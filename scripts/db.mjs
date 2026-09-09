import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteLocalDatabasePort } from "./lib/local-database-env.mjs";
import { spawnLocalPostgres } from "./lib/local-postgres-process.mjs";
import { PLATFORM_ROLE, platformRolePrivilegeSql } from "./lib/platform-role-policy.mjs";
import { portIsBound } from "./lib/port-probe.mjs";
import { postgresToolchainBinaries, resolvePostgresToolchain } from "./lib/postgres-toolchain.mjs";
import { WEB_ROLE, webRolePrivilegeSql } from "./lib/web-role-policy.mjs";
import { WORKER_ROLE, workerRolePrivilegeSql } from "./lib/worker-role-policy.mjs";
import { findFreePort } from "./runtime-port.ts";

/**
 * PostgreSQL orchestration for both supported development modes.
 *
 * A source checkout does not embed PostgreSQL binaries. When a project-local
 * or host PostgreSQL 18 toolchain is available, these commands initialise and
 * manage a private cluster under `.univ/runtime`.
 * Otherwise the same migration/setup commands target the PostgreSQL instance
 * named by DATABASE_ADMIN_URL and use PostgreSQL client tools available on
 * PATH. No command silently substitutes a different remote database target.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/*
 * The server binaries, found not invented.
 *
 * A developer may provision a project-local PostgreSQL toolchain under
 * `.univ/toolchain`. CI and managed deployments instead provide PostgreSQL
 * client tools on PATH and point DATABASE_ADMIN_URL at their database service.
 * Same statements, different binaries.
 */
const toolchain = resolvePostgresToolchain(root);
const hasToolchain = Boolean(toolchain);
const psqlBin = toolchain?.psql ?? "psql";
const initdbBin = toolchain?.initdb ?? "initdb";
const pgIsReadyBin = toolchain?.pg_isready ?? "pg_isready";
const postgresBin = toolchain?.postgres ?? "postgres";
const pgCtlBin = toolchain?.pg_ctl ?? "pg_ctl";
const data = join(root, ".univ", "runtime", "data");
const log = join(root, ".univ", "runtime", "postgres.log");
const databaseEnvPath = join(root, ".env.database.local");
const webEnvPath = join(root, ".env.local");
const runtimeStatePath = join(root, ".univ", "runtime", "postgres.json");

/*
 * Where the cluster is, decided once.
 *
 * `DATABASE_ADMIN_URL` names the owning role, the host, the port AND the
 * database — and every statement below targets exactly what it names. The
 * constants underneath are only the developer's fallback when no URL is set:
 * a hardcoded database name beside a URL-driven migration step is a split
 * brain waiting for the first run where the two disagree — the before-SQL
 * lands on one database and drizzle migrates another, which fails three
 * steps later with «schema app does not exist» and reads like a broken
 * schema rather than a broken pipeline.
 */
const fallback = new URL("postgres://univ:univ_web_dev_password@127.0.0.1:5446/univ_web");

function resolveAdminUrl() {
  const raw = process.env.DATABASE_ADMIN_URL?.trim();
  if (!raw) return fallback;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    console.error("DATABASE_ADMIN_URL must be a valid PostgreSQL URL.");
    process.exit(1);
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    console.error("DATABASE_ADMIN_URL must use the postgres or postgresql scheme.");
    process.exit(1);
  }
  if (!parsed.hostname || !parsed.username || !databaseName(parsed)) {
    console.error("DATABASE_ADMIN_URL must include host, user and database name.");
    process.exit(1);
  }
  return parsed;
}

function databaseName(url) {
  try {
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    console.error("DATABASE_ADMIN_URL contains an invalid encoded database name.");
    process.exit(1);
  }
}

function decodeCredential(name, value) {
  try {
    return decodeURIComponent(value);
  } catch {
    console.error(`DATABASE_ADMIN_URL contains an invalid encoded ${name}.`);
    process.exit(1);
  }
}

const admin = resolveAdminUrl();
let PORT = admin.port || (admin === fallback ? "5446" : "5432");
const DATABASE = databaseName(admin) || "univ_web";

