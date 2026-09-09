#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { assertCanonicalLocalDatabaseTargets } from "../src/lib/local-database-target.ts";
import { frozenInstallArgs, runPnpm } from "./lib/run-command.mjs";

const root = resolve(import.meta.dirname, "..");
const noDev = process.argv.includes("--no-dev");
const externalDb = process.argv.includes("--external-db");
const skipPlatformOperator = process.argv.includes("--skip-platform-operator");
const pinnedRerun = process.env.UNIV_SETUP_LOCAL_PINNED === "1";

if (process.argv.includes("--help")) {
  console.log("Usage: pnpm setup:local [--no-dev] [--external-db] [--skip-platform-operator]");
  console.log("  --no-dev       prepare the database without starting Next.js");
  console.log("  --external-db  use the PostgreSQL named by the existing local env files");
  console.log("  --skip-platform-operator  do not create/update the local operator account");
  process.exit(0);
}

assertHostToolchain();

runStep("Install exact dependency graph", frozenInstallArgs(root));
if (externalDb) {
  requireEnvironment(".env.local");
  requireEnvironment(".env.database.local");
  ensureLocalSecrets();
  ensureLocalStorageEnvironment();
} else {
  ensureLocalEnvironment(".env.local", ".env.example", {
    BETTER_AUTH_SECRET: randomSecret(),
    MFA_ENCRYPTION_KEY: randomSecret(),
    PLATFORM_OPERATION_ENCRYPTION_KEY: randomSecret(),
    INTEGRATION_ENCRYPTION_KEY: randomSecret(),
    PUBLIC_FORM_RATE_SALT: randomSecret(),
    OBJECT_STORAGE_PROVIDER: "s3-compatible",
    OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9100",
    OBJECT_STORAGE_PUBLIC_ENDPOINT: "http://127.0.0.1:9100",
    OBJECT_STORAGE_BROWSER_ORIGIN: "http://127.0.0.1:9100",
    OBJECT_STORAGE_BUCKET: "univ-local",
    OBJECT_STORAGE_ACCESS_KEY_ID: "local-dev",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: randomSecret(),
    OBJECT_STORAGE_PATH_STYLE: "true",
  });
  ensureLocalEnvironment(".env.database.local", ".env.database.local.example", {
    SEED_ADMIN_PASSWORD: randomPassword(),
    TENANT_ADMIN_PASSWORD: randomPassword(),
    PLATFORM_OPERATOR_USERNAME: "operator",
    PLATFORM_OPERATOR_PASSWORD: randomPassword(),
  });
}
ensureLocalRuntimeProfiles();

if (!externalDb) runStep("Start project-local PostgreSQL", ["db:start"]);
assertCanonicalDatabaseReachable();
runStep("Apply database migrations", ["db:migrate"]);
runStep("Provision runtime roles", ["db:setup"]);
runStep("Seed the local institution and administrator", ["seed"]);
if (!skipPlatformOperator) runStep("Create the local platform operator", ["platform:user"]);
if (!noDev) {
  ensureInitialBackup();
  runStep("Start the local full stack (Web, workers, storage, scanner)", ["local:up"]);
}

function runStep(name, args) {
  console.log(`\n=== ${name} ===`);
  runPnpm(args, { cwd: root });
}

function assertHostToolchain() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
    throw new Error(
      `Node.js 24.20.0 or newer is required; found ${process.versions.node}. Switch to the pinned 24.x runtime before bootstrapping.`,
    );
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const required = String(manifest.packageManager ?? "").replace(/^pnpm@/, "");
  const bundled = join(root, "toolchain", "pnpm", required, "bin", "pnpm.mjs");
  const probe = existsSync(bundled)
    ? spawnSync(process.execPath, [bundled, "--version"], { cwd: root, encoding: "utf8" })
    : null;
  const bundledVersion = probe?.status === 0 ? probe.stdout.trim() : "unknown";
  if (required && bundledVersion !== required) {
    throw new Error(
      `The bundled pnpm runtime is unavailable or mismatched: expected ${required}, found ${bundledVersion}. ` +
        "Restore toolchain/pnpm/<version> from the reviewed source archive; refusing a registry-based bootstrap retry.",
    );
  }
  // Use the reviewed runtime directly for every child pnpm command. This
  // avoids a network-dependent `pnpm dlx` re-exec when setup:local is invoked
  // through `node`, a shell wrapper, or a launcher with no user-agent value.
  process.env.npm_execpath = bundled;
  if (pinnedRerun) console.log(`Pinned pnpm@${required} bootstrap launcher active; continuing.`);
  else console.log(`Using bundled pnpm@${required} bootstrap runtime.`);
}

