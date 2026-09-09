import { and, eq, isNull, or } from "drizzle-orm";
import { platformDb } from "../src/db/platform.ts";
import * as schema from "../src/db/schema.ts";
import {
  canonicalAuthUsername,
  isValidLocalUsername,
  isValidTenantSlug,
} from "../src/lib/auth-username.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "../src/lib/password-policy.ts";
import { USERNAME_MAXIMUM_LENGTH, USERNAME_MINIMUM_LENGTH } from "../src/lib/username-policy.ts";
import { privilegedIssuer as issuer } from "./privileged-auth-issuer.ts";

/**
 * Creates an additional senior account for an already provisioned university.
 *
 * This is intentionally a worker-only script. The web role can request this
 * operation, but it cannot issue credentials, assign roles, or cross tenant
 * boundaries itself.
 */

const options = readOptions(process.argv.slice(2));
const operator = process.env.PLATFORM_OPERATOR?.trim() || "platform-console";
const platformRequestId = process.env.PLATFORM_REQUEST_ID?.trim() || null;
const password = process.env.TENANT_USER_PASSWORD ?? "";
const owner = platformDb();

if (!process.env.DATABASE_URL)
  fail("DATABASE_URL is required so the account can be issued safely.");
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  fail("BETTER_AUTH_SECRET must be set and at least 32 characters long.");
}
if (!isValidTenantSlug(options.slug)) fail("invalid tenant slug");
if (!options.name || options.name.length > 160) fail("invalid display name");
if (!isValidLocalUsername(options.username)) {
  fail(
    `--username must be ${USERNAME_MINIMUM_LENGTH}-${USERNAME_MAXIMUM_LENGTH} lowercase letters, digits, dots, underscores or hyphens`,
  );
}
if (password.length < PASSWORD_MINIMUM_LENGTH || password.length > PASSWORD_MAXIMUM_LENGTH) {
  fail(
    `TENANT_USER_PASSWORD must be ${PASSWORD_MINIMUM_LENGTH}-${PASSWORD_MAXIMUM_LENGTH} characters`,
  );
}

const authUsername = canonicalAuthUsername(options.slug, options.username);
const [tenant] = await owner
  .select({
    id: schema.tenants.id,
    status: schema.tenants.status,
    provisioningStatus: schema.tenants.provisioningStatus,
  })
  .from(schema.tenants)
  .where(eq(schema.tenants.slug, options.slug))
  .limit(1);
if (!tenant) fail(`tenant not found: ${options.slug}`);
if (tenant.status !== "active" || tenant.provisioningStatus !== "active") {
  fail(`tenant is not active: ${options.slug}`);
}

const [seniorRole] = await owner
  .select({ id: schema.roles.id })
  .from(schema.roles)
  .where(and(eq(schema.roles.tenantId, tenant.id), eq(schema.roles.key, "research-officer")))
  .limit(1);
if (!seniorRole) fail(`senior role is not configured for tenant: ${options.slug}`);

const [existing] = await owner
  .select({
    id: schema.user.id,
    tenantId: schema.user.tenantId,
    email: schema.user.email,
    createdAt: schema.user.createdAt,
  })
  .from(schema.user)
  .where(eq(schema.user.username, authUsername))
  .limit(1);

/*
 * Better Auth creates the credential row before the application can attach the
 * tenant/role. A process death in that narrow window used to leave an orphan
 * username which made every worker retry fail as "already exists". A queued
 * request can safely resume only the account that was created during *that same
 * request*: the queue row must match the operation/target and the account must
 * have been created no earlier than the request itself. Direct CLI calls keep
 * the strict historical behaviour and never adopt an existing identity.
 */
let resumableExisting = false;
if (existing && platformRequestId) {
  const [request] = await owner
    .select({
      kind: schema.platformOperationRequests.kind,
      payload: schema.platformOperationRequests.payload,
      createdAt: schema.platformOperationRequests.createdAt,
    })
    .from(schema.platformOperationRequests)
    .where(eq(schema.platformOperationRequests.id, platformRequestId))
    .limit(1);
  const payload = request?.payload as Record<string, unknown> | undefined;
  resumableExisting = Boolean(
    request?.kind === "tenant.user.create" &&
      payload?.slug === options.slug &&
      payload?.username === options.username &&
      existing.email === `${authUsername}@users.invalid` &&
      (existing.tenantId === null || existing.tenantId === tenant.id) &&
      existing.createdAt.getTime() >= request.createdAt.getTime(),
  );
}
if (existing && !resumableExisting) {
  fail(`username already exists in this university: ${options.username}`);
}

let createdUserId: string | undefined = resumableExisting ? existing?.id : undefined;
try {
  if (!createdUserId) {
    const result = await issuer.api.signUpEmail({
      body: {
        name: options.name,
        email: `${authUsername}@users.invalid`,
        password,
        username: authUsername,
      },
    });
    createdUserId = result?.user?.id;
    if (!createdUserId) throw new Error("account creation returned no id");
  }

  const createdId = createdUserId;
  await owner.transaction(async (tx) => {
    const [stamped] = await tx
      .update(schema.user)
      .set({ tenantId: tenant.id, displayUsername: options.username, mustChangePassword: true })
      .where(
        and(
          eq(schema.user.id, createdId),
          or(isNull(schema.user.tenantId), eq(schema.user.tenantId, tenant.id)),
        ),
      )
      .returning({ id: schema.user.id });
    if (!stamped) throw new Error("account could not be attached to the university");

    await tx.delete(schema.session).where(eq(schema.session.userId, createdId));
    await tx
      .insert(schema.userRoles)
      .values({ userId: createdId, roleId: seniorRole.id, tenantId: tenant.id })
      .onConflictDoNothing();

    // Role assignment and its request-scoped success proof commit together so
    // the worker can reconcile an acknowledgement failure without re-creating
    // an account or reporting a successful provision as failed.
    await tx.insert(schema.platformAuditLog).values({
      operator,
      requestId: platformRequestId,
      action: "tenant.user.created",
      tenantId: tenant.id,
      target: `${options.slug}/${options.username}`,
      changes: JSON.stringify({ role: "research-officer", displayName: options.name }),
    });
  });
  console.log(`senior account created: ${options.slug}/${options.username}`);
} catch (cause) {
  if (createdUserId) {
    await owner
      .delete(schema.account)
      .where(eq(schema.account.userId, createdUserId))
      .catch(() => undefined);
    await owner
      .delete(schema.user)
      .where(eq(schema.user.id, createdUserId))
      .catch(() => undefined);
  }
  await owner
    .insert(schema.platformAuditLog)
    .values({
      operator,
      requestId: platformRequestId,
      action: "tenant.user.create.failed",
      tenantId: tenant.id,
      target: `${options.slug}/${options.username}`,
      outcome: "failure",
      changes: JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }),
    })
    .catch(() => undefined);
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
}

process.exit(0);

function readOptions(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) continue;
    values.set(key.slice(2), value);
    index += 1;
  }
  return {
    slug: values.get("slug")?.trim().toLowerCase() ?? "",
    name: values.get("name")?.trim() ?? "",
    username: values.get("username")?.trim().toLowerCase() ?? "",
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