function assertProductionDatabaseInputs(command) {
  if (process.env.NODE_ENV !== "production") return;
  const required =
    command === "migrate"
      ? ["DATABASE_ADMIN_URL"]
      : ["DATABASE_ADMIN_URL", "APP_DB_PASSWORD", "WORKER_DB_PASSWORD", "PLATFORM_DB_PASSWORD"];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error(`production ${command} requires explicit secret(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  if (!admin.password) {
    console.error("DATABASE_ADMIN_URL must include an explicit password in production.");
    process.exit(1);
  }
  const localE2E = process.env.UNIV_E2E === "1" && process.env.E2E_EXTERNAL_SERVER === "1";
  if (!localE2E && admin.searchParams.get("sslmode") !== "verify-full") {
    console.error("DATABASE_ADMIN_URL must use sslmode=verify-full in production.");
    process.exit(1);
  }
}

/**
 * A deliberately small environment for libpq child processes.
 *
 * Only libpq-relevant variables are passed to external PostgreSQL clients.
 * DATABASE_ADMIN_URL is the single source of host, port, identity, database and
 * TLS settings for every database step.
 */
function childProcessEnvironment() {
  const environment = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function postgresChildEnvironment(url = admin) {
  const environment = childProcessEnvironment();

  // Local one-shot provisioning may run as the operating-system `postgres`
  // user. A libpq socket path in the URL keeps that operation passwordless and
  // avoids granting the application database owner permanent CREATEROLE.
  const socketHost = url.searchParams.get("host");
  environment.PGHOST = socketHost || url.hostname.replace(/^\[|\]$/g, "");
  environment.PGPORT = url.port || "5432";
  environment.PGUSER = decodeCredential("username", url.username);
  if (url.password) environment.PGPASSWORD = decodeCredential("password", url.password);
  environment.PGDATABASE = databaseName(url);
  environment.PGCLIENTENCODING = "UTF8";

  const libpqParameters = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    sslcrl: "PGSSLCRL",
    channel_binding: "PGCHANNELBINDING",
    target_session_attrs: "PGTARGETSESSIONATTRS",
    connect_timeout: "PGCONNECT_TIMEOUT",
    application_name: "PGAPPNAME",
    options: "PGOPTIONS",
  };
  for (const [parameter, environmentKey] of Object.entries(libpqParameters)) {
    const value = url.searchParams.get(parameter);
    if (value) environment[environmentKey] = value;
  }
  return environment;
}

function runPsql(args, { input, url = admin, database } = {}) {
  const environment = postgresChildEnvironment(url);
  if (database) environment.PGDATABASE = database;
  return spawnSync(psqlBin, ["-v", "ON_ERROR_STOP=1", "-q", ...args], {
    encoding: "utf8",
    env: environment,
    input,
  });
}

function isLoopbackHost(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function assertManagedLocalDatabase() {
  if (!hasToolchain) {
    console.error(
      "db:start/db:stop require a complete PostgreSQL 18 toolchain, either under .univ/toolchain/postgres or exposed by pg_config --bindir " +
        `(missing or incompatible binary set: ${postgresToolchainBinaries.join(", ")}). ` +
        "For an external PostgreSQL service, configure .env.database.local and run db:migrate/db:setup instead.",
    );
    process.exit(1);
  }
  if (!isLoopbackHost(admin.hostname)) {
    console.error(
      "db:start/db:stop manage only a loopback development database; DATABASE_ADMIN_URL points to a remote host.",
    );
    process.exit(1);
  }
}

function clusterInitialized() {
  return existsSync(join(data, "PG_VERSION"));
}

function initialiseCluster() {
  assertManagedLocalDatabase();
  if (clusterInitialized()) return;

  if (existsSync(data) && readdirSync(data).length > 0) {
    console.error(
      `${data} exists but is not an initialized PostgreSQL cluster. Move or remove it before db:start.`,
    );
    process.exit(1);
  }
  if (!admin.password) {
    console.error(
      "DATABASE_ADMIN_URL needs a password before a local PostgreSQL cluster can be initialized.",
    );
    process.exit(1);
  }

  mkdirSync(join(root, ".univ", "runtime"), { recursive: true });
  const passwordFile = join(root, ".univ", "runtime", ".initdb-password");
  writeFileSync(passwordFile, `${decodeCredential("password", admin.password)}\n`, { mode: 0o600 });
  let initialized;
  try {
    initialized = spawnSync(
      initdbBin,
      [
        "-D",
        data,
        "-U",
        decodeCredential("username", admin.username),
        "--pwfile",
        passwordFile,
        "--auth-host=scram-sha-256",
        "--auth-local=trust",
        "--encoding=UTF8",
      ],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(passwordFile, { force: true });
  }
  if (initialized.status !== 0) {
    console.error(
      initialized.stdout || initialized.stderr || initialized.error?.message || "initdb failed",
    );
    process.exit(1);
  }
  console.log(`initialized PostgreSQL cluster at ${data}`);
}

function ensureLocalDatabaseExists() {
  const probe = runPsql(["-tA"], {
    database: "postgres",
    input: `select 1 from pg_database where datname = ${quote(DATABASE)};`,
  });
  if (probe.status !== 0) {
    console.error(probe.stdout || probe.stderr);
    process.exit(1);
  }
  if (probe.stdout.trim() === "1") return;

  const created = runPsql([], {
    database: "postgres",
    input: `create database ${quoteIdent(DATABASE)};`,
  });
  if (created.status !== 0) {
    console.error(created.stdout || created.stderr);
    process.exit(1);
  }
  console.log(`created development database ${DATABASE}`);
}

function pgctl(...args) {
  assertManagedLocalDatabase();
  return spawnSync(pgCtlBin, ["-D", data, ...args], {
    encoding: "utf8",
  });
}

function running() {
  const status = pgctl("status");
  if (status.status === 0) return true;

  /* A port probe alone is not enough: another PostgreSQL instance may be using
     this port. If pg_ctl cannot establish status, ask the listening server for
     its data_directory and count it as ours only when it names this cluster. */
  const ready = spawnSync(pgIsReadyBin, ["-h", "127.0.0.1", "-p", PORT, "-d", "postgres"], {
    encoding: "utf8",
  });
  if (ready.status !== 0) return false;

  const identified = runPsql(["-tA"], { database: "postgres", input: "show data_directory;" });
  if (identified.status !== 0) return false;
  const theirs = identified.stdout.trim();
  if (!theirs) return false;
  return resolve(theirs).toLowerCase() === resolve(data).toLowerCase();
}

async function chooseDatabasePort() {
  const configured = Number(PORT);
  if (configured > 0 && (await portIsBound(configured))) {
    console.error(
      `configured PostgreSQL port ${configured} is already in use by another service; refusing to select a different port. Stop that service, choose the project's configured port, or use setup:local --external-db for an intentionally managed PostgreSQL instance.`,
    );
    process.exit(1);
  }
  const selected = await findFreePort({
    preferred: configured > 0 ? configured : 5446,
    start: configured > 0 ? configured : 5446,
    end: 5700,
  });
  if (configured > 0 && selected !== configured) {
    console.error(
      `PostgreSQL port ${configured} became unavailable during startup; refusing to switch to ${selected} because that would create a second local database endpoint.`,
    );
    process.exit(1);
  }
  PORT = String(selected);
  admin.port = PORT;
  if (selected === configured) return;
  if (!existsSync(databaseEnvPath)) {
    console.error(
      `selected PostgreSQL port ${selected} cannot be persisted without .env.database.local.`,
    );
    process.exit(1);
  }
  rewriteLocalDatabasePort({ databaseEnvPath, port: selected, root, webEnvPath });
  console.log(`selected PostgreSQL port ${PORT}`);
}