function ensureLocalEnvironment(targetName, templateName, replacements) {
  const target = join(root, targetName);
  const hadTarget = existsSync(target);
  assertPrivateFileTarget(target);
  let content = hadTarget
    ? readFileSync(target, "utf8")
    : readFileSync(join(root, templateName), "utf8");
  let changed = false;
  for (const [key, value] of Object.entries(replacements)) {
    const pattern = new RegExp(`^${key}=(.*)$`, "m");
    const match = content.match(pattern);
    if (!match) {
      content += `\n${key}=${value}\n`;
      changed = true;
    } else if (
      /(?:replace-with|replace-me|change-me|local-development-secret)/i.test(match[1]?.trim() ?? "")
    ) {
      content = content.replace(pattern, `${key}=${value}`);
      changed = true;
    }
  }
  if (hadTarget && !changed) {
    ensurePrivateFile(target);
    console.log(`${targetName} already exists; leaving its values unchanged.`);
    return;
  }
  writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
  ensurePrivateFile(target);
  console.log(`${hadTarget ? "Updated" : "Created"} ${targetName} with local-only settings.`);
}

function ensureLocalSecrets() {
  ensureLocalEnvironment(".env.local", ".env.example", {
    BETTER_AUTH_SECRET: randomSecret(),
    MFA_ENCRYPTION_KEY: randomSecret(),
    PLATFORM_OPERATION_ENCRYPTION_KEY: randomSecret(),
    INTEGRATION_ENCRYPTION_KEY: randomSecret(),
    PUBLIC_FORM_RATE_SALT: randomSecret(),
  });
}

function requireEnvironment(name) {
  if (!existsSync(join(root, name))) {
    throw new Error(
      `${name} is required with --external-db; copy the matching example and configure the managed PostgreSQL credentials first.`,
    );
  }
  console.log(`${name} found; leaving externally managed settings unchanged.`);
}

function ensureLocalStorageEnvironment() {
  ensureLocalEnvironment(".env.local", ".env.example", {
    OBJECT_STORAGE_PROVIDER: "s3-compatible",
    OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9100",
    OBJECT_STORAGE_PUBLIC_ENDPOINT: "http://127.0.0.1:9100",
    OBJECT_STORAGE_BROWSER_ORIGIN: "http://127.0.0.1:9100",
    OBJECT_STORAGE_BUCKET: "univ-local",
    OBJECT_STORAGE_ACCESS_KEY_ID: "local-dev",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: randomSecret(),
    OBJECT_STORAGE_PATH_STYLE: "true",
  });
}

