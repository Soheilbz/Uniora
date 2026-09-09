/**
 * Deployment preflight. Run with the production environment loaded:
 *
 *   node --env-file=.env.production scripts/production-check.mjs --strict
 *
 * It checks only configuration shape and never prints secret values. Database
 * identity and permissions are checked by the deployment's migration/setup job,
 * not by the public web container.
 */

const strict = process.argv.includes("--strict");
const failures = [];
const warnings = [];

const required = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "EXPORT_JOB_DIR",
  "PLATFORM_OPERATION_ENCRYPTION_KEY",
  "INTEGRATION_ENCRYPTION_KEY",
  "PUBLIC_FORM_RATE_SALT",
  "TRUSTED_PROXY_HOPS",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_PUBLIC_ENDPOINT",
  "OBJECT_STORAGE_BROWSER_ORIGIN",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
];
for (const key of required) {
  if (!process.env[key]?.trim()) failures.push(`${key} is required`);
}

const secret = process.env.BETTER_AUTH_SECRET ?? "";
const mfaSecrets = configuredMfaSecrets();
if (mfaSecrets.length === 0) failures.push("MFA_ENCRYPTION_KEYS or MFA_ENCRYPTION_KEY is required");
if (secret && secret.length < 32)
  failures.push("BETTER_AUTH_SECRET must be at least 32 characters");
if (secret && looksPlaceholder(secret))
  failures.push("BETTER_AUTH_SECRET must not use an example/placeholder value");
if (secret && mfaSecrets.some((value) => value === secret))
  failures.push("MFA encryption keys must be distinct from BETTER_AUTH_SECRET");
const platformOperationKey = process.env.PLATFORM_OPERATION_ENCRYPTION_KEY?.trim() ?? "";
if (platformOperationKey && platformOperationKey.length < 32)
  failures.push("PLATFORM_OPERATION_ENCRYPTION_KEY must be at least 32 characters");
if (platformOperationKey && looksPlaceholder(platformOperationKey))
  failures.push("PLATFORM_OPERATION_ENCRYPTION_KEY must not use an example/placeholder value");
if (
  platformOperationKey &&
  (platformOperationKey === secret || mfaSecrets.includes(platformOperationKey))
) {
  failures.push(
    "PLATFORM_OPERATION_ENCRYPTION_KEY must be distinct from authentication and MFA secrets",
  );
}
if (/dev-only|admin-dev-password|e2e-only/i.test(secret)) {
  failures.push("BETTER_AUTH_SECRET contains a development/test marker");
}
const integrationKey = process.env.INTEGRATION_ENCRYPTION_KEY?.trim() ?? "";
if (integrationKey && integrationKey.length < 32)
  failures.push("INTEGRATION_ENCRYPTION_KEY must be at least 32 characters");
if (integrationKey && looksPlaceholder(integrationKey))
  failures.push("INTEGRATION_ENCRYPTION_KEY must not use an example/placeholder value");
if (
  integrationKey &&
  (integrationKey === secret ||
    integrationKey === platformOperationKey ||
    mfaSecrets.includes(integrationKey))
) {
  failures.push(
    "INTEGRATION_ENCRYPTION_KEY must be distinct from authentication, MFA and platform-operation secrets",
  );
}
const publicFormRateSalt = process.env.PUBLIC_FORM_RATE_SALT?.trim() ?? "";
if (publicFormRateSalt && publicFormRateSalt.length < 32)
  failures.push("PUBLIC_FORM_RATE_SALT must be at least 32 characters");
if (publicFormRateSalt && looksPlaceholder(publicFormRateSalt))
  failures.push("PUBLIC_FORM_RATE_SALT must not use an example/placeholder value");
if (
  publicFormRateSalt &&
  (publicFormRateSalt === secret ||
    publicFormRateSalt === platformOperationKey ||
    publicFormRateSalt === integrationKey ||
    mfaSecrets.includes(publicFormRateSalt))
) {
  failures.push(
    "PUBLIC_FORM_RATE_SALT must be distinct from authentication, MFA, platform-operation and integration secrets",
  );
}

const database = parseUrl("DATABASE_URL", process.env.DATABASE_URL);
if (database && !["postgres:", "postgresql:"].includes(database.protocol)) {
  failures.push("DATABASE_URL must be a PostgreSQL URL");
}
if (database && (!database.username || !database.password)) {
  failures.push("DATABASE_URL must include an explicit database credential");
}
if (database && database.username !== "univ_app_web") {
  failures.push("DATABASE_URL must use the canonical univ_app_web role");
}
if (database && looksPlaceholder(database.password)) {
  failures.push("DATABASE_URL must not use an example/placeholder password");
}
if (strict && database && database.searchParams.get("sslmode") !== "verify-full") {
  failures.push("DATABASE_URL must use sslmode=verify-full in strict mode");
}

