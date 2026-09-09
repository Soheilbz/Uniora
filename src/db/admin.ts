import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

let ownerPool: Pool | undefined;

/**
 * The owning role, for the two jobs that legitimately cross tenant boundaries.
 *
 * Migrations and seeding create tenants; those few global rows cannot be
 * scoped to a tenant. They connect as the database owner, while tenant-owned
 * work is still explicitly scoped because this role does not bypass FORCE RLS.
 *
 * **Nothing that serves a request may import this.** The application's own
 * connection is `db()` in `client.ts`, which uses a NOSUPERUSER / NOBYPASSRLS
 * role precisely so that the policies apply to it — and a page that reached for
 * this instead would read every university's records with no error and no sign
 * that anything was wrong. That is the failure this file's separateness exists
 * to make hard: it is a different function, in a different file, with a
 * different environment variable behind it.
 */
export function adminDb() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new Error(
      "DATABASE_ADMIN_URL is not set. This is the owning-role connection used by " +
        "migrations and the seeder only; the application uses DATABASE_URL.",
    );
  }
  /* Keep one connection pool per short-lived administrative process. This is
   * deliberately module-local (never globalThis): it lets integration tests
   * establish one explicit tenant context and reuse that same connection for
   * their direct fixture queries, while the Web process cannot import this
   * module or inherit the owner pool. */
  ownerPool ??= new Pool({ connectionString: url, max: 1 });
  return drizzle(ownerPool, { schema });
}

/**
 * Scope direct administrative fixture/setup queries to one tenant.
 *
 * The owner role is also NOBYPASSRLS in this deployment, so FORCE RLS is
 * useful in tests: a fixture that forgets its scope fails loudly instead of
 * accidentally proving a query against every university. The setting is
 * session-local because ownerPool is a single-connection pool and this helper
 * is used only by sequential integration tests and one-shot seed helpers.
 */
export async function setAdminTenantContext(tenantId: string): Promise<void> {
  if (!tenantId) throw new Error("setAdminTenantContext requires a tenant id");
  await adminDb().execute(sql`select set_config('app.tenant_id', ${tenantId}, false)`);
}
