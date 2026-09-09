import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/worker-env.mjs <script> [...args]");
  process.exit(64);
}

// Tenant-worker credentials are intentionally isolated from privileged
// operations credentials. Production Compose injects /etc/univ-web/worker.env;
// local commands may use one of these ignored files.
const envFile = [".env.worker.local", ".env.worker"]
  .map((name) => resolve(root, name))
  .find((candidate) => existsSync(candidate));
const childArgs = envFile ? [`--env-file=${envFile}`, ...args] : args;
const childEnv = { ...process.env };
/* Node's --env-file does not override inherited variables. local:up inherits
 * .env.local, so remove credentials that the tenant-worker policy forbids. */
for (const key of [
  "DATABASE_ADMIN_URL",
  "DATABASE_PLATFORM_URL",
  "APP_DB_PASSWORD",
  "WORKER_DB_PASSWORD",
  "PLATFORM_DB_PASSWORD",
  "BETTER_AUTH_SECRET",
  "MFA_ENCRYPTION_KEY",
  "MFA_ENCRYPTION_KEYS",
  "MFA_ACTIVE_KEY_ID",
  "PLATFORM_OPERATION_ENCRYPTION_KEY",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_ENCRYPTION_KEYS",
  "BACKUP_ACTIVE_KEY_ID",
  "BACKUP_DIR",
  "BACKUP_OFFSITE_DIR",
  "AUDIT_SEAL_KEY",
  "AUDIT_SEAL_DIR",
  "PLATFORM_RESTORE_ALLOWED",
  "PLATFORM_CROSS_TARGET_RESTORE",
])
  delete childEnv[key];
const child = spawn(process.execPath, childArgs, {
  cwd: root,
  env: childEnv,
  stdio: "inherit",
});
let stopping = false;

/* The supervisor owns this adapter. Forward termination instead of allowing
 * Node to exit while the database worker survives as an orphan. That failure
 * mode creates duplicate workers after a terminal closes or local:stop runs. */
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) child.kill(signal);
    else process.exit(0);
  });
}
child.once("error", (error) => {
  console.error(`Unable to start tenant worker command: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  stopping = true;
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
process.once("exit", () => {
  if (child.exitCode === null) child.kill("SIGTERM");
});
