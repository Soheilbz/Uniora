import { readFileSync } from "node:fs";

const failures = [];
const read = (file) => readFileSync(file, "utf8");
const pkg = JSON.parse(read("package.json"));
const scripts = pkg.scripts ?? {};
for (const name of [
  "backup:rekey",
  "mfa:rotate",
  "job:worker",
  "platform:worker",
  "audit:seal:create",
  "audit:seal:verify",
]) {
  if (!scripts[name]) failures.push(`package.json: missing operations command ${name}`);
}
if (!String(scripts["job:worker"] ?? "").includes("scripts/worker-env.mjs")) {
  failures.push(
    "package.json: job:worker must use the isolated tenant-worker environment launcher",
  );
}
if (!String(scripts["platform:worker"] ?? "").includes("scripts/platform-worker-env.mjs")) {
  failures.push("package.json: platform:worker must use its least-privilege environment launcher");
}
for (const name of [
  "db:health",
  "tenant:list",
  "tenant:suspend",
  "tenant:resume",
  "tenant:archive",
  "tenant:failed:purge",
  "tenant:owner:set",
  "tenant:mfa:reset-owner",
  "platform:health",
  "backup:create",
  "backup:verify",
  "backup:rekey",
  "backup:restore",
  "dr:status",
  "dr:record",
  "mfa:rotate",
  "audit:seal:create",
  "audit:seal:verify",
  "audit:partition:status",
  "audit:partition:plan",
]) {
  const command = String(scripts[name] ?? "");
  if (!command.includes("scripts/operations-env.mjs")) {
    failures.push(`package.json: ${name} must use the shared operations environment launcher`);
  }
}
const operationsConfig = read("scripts/lib/operations-config.mjs");
for (const token of [
  "DATABASE_ADMIN_URL is required for operations commands",
  "positiveNumberEnv",
  "positiveIntegerEnv",
]) {
  if (!operationsConfig.includes(token))
    failures.push(`scripts/lib/operations-config.mjs: missing ${token}`);
}
for (const file of ["scripts/audit-partition.mjs", "scripts/db-observability.mjs"]) {
  const source = read(file);
  if (!source.includes("requireOperationsDatabaseUrl"))
    failures.push(`${file}: operations DB credential contract is not centralized`);
  if (source.includes("process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL"))
    failures.push(`${file}: Web DATABASE_URL fallback reintroduced`);
}
const operationsLauncher = read("scripts/operations-env.mjs");
for (const token of [
  ".env.operations.local",
  ".env.operations",
  "process.execPath",
  'stdio: "inherit"',
]) {
  if (!operationsLauncher.includes(token))
    failures.push(`scripts/operations-env.mjs: missing ${token}`);
}
const workerLauncher = read("scripts/worker-env.mjs");
for (const token of [".env.worker.local", ".env.worker", "process.execPath", 'stdio: "inherit"']) {
  if (!workerLauncher.includes(token)) failures.push(`scripts/worker-env.mjs: missing ${token}`);
}
const platformWorkerLauncher = read("scripts/platform-worker-env.mjs");
for (const token of [
  ".env.platform-worker.local",
  ".env.platform-worker",
  "process.execPath",
  'stdio: "inherit"',
]) {
  if (!platformWorkerLauncher.includes(token))
    failures.push(`scripts/platform-worker-env.mjs: missing ${token}`);
}
const ops = read(".env.operations.example");
for (const token of [
  "DATABASE_ADMIN_URL=",
  "APP_DB_PASSWORD=",
  "WORKER_DB_PASSWORD=",
  "PLATFORM_DB_PASSWORD=",
  "DATABASE_URL=",
  "DATABASE_WORKER_URL=",
  "DATABASE_PLATFORM_URL=",
  "BETTER_AUTH_SECRET=",
  "BETTER_AUTH_URL=",
  "BACKUP_ACTIVE_KEY_ID=",
  "BACKUP_ENCRYPTION_KEYS=",
  "MFA_ACTIVE_KEY_ID=",
  "MFA_ENCRYPTION_KEYS=",
  "PLATFORM_OPERATION_ENCRYPTION_KEY=",
  "PLATFORM_SESSION_HOURS=",
  "MFA_ROTATION_CONFIRM=ROTATE_MFA_KEYS",
  "AUDIT_SEAL_DIR=",
  "AUDIT_SEAL_KEY=",
  "DR_REPORT_DIR=",
  "DR_TARGET_RPO_MINUTES=",
  "DR_TARGET_RTO_MINUTES=",
]) {
  if (!ops.includes(token)) failures.push(`.env.operations.example: missing ${token}`);
}
const platformWorkerEnv = read(".env.platform-worker.example");
for (const token of [
  "DATABASE_PLATFORM_URL=",
  "DATABASE_URL=",
  "BETTER_AUTH_SECRET=",
  "BETTER_AUTH_URL=",
  "PLATFORM_OPERATOR=",
  "PLATFORM_OPERATION_ENCRYPTION_KEY=",
  "BACKUP_ACTIVE_KEY_ID=",
  "BACKUP_ENCRYPTION_KEYS=",
  "BACKUP_DIR=",
]) {
  if (!platformWorkerEnv.includes(token))
    failures.push(`.env.platform-worker.example: missing ${token}`);
}
for (const forbidden of [
  "DATABASE_ADMIN_URL=",
  "APP_DB_PASSWORD=",
  "WORKER_DB_PASSWORD=",
  "PLATFORM_DB_PASSWORD=",
  "DATABASE_WORKER_URL=",
  "MFA_ENCRYPTION_KEYS=",
  "MFA_ROTATION_CONFIRM=",
  "AUDIT_SEAL_KEY=",
  "INTEGRATION_ENCRYPTION_KEY=",
  "PLATFORM_RESTORE_ALLOWED=",
]) {
  if (platformWorkerEnv.includes(forbidden))
    failures.push(
      `.env.platform-worker.example: unnecessary privileged value leaked into long-running worker: ${forbidden}`,
    );
}
const runtimeEnvironmentPolicy = read("scripts/lib/runtime-environment-policy.ts");
for (const token of [
  "DATABASE_ADMIN_URL",
  "APP_DB_PASSWORD",
  "WORKER_DB_PASSWORD",
  "PLATFORM_DB_PASSWORD",
  "MFA_ENCRYPTION_KEYS",
  "AUDIT_SEAL_KEY",
  "PLATFORM_RESTORE_ALLOWED",
]) {
  if (!runtimeEnvironmentPolicy.includes(`"${token}"`))
    failures.push(`runtime environment policy: platform worker does not reject ${token}`);
}
const platformWorkerCheck = read("scripts/platform-worker-production-check.mjs");
if (!platformWorkerCheck.includes("platformWorkerEnvironmentFailures")) {
  failures.push(
    "platform-worker-production-check: must delegate to the shared platform worker runtime policy",
  );
}
const workerEnv = read(".env.worker.example");
for (const token of [
  "DATABASE_WORKER_URL=",
  "DATABASE_URL=",
  "EXPORT_JOB_DIR=",
  "INTEGRATION_ENCRYPTION_KEY=",
  "OBJECT_STORAGE_ENDPOINT=",
  "OBJECT_STORAGE_BUCKET=",
  "ANTIVIRUS_HTTP_ENDPOINT=",
]) {
  if (!workerEnv.includes(token)) failures.push(`.env.worker.example: missing ${token}`);
}
for (const forbidden of [
  "DATABASE_ADMIN_URL=",
  "APP_DB_PASSWORD=",
  "WORKER_DB_PASSWORD=",
  "BETTER_AUTH_SECRET=",
  "BACKUP_ENCRYPTION_KEYS=",
  "AUDIT_SEAL_KEY=",
  "DR_REPORT_DIR=",
  "DR_TARGET_RPO_MINUTES=",
  "DR_TARGET_RTO_MINUTES=",
]) {
  if (workerEnv.includes(forbidden))
    failures.push(`.env.worker.example: privileged value leaked into tenant worker: ${forbidden}`);
}
const prod = read(".env.production.example");
for (const token of [
  "EXPORT_JOB_DIR=",
  "MFA_ACTIVE_KEY_ID=",
  "MFA_ENCRYPTION_KEYS=",
  "PLATFORM_OPERATION_ENCRYPTION_KEY=",
  "PLATFORM_SESSION_HOURS=",
  "INTEGRATION_ENCRYPTION_KEY=",
  "PUBLIC_FORM_RATE_SALT=",
])
  if (!prod.includes(token)) failures.push(`.env.production.example: missing ${token}`);
