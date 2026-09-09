import { and, eq, isNull, or, sql } from "drizzle-orm";
import { platformDb } from "../src/db/platform.ts";
import * as schema from "../src/db/schema.ts";
import {
  canonicalAuthUsername,
  isValidLocalUsername,
  isValidTenantSlug,
  TENANT_SLUG_MAXIMUM_LENGTH,
  TENANT_SLUG_MINIMUM_LENGTH,
} from "../src/lib/auth-username.ts";
import { DEFAULT_TENANT_ROLES } from "../src/lib/tenant-defaults.ts";
import { USERNAME_MAXIMUM_LENGTH, USERNAME_MINIMUM_LENGTH } from "../src/lib/username-policy.ts";
import { privilegedIssuer as issuer } from "./privileged-auth-issuer.ts";

/**
 * Provisions one real university and its first administrator.
 *
 * The command is deliberately outside the web app. Creating a tenant crosses
 * the RLS boundary and must be an audited operator action, never a public
 * endpoint. The admin password is supplied through TENANT_ADMIN_PASSWORD so it
 * does not appear in shell history or a process argument list.
 *
 * Example:
 *   TENANT_ADMIN_PASSWORD='...' pnpm tenant:create -- --slug uni-a \
 *     --name "دانشگاه الف" --admin-username admin --admin-name "مدیر دانشگاه"
 */

const options = readOptions(process.argv.slice(2));
const operator = process.env.PLATFORM_OPERATOR?.trim() || "local-operator";
const platformRequestId = process.env.PLATFORM_REQUEST_ID?.trim() || null;
const password = process.env.TENANT_ADMIN_PASSWORD ?? "";
const platformUrl = process.env.DATABASE_PLATFORM_URL ?? "";

if (!platformUrl) fail("DATABASE_PLATFORM_URL is required.");
if (!process.env.DATABASE_URL)
  fail("DATABASE_URL is required so the new account can be issued safely.");
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  fail("BETTER_AUTH_SECRET must be set and at least 32 characters long.");
}
if (!isValidTenantSlug(options.slug)) {
  fail(
    `--slug must be ${TENANT_SLUG_MINIMUM_LENGTH}-${TENANT_SLUG_MAXIMUM_LENGTH} lowercase letters, numbers or hyphens, starting and ending with a letter or number.`,
  );
}
if (!options.name) fail("--name is required.");
if (!isValidLocalUsername(options.adminUsername)) {
  fail(
    `--admin-username must be ${USERNAME_MINIMUM_LENGTH}-${USERNAME_MAXIMUM_LENGTH} lowercase letters, numbers, dots, underscores or hyphens.`,
  );
}
if (password.length < 12) fail("TENANT_ADMIN_PASSWORD must be at least 12 characters long.");

const authUsername = canonicalAuthUsername(options.slug, options.adminUsername);
const owner = platformDb();
const [existingTenant] = await owner
  .select({
    id: schema.tenants.id,
    status: schema.tenants.status,
    provisioningStatus: schema.tenants.provisioningStatus,
    provisioningRequestId: schema.tenants.provisioningRequestId,
    createdAt: schema.tenants.createdAt,
  })
  .from(schema.tenants)
  .where(eq(schema.tenants.slug, options.slug))
  .limit(1);

const canResumeTenant = Boolean(
  existingTenant &&
    platformRequestId &&
    existingTenant.provisioningRequestId === platformRequestId &&
    existingTenant.status === "suspended" &&
    existingTenant.provisioningStatus === "provisioning",
);
if (existingTenant && !canResumeTenant) {
  fail(
    `tenant slug already exists: ${options.slug}. If provisioning failed, inspect it with tenant:list and use tenant:failed:purge before retrying.`,
  );
}

