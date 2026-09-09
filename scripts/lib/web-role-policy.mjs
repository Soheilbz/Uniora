/**
 * Canonical database privilege policy for the request-serving Web role.
 *
 * Both initial provisioning (`db:setup`) and disaster recovery apply this exact
 * SQL. Keeping the policy here prevents the two most security-sensitive paths
 * from drifting: a restore must not silently resurrect an older grant model.
 */
export const WEB_ROLE = "univ_app_web";

/** Ordinary application state: Web may read and mutate these rows under RLS. */
export const WEB_MUTABLE_TABLES = Object.freeze([
  "user",
  "session",
  "account",
  "verification",
  "rate_limit",
  "login_attempts",
  "roles",
  "role_capabilities",
  "user_roles",
  "tenant_owners",
  "lookups",
  "institutions",
  "calendar_entries",
  "calendar_subscription_tokens",
  "students",
  "professors",
  "council_meetings",
  "council_permanent_members",
  "council_decisions",
  "council_rulings",
  "council_appointments",
  "saved_views",
  "professor_capacities",
  "workshops",
  "workshop_participants",
  "workshop_instructors",
  "workshop_certificates",
  "academic_years",
  "academic_periods",
  "organization_units",
  "organization_unit_versions",
  "academic_programs",
  "student_supervision_assignments",
  "attachments",
  "document_versions",
  "document_sequences",
  "correspondence",
  "correspondence_recipients",
  "tasks",
  "notifications",
  "scheduled_jobs",
  "regulation_versions",
  "decision_template_versions",
  "quality_rules",
  "retention_policies",
  "service_accounts",
  "webhook_subscriptions",
  "integration_connections",
  "tenant_features",
  "custom_field_definitions",
  "custom_field_values",
  "user_record_pins",
  "recent_records",
  "research_projects",
  "import_mapping_profiles",
  "import_batches",
  "workshop_registrations",
  "portal_links",
  "passkey",
  "scim_connection_binding",
  "scim_identity_tombstone",
  "scim_subject",
  "scim_user",
  "scim_projection_grant",
  "scim_group",
  "scim_group_member",
  "api_rate_windows",
  "search_documents",
  "attention_summary",
  "external_identity_links",
  "scim_credentials",
  "webhook_deliveries",
  "reporting_snapshots",
  "integration_sync_runs",
  "integration_staging_records",
]);

/**
 * Immutable/event-style records. Web can enqueue or append and inspect them,
 * but lifecycle/state correction belongs to workers or a new compensating row.
 */
export const WEB_APPEND_ONLY_TABLES = Object.freeze([
  "audit_log",
  "jobs",
  "quality_snapshots",
  "pii_access_log",
  "task_transitions",
  "council_decision_transitions",
  "platform_operation_requests",
  "outbox_events",
]);

/** Worker-owned projections/attempt ledgers exposed to Web for diagnostics only. */
export const WEB_READ_ONLY_TABLES = Object.freeze([
  "job_attempts",
  "break_glass_sessions",
  "sso_provider",
  "platform_operators",
  "platform_operational_health",
  "worker_runtime_health",
]);

export const WEB_RLS_EXEMPT_TABLES = Object.freeze([
  "user",
  "session",
  "account",
  "verification",
  "rate_limit",
  "passkey",
  "scim_connection_binding",
  "scim_identity_tombstone",
  "scim_subject",
  "scim_user",
  "scim_projection_grant",
  "scim_group",
  "scim_group_member",
  "tenants",
  "platform_audit_log",
  "platform_operational_health",
  "worker_runtime_health",
  "platform_operators",
  "platform_operation_requests",
  "sso_provider",
]);

export const WEB_EXECUTE_FUNCTIONS = Object.freeze([
  "app.current_tenant()",
  "app.fold_text(text)",
  "app.fold_person(text)",
  "app.jalali_new_year(integer)",
  "app.jalali_year(date)",
  "app.jalali_month(date)",
  "app.public_surface_allows(text)",
  "app.refresh_search_documents(uuid)",
  "app.verify_certificate(text)",
  "app.public_workshop(text)",
  "app.register_public_workshop(text,text,text,text,text,text)",
  "app.resolve_service_account(text)",
  "app.resolve_calendar_subscription(text)",
  "app.resolve_external_identity(text,text,text)",
  "app.list_tenant_sso_providers(text)",
  "app.materialize_sso_provider(uuid,uuid,text,text,text,text,text,text)",
  "app.remove_sso_provider(uuid,uuid,text)",
  "app.resolve_scim_credential(text)",
  "app.resolve_scim_identity(text,text)",
]);

export function webRolePrivilegeSql(database) {
  const db = quoteIdentifier(database);
  const mutable = WEB_MUTABLE_TABLES.map(quoteIdentifier).join(", ");
  const appendOnly = WEB_APPEND_ONLY_TABLES.map(quoteIdentifier).join(", ");
  const readOnly = WEB_READ_ONLY_TABLES.map(quoteIdentifier).join(", ");
  const executable = WEB_EXECUTE_FUNCTIONS.join(", ");
  return `
    REVOKE CONNECT, TEMP ON DATABASE ${db} FROM PUBLIC;
    REVOKE TEMP ON DATABASE ${db} FROM ${WEB_ROLE};
    GRANT CONNECT ON DATABASE ${db} TO ${WEB_ROLE};

    REVOKE CREATE ON SCHEMA public, app, drizzle FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public, app, drizzle FROM ${WEB_ROLE};
    GRANT USAGE ON SCHEMA public, app TO ${WEB_ROLE};

    -- Rebuild the allow-list rather than layering grants over an older release.
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${WEB_ROLE};
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${WEB_ROLE};
    -- Function EXECUTE defaults to PUBLIC in PostgreSQL. Revoke that ambient
    -- grant and rebuild an explicit allow-list so E2E, restore and production
    -- all exercise the same callable database surface.
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA app FROM ${WEB_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM ${WEB_ROLE};

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${mutable} TO ${WEB_ROLE};
    GRANT SELECT, INSERT ON TABLE ${appendOnly} TO ${WEB_ROLE};
    GRANT SELECT ON TABLE ${readOnly} TO ${WEB_ROLE};
    GRANT SELECT ON TABLE tenants TO ${WEB_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${WEB_ROLE};
    GRANT EXECUTE ON FUNCTION ${executable} TO ${WEB_ROLE};

    REVOKE ALL PRIVILEGES ON platform_audit_log FROM ${WEB_ROLE};
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle FROM ${WEB_ROLE};
    REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA drizzle FROM ${WEB_ROLE};
  `;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