for (const forbidden of [
  "DATABASE_ADMIN_URL=",
  "DATABASE_WORKER_URL=",
  "DATABASE_PLATFORM_URL=",
  "WORKER_DB_PASSWORD=",
  "PLATFORM_DB_PASSWORD=",
  "BACKUP_ENCRYPTION_KEYS=",
  "AUDIT_SEAL_KEY=",
])
  if (prod.includes(forbidden))
    failures.push(
      `.env.production.example: privileged value leaked into Web example: ${forbidden}`,
    );
const runtime = read("src/lib/runtime-config.ts");
for (const forbidden of [
  "DATABASE_WORKER_URL",
  "DATABASE_PLATFORM_URL",
  "WORKER_DB_PASSWORD",
  "PLATFORM_DB_PASSWORD",
  "BACKUP_ENCRYPTION_KEYS",
  "BACKUP_ACTIVE_KEY_ID",
  "AUDIT_SEAL_KEY",
  "MFA_ROTATION_CONFIRM",
])
  if (!runtime.includes(`"${forbidden}"`))
    failures.push(`runtime-config: Web does not reject ${forbidden}`);
const e2eServe = read("scripts/e2e/serve.mjs");
for (const token of [
  "EXPORT_JOB_DIR: exportJobDir",
  "delete runtimeEnv.DATABASE_WORKER_URL",
  "delete runtimeEnv.DATABASE_PLATFORM_URL",
  "delete runtimeEnv.WORKER_DB_PASSWORD",
  "delete runtimeEnv.PLATFORM_DB_PASSWORD",
  "delete runtimeEnv.BACKUP_ENCRYPTION_KEYS",
  "delete runtimeEnv.AUDIT_SEAL_KEY",
  "delete runtimeEnv.MFA_ROTATION_CONFIRM",
]) {
  if (!e2eServe.includes(token))
    failures.push(`scripts/e2e/serve.mjs: E2E production runtime drift: missing ${token}`);
}

