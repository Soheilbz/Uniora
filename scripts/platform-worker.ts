import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  failureDisposition,
  platformSuccessAuditAction,
  platformWorkerAttempt,
  staleDisposition,
} from "../src/modules/platform/worker-policy.ts";
import { assertPlatformRequesterAuthorized } from "./lib/platform-operation-authorization.ts";
import { executePlatformOperation } from "./lib/platform-operation-execution.ts";
import {
  PermanentOperationError,
  type PlatformRequestRow,
  safeDiagnostic,
} from "./lib/platform-operation-model.ts";
import { assertPlatformWorkerEnvironment } from "./lib/runtime-environment-policy.ts";
import { structuredLog } from "./lib/structured-log.mjs";

const { Pool } = pg;
assertPlatformWorkerEnvironment(process.env);
const platformUrl = process.env.DATABASE_PLATFORM_URL?.trim();
const defaultOperator = process.env.PLATFORM_OPERATOR?.trim() || "platform-console";
if (!platformUrl) throw new Error("DATABASE_PLATFORM_URL is required");

const pool = new Pool({
  connectionString: platformUrl,
  max: 2,
  connectionTimeoutMillis: 5000,
  application_name: "univ-platform-worker",
});
const once = process.argv.includes("--once");
const HEARTBEAT_MS = 15_000;
const STALE_AFTER_MS = 2 * 60_000;
const PLATFORM_SESSION_HOURS = boundedPlatformSessionHours();
const WORKER_INSTANCE_ID = randomUUID();
const WORKER_STARTED_AT = new Date().toISOString();
const WORKER_VERSION = packageVersion();

let stopping = false;
let processedSuccess = 0;
let processedFailure = 0;
let processedRetry = 0;
let lastOperationId: string | null = null;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function recoverStale(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await pool.query<PlatformRequestRow>(
    `select id, kind, payload, requested_by as "requestedBy", created_at as "createdAt"
       from platform_operation_requests
      where status='running' and updated_at < $1`,
    [staleBefore],
  );

  for (const row of stale.rows) {
    const attempt = platformWorkerAttempt(row.payload);

    // A worker can disappear after the privileged command committed but before
    // it acknowledged the queue row. Reconcile the durable request-scoped
    // success audit before either retrying or declaring the lease exhausted.
    // This is especially important on the final attempt: a committed operation
    // must never be reported as failed merely because its acknowledgement died.
    try {
      const disposition = staleDisposition(
        attempt,
        (await operationAlreadySucceeded(row)) ? "success" : "absent",
      );
      if (disposition === "complete") {
        await complete(row.id, { action: row.kind, recoveredFromAudit: true }, attempt);
        continue;
      }
      if (disposition === "terminal") {
        await terminalFailure(row.id, "worker_interrupted", attempt);
        continue;
      }
    } catch (_error) {
      structuredLog("error", "platform_operation.stale_reconciliation_failed", {
        kind: row.kind,
        attempt,
      });
      // Do not destroy retryable credentials or mark the operation terminal
      // while the authoritative audit store itself is unavailable.
      if (staleDisposition(attempt, "unavailable") === "hold") continue;
    }

    // The terminal case was handled immediately after successful reconciliation.
    await pool.query(
      `update platform_operation_requests
          set status='queued', error_message='retrying_after_worker_interruption',
              processed_at=null, updated_at=now()
        where id=$1 and status='running'
          and coalesce((payload->'__worker'->>'attempt')::int,0)=$2`,
      [row.id, attempt],
    );
  }
}

