import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function boundedInt(name, raw, fallback, min, max) {
  if (raw === undefined || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function requireFile(values) {
  const file = option(values, "--file");
  if (!file) fail("--file <manifest.json> is required");
  return file;
}

export function option(values, keyName) {
  const index = values.indexOf(keyName);
  return index >= 0 ? values[index + 1]?.trim() : undefined;
}

export function message(value) {
  return value instanceof Error ? value.message : String(value);
}

export function postgresBinary(name) {
  const configured = process.env.PG_BIN_DIR?.trim();
  const binDir = configured
    ? resolve(configured)
    : resolve(process.cwd(), ".univ", "toolchain", "postgres", "bin");
  const local = join(binDir, name);
  return existsSync(local) ? local : name;
}

export function fail(messageText) {
  console.error(messageText);
  process.exit(1);
}

export function postgresEnvironment(connectionString, environmentKey = "DATABASE_ADMIN_URL") {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail(`${environmentKey} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol))
    fail(`${environmentKey} must be a PostgreSQL URL`);
  if (!parsed.hostname || !parsed.username)
    fail(`${environmentKey} must include host and username`);
  let database;
  let username;
  let password;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    username = decodeURIComponent(parsed.username);
    password = parsed.password ? decodeURIComponent(parsed.password) : "";
  } catch {
    fail(`${environmentKey} contains invalid percent-encoding`);
  }
  if (!database) fail(`${environmentKey} must include a database name`);

  const env = {};
  for (const name of [
    "PATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "GITHUB_WORKSPACE",
    "PG_DOCKER_IMAGE",
  ]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.PGHOST = parsed.hostname.replace(/^\[|\]$/g, "");
  env.PGPORT = parsed.port || "5432";
  env.PGUSER = username;
  env.PGDATABASE = database;
  env.PGCLIENTENCODING = "UTF8";
  if (password) env.PGPASSWORD = password;

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
  for (const [parameter, environmentName] of Object.entries(libpqParameters)) {
    const value = parsed.searchParams.get(parameter);
    if (value) env[environmentName] = value;
  }
  env.PGAPPNAME ||= "univ-platform-backup";
  const identityHost = env.PGHOST.includes(":") ? `[${env.PGHOST}]` : env.PGHOST.toLowerCase();
  const identity = `postgresql://${identityHost}:${env.PGPORT}/${encodeURIComponent(database)}`;
  return { database, identity, env };
}
