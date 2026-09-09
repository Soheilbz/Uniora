import { isAbsolute } from "node:path";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PLACEHOLDER = /replace|example|changeme|placeholder|0123456789abcdef/i;

type Env = NodeJS.ProcessEnv;
type Failures = string[];

export function tenantWorkerEnvironmentFailures(env: Env = process.env): string[] {
  const failures: Failures = [];
  const required = [
    "DATABASE_WORKER_URL",
    "DATABASE_URL",
    "EXPORT_JOB_DIR",
    "PLATFORM_OPERATOR",
    "INTEGRATION_ENCRYPTION_KEY",
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_PUBLIC_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY_ID",
    "OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "ANTIVIRUS_HTTP_ENDPOINT",
  ];
  requireValues(required, env, failures);

  const worker = databaseUrl(
    "DATABASE_WORKER_URL",
    env.DATABASE_WORKER_URL,
    "univ_job_worker",
    env,
    failures,
  );
  const web = databaseUrl("DATABASE_URL", env.DATABASE_URL, "univ_app_web", env, failures);
  if (worker && web && worker.username === web.username) {
    failures.push("worker and Web database roles must differ");
  }
  if (worker && (worker.username === "univ" || /owner|admin/i.test(worker.username))) {
    failures.push("DATABASE_WORKER_URL must not use an owner/admin role");
  }

  validateSecret("INTEGRATION_ENCRYPTION_KEY", env.INTEGRATION_ENCRYPTION_KEY, 32, failures);
  rejectPresent(
    [
      "DATABASE_ADMIN_URL",
      "DATABASE_PLATFORM_URL",
      "APP_DB_PASSWORD",
      "WORKER_DB_PASSWORD",
      "PLATFORM_DB_PASSWORD",
      "BETTER_AUTH_SECRET",
      "MFA_ENCRYPTION_KEY",
      "MFA_ENCRYPTION_KEYS",
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
    ],
    env,
    failures,
    "tenant worker runtime",
  );

  validateStorageOrigin("OBJECT_STORAGE_ENDPOINT", env.OBJECT_STORAGE_ENDPOINT, env, failures);
  validateStorageOrigin(
    "OBJECT_STORAGE_PUBLIC_ENDPOINT",
    env.OBJECT_STORAGE_PUBLIC_ENDPOINT,
    env,
    failures,
  );
  const bucket = env.OBJECT_STORAGE_BUCKET?.trim() ?? "";
  if (bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    failures.push("OBJECT_STORAGE_BUCKET must be a DNS-compatible 3-63 character bucket name");
  }
  validateBoolean("OBJECT_STORAGE_PATH_STYLE", env.OBJECT_STORAGE_PATH_STYLE, failures);
  validateInteger(
    "OBJECT_STORAGE_TIMEOUT_MS",
    env.OBJECT_STORAGE_TIMEOUT_MS,
    1_000,
    120_000,
    failures,
  );
  validateInteger(
    "OBJECT_STORAGE_MAX_READ_BYTES",
    env.OBJECT_STORAGE_MAX_READ_BYTES,
    1_048_576,
    536_870_912,
    failures,
  );
  if (
    env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() &&
    PLACEHOLDER.test(env.OBJECT_STORAGE_SECRET_ACCESS_KEY)
  ) {
    failures.push("OBJECT_STORAGE_SECRET_ACCESS_KEY must not be a placeholder");
  }

  validateScannerEndpoint(env.ANTIVIRUS_HTTP_ENDPOINT, env, failures);
  validateInteger(
    "ANTIVIRUS_HTTP_TIMEOUT_MS",
    env.ANTIVIRUS_HTTP_TIMEOUT_MS,
    1_000,
    120_000,
    failures,
  );

  const leaseSeconds = boundedInteger(
    "JOB_LEASE_SECONDS",
    env.JOB_LEASE_SECONDS,
    180,
    60,
    900,
    failures,
  );
  const heartbeatMs = boundedInteger(
    "JOB_HEARTBEAT_MS",
    env.JOB_HEARTBEAT_MS,
    30_000,
    5_000,
    120_000,
    failures,
  );
  boundedInteger("JOB_POLL_MS", env.JOB_POLL_MS, 2_000, 250, 60_000, failures);
  if (heartbeatMs > (leaseSeconds * 1000) / 2) {
    failures.push("JOB_HEARTBEAT_MS must not exceed half of JOB_LEASE_SECONDS");
  }

  return failures;
}

