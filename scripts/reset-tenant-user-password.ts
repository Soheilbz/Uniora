import { and, eq } from "drizzle-orm";
import { platformDb } from "../src/db/platform.ts";
import * as schema from "../src/db/schema.ts";
import {
  canonicalAuthUsername,
  isValidLocalUsername,
  isValidTenantSlug,
} from "../src/lib/auth-username.ts";
import { PASSWORD_MAXIMUM_LENGTH, PASSWORD_MINIMUM_LENGTH } from "../src/lib/password-policy.ts";
import { privilegedIssuer as issuer } from "./privileged-auth-issuer.ts";

const values = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  values.set(process.argv[i]?.slice(2) ?? "", process.argv[i + 1] ?? "");
const slug = values.get("slug")?.trim().toLowerCase() ?? "";
const username = values.get("username")?.trim().toLowerCase() ?? "";
const password = process.env.TENANT_USER_PASSWORD ?? "";
if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
  fail("database and auth configuration are required");
if (!isValidTenantSlug(slug) || !isValidLocalUsername(username)) fail("invalid account target");
if (password.length < PASSWORD_MINIMUM_LENGTH || password.length > PASSWORD_MAXIMUM_LENGTH)
  fail("invalid password");

const owner = platformDb();
const [tenant] = await owner
  .select({
    id: schema.tenants.id,
    status: schema.tenants.status,
    provisioningStatus: schema.tenants.provisioningStatus,
  })
  .from(schema.tenants)
  .where(eq(schema.tenants.slug, slug))
  .limit(1);
if (tenant?.status !== "active" || tenant.provisioningStatus !== "active")
  fail("tenant is not active");
const authUsername = canonicalAuthUsername(slug, username);
const [target] = await owner
  .select({ id: schema.user.id })
  .from(schema.user)
  .where(and(eq(schema.user.tenantId, tenant.id), eq(schema.user.username, authUsername)))
  .limit(1);
if (!target) fail("account not found in target university");
const [credential] = await owner
  .select({ id: schema.account.id })
  .from(schema.account)
  .where(and(eq(schema.account.userId, target.id), eq(schema.account.providerId, "credential")))
  .limit(1);
if (!credential) fail("password credential not found");
const hash = await issuer.$context.then((context) => context.password.hash(password));
await owner.transaction(async (tx) => {
  await tx
    .update(schema.account)
    .set({ password: hash, updatedAt: new Date() })
    .where(eq(schema.account.id, credential.id));
  await tx
    .update(schema.user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(schema.user.id, target.id));
  await tx.delete(schema.session).where(eq(schema.session.userId, target.id));
  await tx.insert(schema.platformAuditLog).values({
    operator: process.env.PLATFORM_OPERATOR?.trim() || "platform-console",
    requestId: process.env.PLATFORM_REQUEST_ID?.trim() || null,
    action: "tenant.user.password.reset",
    tenantId: tenant.id,
    target: `${slug}/${username}`,
    changes: JSON.stringify({ password: { to: "…" } }),
  });
});
console.log(`password reset: ${slug}/${username}`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
