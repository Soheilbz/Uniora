#!/usr/bin/env node
import pg from "pg";
import { positiveNumberEnv, requireOperationsDatabaseUrl } from "./lib/operations-config.mjs";

const connectionString = requireOperationsDatabaseUrl();
const slowMs = positiveNumberEnv("DB_SLOW_QUERY_MEAN_MS", 250);
const pool = new pg.Pool({ connectionString, application_name: "univ-db-observability" });

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}
async function optional(client, text) {
  try {
    return await client.query(text);
  } catch (error) {
    return { rows: [], unavailable: error instanceof Error ? error.message : String(error) };
  }
}

const client = await pool.connect();
try {
  const activity = await client.query(`
    select current_setting('server_version') server_version,
           current_setting('max_connections')::int max_connections,
           count(*)::int total_connections,
           count(*) filter(where state='active')::int active_connections,
           count(*) filter(where state='idle in transaction')::int idle_in_transaction,
           count(*) filter(where xact_start is not null and now()-xact_start>interval '5 minutes')::int long_transactions
      from pg_stat_activity where datname=current_database()
      group by current_setting('server_version'), current_setting('max_connections')`);
  const tables = await client.query(`
    select schemaname,relname,n_live_tup,n_dead_tup,seq_scan,idx_scan,last_autovacuum,last_autoanalyze
      from pg_stat_user_tables order by n_dead_tup desc, relname limit 100`);
  const database = await client.query(`
    select pg_database_size(current_database())::bigint database_size_bytes,
           case when blks_hit+blks_read=0 then null else round(100.0*blks_hit/(blks_hit+blks_read),2) end cache_hit_ratio_pct,
           xact_commit,xact_rollback,deadlocks,temp_files,temp_bytes
      from pg_stat_database where datname=current_database()`);
  const statements = await optional(
    client,
    `
    select queryid,calls,round(mean_exec_time::numeric,2) mean_exec_time_ms,
           round(total_exec_time::numeric,2) total_exec_time_ms,rows,
           left(regexp_replace(query,'\\s+',' ','g'),300) query
      from pg_stat_statements where dbid=(select oid from pg_database where datname=current_database())
      order by mean_exec_time desc nulls last limit 25`,
  );
  const a = activity.rows[0] ?? {};
  const utilization =
    n(a.max_connections) && n(a.total_connections) !== null
      ? Math.round((Number(a.total_connections) / Number(a.max_connections)) * 1000) / 10
      : null;
  const slow = statements.rows.filter((row) => Number(row.mean_exec_time_ms) >= slowMs);
  const output = {
    generatedAt: new Date().toISOString(),
    serverVersion: a.server_version ?? null,
    connections: {
      total: n(a.total_connections),
      active: n(a.active_connections),
      max: n(a.max_connections),
      utilizationPct: utilization,
      idleInTransaction: n(a.idle_in_transaction),
      longTransactions: n(a.long_transactions),
    },
    database: database.rows[0] ?? null,
    pgStatStatements: {
      available: !statements.unavailable,
      unavailableReason: statements.unavailable ?? null,
      thresholdMeanMs: slowMs,
      slowCount: slow.length,
      worst: statements.rows,
    },
    tables: tables.rows,
    warnings: [
      ...(utilization !== null && utilization >= 80
        ? [`connection utilization ${utilization}% >= 80%`]
        : []),
      ...(Number(a.idle_in_transaction ?? 0) > 0
        ? [`${a.idle_in_transaction} idle-in-transaction sessions`]
        : []),
      ...(Number(a.long_transactions ?? 0) > 0
        ? [`${a.long_transactions} transactions older than five minutes`]
        : []),
      ...tables.rows
        .filter((row) => Number(row.n_dead_tup) > Math.max(10000, Number(row.n_live_tup) * 0.2))
        .map((row) => `${row.schemaname}.${row.relname} vacuum pressure`),
      ...(slow.length
        ? [`${slow.length} pg_stat_statements fingerprints exceed ${slowMs}ms mean`]
        : []),
    ],
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  client.release();
  await pool.end();
}
