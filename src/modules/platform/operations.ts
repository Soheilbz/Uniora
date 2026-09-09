import { desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/db/client.ts";
import {
  jobs,
  platformOperationalHealth,
  platformOperationRequests,
  tenants,
  workerRuntimeHealth,
} from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import { readObjectStorageHealth, type StorageCapabilities } from "./storage-health";

export interface PlatformOperationalHealth {
  jobs: {
    queued: number;
    running: number;
    retry: number;
    failed24h: number;
    staleLeases: number;
    lastHeartbeatAt: Date | null;
    platformWorkerHeartbeatAt: Date | null;
    oldestPlatformOperationAgeMinutes: number | null;
  };
  database: {
    latencyMs: number | null;
    serverVersion: string | null;
    totalConnections: number | null;
    activeConnections: number | null;
    idleInTransaction: number | null;
    longTransactions: number | null;
    migrationMarker: string | null;
    maxConnections: number | null;
    connectionUtilizationPct: number | null;
    pgStatStatementsAvailable: boolean;
    queryStatsStatus: "available" | "not-installed" | "not-enabled" | "unavailable";
    slowQueries: number | null;
    worstMeanQueryMs: number | null;
    indexHitRatioPct: number | null;
    deadTuples: number | null;
    tablesNeedingVacuum: number | null;
    databaseSizeBytes: number | null;
  };
  backup: {
    latestCreatedAt: Date | null;
    ageHours: number | null;
    manifest: string | null;
    retainedCount: number;
    totalBytes: number;
    oldestCreatedAt: Date | null;
    lastVerifiedAt: Date | null;
    backups: Array<{
      manifest: string;
      createdAt: Date;
      sizeBytes: number;
      offsite: boolean;
      metadataValid: boolean;
      lastVerifiedAt: Date | null;
    }>;
  };
  storage: {
    status: "verified" | "unconfigured" | "unreachable" | "partial";
    provider: "s3-compatible" | "unconfigured";
    checkedAt: Date | null;
    capabilities: StorageCapabilities;
  };
}

interface TenantJobHealth {
  queued: number;
  running: number;
  retry: number;
  failed24h: number;
  staleLeases: number;
  lastHeartbeatAt: Date | null;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index] as T);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, () => worker()),
  );
  return output;
}

async function readTenantJobHealth(): Promise<
  Omit<PlatformOperationalHealth["jobs"], "oldestPlatformOperationAgeMinutes">
> {
  const tenantRows = await db().select({ id: tenants.id }).from(tenants);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const perTenant = await mapWithConcurrency(tenantRows, 4, (tenant) =>
    readOnly(
      tenant.id,
      async (tx): Promise<TenantJobHealth> => {
        const [row] = await tx
          .select({
            queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')::int`,
            running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
            retry: sql<number>`count(*) filter (where ${jobs.status} = 'retry')::int`,
            failed24h: sql<number>`count(*) filter (where ${jobs.status} = 'failed' and ${jobs.updatedAt} >= ${yesterday})::int`,
            staleLeases: sql<number>`count(*) filter (where ${jobs.status} = 'running' and ${jobs.leaseUntil} is not null and ${jobs.leaseUntil} < ${now})::int`,
            lastHeartbeatAt: max(jobs.heartbeatAt),
          })
          .from(jobs);
        return {
          queued: Number(row?.queued ?? 0),
          running: Number(row?.running ?? 0),
          retry: Number(row?.retry ?? 0),
          failed24h: Number(row?.failed24h ?? 0),
          staleLeases: Number(row?.staleLeases ?? 0),
          lastHeartbeatAt: row?.lastHeartbeatAt ?? null,
        };
      },
      { allowInactive: true },
    ),
  );

  const result = perTenant.reduce<
    Omit<
      PlatformOperationalHealth["jobs"],
      "platformWorkerHeartbeatAt" | "oldestPlatformOperationAgeMinutes"
    >
  >(
    (total, row) => ({
      queued: total.queued + row.queued,
      running: total.running + row.running,
      retry: total.retry + row.retry,
      failed24h: total.failed24h + row.failed24h,
      staleLeases: total.staleLeases + row.staleLeases,
      lastHeartbeatAt:
        !total.lastHeartbeatAt ||
        (row.lastHeartbeatAt && row.lastHeartbeatAt > total.lastHeartbeatAt)
          ? row.lastHeartbeatAt
          : total.lastHeartbeatAt,
    }),
    { queued: 0, running: 0, retry: 0, failed24h: 0, staleLeases: 0, lastHeartbeatAt: null },
  );
  try {
    const [worker] = await db()
      .select({ observedAt: workerRuntimeHealth.observedAt })
      .from(workerRuntimeHealth)
      .where(eq(workerRuntimeHealth.executionClass, "platform"))
      .orderBy(desc(workerRuntimeHealth.observedAt))
      .limit(1);
    return { ...result, platformWorkerHeartbeatAt: worker?.observedAt ?? null };
  } catch {
    return { ...result, platformWorkerHeartbeatAt: null };
  }
}