async function start() {
  assertManagedLocalDatabase();
  initialiseCluster();
  if (running()) {
    console.log(`already running on port ${PORT}`);
    return;
  }
  await chooseDatabasePort();
  /*
   * pg_ctl can fail before postgres starts, so startup diagnostics remain explicit.
   * to bind (notably with error 87). Start the bundled server directly instead:
   * it remains a child of this project, writes only to the project log, and its
   * pid file still lets the normal pg_ctl stop/status commands manage it.
   */
  mkdirSync(join(root, ".univ", "runtime"), { recursive: true });
  const logHandle = openSync(log, "a");
  const child = spawnLocalPostgres(postgresBin, data, PORT, logHandle);
  closeSync(logHandle);
  child.unref();
  writeFileSync(
    runtimeStatePath,
    JSON.stringify(
      { pid: child.pid, port: Number(PORT), data, startedAt: new Date().toISOString() },
      null,
      2,
    ),
  );

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (
      spawnSync(pgIsReadyBin, ["-h", "127.0.0.1", "-p", PORT, "-d", "postgres"], {}).status === 0
    ) {
      ensureLocalDatabaseExists();
      console.log(`postgres up on 127.0.0.1:${PORT}`);
      return;
    }
    if (child.exitCode !== null) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  try {
    child.kill();
  } catch {
    // The process may have exited between the readiness probe and cleanup.
  }
  rmSync(runtimeStatePath, { force: true });
  console.error(`PostgreSQL did not become ready on 127.0.0.1:${PORT}; see ${log}`);
  process.exit(1);
}

