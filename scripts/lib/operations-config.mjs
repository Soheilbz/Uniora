export function requireOperationsDatabaseUrl(env = process.env) {
  const raw = env.DATABASE_ADMIN_URL?.trim() ?? "";
  if (!raw) throw new Error("DATABASE_ADMIN_URL is required for operations commands");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_ADMIN_URL must be a valid PostgreSQL URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("DATABASE_ADMIN_URL must use the postgres or postgresql scheme");
  }
  if (!url.hostname || !url.username || !url.pathname || url.pathname === "/") {
    throw new Error("DATABASE_ADMIN_URL must include host, user and database name");
  }
  return raw;
}

export function positiveNumberEnv(name, fallback, env = process.env) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number greater than zero`);
  }
  return value;
}

export function positiveIntegerEnv(name, fallback, env = process.env) {
  const value = positiveNumberEnv(name, fallback, env);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a positive integer`);
  return value;
}