function ensureLocalRuntimeProfiles() {
  const db = readEnvFile(".env.database.local");
  const web = readEnvFile(".env.local");
  const databaseTarget = assertCanonicalLocalDatabaseTargets([
    {
      name: ".env.database.local:DATABASE_ADMIN_URL",
      role: "univ_owner",
      url: db.get("DATABASE_ADMIN_URL"),
    },
    {
      name: ".env.database.local:DATABASE_URL",
      role: "univ_app_web",
      url: db.get("DATABASE_URL"),
    },
    {
      name: ".env.local:DATABASE_URL",
      role: "univ_app_web",
      url: web.get("DATABASE_URL"),
    },
    {
      name: ".env.database.local:DATABASE_WORKER_URL",
      role: "univ_job_worker",
      url: db.get("DATABASE_WORKER_URL"),
    },
    {
      name: ".env.database.local:DATABASE_PLATFORM_URL",
      role: "univ_platform_worker",
      url: db.get("DATABASE_PLATFORM_URL"),
    },
  ]);
  const backupDir = resolve(root, ".univ", "runtime", "backups");
  const exportDir = resolve(root, ".univ", "exports");
  const auditDir = resolve(root, ".univ", "runtime", "audit-seals");
  const reportDir = resolve(root, ".univ", "runtime", "dr-reports");
  const existingKeyring = readEnvValue(".env.operations.local", "BACKUP_ENCRYPTION_KEYS");
  const existingAuditSealKey = readEnvValue(".env.operations.local", "AUDIT_SEAL_KEY");
  const backupKey = existingKeyring || JSON.stringify({ local: randomBytesHex() });
  const auditSealKey = existingAuditSealKey || randomSecret();
  const profiles = {
    ".env.worker.local": `${[
      "# Generated by pnpm setup:local; local-only and ignored by git.",
      "NODE_ENV=development",
      `DATABASE_WORKER_URL=${requiredEnv(db, "DATABASE_WORKER_URL")}`,
      `DATABASE_URL=${requiredEnv(web, "DATABASE_URL")}`,
      `EXPORT_JOB_DIR=${exportDir}`,
      "PLATFORM_OPERATOR=tenant-job-worker",
      `INTEGRATION_ENCRYPTION_KEY=${requiredEnv(web, "INTEGRATION_ENCRYPTION_KEY")}`,
      "OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9100",
      "OBJECT_STORAGE_PUBLIC_ENDPOINT=http://127.0.0.1:9100",
      "OBJECT_STORAGE_BUCKET=univ-local",
      "OBJECT_STORAGE_ACCESS_KEY_ID=local-dev",
      `OBJECT_STORAGE_SECRET_ACCESS_KEY=${requiredEnv(web, "OBJECT_STORAGE_SECRET_ACCESS_KEY")}`,
      "OBJECT_STORAGE_PATH_STYLE=true",
      "ANTIVIRUS_HTTP_ENDPOINT=http://127.0.0.1:9110",
      "ANTIVIRUS_HTTP_TIMEOUT_MS=5000",
    ].join("\n")}\n`,
    ".env.platform-worker.local": `${[
      "# Generated by pnpm setup:local; local-only and ignored by git.",
      "NODE_ENV=development",
      `DATABASE_PLATFORM_URL=${requiredEnv(db, "DATABASE_PLATFORM_URL")}`,
      `DATABASE_URL=${requiredEnv(web, "DATABASE_URL")}`,
      `BETTER_AUTH_SECRET=${requiredEnv(web, "BETTER_AUTH_SECRET")}`,
      `BETTER_AUTH_URL=${requiredEnv(web, "BETTER_AUTH_URL")}`,
      "PLATFORM_OPERATOR=operator",
      `PLATFORM_OPERATION_ENCRYPTION_KEY=${requiredEnv(web, "PLATFORM_OPERATION_ENCRYPTION_KEY")}`,
      "PLATFORM_SESSION_HOURS=4",
      "BACKUP_ACTIVE_KEY_ID=local",
      `BACKUP_ENCRYPTION_KEYS=${backupKey}`,
      `BACKUP_DIR=${backupDir}`,
    ].join("\n")}\n`,
    ".env.operations.local": `${[
      "# Generated by pnpm setup:local; one-shot operations only.",
      "NODE_ENV=development",
      `DATABASE_ADMIN_URL=${requiredEnv(db, "DATABASE_ADMIN_URL")}`,
      `APP_DB_PASSWORD=${requiredEnv(db, "APP_DB_PASSWORD")}`,
      `WORKER_DB_PASSWORD=${requiredEnv(db, "WORKER_DB_PASSWORD")}`,
      `PLATFORM_DB_PASSWORD=${requiredEnv(db, "PLATFORM_DB_PASSWORD")}`,
      `DATABASE_URL=${requiredEnv(web, "DATABASE_URL")}`,
      `DATABASE_WORKER_URL=${requiredEnv(db, "DATABASE_WORKER_URL")}`,
      `DATABASE_PLATFORM_URL=${requiredEnv(db, "DATABASE_PLATFORM_URL")}`,
      `BETTER_AUTH_SECRET=${requiredEnv(web, "BETTER_AUTH_SECRET")}`,
      `BETTER_AUTH_URL=${requiredEnv(web, "BETTER_AUTH_URL")}`,
      "PLATFORM_OPERATOR=operator",
      `PLATFORM_OPERATION_ENCRYPTION_KEY=${requiredEnv(web, "PLATFORM_OPERATION_ENCRYPTION_KEY")}`,
      "PLATFORM_SESSION_HOURS=4",
      "BACKUP_ACTIVE_KEY_ID=local",
      `BACKUP_ENCRYPTION_KEYS=${backupKey}`,
      `BACKUP_DIR=${backupDir}`,
      "MFA_ACTIVE_KEY_ID=local",
      `MFA_ENCRYPTION_KEYS=${JSON.stringify({ local: requiredEnv(web, "MFA_ENCRYPTION_KEY") })}`,
      `AUDIT_SEAL_DIR=${auditDir}`,
      `AUDIT_SEAL_KEY=${auditSealKey}`,
      `DR_REPORT_DIR=${reportDir}`,
      "DR_TARGET_RPO_MINUTES=60",
      "DR_TARGET_RTO_MINUTES=240",
    ].join("\n")}\n`,
  };
  ensurePrivateDirectory(resolve(root, ".univ"));
  ensurePrivateDirectory(resolve(root, ".univ", "runtime"));
  ensurePrivateDirectory(exportDir);
  ensurePrivateDirectory(backupDir);
  ensurePrivateDirectory(auditDir);
  ensurePrivateDirectory(reportDir);
  for (const [name, content] of Object.entries(profiles)) {
    const path = join(root, name);
    assertPrivateFileTarget(path);
    writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    ensurePrivateFile(path);
  }
  console.log(`Canonical local database target: ${databaseTarget}`);
  console.log("Local worker, platform-worker, and operations profiles are ready.");
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function assertPrivateFileTarget(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`${path} must not be a symbolic link; replace it with a regular local file.`);
  }
}

