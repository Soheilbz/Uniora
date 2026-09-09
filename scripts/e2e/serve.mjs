import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort } from "../runtime-port.ts";
import { e2eDatabaseName } from "./database-safety.mjs";

/**
 * Runs the *production* server against the E2E database.
 *
 * `output: "standalone"` means the deployable artifact is
 * `<distDir>/standalone/server.js` — `next start` does not serve from it. So this
 * is the same command a deployment runs, pointed at the test database and a
 * test port: static assets copied into the bundle, the standalone process
 * started with the E2E connection strings in its environment.
 *
 * Environment passed here wins over `.env.local` (dotenv never overrides an
 * existing process variable), which is what keeps the suite off the
 * developer's database even though the file is present.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const port = process.env.E2E_PORT ?? String(await findFreePort({ preferred: 3021 }));
/* The runner gives each parallel group its own database; unset is the
   classic single-run name. */
const dbName = e2eDatabaseName(process.env.E2E_DB_NAME);
const buildDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const standalone = join(root, buildDir, "standalone");
const exportJobDir = join(root, ".univ", "e2e-exports", dbName);
mkdirSync(exportJobDir, { recursive: true, mode: 0o700 });

if (!existsSync(join(standalone, "server.js"))) {
  console.error("No standalone build. Run `pnpm build` first (the e2e script does).");
  process.exit(1);
}

/* The bundle needs the static assets beside it; the build does not copy them.
   The normal runner stages this once before starting parallel lanes. Keep a
   small lock for direct/concurrent wrapper starts so they cannot overwrite the
   shared standalone tree at the same time. */
const staticDest = join(standalone, buildDir, "static");
if (!existsSync(staticDest)) {
  const lock = `${staticDest}.lock`;
  let ownsLock = false;
  for (let attempt = 1; ; attempt++) {
    try {
      mkdirSync(lock);
      ownsLock = true;
      cpSync(join(root, buildDir, "static"), staticDest, { recursive: true });
      break;
    } catch (cause) {
      if (ownsLock) throw cause;
      if (existsSync(staticDest)) break;
      if (attempt >= 120) throw cause;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    } finally {
      if (ownsLock) rmSync(lock, { recursive: true, force: true });
    }
  }
}

function readEnvFile(name) {
  const values = {};
  const envPath = join(root, name);
  if (!existsSync(envPath)) return values;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

const file = readEnvFile(".env.local");
const databaseFile = readEnvFile(".env.database.local");

/* CI supplies the owner URL explicitly; local E2E reads it only from the
   privileged database file. The public Web file never carries it. */
const adminUrl = new URL(
  process.env.E2E_ADMIN_URL ??
    process.env.DATABASE_ADMIN_URL ??
    databaseFile.DATABASE_ADMIN_URL ??
    "",
);
if (!adminUrl.hostname) {
  console.error("DATABASE_ADMIN_URL (or E2E_ADMIN_URL) is required to serve the E2E database.");
  process.exit(1);
}
adminUrl.pathname = `/${dbName}`;
const appUrl = new URL(adminUrl);
appUrl.username = "univ_app_web";
appUrl.password =
  process.env.APP_DB_PASSWORD ?? databaseFile.APP_DB_PASSWORD ?? "univ_app_web_dev_password";
/* NEXT_DIST_DIR selects the artifact for this wrapper; the generated
 * standalone server runs from that artifact's root and must not reinterpret
 * the selector relative to its own cwd. */
const runtimeEnv = { ...file };
delete runtimeEnv.NEXT_DIST_DIR;
delete runtimeEnv.DATABASE_ADMIN_URL;
delete runtimeEnv.DATABASE_WORKER_URL;
delete runtimeEnv.DATABASE_PLATFORM_URL;
delete runtimeEnv.APP_DB_PASSWORD;
delete runtimeEnv.WORKER_DB_PASSWORD;
delete runtimeEnv.PLATFORM_DB_PASSWORD;
delete runtimeEnv.BACKUP_ENCRYPTION_KEY;
delete runtimeEnv.BACKUP_ENCRYPTION_KEYS;
delete runtimeEnv.BACKUP_ACTIVE_KEY_ID;
delete runtimeEnv.BACKUP_DIR;
delete runtimeEnv.BACKUP_OFFSITE_DIR;
delete runtimeEnv.AUDIT_SEAL_KEY;
delete runtimeEnv.MFA_ROTATION_CONFIRM;
delete runtimeEnv.PLATFORM_OPERATOR;
delete runtimeEnv.PLATFORM_RESTORE_ALLOWED;
delete runtimeEnv.PLATFORM_CROSS_TARGET_RESTORE;

const child = spawn(process.execPath, [join(standalone, "server.js")], {
  cwd: standalone,
  env: {
    ...runtimeEnv,
    PORT: port,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    DATABASE_URL: appUrl.toString(),
    /* The runner sizes this per lane from the total number of concurrent
       lanes. Keep the production default only for direct one-lane invocations,
       so a parallel suite cannot exhaust the shared PostgreSQL cluster. */
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "10",
    DATABASE_CONNECTION_TIMEOUT_MS: "15000",
    EXPORT_JOB_DIR: exportJobDir,
    /* Never inherit the developer's marked secret from .env.local. The E2E
       server runs with NODE_ENV=production and must exercise the same guard
       as a deployment, while its isolated database still needs a stable test
       secret. */
    BETTER_AUTH_SECRET: "9f4c8b2a7d6e1c0f3a5b8d2e6f1c9a4b7d0e3f6a8c1b5d9e2f4a7c0b3e6d8f1",
    MFA_ENCRYPTION_KEY: "1e6c7d8a9b0f1234567890abcdef1234567890abcdef1234567890abcdef1234",
    PLATFORM_OPERATION_ENCRYPTION_KEY:
      "e2e-platform-operation-key-0123456789abcdef0123456789abcdef",
    INTEGRATION_ENCRYPTION_KEY: "e2e-integration-encryption-key-0123456789abcdef0123456789abcdef",
    PLATFORM_SESSION_HOURS: "4",
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
    UNIV_E2E: "1",
    /* The runtime guard requires a second, independently supplied marker so
       a production process cannot be weakened by UNIV_E2E alone. */
    E2E_EXTERNAL_SERVER: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});

let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill();
  process.exit(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 0);
}

/* Playwright starts this wrapper, not the standalone server directly. Forward
   shutdown so a completed or interrupted run cannot leave server.js holding
   the standalone tree open while the child process is serving it. */
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("exit", () => {
  if (child.exitCode === null) child.kill();
});

child.on("exit", (code) => {
  if (!stopping) process.exit(code ?? 0);
});