const platformViewer = read("src/lib/platform-viewer.ts");
for (const token of [
  "requirePlatformConsoleOperator",
  "requirePlatformElevatedSession",
  "mfaVerified",
  "PLATFORM_SESSION_HOURS",
]) {
  if (!platformViewer.includes(token))
    failures.push(`platform-viewer: missing hardened platform guard ${token}`);
}

const tenantProvisioner = read("scripts/create-tenant.ts");
for (const token of [
  "provisioningRequestId",
  "provisioningRequestId: platformRequestId",
  "canResumeTenant",
  'action: "tenant.created"',
]) {
  if (!tenantProvisioner.includes(token))
    failures.push(`create-tenant: missing crash-safe provisioning contract ${token}`);
}

const platformWorker = read("scripts/platform-worker.ts");
const platformAuthorization = read("scripts/lib/platform-operation-authorization.ts");
const platformExecution = read("scripts/lib/platform-operation-execution.ts");
const platformRuntime = `${platformWorker}\n${platformAuthorization}\n${platformExecution}`;
for (const token of [
  "recoverStale",
  "withHeartbeat",
  "operationAlreadySucceeded",
  "requested_by",
  "s.expires_at > now()",
  "payload=payload - ARRAY['adminPassword','password','__auth']",
  "coalesce((payload->'__worker'->>'attempt')::int,0)",
]) {
  if (!platformRuntime.includes(token))
    failures.push(`platform-worker runtime: missing reliability/security contract ${token}`);
}
for (const token of [
  "backupKeyringFromEnvironment",
  "inspectBackupDirectory",
  "backup_catalog_degraded",
]) {
  if (!platformExecution.includes(token))
    failures.push(
      `platform operation executor: backup verification does not use the authoritative backup catalog (${token})`,
    );
}
const failedProvisioningRecovery = read("db/sql/after/0005_platform_failed_provisioning_purge.sql");
if (!failedProvisioningRecovery.includes("'tenant.failed.purge'"))
  failures.push(
    "platform operation SQL contract: failed provisioning recovery is not allow-listed",
  );