async function claim(): Promise<PlatformRequestRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<PlatformRequestRow>(`
      with picked as (
        select id
          from platform_operation_requests
         where status='queued'
         order by case when kind='platform.operation.cancel' then 0 else 1 end, created_at, id
         for update skip locked
         limit 1
      )
      update platform_operation_requests r
         set status='running',
             payload=jsonb_set(
               r.payload,
               '{__worker}',
               jsonb_build_object(
                 'attempt', coalesce((r.payload->'__worker'->>'attempt')::int, 0) + 1
               ),
               true
             ),
             error_message=null,
             processed_at=null,
             updated_at=now()
        from picked
       where r.id=picked.id
      returning r.id, r.kind, r.payload,
                r.requested_by as "requestedBy", r.created_at as "createdAt"`);
    await client.query("commit");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function complete(id: string, result: Record<string, unknown>, attempt: number) {
  const updated = await pool.query(
    `update platform_operation_requests
        set status='completed',result=$2,error_message=null,
            payload=payload - ARRAY['adminPassword','password','__auth'],
            processed_at=now(),updated_at=now()
      where id=$1 and status='running'
        and coalesce((payload->'__worker'->>'attempt')::int,0)=$3
      returning id`,
    [id, JSON.stringify({ ...result, attempts: attempt }), attempt],
  );
  if (updated.rowCount !== 1) throw new Error("platform operation attempt lost before completion");
}

async function terminalFailure(
  id: string,
  publicCode: string,
  attempt: number,
  diagnostic: string | null = null,
) {
  const updated = await pool.query(
    `update platform_operation_requests
        set status='failed',result=$2,error_message=$3,
            payload=payload - ARRAY['adminPassword','password','__auth'],
            processed_at=now(),updated_at=now()
      where id=$1 and status in ('running','queued')
        and coalesce((payload->'__worker'->>'attempt')::int,0)=$4
      returning id`,
    [
      id,
      JSON.stringify({
        attempts: attempt,
        errorCode: publicCode,
        ...(diagnostic ? { diagnostic } : {}),
      }),
      publicCode,
      attempt,
    ],
  );
  if (updated.rowCount !== 1)
    throw new Error("platform operation attempt lost before terminal failure");
}

async function retry(
  id: string,
  publicCode: string,
  attempt: number,
  diagnostic: string | null = null,
) {
  const updated = await pool.query(
    `update platform_operation_requests
        set status='queued',error_message=$2,result=$3,processed_at=null,updated_at=now()
      where id=$1 and status='running'
        and coalesce((payload->'__worker'->>'attempt')::int,0)=$4
      returning id`,
    [
      id,
      publicCode,
      JSON.stringify({ errorCode: publicCode, ...(diagnostic ? { diagnostic } : {}) }),
      attempt,
    ],
  );
  if (updated.rowCount !== 1) throw new Error("platform operation attempt lost before retry");
}

async function withHeartbeat<T>(jobId: string, attempt: number, run: () => Promise<T>): Promise<T> {
  let heartbeatError: unknown;
  let active = true;
  const beat = async () => {
    if (!active || heartbeatError) return;
    try {
      const result = await pool.query(
        `update platform_operation_requests set updated_at=now()
          where id=$1 and status='running'
            and coalesce((payload->'__worker'->>'attempt')::int,0)=$2
          returning id`,
        [jobId, attempt],
      );
      if (result.rowCount !== 1) heartbeatError = new Error("platform operation lease was lost");
    } catch (error) {
      heartbeatError = error;
    }
  };
  await beat();
  const timer = setInterval(() => {
    void beat();
  }, HEARTBEAT_MS);
  try {
    const value = await run();
    await beat();
    if (heartbeatError) throw heartbeatError;
    return value;
  } finally {
    active = false;
    clearInterval(timer);
  }
}

async function operationAlreadySucceeded(row: PlatformRequestRow): Promise<boolean> {
  const action = platformSuccessAuditAction(row.kind);
  if (!action) return false;
  const result = await pool.query(
    `select 1
       from platform_audit_log
      where request_id=$1 and action=$2 and outcome='success'
      limit 1`,
    [row.id, action],
  );
  return result.rowCount === 1;
}