function ensurePrivateFile(path) {
  assertPrivateFileTarget(path);
  chmodSync(path, 0o600);
}

function assertCanonicalDatabaseReachable() {
  const databaseUrl = readEnvValue(".env.database.local", "DATABASE_ADMIN_URL");
  if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL is required before local bootstrap.");

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_ADMIN_URL must be a valid PostgreSQL URL before local bootstrap.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const host = parsed.searchParams.get("host") || parsed.hostname;
  const port = parsed.port || "5432";
  const probe = spawnSync("pg_isready", ["--host", host, "--port", port, "--dbname", database], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    const details = (probe.stdout || probe.stderr || probe.error?.code || "no response").trim();
    throw new Error(
      `Canonical PostgreSQL is not reachable at ${host}:${port}/${database}. ` +
        `${externalDb ? "Start the configured PostgreSQL service and retry setup:local --external-db." : "Start the local database or use --external-db for a managed service."} ` +
        `Probe: ${details}`,
    );
  }
  console.log(`Canonical PostgreSQL is reachable at ${host}:${port}/${database}.`);
}

function ensureInitialBackup() {
  const dir = resolve(root, ".univ", "runtime", "backups");
  const hasManifest =
    existsSync(dir) && readdirSync(dir).some((name) => name.endsWith(".dump.enc.json"));
  if (!hasManifest) runStep("Create the initial verified local backup", ["backup:create"]);
}

function readEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return new Map();
  return new Map(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        return match ? [[match[1], match[2]]] : [];
      }),
  );
}

function readEnvValue(name, key) {
  return readEnvFile(name).get(key)?.trim() || "";
}

function requiredEnv(values, key) {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`${key} is required in the local environment`);
  return value;
}

function randomBytesHex() {
  return randomBytes(32).toString("hex");
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function randomPassword() {
  return `Local-${randomBytes(18).toString("base64url")}`;
}