function stop() {
  if (!running()) {
    rmSync(runtimeStatePath, { force: true });
    console.log("not running");
    return;
  }
  // `fast` asks for a clean shutdown that does not wait for idle clients to
  // disconnect: a dev server holding a pool would otherwise keep the cluster up
  // indefinitely, and the alternative — `immediate` — leaves a recovery to do
  // on the next start.
  const stopped = pgctl("-m", "fast", "-w", "stop");
  if (stopped.status !== 0) {
    console.error(stopped.stdout || stopped.stderr);
    process.exit(1);
  }
  rmSync(runtimeStatePath, { force: true });
  console.log("postgres stopped");
}

/**
 * Brings the database up to the current schema, in two steps that are two
 * different kinds of thing.
 *
 * **Tables** are applied by drizzle-kit, which keeps its own journal in
 * `__drizzle_migrations` and therefore knows what it has already run. Re-running
 * is a no-op; that is the whole reason to use it rather than replaying SQL by
 * hand, which fails on the second run with "relation already exists".
 *
 * **Hand-written SQL** surrounds that step, from `db/sql`, because several
 * things this schema depends on cannot be expressed in a Drizzle table
 * definition and drizzle-kit will never generate them: row-level security
 * policies, an extension, and an IMMUTABLE text-folding function.
 *
 * The two directories are a dependency order, not a filing convention:
 *
 *   `before/`  runs first, and holds what the tables depend on. The folding
 *              function is here because `students.search_text` is a generated
 *              column that calls it — PostgreSQL refuses to create the column
 *              otherwise, so a fresh database would fail at migration 0003 with
 *              an error naming a function nobody had thought to create yet.
 *
 *   `after/`   runs last, and holds what depends on the tables. A policy names
 *              the table it protects and cannot precede it.
 *
 * Every file in both is written to be idempotent — `CREATE OR REPLACE`, `DROP
 * POLICY IF EXISTS`, `IF NOT EXISTS` — so the whole set is re-applied every time
 * rather than journal-tracked. For a handful of declarative statements that is
 * the safer trade: a policy can never be silently absent because a journal
 * believed it had been applied.
 *
 * Both steps connect as the owning role. `DATABASE_URL` is the application's
 * restricted role and cannot create a table or a policy — by design.
 */
function migrate() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    console.error("DATABASE_ADMIN_URL is not set; migrations run as the owning role.");
    process.exit(1);
  }

  applySql("before");

  const tables = spawnSync(
    process.execPath,
    [join(root, "node_modules", "drizzle-kit", "bin.cjs"), "migrate"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...childProcessEnvironment(),
        DATABASE_URL: adminUrl,
        NODE_ENV: process.env.NODE_ENV ?? "development",
        NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1",
      },
    },
  );
  if (tables.status !== 0) {
    console.error(tables.stdout || tables.stderr);
    process.exit(1);
  }
  console.log("tables up to date");

  applySql("after");

  // Existing runtime roles are refreshed after every schema change. A genuinely
  // fresh database may not have those cluster-level roles yet; in that case
  // migrate must succeed and the subsequent `db:setup` creates and grants them.
  refreshRolePolicyIfPresent(WEB_ROLE, webRolePrivilegeSql(DATABASE), "web");
  refreshRolePolicyIfPresent(WORKER_ROLE, workerRolePrivilegeSql(DATABASE), "worker");
  refreshRolePolicyIfPresent(PLATFORM_ROLE, platformRolePrivilegeSql(DATABASE), "platform worker");
}

/**
 * Applies every `.sql` file in one phase directory, in filename order.
 *
 * A missing directory is not a failure — a phase with nothing in it yet is a
 * legitimate state — but a file that errors stops everything: `ON_ERROR_STOP=1`
 * plus a non-zero exit here, because a half-applied policy file is a database
 * that looks migrated and is not protected.
 */
function applySql(phase) {
  const dir = join(root, "db", "sql", phase);
  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) return;

  for (const file of files) {
    // The folding function is a wall of Persian characters. Passed through
    // `-f` with PGCLIENTENCODING=UTF8 keeps migration text decoding deterministic.
    // corruption. Host, database, credentials and TLS all come from the same
    // DATABASE_ADMIN_URL that drizzle-kit uses.
    const applied = runPsql(["-f", join(dir, file)]);
    if (applied.status !== 0) {
      console.error(`failed: db/sql/${phase}/${file}`);
      console.error(applied.stdout || applied.stderr);
      process.exit(1);
    }
  }
  console.log(`applied ${files.length} sql file(s) (${phase})`);
}

