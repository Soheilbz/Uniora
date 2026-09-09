const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function e2eDatabaseName(raw) {
  const value = String(raw ?? "univ_web_e2e").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value)) {
    throw new Error("E2E_DB_NAME must be a valid PostgreSQL identifier up to 63 characters");
  }
  if (!/(?:^|_)e2e(?:_|$)/i.test(value)) {
    throw new Error("E2E_DB_NAME must contain an explicit e2e marker");
  }
  return value;
}

export function localE2EAdminUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ""));
  } catch {
    throw new Error("E2E_ADMIN_URL/DATABASE_ADMIN_URL must be a valid PostgreSQL URL");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("E2E admin URL must use the postgres or postgresql scheme");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(
      "E2E provisioning is destructive and is restricted to a loopback PostgreSQL host",
    );
  }
  return url.toString();
}

export function quotePgIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