export function platformWorkerEnvironmentFailures(env: Env = process.env): string[] {
  const failures: Failures = [];
  const required = [
    "DATABASE_PLATFORM_URL",
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "PLATFORM_OPERATOR",
    "PLATFORM_OPERATION_ENCRYPTION_KEY",
    "BACKUP_ACTIVE_KEY_ID",
    "BACKUP_ENCRYPTION_KEYS",
    "BACKUP_DIR",
  ];
  requireValues(required, env, failures);

  const platform = databaseUrl(
    "DATABASE_PLATFORM_URL",
    env.DATABASE_PLATFORM_URL,
    "univ_platform_worker",
    env,
    failures,
  );
  const web = databaseUrl("DATABASE_URL", env.DATABASE_URL, "univ_app_web", env, failures);
  if (platform && web && platform.username === web.username) {
    failures.push("Platform and Web database roles must differ");
  }
  if (platform && (platform.username === "univ" || /owner|admin/i.test(platform.username))) {
    failures.push("DATABASE_PLATFORM_URL must not use an owner/admin role");
  }

  const authUrl = absoluteUrl("BETTER_AUTH_URL", env.BETTER_AUTH_URL, failures);
  if (authUrl) {
    if (env.NODE_ENV === "production" && authUrl.protocol !== "https:") {
      failures.push("BETTER_AUTH_URL must use HTTPS in production");
    }
    if (
      authUrl.pathname !== "/" ||
      authUrl.search ||
      authUrl.hash ||
      authUrl.username ||
      authUrl.password
    ) {
      failures.push("BETTER_AUTH_URL must be a credential-free origin without path/query/hash");
    }
  }

  validateSecret("BETTER_AUTH_SECRET", env.BETTER_AUTH_SECRET, 32, failures);
  validateSecret(
    "PLATFORM_OPERATION_ENCRYPTION_KEY",
    env.PLATFORM_OPERATION_ENCRYPTION_KEY,
    32,
    failures,
  );
  if (
    env.BETTER_AUTH_SECRET?.trim() &&
    env.BETTER_AUTH_SECRET?.trim() === env.PLATFORM_OPERATION_ENCRYPTION_KEY?.trim()
  ) {
    failures.push("PLATFORM_OPERATION_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET");
  }

  validateInteger("PLATFORM_SESSION_HOURS", env.PLATFORM_SESSION_HOURS, 1, 8, failures);
  validateBackupKeyring(env, failures);
  validateAbsoluteDirectory("BACKUP_DIR", env.BACKUP_DIR, failures);
  if (env.BACKUP_OFFSITE_DIR?.trim()) {
    validateAbsoluteDirectory("BACKUP_OFFSITE_DIR", env.BACKUP_OFFSITE_DIR, failures);
  }

  rejectPresent(
    [
      "DATABASE_ADMIN_URL",
      "APP_DB_PASSWORD",
      "WORKER_DB_PASSWORD",
      "PLATFORM_DB_PASSWORD",
      "DATABASE_WORKER_URL",
      "MFA_ENCRYPTION_KEY",
      "MFA_ENCRYPTION_KEYS",
      "MFA_ACTIVE_KEY_ID",
      "MFA_ROTATION_CONFIRM",
      "AUDIT_SEAL_KEY",
      "AUDIT_SEAL_DIR",
      "INTEGRATION_ENCRYPTION_KEY",
      "ANTIVIRUS_HTTP_TOKEN",
      "PLATFORM_RESTORE_ALLOWED",
      "PLATFORM_CROSS_TARGET_RESTORE",
      "SEED_ADMIN_PASSWORD",
    ],
    env,
    failures,
    "Platform worker runtime",
  );

  return failures;
}

export function assertTenantWorkerEnvironment(env: Env = process.env): void {
  assertNoFailures("tenant worker", tenantWorkerEnvironmentFailures(env));
}

export function assertPlatformWorkerEnvironment(env: Env = process.env): void {
  assertNoFailures("Platform worker", platformWorkerEnvironmentFailures(env));
}

function assertNoFailures(scope: string, failures: Failures): void {
  if (failures.length) {
    throw new Error(`${scope} configuration is invalid:\n- ${failures.join("\n- ")}`);
  }
}

function requireValues(names: readonly string[], env: Env, failures: Failures): void {
  for (const name of names) if (!env[name]?.trim()) failures.push(`${name} is required`);
}

