/**
 * Runtime configuration checks for a real server process.
 *
 * Build-time code must remain usable without production secrets, so this is
 * called from instrumentation when the Node server starts, not while Next is
 * compiling the application. It fails closed before the first request instead
 * of allowing a deployment to discover a missing secret through broken auth.
 */
export function assertRuntimeConfig(): void {
  if (process.env.NODE_ENV !== "production") return;

  const allowLocalE2E = process.env.UNIV_E2E === "1" && process.env.E2E_EXTERNAL_SERVER === "1";
  const required = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "EXPORT_JOB_DIR",
    "PLATFORM_OPERATION_ENCRYPTION_KEY",
    "INTEGRATION_ENCRYPTION_KEY",
    "PUBLIC_FORM_RATE_SALT",
    ...(allowLocalE2E
      ? []
      : [
          "OBJECT_STORAGE_ENDPOINT",
          "OBJECT_STORAGE_PUBLIC_ENDPOINT",
          "OBJECT_STORAGE_BROWSER_ORIGIN",
          "OBJECT_STORAGE_BUCKET",
          "OBJECT_STORAGE_ACCESS_KEY_ID",
          "OBJECT_STORAGE_SECRET_ACCESS_KEY",
          "TRUSTED_PROXY_HOPS",
        ]),
  ];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing production environment variable(s): ${missing.join(", ")}`);
  }

  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters in production.");
  }
  if (/dev-only|admin-dev-password|e2e-only/i.test(secret)) {
    throw new Error("BETTER_AUTH_SECRET contains a development or test marker.");
  }

  const mfaSecrets = configuredMfaSecrets();
  if (mfaSecrets.length === 0) {
    throw new Error("MFA_ENCRYPTION_KEYS or MFA_ENCRYPTION_KEY is required in production.");
  }
  if (mfaSecrets.some((value) => value === secret)) {
    throw new Error("MFA encryption keys must be distinct from BETTER_AUTH_SECRET.");
  }

  const platformOperationKey = process.env.PLATFORM_OPERATION_ENCRYPTION_KEY?.trim() ?? "";
  if (platformOperationKey.length < 32) {
    throw new Error(
      "PLATFORM_OPERATION_ENCRYPTION_KEY must contain at least 32 characters in production.",
    );
  }
  if (platformOperationKey === secret || mfaSecrets.includes(platformOperationKey)) {
    throw new Error(
      "PLATFORM_OPERATION_ENCRYPTION_KEY must be distinct from authentication and MFA secrets.",
    );
  }

  const integrationKey = process.env.INTEGRATION_ENCRYPTION_KEY?.trim() ?? "";
  if (integrationKey.length < 32) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must contain at least 32 characters in production.",
    );
  }
  if (
    integrationKey === secret ||
    integrationKey === platformOperationKey ||
    mfaSecrets.includes(integrationKey)
  ) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be distinct from authentication, MFA and platform-operation secrets.",
    );
  }

  const publicFormRateSalt = process.env.PUBLIC_FORM_RATE_SALT?.trim() ?? "";
  if (publicFormRateSalt.length < 32) {
    throw new Error("PUBLIC_FORM_RATE_SALT must contain at least 32 characters in production.");
  }
  if (
    publicFormRateSalt === secret ||
    publicFormRateSalt === platformOperationKey ||
    publicFormRateSalt === integrationKey ||
    mfaSecrets.includes(publicFormRateSalt)
  ) {
    throw new Error(
      "PUBLIC_FORM_RATE_SALT must be distinct from authentication and encryption secrets.",
    );
  }

  const database = parseUrl("DATABASE_URL", process.env.DATABASE_URL ?? "");
  if (database.protocol !== "postgres:" && database.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  }
  assertSecureDatabaseUrl("DATABASE_URL", database);
  if (!allowLocalE2E && database.username !== "univ_app_web") {
    throw new Error("DATABASE_URL must use the canonical univ_app_web role in production.");
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
    if (process.env[forbidden]?.trim()) {
      throw new Error(`${forbidden} must not be present in the production web process.`);
    }
  }

  assertInteger("DATABASE_POOL_MAX", process.env.DATABASE_POOL_MAX, 1, 100);
  assertInteger(
    "DATABASE_CONNECTION_TIMEOUT_MS",
    process.env.DATABASE_CONNECTION_TIMEOUT_MS,
    1_000,
    60_000,
  );
  assertInteger("PLATFORM_SESSION_HOURS", process.env.PLATFORM_SESSION_HOURS, 1, 8);

  const authUrl = parseUrl("BETTER_AUTH_URL", process.env.BETTER_AUTH_URL ?? "");
  /* The browser suite deliberately runs a production bundle over loopback
     HTTP; its server marks that exception explicitly instead of weakening the
     public production default. */
  const allowHttpForLocalE2E = allowLocalE2E;
  if (!isOrigin(authUrl.toString(), !allowHttpForLocalE2E)) {
    throw new Error("BETTER_AUTH_URL must be an explicit origin without a path, query, or hash.");
  }
  if (!allowHttpForLocalE2E && authUrl.protocol !== "https:") {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
  }
  if (!allowHttpForLocalE2E && isLoopbackHostname(authUrl.hostname)) {
    throw new Error("BETTER_AUTH_URL must use the public HTTPS hostname, not loopback.");
  }

  const origins = (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error("TRUSTED_ORIGINS must contain at least one origin in production.");
  }
  if (origins.some((origin) => origin === "*" || !isOrigin(origin, !allowHttpForLocalE2E))) {
    throw new Error("TRUSTED_ORIGINS must contain explicit HTTPS origins, not a wildcard.");
  }
  if (
    !allowHttpForLocalE2E &&
    origins.some((origin) => isLoopbackHostname(new URL(origin).hostname))
  ) {
    throw new Error("TRUSTED_ORIGINS must not use a loopback hostname in production.");
  }
  if (!origins.some((origin) => new URL(origin).origin === authUrl.origin)) {
    throw new Error("TRUSTED_ORIGINS must include the BETTER_AUTH_URL origin.");
  }

  if (!allowLocalE2E) {
    const trustedProxyHops = Number(process.env.TRUSTED_PROXY_HOPS);
    if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 1 || trustedProxyHops > 5) {
      throw new Error("TRUSTED_PROXY_HOPS must be an integer between 1 and 5 in production.");
    }

    const internalStorage = parseUrl(
      "OBJECT_STORAGE_ENDPOINT",
      process.env.OBJECT_STORAGE_ENDPOINT ?? "",
    );
    const publicStorage = parseUrl(
      "OBJECT_STORAGE_PUBLIC_ENDPOINT",
      process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT ?? "",
    );
    const browserStorage = parseUrl(
      "OBJECT_STORAGE_BROWSER_ORIGIN",
      process.env.OBJECT_STORAGE_BROWSER_ORIGIN ?? "",
    );
    for (const [name, url] of [
      ["OBJECT_STORAGE_ENDPOINT", internalStorage],
      ["OBJECT_STORAGE_PUBLIC_ENDPOINT", publicStorage],
      ["OBJECT_STORAGE_BROWSER_ORIGIN", browserStorage],
    ] as const) {
      if (!isOrigin(url.toString(), true))
        throw new Error(`${name} must be an explicit HTTPS origin.`);
    }
    const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim() ?? "";
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error("OBJECT_STORAGE_BUCKET must be a valid DNS-compatible bucket name.");
    }
    const pathStyle = parseBoolean(
      "OBJECT_STORAGE_PATH_STYLE",
      process.env.OBJECT_STORAGE_PATH_STYLE,
      true,
    );
    const expectedBrowser = new URL(publicStorage.origin);
    if (!pathStyle) expectedBrowser.hostname = `${bucket}.${expectedBrowser.hostname}`;
    if (browserStorage.origin !== expectedBrowser.origin) {
      throw new Error(
        "OBJECT_STORAGE_BROWSER_ORIGIN must match the actual presigned object-storage origin.",
      );
    }
    assertInteger(
      "OBJECT_STORAGE_TIMEOUT_MS",
      process.env.OBJECT_STORAGE_TIMEOUT_MS,
      1_000,
      120_000,
    );
    assertInteger(
      "OBJECT_STORAGE_MAX_READ_BYTES",
      process.env.OBJECT_STORAGE_MAX_READ_BYTES,
      1024 * 1024,
      512 * 1024 * 1024,
    );
  }
}

function configuredMfaSecrets(): string[] {
  const values: string[] = [];
  const legacy = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (legacy) {
    if (legacy.length < 32)
      throw new Error("MFA_ENCRYPTION_KEY must contain at least 32 characters in production.");
    values.push(legacy);
  }
  const raw = process.env.MFA_ENCRYPTION_KEYS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("MFA_ENCRYPTION_KEYS must be a JSON object.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MFA_ENCRYPTION_KEYS must be a JSON object.");
    }
    const entries = Object.entries(parsed);
    if (entries.length === 0) throw new Error("MFA_ENCRYPTION_KEYS must not be empty.");
    for (const [id, value] of entries) {
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(id) || typeof value !== "string" || value.length < 32) {
        throw new Error("MFA_ENCRYPTION_KEYS contains an invalid key id or short secret.");
      }
      values.push(value);
    }
    const active = process.env.MFA_ACTIVE_KEY_ID?.trim();
    if (!active || !(active in (parsed as Record<string, unknown>))) {
      throw new Error("MFA_ACTIVE_KEY_ID must name a key present in MFA_ENCRYPTION_KEYS.");
    }
  }
  return values;
}

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function isOrigin(value: string, httpsOnly: boolean): boolean {
  try {
    const url = new URL(value);
    return (
      (!httpsOnly || url.protocol === "https:") &&
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be exactly true or false.`);
}

function assertInteger(name: string, value: string | undefined, minimum: number, maximum: number) {
  if (value === undefined || value.trim() === "") return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function assertSecureDatabaseUrl(name: string, url: URL): void {
  if (!url.username || !url.password) {
    throw new Error(`${name} must include an explicit database credential in production.`);
  }
  /* E2E is an explicitly marked, loopback-only production-bundle test. Its
     bundled PostgreSQL is intentionally plain TCP; public deployments still
     take the strict TLS path below. */
  if (process.env.UNIV_E2E === "1" && process.env.E2E_EXTERNAL_SERVER === "1") return;
  if (url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error(`${name} must use sslmode=verify-full in production.`);
  }
}
