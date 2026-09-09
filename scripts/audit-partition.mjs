#!/usr/bin/env node
import pg from "pg";
import { positiveIntegerEnv, requireOperationsDatabaseUrl } from "./lib/operations-config.mjs";

const command = process.argv[2] || "status";
const connectionString = requireOperationsDatabaseUrl();
const rowThreshold = positiveIntegerEnv("AUDIT_PARTITION_ROW_THRESHOLD", 5_000_000);
const sizeThreshold = positiveIntegerEnv("AUDIT_PARTITION_SIZE_BYTES", 10 * 1024 * 1024 * 1024);
const pool = new pg.Pool({ connectionString, application_name: "univ-audit-partition-advisor" });
const c = await pool.connect();
try {
  const r = await c.query(
    `select c.relispartition,pg_total_relation_size(c.oid)::bigint bytes,reltuples::bigint estimated_rows,(select min(created_at) from audit_log) oldest,(select max(created_at) from audit_log) newest from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='audit_log'`,
  );
  const row = r.rows[0];
  if (!row) throw new Error("audit_log not found");
  const recommend =
    !row.relispartition &&
    (Number(row.estimated_rows) >= rowThreshold || Number(row.bytes) >= sizeThreshold);
  if (command === "plan") {
    const plan = {
      recommended: recommend,
      reason: recommend ? "threshold exceeded" : "threshold not exceeded",
      strategy:
        "shadow partitioned table -> dual-write maintenance window -> copy by month -> verify counts/seals -> transactional rename; never ALTER the live audit table in-place",
      partitionKey: "created_at monthly",
      preconditions: [
        "verified encrypted backup",
        "audit seal verification",
        "maintenance window",
        "free disk >= 1.5x audit table",
        "application writes paused or dual-written",
      ],
      rollback:
        "retain original table until row counts, HMAC seal chain and application smoke checks pass",
    };
    console.log(JSON.stringify(plan, null, 2));
  } else
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          ...row,
          rowThreshold,
          sizeThreshold,
          recommended: recommend,
        },
        null,
        2,
      ),
    );
} finally {
  c.release();
  await pool.end();
}