let tenantId: string | undefined = canResumeTenant ? existingTenant?.id : undefined;
let createdUserId: string | undefined;
try {
  /*
   * The queue request id is persisted on the suspended provisioning shell. It
   * makes process-crash recovery unambiguous: only the request that created the
   * shell may resume it. A direct CLI invocation still refuses every existing
   * slug, preserving the conservative operator workflow.
   */
  let administratorRoleId: string | undefined;
  if (tenantId) {
    const [administratorRole] = await owner
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.key, "administrator")))
      .limit(1);
    administratorRoleId = administratorRole?.id;
    if (!administratorRoleId) throw new Error("resumable tenant has no administrator role");
  } else {
    const provisioned = await owner.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          slug: options.slug,
          name: options.name,
          status: "suspended",
          provisioningStatus: "provisioning",
          provisioningRequestId: platformRequestId,
        })
        .returning({ id: schema.tenants.id });
      const createdTenantId = tenant?.id;
      if (!createdTenantId) throw new Error("tenant creation returned no id.");

      await tx
        .insert(schema.institutions)
        .values({ tenantId: createdTenantId, name: options.name });
      let roleId: string | undefined;
      for (const definition of DEFAULT_TENANT_ROLES) {
        const [role] = await tx
          .insert(schema.roles)
          .values({
            tenantId: createdTenantId,
            key: definition.key,
            name: definition.name,
            tier: definition.tier,
            isSystem: true,
          })
          .returning({ id: schema.roles.id });
        if (!role) throw new Error(`role creation failed: ${definition.key}`);
        if (definition.key === "administrator") roleId = role.id;
        if (definition.capabilities.length > 0) {
          await tx
            .insert(schema.roleCapabilities)
            .values(definition.capabilities.map((capability) => ({ roleId: role.id, capability })));
        }
      }
      if (!roleId) throw new Error("administrator role was not created.");
      return { tenantId: createdTenantId, administratorRoleId: roleId };
    });
    tenantId = provisioned.tenantId;
    administratorRoleId = provisioned.administratorRoleId;
  }

  if (!tenantId || !administratorRoleId)
    throw new Error("tenant provisioning lost its identifiers.");
  const provisionedTenantId = tenantId;

  const [existingUser] = await owner
    .select({
      id: schema.user.id,
      tenantId: schema.user.tenantId,
      email: schema.user.email,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .where(eq(schema.user.username, authUsername))
    .limit(1);

  const resumableUser = Boolean(
    existingUser &&
      canResumeTenant &&
      existingUser.email === `${authUsername}@users.invalid` &&
      (existingUser.tenantId === null || existingUser.tenantId === provisionedTenantId) &&
      existingTenant &&
      existingUser.createdAt.getTime() >= existingTenant.createdAt.getTime(),
  );
  if (existingUser && !resumableUser) {
    throw new Error(
      `administrator username already exists in this tenant: ${options.adminUsername}`,
    );
  }

  if (resumableUser) {
    createdUserId = existingUser?.id;
  } else {
    const result = await issuer.api.signUpEmail({
      body: {
        name: options.adminName,
        email: `${authUsername}@users.invalid`,
        password,
        username: authUsername,
      },
    });
    createdUserId = result?.user?.id;
    if (!createdUserId) throw new Error("administrator account creation returned no id.");
  }

  const provisionedUserId = createdUserId;
  if (!provisionedUserId) throw new Error("administrator provisioning lost its identity id.");

  /*
   * Everything after Better Auth's credential creation is one privileged
   * transaction: tenant attachment, role/ownership, activation and the durable
   * request-scoped audit proof. A crash can therefore happen either before all
   * of these effects or after all of them, never in a half-activated state.
   */
  await owner.transaction(async (tx) => {
    const [stamped] = await tx
      .update(schema.user)
      .set({
        tenantId: provisionedTenantId,
        displayUsername: options.adminUsername,
        mustChangePassword: true,
      })
      .where(
        and(
          eq(schema.user.id, provisionedUserId),
          or(isNull(schema.user.tenantId), eq(schema.user.tenantId, provisionedTenantId)),
        ),
      )
      .returning({ id: schema.user.id });
    if (!stamped) throw new Error("administrator account could not be attached to the new tenant.");

    await tx.delete(schema.session).where(eq(schema.session.userId, provisionedUserId));
    await tx
      .insert(schema.userRoles)
      .values({
        userId: provisionedUserId,
        roleId: administratorRoleId,
        tenantId: provisionedTenantId,
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.tenantOwners)
      .values({ tenantId: provisionedTenantId, userId: provisionedUserId })
      .onConflictDoUpdate({
        target: schema.tenantOwners.tenantId,
        set: { userId: provisionedUserId, updatedAt: new Date() },
      });

    await tx
      .update(schema.tenants)
      .set({
        status: "active",
        provisioningStatus: "active",
        provisioningRequestId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tenants.id, provisionedTenantId),
          eq(schema.tenants.provisioningStatus, "provisioning"),
        ),
      );
    await tx.insert(schema.platformAuditLog).values({
      operator,
      requestId: platformRequestId,
      action: "tenant.created",
      tenantId: provisionedTenantId,
      target: options.slug,
      changes: JSON.stringify({ administrator: options.adminUsername }),
    });
  });

  console.log(`tenant created: ${options.slug}`);
  console.log(`administrator created: ${options.adminUsername}`);
} catch (cause) {
  /* Best-effort compensation for the Better Auth phase. A hard process death is
     handled by the request-owned provisioning shell above; an ordinary thrown
     error is cleaned up immediately so the slug does not remain wedged. */
  const cleanupErrors: unknown[] = [];
  const cleanupTenantId = tenantId;
  if (cleanupTenantId) {
    try {
      await owner.transaction(async (tx) => {
        if (createdUserId) {
          await tx.delete(schema.tenantOwners).where(eq(schema.tenantOwners.userId, createdUserId));
          await tx.delete(schema.userRoles).where(eq(schema.userRoles.userId, createdUserId));
          await tx.delete(schema.session).where(eq(schema.session.userId, createdUserId));
          await tx.delete(schema.account).where(eq(schema.account.userId, createdUserId));
          await tx.delete(schema.user).where(eq(schema.user.id, createdUserId));
        }
        await tx
          .delete(schema.institutions)
          .where(eq(schema.institutions.tenantId, cleanupTenantId));
        await tx
          .delete(schema.roleCapabilities)
          .where(
            sql`${schema.roleCapabilities.roleId} in (select id from roles where tenant_id = ${cleanupTenantId})`,
          );
        await tx.delete(schema.roles).where(eq(schema.roles.tenantId, cleanupTenantId));
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, cleanupTenantId));
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  } else if (createdUserId) {
    try {
      await owner.delete(schema.account).where(eq(schema.account.userId, createdUserId));
      await owner.delete(schema.user).where(eq(schema.user.id, createdUserId));
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await owner.insert(schema.platformAuditLog).values({
      operator,
      requestId: platformRequestId,
      action: "tenant.create.failed",
      tenantId: cleanupErrors.length > 0 ? tenantId : null,
      target: options.slug,
      outcome: "failure",
      changes: JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }),
    });
  } catch (auditError) {
    cleanupErrors.push(auditError);
  }
  if (cleanupErrors.length > 0 && tenantId) {
    try {
      await owner
        .update(schema.tenants)
        .set({ status: "suspended", provisioningStatus: "failed", updatedAt: new Date() })
        .where(eq(schema.tenants.id, tenantId));
    } catch (statusError) {
      cleanupErrors.push(statusError);
    }
  }
  console.error(cause);
  for (const error of cleanupErrors) console.error("tenant provisioning cleanup failed:", error);
  process.exit(1);
}

/* `pg` pools intentionally stay alive for reuse. This is a one-shot operator
   command, so exit after every awaited write has completed rather than waiting
   for pool idle timers to expire. */
process.exit(0);

function readOptions(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) fail(`${key} needs a value.`);
    values.set(key.slice(2), value);
    index += 1;
  }
  return {
    slug: values.get("slug")?.trim().toLowerCase() ?? "",
    name: values.get("name")?.trim() ?? "",
    adminUsername: values.get("admin-username")?.trim().toLowerCase() ?? "",
    adminName: values.get("admin-name")?.trim() || "مدیر سامانه",
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
