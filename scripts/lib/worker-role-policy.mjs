/**
 * Canonical database privilege policy for the shared tenant job worker.
 *
 * The worker must claim jobs across tenants, so PostgreSQL RLS cannot be its
 * cross-tenant queue boundary. Instead it gets BYPASSRLS with an intentionally
 * tiny table allow-list: queue lifecycle, attempt ledger, and append-only
 * platform audit. All tenant/domain data continues through DATABASE_URL and
 * therefore through the ordinary forced-RLS Web role.
 */
export const WORKER_ROLE = "univ_job_worker";
export const WORKER_EXECUTE_FUNCTIONS = Object.freeze([
  "app.upsert_tenant_worker_health(text,text,text,timestamptz)",
]);

export const WORKER_TABLE_PRIVILEGES = Object.freeze({
  jobs: Object.freeze(["SELECT", "UPDATE"]),
  job_attempts: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
  platform_audit_log: Object.freeze(["INSERT"]),
});

export function workerRolePrivilegeSql(database) {
  const db = quoteIdentifier(database);
  const role = quoteIdentifier(WORKER_ROLE);
  const grants = Object.entries(WORKER_TABLE_PRIVILEGES)
    .map(
      ([table, privileges]) =>
        `GRANT ${privileges.join(", ")} ON TABLE ${quoteIdentifier(table)} TO ${role};`,
    )
    .join("\n    ");

  return `
    REVOKE CONNECT, TEMP ON DATABASE ${db} FROM PUBLIC;
    REVOKE TEMP ON DATABASE ${db} FROM ${role};
    GRANT CONNECT ON DATABASE ${db} TO ${role};

    REVOKE CREATE ON SCHEMA public, app, drizzle FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public, app, drizzle FROM ${role};
    GRANT USAGE ON SCHEMA public TO ${role};

    -- Rebuild rather than layer over stale grants from an older release.
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role};
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role};
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle FROM ${role};
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA drizzle FROM ${role};
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app FROM ${role};

    ${grants}
    GRANT USAGE ON SCHEMA app TO ${role};
    GRANT EXECUTE ON FUNCTION ${WORKER_EXECUTE_FUNCTIONS.join(", ")} TO ${role};
  `;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