for (const forbidden of [
  "DATABASE_ADMIN_URL",
  "DATABASE_WORKER_URL",
  "DATABASE_PLATFORM_URL",
  "APP_DB_PASSWORD",
  "WORKER_DB_PASSWORD",
  "PLATFORM_DB_PASSWORD",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_ENCRYPTION_KEYS",
  "BACKUP_ACTIVE_KEY_ID",
  "AUDIT_SEAL_KEY",
  "MFA_ROTATION_CONFIRM",
  "BACKUP_DIR",
  "BACKUP_OFFSITE_DIR",
  "PLATFORM_OPERATOR",
  "PLATFORM_RESTORE_ALLOWED",
  "PLATFORM_CROSS_TARGET_RESTORE",
  "SEED_ADMIN_PASSWORD",
  "TENANT_ADMIN_PASSWORD",
  "E2E_ADMIN_URL",
]) {
  if (process.env[forbidden]?.trim())
    failures.push(`${forbidden} must not be present in the Web runtime`);
}

validateInteger("DATABASE_POOL_MAX", process.env.DATABASE_POOL_MAX, 1, 100);
validateInteger(
  "DATABASE_CONNECTION_TIMEOUT_MS",
  process.env.DATABASE_CONNECTION_TIMEOUT_MS,
  1_000,
  60_000,
);
validateInteger("PLATFORM_SESSION_HOURS", process.env.PLATFORM_SESSION_HOURS, 1, 8);
validateInteger("TRUSTED_PROXY_HOPS", process.env.TRUSTED_PROXY_HOPS, 1, 5);
validateInteger("OBJECT_STORAGE_TIMEOUT_MS", process.env.OBJECT_STORAGE_TIMEOUT_MS, 1_000, 120_000);
validateInteger(
  "OBJECT_STORAGE_MAX_READ_BYTES",
  process.env.OBJECT_STORAGE_MAX_READ_BYTES,
  1_048_576,
  536_870_912,
);

const authUrl = parseUrl("BETTER_AUTH_URL", process.env.BETTER_AUTH_URL);
if (authUrl && !["http:", "https:"].includes(authUrl.protocol)) {
  failures.push("BETTER_AUTH_URL must use http or https");
}
if (
  authUrl &&
  (authUrl.pathname !== "/" ||
    authUrl.search ||
    authUrl.hash ||
    authUrl.username ||
    authUrl.password)
) {
  failures.push(
    "BETTER_AUTH_URL must be an explicit origin without credentials, path, query, or hash",
  );
}
if (strict && authUrl && authUrl.protocol !== "https:") {
  failures.push("BETTER_AUTH_URL must use HTTPS for a public deployment");
}
if (strict && authUrl && isLoopbackHostname(authUrl.hostname)) {
  failures.push("BETTER_AUTH_URL must use the public HTTPS hostname, not loopback");
}

const origins = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (origins.length === 0) failures.push("TRUSTED_ORIGINS must contain an explicit origin");
for (const origin of origins) {
  const parsed = parseUrl("TRUSTED_ORIGINS", origin);
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    failures.push(`TRUSTED_ORIGINS contains an invalid origin: ${origin}`);
  }
  if (strict && parsed && parsed.protocol !== "https:") {
    failures.push(`TRUSTED_ORIGINS must use HTTPS in strict mode: ${origin}`);
  }
  if (strict && parsed && isLoopbackHostname(parsed.hostname)) {
    failures.push(`TRUSTED_ORIGINS must not use a loopback hostname: ${origin}`);
  }
  if (origin === "*") failures.push("TRUSTED_ORIGINS must not use a wildcard");
}
if (
  authUrl &&
  origins.length > 0 &&
  !origins.some((origin) => {
    try {
      return new URL(origin).origin === authUrl.origin;
    } catch {
      return false;
    }
  })
) {
  failures.push("TRUSTED_ORIGINS must include BETTER_AUTH_URL origin");
}

