import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logError } from "@/lib/logger.ts";
import * as schema from "./schema.ts";

/**
 * One pool per process, created the first time somebody asks for it.
 *
 * Never at module load. Next.js imports modules during the build, where there
 * is no database and no environment — an eager `new Pool()` there turns a build
 * into a connection attempt against nothing. It is the single most common way a
 * Drizzle setup fails on this framework, and it fails at the least useful
 * moment.
 *
 * Held on `globalThis` because the dev server replaces module instances on every
 * edit. Without it, a morning of editing leaves a hundred pools open and
 * PostgreSQL refusing connections for reasons that look nothing like the cause.
 */
declare global {
  var __univPool: Pool | undefined;
}

function pool(): Pool {
  if (globalThis.__univPool) return globalThis.__univPool;

  const configuredUrl = process.env.DATABASE_URL;
  /*
   * Some libraries (notably Better Auth's Drizzle adapter) construct their
   * database metadata while Next evaluates route modules during a production
   * build.  That evaluation must not require credentials or a live server,
   * but it still needs a Pool-shaped object to finish module construction.
   *
   * This placeholder is build-only and is never used for a query: all routes
   * that could access data are request-scoped/dynamic.  Keep the runtime path
   * strict so a misconfigured server fails immediately instead of silently
   * attempting localhost or a developer database.
   */
  const url =
    configuredUrl ??
    (process.env.NEXT_PHASE === "phase-production-build"
      ? "postgresql://build:build@127.0.0.1:5432/build"
      : undefined);
  if (!url) throw new Error("DATABASE_URL is not set");

  const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? 10);
  const max =
    Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 100
      ? configuredMax
      : 10;
  const configuredConnectionTimeout = Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 15_000);
  const connectionTimeoutMillis =
    Number.isInteger(configuredConnectionTimeout) &&
    configuredConnectionTimeout >= 1_000 &&
    configuredConnectionTimeout <= 60_000
      ? configuredConnectionTimeout
      : 15_000;

  const created = new Pool({
    connectionString: url,
    /*
     * Sized for a *process*, not for the institution.
     *
     * Two or three thousand people signed in do not need two or three thousand
     * connections — they need a small number of connections turned over
     * quickly, because a request holds one only for the milliseconds it is
     * inside a transaction. PostgreSQL costs several megabytes and a process per
     * backend, so a pool sized by user count is how a database machine falls
     * over while the CPU sits idle.
     *
     * The real ceiling lives in PgBouncer in front of this (transaction mode —
     * see `withTenant` for why that is safe here and would not be with a
     * session-scoped setting). This number is what one application instance may
     * hold, and `instances × max` must stay under what PgBouncer and PostgreSQL
     * are configured to accept.
     */
    max,
    // A connection nobody has used in 30s is cheaper to re-open than to hold.
    idleTimeoutMillis: 30_000,
    /*
     * Fail fast rather than pile up. Under a stampede — everybody opening the
     * dashboard at 8am — a request that cannot get a connection within the
     * configured timeout has already lost the user; queueing it behind a
     * hundred others turns a slow morning into an outage that outlives the cause.
     */
    connectionTimeoutMillis,
    // A statement that has run for thirty seconds in a back-office registry is
    // a mistake, and it is holding a connection the rest of the building needs.
    statement_timeout: 30_000,
    application_name: "univ-web",
  });

  created.on("error", (error) => {
    // An idle client failing is not a request failing; it must not take the
    // process down, but it must not be silent either.
    logError("database.idle_client_error", error);
  });

  globalThis.__univPool = created;
  return created;
}

/** The query interface. Prefer `withTenant` — this one is not tenant-scoped. */
export function db() {
  return drizzle(pool(), { schema });
}

export type Database = ReturnType<typeof db>;
