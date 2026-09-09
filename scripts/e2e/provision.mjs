import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { platformRolePrivilegeSql } from "../lib/platform-role-policy.mjs";
import { webRolePrivilegeSql } from "../lib/web-role-policy.mjs";
import { workerRolePrivilegeSql } from "../lib/worker-role-policy.mjs";
import { e2eDatabaseName, localE2EAdminUrl, quotePgIdentifier } from "./database-safety.mjs";

/**
 * Provisions the end-to-end test database from nothing.
 *
 * The E2E suite runs against a real PostgreSQL with the real schema, the real
 * row-level security and the real seed — which means it must never be the
 * developer's database. This drops and recreates `univ_web_e2e` on the same
 * loopback-only cluster the project already owns, applies the exact migration
 * pipeline the real database gets (before-SQL, drizzle migrations, after-SQL,
 * the restricted application role's grants), seeds it, and writes fixtures.
 *
 * Deterministic by construction: the database is destroyed and rebuilt every
 * run, so no test depends on what a previous run left behind.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/* Binaries, found not invented — the bundled toolchain on the developer's
   machine, the runner's own psql on CI. See scripts/db.mjs for the same rule. */
const toolchainBin = join(root, ".univ", "toolchain", "postgres", "bin");
const projectPsql = join(toolchainBin, "psql");
const psql = existsSync(projectPsql) ? projectPsql : "psql";
/* The runner provisions one database per parallel group; unset is the
   classic single-run name. */
const DB_NAME = e2eDatabaseName(process.env.E2E_DB_NAME);

/** The developer's privileged local database credentials. The Web .env.local is intentionally not read here. CI supplies everything through the process environment. */
function envFile() {
  const path = join(root, ".env.database.local");
  if (!existsSync(path)) return {};
  const map = {};
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("NODE")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return map;
}

const file = envFile();
const rawAdminUrl =
  process.env.E2E_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL ?? file.DATABASE_ADMIN_URL;
if (!rawAdminUrl) {
  console.error("DATABASE_ADMIN_URL (or E2E_ADMIN_URL) is required to provision the E2E database.");
  process.exit(1);
}
const adminUrl = localE2EAdminUrl(rawAdminUrl);
const ADMIN_USER = decodeURIComponent(new URL(adminUrl).username);
const ADMIN_HOST = new URL(adminUrl).searchParams.get("host") || new URL(adminUrl).hostname;
const PORT = process.env.DB_PORT ?? String(new URL(adminUrl).port || 5432);

/** Fixed credentials the suite and the fixtures both know. */
export const E2E = {
  dbName: DB_NAME,
  port: PORT,
  adminUrlFor(db) {
    const url = new URL(adminUrl);
    url.pathname = `/${db}`;
    return url.toString();
  },
  appUrlFor(db) {
    const url = new URL(adminUrl);
    url.username = "univ_app_web";
    url.password =
      process.env.APP_DB_PASSWORD ?? file.APP_DB_PASSWORD ?? "univ_app_web_dev_password";
    url.pathname = `/${db}`;
    return url.toString();
  },
};

function applySql(database, file2) {
  const args = [
    "-h",
    ADMIN_HOST,
    "-p",
    PORT,
    "-U",
    ADMIN_USER,
    "-d",
    database,
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
  ];
  if (file2) args.push("-f", file2);
  else args.push("-c", statements);
  const ran = spawnSync(psql, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(new URL(adminUrl).password),
      PGCLIENTENCODING: "UTF8",
    },
  });
  if (ran.status !== 0) {
    console.error(`psql failed${file2 ? ` (${file2})` : ""}:`, ran.stdout || ran.stderr);
    process.exit(1);
  }
}

/* `DROP DATABASE ... WITH (FORCE)` needs pg_signal_backend when another role
 * owns a connection. The disposable Web role must not receive that powerful
 * cluster-wide privilege just to make an interrupted E2E run recoverable, but
 * PostgreSQL does allow a role to terminate its own backends. Close only the
 * old Web connections first; the owner can then drop the database normally.
 * This is what makes Ctrl-C/restart safe without changing production grants. */
async function closeStaleWebConnections() {
  const app = new pg.Client({ connectionString: E2E.appUrlFor(DB_NAME) });
  try {
    await app.connect();
    await app.query(
      `select pg_terminate_backend(pid)
         from pg_stat_activity
        where datname = current_database()
          and usename = current_user
          and pid <> pg_backend_pid()`,
    );
  } catch (error) {
    if (error?.code !== "3D000") throw error;
  } finally {
    await app.end().catch(() => undefined);
  }
}

let statements = "";

// 1. Destroy and recreate the test database.
await closeStaleWebConnections();
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
const databaseIdentifier = quotePgIdentifier(DB_NAME);
await admin.query(`DROP DATABASE IF EXISTS ${databaseIdentifier} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${databaseIdentifier}`);
await admin.end();
console.log(`database recreated: ${DB_NAME}`);

// 2. The hand-written SQL the tables depend on (text folding).
for (const file2 of files("before")) applySql(DB_NAME, file2);

// 3. Drizzle migrations, as the owning role, against the test database.
const migrated = spawnSync(
  process.execPath,
  [join(root, "node_modules", "drizzle-kit", "bin.cjs"), "migrate"],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: E2E.adminUrlFor(DB_NAME) },
  },
);
if (migrated.status !== 0) {
  console.error("drizzle-kit migrate failed:", migrated.stdout || migrated.stderr);
  process.exit(1);
}
console.log("migrations applied");

// 4. The hand-written SQL that depends on the tables (row-level security).
for (const file2 of files("after")) applySql(DB_NAME, file2);

// 5. Runtime-role grants, scoped to this database. Use the exact canonical
//    policies production setup and disaster recovery use; E2E must not carry a
//    permissive shadow policy that can hide a missing production grant.
statements = `${webRolePrivilegeSql(DB_NAME)}
${workerRolePrivilegeSql(DB_NAME)}
${platformRolePrivilegeSql(DB_NAME)}`;
applySql(DB_NAME);
console.log("runtime roles granted");

// 6. Seed, then fixtures — both pointed at the test database by env.
function runScript(script, extraEnv = {}) {
  const ran = spawnSync(process.execPath, ["--env-file-if-exists=.env.database.local", script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: E2E.appUrlFor(DB_NAME),
      DATABASE_ADMIN_URL: E2E.adminUrlFor(DB_NAME),
      SEED_ADMIN_PASSWORD: "e2e-admin-pass-123",
      MFA_ENCRYPTION_KEY:
        process.env.MFA_ENCRYPTION_KEY ??
        "1e6c7d8a9b0f1234567890abcdef1234567890abcdef1234567890abcdef1234",
      /* Shard-aware outputs flow through to the scripts that write them. */
      ...(process.env.E2E_STATE_FILE ? { E2E_STATE_FILE: process.env.E2E_STATE_FILE } : {}),
      ...extraEnv,
    },
  });
  if (ran.status !== 0) {
    console.error(`${script} failed:`, ran.stdout || ran.stderr);
    process.exit(1);
  }
  console.log(ran.stdout.trim().split("\n").at(-1));
}

runScript("scripts/seed.ts");
runScript("scripts/e2e/seed-fixtures.ts");
console.log("e2e database ready");

function files(phase) {
  return readdirSync(join(root, "db", "sql", phase))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join("db", "sql", phase, name));
}
