import { sql } from "drizzle-orm";
import { type Database, db } from "./client.ts";

interface TenantScopeOptions {
  /** Provisioning is the only caller allowed to scope a tenant before activation. */
  allowInactive?: boolean;
}

export type TenantTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class TenantUnavailableError extends Error {
  constructor() {
    super("tenant is not active and fully provisioned");
    this.name = "TenantUnavailableError";
  }
}

async function establishTenantContext(
  tx: TenantTx,
  tenantId: string,
  options: TenantScopeOptions,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  if (!options.allowInactive) {
    const state = await tx.execute(sql`
      SELECT status, provisioning_status AS "provisioningStatus"
      FROM tenants WHERE id=${tenantId} LIMIT 1
    `);
    const row = state.rows[0] as { status?: unknown; provisioningStatus?: unknown } | undefined;
    if (row?.status !== "active" || row.provisioningStatus !== "active") {
      throw new TenantUnavailableError();
    }
  }
  const zone = await tx.execute(sql`
    SELECT coalesce((
      SELECT i.timezone
      FROM institutions i
      JOIN pg_timezone_names z ON z.name=i.timezone
      WHERE i.tenant_id=${tenantId}
      LIMIT 1
    ), 'UTC') AS timezone
  `);
  const timeZone = String((zone.rows[0] as { timezone?: unknown } | undefined)?.timezone ?? "UTC");
  await tx.execute(sql`SELECT set_config('TimeZone', ${timeZone}, true)`);
}

/**
 * Every read and every write of institutional data, scoped to one university.
 *
 * ── Why this is a transaction, and why that is not a detail ──────────────────
 *
 * Row-level security decides what a query may see by reading `app.tenant_id`,
 * and this sets it with `set_config(..., true)` — the `true` meaning *local to
 * this transaction*. That one argument is what makes the whole deployment
 * possible at the size this is built for.
 *
 * A couple of thousand people signed in cannot each hold a PostgreSQL backend,
 * so PgBouncer sits in front in **transaction mode**: a client gets a server
 * connection for the length of a transaction and hands it back. Anything set
 * with a session-scoped `SET` would survive that handover and be inherited by
 * whoever got the connection next — which, here, means one university reading
 * another university's records. Transaction-scoped settings cannot leak that
 * way: the value dies with the transaction that set it, before the connection
 * goes back to the pool.
 *
 * So the rule is absolute, and it is the reason this function exists rather
 * than a middleware that sets the tenant once per request:
 *
 *   **The tenant is set inside the transaction that uses it. Never outside.**
 *
 * A query issued outside `withTenant` has no tenant context. The RLS helper
 * raises in that state rather than returning an empty result, making a forgotten
 * scope an explicit failure instead of something that can be mistaken for an
 * institution with no data.
 */
export async function withTenant<T>(
  tenantId: string,
  run: (tx: TenantTx) => Promise<T>,
  options: TenantScopeOptions = {},
): Promise<T> {
  if (!tenantId) throw new Error("withTenant requires a tenant id");
  return db().transaction(async (tx) => {
    await establishTenantContext(tx, tenantId, options);
    return run(tx);
  });
}

/**
 * A read-only transaction, for the screens that only look.
 *
 * `READ ONLY` is cheap insurance: it turns a mistake — a mutation on
 * a reporting path — into an error instead of a write nobody expected. Reports
 * over a full archive are exactly where a stray write would be least noticed.
 */
export async function readOnly<T>(
  tenantId: string,
  run: (tx: TenantTx) => Promise<T>,
  options: Pick<TenantScopeOptions, "allowInactive"> = {},
): Promise<T> {
  if (!tenantId) throw new Error("readOnly requires a tenant id");
  return db().transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await establishTenantContext(tx, tenantId, options);
    return run(tx);
  });
}
