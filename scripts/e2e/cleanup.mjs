import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { e2eDatabaseName, localE2EAdminUrl, quotePgIdentifier } from "./database-safety.mjs";

/*
 * Remove exactly one disposable E2E database. This is deliberately a separate
 * command instead of a broad prefix sweep: an interrupted test run must never
 * be able to guess at, or touch, the canonical `univ` database.
 */
const rawAdminUrl = process.env.E2E_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL;
if (!rawAdminUrl) throw new Error("E2E_ADMIN_URL or DATABASE_ADMIN_URL is required");
const adminUrl = localE2EAdminUrl(rawAdminUrl);
const database = e2eDatabaseName(process.env.E2E_DB_NAME);
const stateFile = resolve(process.cwd(), process.env.E2E_STATE_FILE?.trim() || "e2e/.state.json");

/* The owner may not terminate another role's backend without pg_signal_backend.
 * Close only the disposable database's own Web connections first, using the
 * same restricted role that owns those connections; this keeps cleanup safe
 * on a production-like role configuration and makes interrupted E2E runs
 * recoverable without granting cluster-wide termination privileges. */
const appUrl = new URL(adminUrl);
appUrl.username = "univ_app_web";
appUrl.password =
  process.env.APP_DB_PASSWORD ?? readEnvValue("APP_DB_PASSWORD") ?? "univ_app_web_dev_password";
appUrl.pathname = `/${database}`;
const app = new pg.Client({ connectionString: appUrl.toString() });
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

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  await client.query(`drop database if exists ${quotePgIdentifier(database)} with (force)`);
  rmSync(stateFile, { force: true });
  console.log(`e2e database removed: ${database}`);
} finally {
  await client.end();
}

function readEnvValue(key) {
  const path = resolve(process.cwd(), ".env.database.local");
  if (!existsSync(path)) return "";
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((value) => value.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}
