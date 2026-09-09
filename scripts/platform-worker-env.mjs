import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/platform-worker-env.mjs <script> [...args]");
  process.exit(64);
}

// Keep the always-on Platform worker narrower than one-shot maintenance jobs.
// Production Compose injects /etc/univ-web/platform-worker.env; local commands
// may use one of these ignored files.
const envFile = [".env.platform-worker.local", ".env.platform-worker"]
  .map((name) => resolve(root, name))
  .find((candidate) => existsSync(candidate));
const e2eLane = process.env.UNIV_E2E === "1" && process.env.E2E_EXTERNAL_SERVER === "1";
const childArgs = envFile && !e2eLane ? [`--env-file=${envFile}`, ...args] : args;
const childEnv = { ...process.env };
/* Keep Web/tenant/one-shot credentials out of the long-running Platform
 * worker even when its supervisor inherited .env.local. When no dedicated
 * env file exists (for example, the disposable CI worker), the two database
 * URLs are the explicit platform-worker contract and must remain available. */
for (const key of [
  "DATABASE_ADMIN_URL",
  "DATABASE_WORKER_URL",
  "APP_DB_PASSWORD",
  "WORKER_DB_PASSWORD",
  "PLATFORM_DB_PASSWORD",
  "MFA_ENCRYPTION_KEY",
  "MFA_ENCRYPTION_KEYS",
  "MFA_ACTIVE_KEY_ID",
  "INTEGRATION_ENCRYPTION_KEY",
  "ANTIVIRUS_HTTP_ENDPOINT",
  "ANTIVIRUS_HTTP_TOKEN",
  "PLATFORM_RESTORE_ALLOWED",
  "PLATFORM_CROSS_TARGET_RESTORE",
  "AUDIT_SEAL_KEY",
  "AUDIT_SEAL_DIR",
  "SEED_ADMIN_PASSWORD",
])
  delete childEnv[key];
if (envFile && !e2eLane) {
  delete childEnv.DATABASE_PLATFORM_URL;
  delete childEnv.DATABASE_URL;
}
const child = spawn(process.execPath, childArgs, {
  cwd: root,
  env: childEnv,
  stdio: "inherit",
});
let stopping = false;

/* Keep the privileged worker inside the supervisor lifecycle. Without signal
 * forwarding the adapter exits but its child remains connected to PostgreSQL,
 * so every later bootstrap adds another active worker. */
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) child.kill(signal);
    else process.exit(0);
  });
}
child.once("error", (error) => {
  console.error(`Unable to start Platform worker command: ${error.message}`);
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