const platformActions = read("src/modules/platform/actions.ts");
for (const token of [
  "requirePlatformElevatedSession",
  "onConflictDoNothing",
  "__auth: { sessionId: operator.sessionId, requestedAt: new Date().toISOString() }",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: This is a literal source-contract token.
  "ARCHIVE:${slug}",
]) {
  if (!platformActions.includes(token))
    failures.push(`platform actions: missing privileged queue contract ${token}`);
}

const rls = read("db/sql/after/0001_row_level_security.sql");
for (const token of [
  "ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY",
  "EXISTS (SELECT 1 FROM platform_operators p WHERE p.user_id = u.id)",
  "nullif(current_setting('app.tenant_id', true), '') IS NULL",
  "ELSE u.tenant_id = app.current_tenant()",
]) {
  if (!rls.includes(token)) failures.push(`login-attempt RLS: missing ${token}`);
}

const webLauncher = read("scripts/web.mjs");
for (const token of [
  'process.platform !== "linux"',
  "/proc/" + "$" + "{pid}/cmdline",
  "isOurServerProcess",
  "xdg-open",
]) {
  if (!webLauncher.includes(token))
    failures.push(`scripts/web.mjs: missing Linux process ownership/launcher contract ${token}`);
}
for (const forbidden of [
  "powershell.exe",
  "taskkill",
  "netstat",
  "cmd.exe",
  'process.platform === "win32"',
]) {
  if (webLauncher.includes(forbidden))
    failures.push(`scripts/web.mjs: obsolete Windows launcher branch remains (${forbidden})`);
}

const backup = [
  read("scripts/platform-backup.mjs"),
  read("scripts/lib/platform-backup-retention.mjs"),
  read("scripts/lib/backup-format.ts"),
].join("\n");
for (const token of [
  "backupKeyringFromEnvironment",
  "inspectBackupSet",
  "pg_try_advisory_lock",
  "publishBackupPair",
  "mirrorBackupPair",
  "backup retention refused while catalog is degraded",
]) {
  if (!backup.includes(token))
    failures.push(`platform-backup: missing hardened backup contract ${token}`);
}
if (backup.includes("renameSync(temp, enc)"))
  failures.push("platform-backup: unsafe in-place rekey replacement reintroduced");
const drReadiness = read("scripts/dr-readiness.mjs");
for (const token of [
  "DATABASE_ADMIN_URL is required for DR status",
  "inspectBackupSet",
  "backupKeyringFromEnvironment",
]) {
  if (!drReadiness.includes(token))
    failures.push(`dr-readiness: missing shared backup-health contract ${token}`);
}

const docs = read("docs/production.md");
for (const token of [
  "/api/healthz",
  "/api/readyz",
  "EXPORT_JOB_DIR",
  "backup:rekey",
  "mfa:rotate",
  "audit:seal",
])
  if (!docs.includes(token))
    failures.push(`docs/production.md: missing operational runbook topic ${token}`);
if (failures.length) {
  for (const x of failures) console.error(`error: ${x}`);
  process.exit(1);
}
console.log("operations contract ok");