const storageEndpoint = validateHttpsOrigin(
  "OBJECT_STORAGE_ENDPOINT",
  process.env.OBJECT_STORAGE_ENDPOINT,
);
const storagePublicEndpoint = validateHttpsOrigin(
  "OBJECT_STORAGE_PUBLIC_ENDPOINT",
  process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT,
);
const storageBrowserOrigin = validateHttpsOrigin(
  "OBJECT_STORAGE_BROWSER_ORIGIN",
  process.env.OBJECT_STORAGE_BROWSER_ORIGIN,
);
const storageBucket = process.env.OBJECT_STORAGE_BUCKET?.trim() ?? "";
if (storageBucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(storageBucket)) {
  failures.push("OBJECT_STORAGE_BUCKET must be a DNS-compatible 3-63 character bucket name");
}
if (storagePublicEndpoint && storageBrowserOrigin && storageBucket) {
  const pathStyle = parseBoolean(
    "OBJECT_STORAGE_PATH_STYLE",
    process.env.OBJECT_STORAGE_PATH_STYLE,
    true,
  );
  const expectedOrigin = pathStyle
    ? storagePublicEndpoint.origin
    : `${storagePublicEndpoint.protocol}//${storageBucket}.${storagePublicEndpoint.host}`;
  if (storageBrowserOrigin.origin !== expectedOrigin) {
    failures.push(
      "OBJECT_STORAGE_BROWSER_ORIGIN must equal the browser-visible presigned object-storage origin",
    );
  }
}
if (
  storageEndpoint &&
  storagePublicEndpoint &&
  storageEndpoint.origin === storagePublicEndpoint.origin
) {
  warnings.push(
    "OBJECT_STORAGE_ENDPOINT and OBJECT_STORAGE_PUBLIC_ENDPOINT are identical; prefer a private internal endpoint when available",
  );
}
const storageSecret = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim() ?? "";
if (storageSecret && looksPlaceholder(storageSecret)) {
  failures.push("OBJECT_STORAGE_SECRET_ACCESS_KEY must not use an example/placeholder value");
}

if (process.env.NEXT_TELEMETRY_DISABLED !== "1") {
  warnings.push("NEXT_TELEMETRY_DISABLED is not set to 1");
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log(`production configuration ok${strict ? " (strict)" : ""}`);

function configuredMfaSecrets() {
  const values = [];
  const legacy = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (legacy) {
    if (legacy.length < 32) failures.push("MFA_ENCRYPTION_KEY must be at least 32 characters");
    if (looksPlaceholder(legacy))
      failures.push("MFA_ENCRYPTION_KEY must not use an example/placeholder value");
    values.push(legacy);
  }
  const raw = process.env.MFA_ENCRYPTION_KEYS?.trim();
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failures.push("MFA_ENCRYPTION_KEYS must be a JSON object");
      return values;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      failures.push("MFA_ENCRYPTION_KEYS must be a JSON object");
      return values;
    }
    for (const [id, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(id) || typeof value !== "string" || value.length < 32) {
        failures.push("MFA_ENCRYPTION_KEYS contains an invalid key id or short secret");
      } else {
        if (looksPlaceholder(value))
          failures.push(`MFA_ENCRYPTION_KEYS key ${id} must not use an example/placeholder value`);
        values.push(value);
      }
    }
    const active = process.env.MFA_ACTIVE_KEY_ID?.trim();
    if (!active || !Object.hasOwn(parsed, active)) {
      failures.push("MFA_ACTIVE_KEY_ID must name a key present in MFA_ENCRYPTION_KEYS");
    }
  }
  return values;
}

function parseUrl(name, value) {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    failures.push(`${name} must be a valid URL`);
    return null;
  }
}

function validateHttpsOrigin(name, value) {
  const parsed = parseUrl(name, value);
  if (!parsed) return null;
  if (parsed.protocol !== "https:") {
    failures.push(`${name} must use HTTPS`);
  }
  if (
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    failures.push(
      `${name} must be an explicit HTTPS origin without credentials, path, query, or hash`,
    );
  }
  if (strict && isLoopbackHostname(parsed.hostname)) {
    failures.push(`${name} must not use a loopback hostname in strict mode`);
  }
  return parsed;
}

function parseBoolean(name, value, fallback) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  failures.push(`${name} must be exactly true or false`);
  return fallback;
}

function validateInteger(name, value, minimum, maximum) {
  if (value === undefined || value.trim() === "") return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function looksPlaceholder(value) {
  return /(?:replace(?:-?me|-?with)?|change(?:-?me)?|changeme|example|placeholder|your[_-]?)/i.test(
    String(value),
  );
}
