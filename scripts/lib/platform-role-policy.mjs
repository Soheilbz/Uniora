/**
 * Canonical database policy for the long-running Platform worker.
 *
 * The worker must inspect every tenant and produce full logical backups, so it
 * legitimately needs cross-tenant SELECT plus BYPASSRLS. It does not need to
 * own the database, create/alter schema objects, create roles, or mutate every
 * domain table. Keep mutation authority on the explicit allow-list below.
 */
export const PLATFORM_ROLE = "univ_platform_worker";
export const PLATFORM_EXECUTE_FUNCTIONS = Object.freeze([
  "app.upsert_platform_worker_health(text,text,text,timestamptz)",
]);

export const PLATFORM_MUTABLE_TABLES = Object.freeze([
  "user",
  "session",
  "account",
  "verification",
  "rate_limit",
  "login_attempts",
  "tenants",
  "roles",
  "role_capabilities",
  "user_roles",
  "tenant_owners",
  "lookups",
  "institutions",
  "notifications",
  "platform_audit_log",
  "platform_operation_requests",
  "break_glass_sessions",
  "platform_operational_health",
]);

export function platformRolePrivilegeSql(database) {
  const db = quoteIdentifier(database);
  const role = quoteIdentifier(PLATFORM_ROLE);
  const mutable = PLATFORM_MUTABLE_TABLES.map(quoteIdentifier).join(", ");
  return `
    REVOKE CONNECT, TEMP ON DATABASE ${db} FROM PUBLIC;
    REVOKE TEMP ON DATABASE ${db} FROM ${role};
    GRANT CONNECT ON DATABASE ${db} TO ${role};

    REVOKE CREATE ON SCHEMA public, app, drizzle FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public, app, drizzle FROM ${role};
    GRANT USAGE ON SCHEMA public, app, drizzle TO ${role};

    -- Rebuild from zero so an old release cannot leave hidden authority behind.
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public, app, drizzle FROM ${role};
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public, app, drizzle FROM ${role};
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app FROM ${role};

    -- Full read is required for cross-tenant safety checks and pg_dump. The
    -- app/drizzle schemas are read-only to this role; executable app functions
    -- remain outside its surface.
    GRANT SELECT ON ALL TABLES IN SCHEMA public, app, drizzle TO ${role};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, app, drizzle TO ${role};

    -- Only reviewed platform/auth lifecycle state may be mutated.
    GRANT INSERT, UPDATE, DELETE ON TABLE ${mutable} TO ${role};
    GRANT EXECUTE ON FUNCTION ${PLATFORM_EXECUTE_FUNCTIONS.join(", ")} TO ${role};
  `;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
