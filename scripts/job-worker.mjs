/**
 * Shared durable tenant-job worker.
 *
 * SECURITY BOUNDARY
 * -----------------
 * DATABASE_WORKER_URL is a dedicated cross-tenant queue role. It has BYPASSRLS
 * only because queue rows span tenants, but its table grants are restricted to
 * jobs, job_attempts and append-only platform_audit_log. Domain data is always
 * read through DATABASE_URL after a transaction-local tenant context has been
 * established, so forced RLS remains the data boundary. Platform jobs are never
 * claimed here; scripts/platform-worker.ts keeps separate owner authority.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import pg from "pg";
import {
  isRetryableJobError as isRetryable,
  errorMessage as message,
  PermanentJobError,
} from "./lib/job-errors.mjs";
import { assertTenantWorkerEnvironment } from "./lib/runtime-environment-policy.ts";
import { parseStoredObject } from "./lib/stored-json.mjs";
import { structuredLog } from "./lib/structured-log.mjs";
import {
  createMaintenanceClock,
  maintenanceDue,
  markMaintenanceRun,
  workerMaintenanceIntervals,
} from "./lib/worker-maintenance.mjs";
import { createTenantJobControlPlane } from "./tenant-worker/control-plane.mjs";
import { createExportHandler } from "./tenant-worker/export-handler.mjs";
import { createIntegrationWebhookHandlers } from "./tenant-worker/integration-webhook-handlers.mjs";
import { createMaintenanceHandlers } from "./tenant-worker/maintenance-handlers.mjs";
import { createParticipantImportHandler } from "./tenant-worker/participant-import-handler.mjs";
import { createProjectionHandlers } from "./tenant-worker/projection-handlers.mjs";
import { createStorageDocumentHandlers } from "./tenant-worker/storage-document-handlers.mjs";

const { Pool } = pg;
assertTenantWorkerEnvironment(process.env);
const workerUrl = process.env.DATABASE_WORKER_URL?.trim();
const webUrl = process.env.DATABASE_URL?.trim();
const operator = process.env.PLATFORM_OPERATOR?.trim() || "tenant-job-worker";
const workerId = `${process.env.COMPUTERNAME || process.env.HOSTNAME || "worker"}:${process.pid}:${randomBytes(4).toString("hex")}`;
const root = resolve(process.env.EXPORT_JOB_DIR?.trim() || "./exports");
const leaseSeconds = boundedInt("JOB_LEASE_SECONDS", process.env.JOB_LEASE_SECONDS, 180, 60, 900);
const heartbeatMs = boundedInt(
  "JOB_HEARTBEAT_MS",
  process.env.JOB_HEARTBEAT_MS,
  30_000,
  5_000,
  120_000,
);
const pollMs = boundedInt("JOB_POLL_MS", process.env.JOB_POLL_MS, 2_000, 250, 60_000);
const maintenanceIntervals = workerMaintenanceIntervals(leaseSeconds);
const maintenanceClock = createMaintenanceClock();
const workerStartedAt = new Date().toISOString();
const runtimeStats = {
  processedSuccess: 0,
  processedFailure: 0,
  processedRetry: 0,
  leaseRecoveries: 0,
  lastSuccessAt: null,
  lastHealthAt: 0,
  currentJobKind: null,
};
if (heartbeatMs > (leaseSeconds * 1000) / 2) {
  throw new Error("JOB_HEARTBEAT_MS must not exceed half of JOB_LEASE_SECONDS");
}
if (!workerUrl) fail("DATABASE_WORKER_URL is required");
if (!webUrl) fail("DATABASE_URL is required");
mkdirSync(root, { recursive: true, mode: 0o700 });
process.umask(0o077);
const control = new Pool({
  connectionString: workerUrl,
  max: 2,
  application_name: "univ-job-worker-control",
});
const web = new Pool({
  connectionString: webUrl,
  max: 2,
  application_name: "univ-job-worker-data",
});
const runExportJob = createExportHandler({
  artifactFile,
  withTenantSnapshot,
  assertRequesterEligible,
  requesterHasAnyCapability,
});

const { refreshSearchProjection, refreshAttentionProjection, runQualitySnapshot } =
  createProjectionHandlers({ withTenantWrite });

const {
  refreshAnalytics,
  deliverScheduledReminder,
  dispatchSchedules,
  dispatchOutbox,
  runRetentionPurge,
} = createMaintenanceHandlers({
  control,
  withTenantSnapshot,
  withTenantWrite,
  assertRequesterEligible,
  errorMessage: message,
});

const { queueStorageReconcileJob, reconcileStorageObjects, scanDocument } =
  createStorageDocumentHandlers({
    withTenantWrite,
    withTenantMaintenance,
    withTenantSnapshot,
    assertRequesterEligible,
  });
const runLargeParticipantImport = createParticipantImportHandler({
  withTenantWrite,
  assertRequesterEligible,
  platformAudit,
  queueStorageReconcileJob,
});

const { deliverWebhook, runIntegrationSync } = createIntegrationWebhookHandlers({
  withTenantWrite,
  assertRequesterEligible,
});

const {
  claimOne,
  recoverStaleJobs,
  expireArtifacts,
  publishJobSuccess,
  publishJobFailure,
  makeHeartbeat,
} = createTenantJobControlPlane({
  control,
  workerId,
  operator,
  leaseSeconds,
  heartbeatMs,
  cleanupJobFiles,
  artifactFile,
  platformAudit,
  onLeaseRecovered: () => {
    runtimeStats.leaseRecoveries += 1;
  },
});

const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

structuredLog("info", "tenant_worker.started", { worker: "tenant", pid: process.pid });
try {
  do {
    await publishWorkerHealth();
    await runDueMaintenance();
    const job = await claimOne();
    if (job) await runJob(job);
    if (once) break;
    if (!job) await sleep(pollMs);
  } while (!stopping);
} finally {
  await publishWorkerHealth("stopping", true).catch(() => {});
  structuredLog("info", "tenant_worker.stopping", { worker: "tenant", pid: process.pid });
  await Promise.all([control.end(), web.end()]);
}

async function publishWorkerHealth(status = "ok", force = false) {
  const now = Date.now();
  if (!force && now - runtimeStats.lastHealthAt < 30_000) return;
  await control.query(`select app.upsert_tenant_worker_health($1,$2,$3,$4)`, [
    `tenant:${workerId}`,
    status,
    JSON.stringify({
      process: "tenant-job-worker",
      pid: process.pid,
      startedAt: workerStartedAt,
      currentJobKind: runtimeStats.currentJobKind,
      processedSuccess: runtimeStats.processedSuccess,
      processedFailure: runtimeStats.processedFailure,
      processedRetry: runtimeStats.processedRetry,
      leaseRecoveries: runtimeStats.leaseRecoveries,
      lastSuccessAt: runtimeStats.lastSuccessAt,
    }),
    workerStartedAt,
  ]);
  runtimeStats.lastHealthAt = now;
}

async function runDueMaintenance() {
  const now = Date.now();
  const due = maintenanceDue(maintenanceClock, now);
  if (due.recoverStaleJobs) {
    await recoverStaleJobs();
    markMaintenanceRun(
      maintenanceClock,
      "recoverStaleJobs",
      maintenanceIntervals.staleRecoveryMs,
      Date.now(),
    );
  }
  if (due.expireArtifacts) {
    await expireArtifacts();
    markMaintenanceRun(
      maintenanceClock,
      "expireArtifacts",
      maintenanceIntervals.artifactExpiryMs,
      Date.now(),
    );
  }
}

async function runJob(job) {
  const heartbeat = makeHeartbeat(job);
  const startedAt = Date.now();
  runtimeStats.currentJobKind = job.kind;
  try {
    const payload = parseStoredObject(job.payload, "job payload");
    await heartbeat(true);
    const handler = resolveHandler(job.kind);
    const result = await handler(job, payload, heartbeat);
    await heartbeat(true);
    await publishJobSuccess(job, result ?? {});
    runtimeStats.processedSuccess += 1;
    runtimeStats.lastSuccessAt = new Date().toISOString();
    structuredLog("info", "tenant_job.completed", {
      kind: job.kind,
      attempt: Number(job.attempt),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const detail = message(error).slice(0, 4000);
    const retry = Number(job.attempt) < Number(job.max_attempts) && isRetryable(error);
    const requestedDelay = Number(error?.retryAfterSeconds);
    const delaySeconds =
      Number.isInteger(requestedDelay) && requestedDelay >= 1
        ? Math.min(3600, requestedDelay)
        : Math.min(900, 15 * 2 ** Math.max(0, Number(job.attempt) - 1));
    const published = await publishJobFailure(job, {
      retry,
      delaySeconds,
      errorCode: error instanceof PermanentJobError ? "JOB_PERMANENT_FAILURE" : "JOB_FAILED",
      detail,
    });
    if (published) {
      if (retry) runtimeStats.processedRetry += 1;
      else runtimeStats.processedFailure += 1;
      structuredLog(retry ? "warn" : "error", retry ? "tenant_job.retrying" : "tenant_job.failed", {
        kind: job.kind,
        attempt: Number(job.attempt),
        durationMs: Date.now() - startedAt,
      });
      cleanupJobFiles(job);
    }
  } finally {
    runtimeStats.currentJobKind = null;
    await publishWorkerHealth("ok", true).catch(() => {});
  }
}

function resolveHandler(kind) {
  if (kind.startsWith("export.")) return runExportJob;
  const handlers = {
    "projection.search": refreshSearchProjection,
    "projection.attention": refreshAttentionProjection,
    "quality.scan": runQualitySnapshot,
    "documents.scan": scanDocument,
    "schedule.dispatch": dispatchSchedules,
    "outbox.dispatch": dispatchOutbox,
    "webhook.deliver": deliverWebhook,
    "retention.purge": runRetentionPurge,
    "analytics.refresh": refreshAnalytics,
    "notification.reminder": deliverScheduledReminder,
    "integration.sync": runIntegrationSync,
    "workshop.participants.import.large": runLargeParticipantImport,
    "storage.reconcile": reconcileStorageObjects,
  };
  const handler = handlers[kind];
  if (!handler) throw new PermanentJobError(`unsupported tenant job kind ${kind}`);
  return handler;
}

async function withTenantMaintenance(tenantId, run) {
  const client = await web.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
    const state = await client.query(`select id from tenants where id=app.current_tenant()`);
    if (!state.rows[0]) throw new PermanentJobError("tenant no longer exists");
    const zone = await client.query(
      `select coalesce((select timezone from institutions limit 1),'UTC') timezone`,
    );
    await client.query("select set_config('TimeZone',$1,true)", [
      String(zone.rows[0]?.timezone ?? "UTC"),
    ]);
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function withTenantSnapshot(tenantId, run) {
  const client = await web.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await establishTenant(client, tenantId);
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
async function withTenantWrite(tenantId, run) {
  const client = await web.connect();
  try {
    await client.query("begin");
    await establishTenant(client, tenantId);
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
async function establishTenant(client, tenantId) {
  await client.query("select set_config('app.tenant_id',$1,true)", [tenantId]);
  const state = await client.query(
    `select status,provisioning_status from tenants where id=app.current_tenant()`,
  );
  if (state.rows[0]?.status !== "active" || state.rows[0]?.provisioning_status !== "active")
    throw new PermanentJobError("tenant is not active");
  const zone = await client.query(
    `select coalesce((select timezone from institutions limit 1),'UTC') timezone`,
  );
  await client.query("select set_config('TimeZone',$1,true)", [
    String(zone.rows[0]?.timezone ?? "UTC"),
  ]);
}

async function assertRequesterEligible(client, requestedBy, requiredCapabilities, ownerOnly) {
  const requester = String(requestedBy ?? "");
  if (!requester) throw new PermanentJobError("job requester is missing");
  const state = await client.query(
    `select u.id,exists(select 1 from tenant_owners o where o.tenant_id=app.current_tenant() and o.user_id=u.id) is_owner from "user" u where u.tenant_id=app.current_tenant() and u.id=$1 and u.suspended_at is null and (u.account_expires_at is null or u.account_expires_at>now()) and (u.employment_start is null or u.employment_start<=current_date) and (u.employment_end is null or u.employment_end>=current_date) and not u.must_change_password`,
    [requester],
  );
  const person = state.rows[0];
  if (!person) throw new PermanentJobError("job requester is no longer eligible");
  if (ownerOnly && !person.is_owner)
    throw new PermanentJobError("tenant owner is no longer eligible for portability export");
  const caps = await client.query(
    `select distinct rc.capability from user_roles ur join roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id join role_capabilities rc on rc.role_id=r.id where ur.tenant_id=app.current_tenant() and ur.user_id=$1`,
    [requester],
  );
  const granted = new Set(caps.rows.map((r) => r.capability));
  for (const capability of requiredCapabilities)
    if (!granted.has(capability))
      throw new PermanentJobError(`job requester no longer has ${capability}`);
}

async function requesterHasAnyCapability(client, requestedBy, candidates) {
  if (!candidates.length) return false;
  const result = await client.query(
    `select distinct rc.capability
       from user_roles ur
       join roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
       join role_capabilities rc on rc.role_id=r.id
      where ur.tenant_id=app.current_tenant() and ur.user_id=$1 and rc.capability=any($2::text[])`,
    [requestedBy, candidates],
  );
  return result.rowCount > 0;
}

function cleanupJobFiles(job) {
  const prefix = `${job.id}.${job.attempt}`;
  rmSync(artifactFile(`${prefix}.part`), { force: true });
  rmSync(artifactFile(`${prefix}.csv`), { force: true });
  rmSync(artifactFile(`${prefix}.json`), { force: true });
}
function artifactFile(name) {
  if (typeof name !== "string" || basename(name) !== name || !/^[A-Za-z0-9._-]+$/.test(name))
    throw new PermanentJobError("invalid artifact name");
  const file = resolve(root, name);
  if (dirname(file) !== root)
    throw new PermanentJobError("artifact path escapes configured directory");
  return file;
}

async function platformAudit(action, tenantId, target, changes, outcome = "success") {
  await control.query(
    `insert into platform_audit_log(operator,action,tenant_id,target,changes,outcome) values($1,$2,$3,$4,$5,$6)`,
    [operator, action, tenantId, target, JSON.stringify(changes), outcome],
  );
}
function boundedInt(name, raw, fallback, min, max) {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function fail(text) {
  console.error(text);
  process.exit(1);
}