/**
 * Creates the request-serving role — one cluster-level half of `setup`, usable
 * before any database has a schema. The E2E pipeline can create runtime roles
 * before provisioning while grants wait for migrations to create their tables.
 */
function ensureRole() {
  ensureDatabaseRole({
    role: WEB_ROLE,
    password: process.env.APP_DB_PASSWORD ?? "univ_app_web_dev_password",
    bypassRls: false,
  });
}

function ensureWorkerRole() {
  ensureDatabaseRole({
    role: WORKER_ROLE,
    password: process.env.WORKER_DB_PASSWORD ?? "univ_job_worker_dev_password",
    bypassRls: true,
  });
}

function ensurePlatformRole() {
  ensureDatabaseRole({
    role: PLATFORM_ROLE,
    password: process.env.PLATFORM_DB_PASSWORD ?? "univ_platform_worker_dev_password",
    bypassRls: true,
  });
}

function ensureDatabaseRole({ role, password, bypassRls }) {
  /*
   * db:setup is intentionally safe to rerun with the restricted owner role.
   * Existing runtime roles are not password-rotated here: doing so would
   * require permanent CREATEROLE on univ_owner and would also silently break
   * the credential files used by the workers. Password rotation belongs to the
   * explicit bootstrap/admin path. A missing role is still created below, so a
   * fresh database remains fully bootstrappable by its initial administrator.
   */
  if (roleExists(role)) {
    console.log(`${role} already exists; preserving its credential and cluster privileges`);
    return;
  }
  const identifier = quoteIdent(role);
  const statements = `DO $$ BEGIN
    CREATE ROLE ${identifier} LOGIN PASSWORD ${quote(password)};
  END $$;
  ALTER ROLE ${identifier} NOSUPERUSER ${bypassRls ? "BYPASSRLS" : "NOBYPASSRLS"} NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;`;
  // Feed SQL on stdin so role passwords never appear in the process list.
  const applied = runPsql([], { input: statements });
  if (applied.status !== 0) {
    console.error(applied.stdout || applied.stderr);
    process.exit(1);
  }
  console.log(`${role} ready (NOSUPERUSER, ${bypassRls ? "BYPASSRLS" : "NOBYPASSRLS"})`);
}

function roleExists(role) {
  const result = runPsql(["-tAc", `select 1 from pg_roles where rolname=${quote(role)}`]);
  if (result.status !== 0) {
    console.error(result.stdout || result.stderr);
    process.exit(1);
  }
  return result.stdout.trim() === "1";
}

function refreshRolePolicyIfPresent(role, sql, label) {
  if (!roleExists(role)) {
    console.log(`${label} database role not present yet; privileges will be applied by db:setup`);
    return;
  }
  const applied = runPsql([], { input: sql });
  if (applied.status !== 0) {
    console.error(applied.stdout || applied.stderr);
    process.exit(1);
  }
  console.log(`${label} database privileges refreshed`);
}

/**
 * Applies the request-serving role's least-privilege database contract.
 *
 * No default table privileges are granted: a future table is inaccessible to
 * the Web role until this setup step is reviewed and rerun after migration.
 * That fails closed for new platform/operational tables instead of silently
 * publishing them to the application process.
 */
function setup() {
  ensureRole();
  ensureWorkerRole();
  ensurePlatformRole();
  for (const [label, sql] of [
    ["web", webRolePrivilegeSql(DATABASE)],
    ["worker", workerRolePrivilegeSql(DATABASE)],
    ["platform worker", platformRolePrivilegeSql(DATABASE)],
  ]) {
    const applied = runPsql([], { input: sql });
    if (applied.status !== 0) {
      console.error(applied.stdout || applied.stderr);
      process.exit(1);
    }
    console.log(`${label} database privileges applied`);
  }
}

/** Single-quotes a literal for SQL. Only ever used on a password from env. */
function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Identifiers come from the parsed admin URL, never from request input. */
function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

const command = process.argv[2];
if (command === "start") await start();
else if (command === "setup") {
  assertProductionDatabaseInputs("setup");
  setup();
} else if (command === "role") {
  assertProductionDatabaseInputs("role");
  ensureRole();
  ensureWorkerRole();
  ensurePlatformRole();
} else if (command === "stop") stop();
else if (command === "migrate") {
  assertProductionDatabaseInputs("migrate");
  migrate();
} else {
  console.error("usage: node scripts/db.mjs start|stop|migrate|setup|role");
  process.exit(1);
}