function databaseUrl(
  name: string,
  raw: string | undefined,
  expectedUser: string,
  env: Env,
  failures: Failures,
): URL | null {
  const url = absoluteUrl(name, raw, failures);
  if (!url) return null;
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) failures.push(`${name} must be PostgreSQL`);
  if (!url.username || !url.password) failures.push(`${name} must contain an explicit credential`);
  if (url.username && url.username !== expectedUser) {
    failures.push(`${name} must use the canonical ${expectedUser} role`);
  }
  if (env.NODE_ENV === "production" && url.searchParams.get("sslmode") !== "verify-full") {
    failures.push(`${name} must use sslmode=verify-full in production`);
  }
  return url;
}

function absoluteUrl(name: string, raw: string | undefined, failures: Failures): URL | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw);
  } catch {
    failures.push(`${name} must be an absolute URL`);
    return null;
  }
}

function validateSecret(
  name: string,
  raw: string | undefined,
  minimum: number,
  failures: Failures,
): void {
  const value = raw?.trim() ?? "";
  if (!value) return;
  if (value.length < minimum) failures.push(`${name} must be at least ${minimum} characters`);
  if (PLACEHOLDER.test(value)) failures.push(`${name} must not be a placeholder`);
}

function rejectPresent(
  names: readonly string[],
  env: Env,
  failures: Failures,
  scope: string,
): void {
  for (const name of names) {
    if (env[name]?.trim()) failures.push(`${name} must not be present in ${scope}`);
  }
}

function validateStorageOrigin(
  name: string,
  raw: string | undefined,
  env: Env,
  failures: Failures,
): void {
  const url = absoluteUrl(name, raw, failures);
  if (!url) return;
  const local = LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, "").toLowerCase());
  if (
    url.protocol !== "https:" &&
    !(env.NODE_ENV !== "production" && local && url.protocol === "http:")
  ) {
    failures.push(`${name} must use HTTPS outside local development`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    failures.push(
      `${name} must be an origin without credentials, path, query parameters, or fragments`,
    );
  }
}

function validateScannerEndpoint(raw: string | undefined, env: Env, failures: Failures): void {
  const url = absoluteUrl("ANTIVIRUS_HTTP_ENDPOINT", raw, failures);
  if (!url) return;
  const local = LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, "").toLowerCase());
  if (
    url.protocol !== "https:" &&
    !(env.NODE_ENV !== "production" && local && url.protocol === "http:")
  ) {
    failures.push("ANTIVIRUS_HTTP_ENDPOINT must use HTTPS outside local development");
  }
  if (url.username || url.password || url.hash) {
    failures.push("ANTIVIRUS_HTTP_ENDPOINT must not contain credentials or fragments");
  }
}

function validateBoolean(name: string, raw: string | undefined, failures: Failures): void {
  if (raw == null || raw.trim() === "") return;
  if (!new Set(["true", "false"]).has(raw.trim().toLowerCase())) {
    failures.push(`${name} must be exactly true or false`);
  }
}

function validateInteger(
  name: string,
  raw: string | undefined,
  minimum: number,
  maximum: number,
  failures: Failures,
): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum}`);
    return null;
  }
  return value;
}

function boundedInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  failures: Failures,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  return validateInteger(name, raw, minimum, maximum, failures) ?? fallback;
}

function validateBackupKeyring(env: Env, failures: Failures): void {
  const raw = env.BACKUP_ENCRYPTION_KEYS?.trim();
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failures.push("BACKUP_ENCRYPTION_KEYS must be valid JSON");
    return;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  ) {
    failures.push("BACKUP_ENCRYPTION_KEYS must be a non-empty JSON object");
    return;
  }
  const keyring = parsed as Record<string, unknown>;
  for (const [id, value] of Object.entries(keyring)) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(id) || !/^[0-9a-fA-F]{64}$/.test(String(value))) {
      failures.push("BACKUP_ENCRYPTION_KEYS entries must use safe ids and 64-hex keys");
      break;
    }
  }
  const active = env.BACKUP_ACTIVE_KEY_ID?.trim();
  if (active && !Object.hasOwn(keyring, active)) {
    failures.push("BACKUP_ACTIVE_KEY_ID must name a key in BACKUP_ENCRYPTION_KEYS");
  }
}

function validateAbsoluteDirectory(
  name: string,
  raw: string | undefined,
  failures: Failures,
): void {
  const value = raw?.trim() ?? "";
  if (value && !isAbsolute(value)) failures.push(`${name} must be an absolute path`);
}