async function readPlatformOperationAge(): Promise<number | null> {
  try {
    const [row] = await db()
      .select({ oldestCreatedAt: sql<Date | null>`min(${platformOperationRequests.createdAt})` })
      .from(platformOperationRequests)
      .where(eq(platformOperationRequests.status, "queued"));
    if (!row?.oldestCreatedAt) return null;
    const ageMinutes = (Date.now() - row.oldestCreatedAt.getTime()) / 60_000;
    return Number.isFinite(ageMinutes) ? Math.max(0, Math.round(ageMinutes * 10) / 10) : null;
  } catch {
    return null;
  }
}

async function readDatabaseHealth(): Promise<PlatformOperationalHealth["database"]> {
  const started = performance.now();
  let latencyMs: number | null = null;
  let serverVersion: string | null = null;
  let totalConnections: number | null = null;
  let activeConnections: number | null = null;
  let idleInTransaction: number | null = null;
  let longTransactions: number | null = null;
  let migrationMarker: string | null = null;
  let maxConnections: number | null = null;
  let connectionUtilizationPct: number | null = null;
  let pgStatStatementsAvailable = false;
  let queryStatsStatus: PlatformOperationalHealth["database"]["queryStatsStatus"] = "unavailable";
  let slowQueries: number | null = null;
  let worstMeanQueryMs: number | null = null;
  let indexHitRatioPct: number | null = null;
  let deadTuples: number | null = null;
  let tablesNeedingVacuum: number | null = null;
  let databaseSizeBytes: number | null = null;

  try {
    const result = await db().execute(sql`
      select current_setting('server_version') as server_version,
             count(*)::int as total_connections,
             count(*) filter (where state = 'active')::int as active_connections,
             count(*) filter (where state = 'idle in transaction')::int as idle_in_transaction,
             count(*) filter (where xact_start is not null and now() - xact_start > interval '5 minutes')::int as long_transactions
        from pg_stat_activity
       where datname = current_database()
       group by current_setting('server_version')
    `);
    latencyMs = Math.max(0, Math.round((performance.now() - started) * 10) / 10);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    serverVersion = typeof row?.server_version === "string" ? row.server_version : null;
    totalConnections = Number.isFinite(Number(row?.total_connections))
      ? Number(row?.total_connections)
      : null;
    activeConnections = Number.isFinite(Number(row?.active_connections))
      ? Number(row?.active_connections)
      : null;
    idleInTransaction = Number.isFinite(Number(row?.idle_in_transaction))
      ? Number(row?.idle_in_transaction)
      : null;
    longTransactions = Number.isFinite(Number(row?.long_transactions))
      ? Number(row?.long_transactions)
      : null;
  } catch {
    latencyMs = null;
  }

  try {
    const result = await db().execute(sql`
      select coalesce(max(id)::text, max(hash)::text) as marker
        from drizzle.__drizzle_migrations
    `);
    const marker = (result.rows[0] as Record<string, unknown> | undefined)?.marker;
    migrationMarker = marker === null || marker === undefined ? null : String(marker);
  } catch {
    /* Older Drizzle metadata layouts vary; an unavailable marker is diagnostic, not a page failure. */
  }

  try {
    const result = await db().execute(sql`
      select current_setting('max_connections')::int as max_connections,
             pg_database_size(current_database())::bigint as database_size_bytes,
             case when sum(blks_hit + blks_read) = 0 then null
                  else round(100.0 * sum(blks_hit) / sum(blks_hit + blks_read), 2) end as index_hit_ratio_pct
        from pg_stat_database
       where datname=current_database()
       group by current_setting('max_connections')
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    maxConnections = Number.isFinite(Number(row?.max_connections))
      ? Number(row?.max_connections)
      : null;
    databaseSizeBytes = Number.isFinite(Number(row?.database_size_bytes))
      ? Number(row?.database_size_bytes)
      : null;
    indexHitRatioPct = Number.isFinite(Number(row?.index_hit_ratio_pct))
      ? Number(row?.index_hit_ratio_pct)
      : null;
    if (maxConnections && totalConnections !== null)
      connectionUtilizationPct = Math.round((totalConnections / maxConnections) * 1000) / 10;
  } catch {
    /* optional statistics privilege */
  }

  try {
    const result = await db().execute(sql`
      select coalesce(sum(n_dead_tup),0)::bigint as dead_tuples,
             count(*) filter (where n_dead_tup > greatest(10000, n_live_tup * 0.2))::int as tables_needing_vacuum
        from pg_stat_user_tables
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    deadTuples = Number.isFinite(Number(row?.dead_tuples)) ? Number(row?.dead_tuples) : null;
    tablesNeedingVacuum = Number.isFinite(Number(row?.tables_needing_vacuum))
      ? Number(row?.tables_needing_vacuum)
      : null;
  } catch {
    /* optional statistics privilege */
  }

  try {
    const extensionState = await db().execute(sql`
      select exists(select 1 from pg_extension where extname = 'pg_stat_statements') as installed
    `);
    const extensionRow = extensionState.rows[0] as Record<string, unknown> | undefined;
    const installed = extensionRow?.installed === true || extensionRow?.installed === "t";
    if (!installed) queryStatsStatus = "not-installed";
    else {
      const result = await db().execute(sql`
      select count(*) filter (where mean_exec_time >= 250)::int as slow_queries,
             max(mean_exec_time)::double precision as worst_mean_query_ms
        from pg_stat_statements
       where dbid=(select oid from pg_database where datname=current_database())
    `);
      pgStatStatementsAvailable = true;
      queryStatsStatus = "available";
      const row = result.rows[0] as Record<string, unknown> | undefined;
      slowQueries = Number.isFinite(Number(row?.slow_queries)) ? Number(row?.slow_queries) : null;
      worstMeanQueryMs = Number.isFinite(Number(row?.worst_mean_query_ms))
        ? Math.round(Number(row?.worst_mean_query_ms) * 10) / 10
        : null;
    }
  } catch {
    queryStatsStatus = "unavailable";
  }

  return {
    latencyMs,
    serverVersion,
    totalConnections,
    activeConnections,
    idleInTransaction,
    longTransactions,
    migrationMarker,
    maxConnections,
    connectionUtilizationPct,
    pgStatStatementsAvailable,
    queryStatsStatus,
    slowQueries,
    worstMeanQueryMs,
    indexHitRatioPct,
    deadTuples,
    tablesNeedingVacuum,
    databaseSizeBytes,
  };
}

async function readBackupHealth(): Promise<PlatformOperationalHealth["backup"]> {
  try {
    const [row] = await db()
      .select({
        status: platformOperationalHealth.status,
        payloadJson: platformOperationalHealth.payloadJson,
      })
      .from(platformOperationalHealth)
      .where(eq(platformOperationalHealth.key, "backup"))
      .limit(1);
    if (row?.status !== "ok")
      return {
        latestCreatedAt: null,
        ageHours: null,
        manifest: null,
        retainedCount: 0,
        totalBytes: 0,
        oldestCreatedAt: null,
        lastVerifiedAt: null,
        backups: [],
      };
    const payload = JSON.parse(row.payloadJson) as {
      latestCreatedAt?: unknown;
      manifest?: unknown;
      retainedCount?: unknown;
      totalBytes?: unknown;
      oldestCreatedAt?: unknown;
      lastVerifiedAt?: unknown;
      backups?: unknown;
    };
    const latestCreatedAt = new Date(String(payload.latestCreatedAt ?? ""));
    if (Number.isNaN(latestCreatedAt.getTime()))
      return {
        latestCreatedAt: null,
        ageHours: null,
        manifest: null,
        retainedCount: 0,
        totalBytes: 0,
        oldestCreatedAt: null,
        lastVerifiedAt: null,
        backups: [],
      };
    const manifest =
      typeof payload.manifest === "string" && /^[A-Za-z0-9._-]{1,255}$/.test(payload.manifest)
        ? payload.manifest
        : null;
    const parseDate = (value: unknown) => {
      const date = new Date(String(value ?? ""));
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const backups = Array.isArray(payload.backups)
      ? payload.backups.flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          const manifest =
            typeof item.manifest === "string" && /^[A-Za-z0-9._-]{1,255}$/.test(item.manifest)
              ? item.manifest
              : null;
          const createdAt = parseDate(item.createdAt);
          const sizeBytes = Number(item.sizeBytes);
          if (!manifest || !createdAt || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
            return [];
          return [
            {
              manifest,
              createdAt,
              sizeBytes,
              offsite: item.offsite === true,
              metadataValid: item.metadataValid === true,
              lastVerifiedAt: parseDate(item.lastVerifiedAt),
            },
          ];
        })
      : [];
    return {
      latestCreatedAt,
      ageHours: Math.max(
        0,
        Math.round(((Date.now() - latestCreatedAt.getTime()) / 3_600_000) * 10) / 10,
      ),
      manifest,
      retainedCount:
        Number.isSafeInteger(Number(payload.retainedCount)) && Number(payload.retainedCount) >= 0
          ? Number(payload.retainedCount)
          : 0,
      totalBytes:
        Number.isSafeInteger(Number(payload.totalBytes)) && Number(payload.totalBytes) >= 0
          ? Number(payload.totalBytes)
          : 0,
      oldestCreatedAt: parseDate(payload.oldestCreatedAt),
      lastVerifiedAt: parseDate(payload.lastVerifiedAt),
      backups,
    };
  } catch {
    return {
      latestCreatedAt: null,
      ageHours: null,
      manifest: null,
      retainedCount: 0,
      totalBytes: 0,
      oldestCreatedAt: null,
      lastVerifiedAt: null,
      backups: [],
    };
  }
}

export async function readPlatformOperationalHealth(): Promise<PlatformOperationalHealth> {
  const [jobHealth, oldestPlatformOperationAgeMinutes, database, backup, storage] =
    await Promise.all([
      readTenantJobHealth(),
      readPlatformOperationAge(),
      readDatabaseHealth(),
      readBackupHealth(),
      readObjectStorageHealth(),
    ]);
  return {
    jobs: { ...jobHealth, oldestPlatformOperationAgeMinutes },
    database,
    backup,
    storage,
  };
}