async function runOne(row: PlatformRequestRow): Promise<void> {
  lastOperationId = row.id;
  const attempts = platformWorkerAttempt(row.payload);
  try {
    /*
     * Every privileged side effect writes a success audit row with this queue
     * request id in the same transaction as the final application-state effect
     * wherever that operation supports a single transaction. Provisioning also
     * records the same request id for reconciliation. If a worker died after
     * the effect but before marking the queue row complete, this proof prevents
     * an at-least-once retry from suspending/creating the same thing twice.
     */
    if (await operationAlreadySucceeded(row)) {
      await complete(row.id, { action: row.kind, recoveredFromAudit: true }, attempts);
      return;
    }

    const operatorLabel = await assertPlatformRequesterAuthorized(
      pool,
      row,
      defaultOperator,
      PLATFORM_SESSION_HOURS,
    );
    const result = await withHeartbeat(row.id, attempts, () =>
      executePlatformOperation(pool, row, operatorLabel),
    );
    await complete(row.id, result, attempts);
    processedSuccess += 1;
  } catch (error) {
    structuredLog("error", "platform_operation.failed", { kind: row.kind, attempt: attempts });

    /* The child may have committed successfully immediately before its process
       or our heartbeat channel failed. Reconcile against the durable audit
       proof before deciding whether this operation is safe to retry. */
    try {
      if (await operationAlreadySucceeded(row)) {
        await complete(row.id, { action: row.kind, recoveredFromAudit: true }, attempts);
        return;
      }
    } catch (_reconcileError) {
      structuredLog("error", "platform_operation.reconciliation_failed", {
        kind: row.kind,
        attempt: attempts,
      });
    }

    if (failureDisposition(attempts, error instanceof PermanentOperationError) === "terminal") {
      processedFailure += 1;
      await terminalFailure(
        row.id,
        error instanceof PermanentOperationError ? error.publicCode : "operation_failed",
        attempts,
        /* Permanent errors are deliberately short and structured, but keeping
           their sanitized message is essential for operator diagnosis. The old
           worker discarded this field, leaving only the opaque operation_failed
           code in the console. */
        safeDiagnostic(error),
      );
      return;
    }
    processedRetry += 1;
    await retry(
      row.id,
      "operation_retrying",
      attempts,
      error instanceof PermanentOperationError ? null : safeDiagnostic(error),
    );
  }
}

async function main() {
  structuredLog("info", "platform_worker.started", {
    worker: "platform",
    pid: process.pid,
    version: WORKER_VERSION,
  });
  while (!stopping) {
    await publishWorkerHeartbeat();
    await recoverStale();
    const row = await claim();
    if (!row) {
      if (once) break;
      await wait(800);
      continue;
    }
    await runOne(row);
    if (once) break;
  }
}

async function publishWorkerHeartbeat(status: "ok" | "stopping" = "ok") {
  await pool.query(`select app.upsert_platform_worker_health($1,$2,$3,$4)`, [
    `platform:${WORKER_INSTANCE_ID}`,
    status,
    JSON.stringify({
      process: "platform-worker",
      pid: process.pid,
      instanceId: WORKER_INSTANCE_ID,
      startedAt: WORKER_STARTED_AT,
      version: WORKER_VERSION,
      lastOperationId,
      processedSuccess,
      processedFailure,
      processedRetry,
    }),
    WORKER_STARTED_AT,
  ]);
}

await main().finally(async () => {
  await publishWorkerHeartbeat("stopping").catch(() => {});
  structuredLog("info", "platform_worker.stopping", { worker: "platform", pid: process.pid });
  await pool.end();
});

function boundedPlatformSessionHours(): number {
  const raw = process.env.PLATFORM_SESSION_HOURS;
  if (raw == null || raw.trim() === "") return 4;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error("PLATFORM_SESSION_HOURS must be an integer between 1 and 8");
  }
  return parsed;
}

function packageVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (
      typeof parsed.version === "string" &&
      /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(parsed.version)
    ) {
      return parsed.version;
    }
  } catch {}
  throw new Error("package.json contains no valid application version");
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
