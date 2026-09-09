-- Row-level security: the boundary between universities.
--
-- Hand-written, because policies cannot be expressed in a Drizzle table
-- definition. That is not a footnote — it is the reason `drizzle-kit push` must
-- never be the way this database is built: push would create every table above
-- and none of the policies below, producing a database that looks correct,
-- answers every query, and lets any university read every other one's records.
--
-- The application connects as a NOSUPERUSER / NOBYPASSRLS role, which is what
-- makes these policies apply to it at all. See `scripts/db.mjs setup`.

CREATE SCHEMA IF NOT EXISTS app;

--------------------------------------------------------------------------------
-- Which university is asking.
--
-- Raises rather than returning NULL when nothing is set, and that choice is the
-- whole safety property. A NULL would make every policy below evaluate to false
-- and quietly return an empty result — so a query that forgot its scope would
-- look exactly like a university with no records, and an engineer would go
-- hunting for missing data instead of a missing transaction.
--
-- The `true` in `current_setting` means "return NULL if unset rather than
-- erroring", so the error raised here is ours, with a sentence in it.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
  LANGUAGE plpgsql STABLE AS $$
DECLARE
  raw text := current_setting('app.tenant_id', true);
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RAISE EXCEPTION 'no tenant context set for this transaction'
      USING HINT = 'wrap this query in withTenant(); see src/db/tenant.ts';
  END IF;
  RETURN raw::uuid;
END;
$$;

--------------------------------------------------------------------------------
-- Public no-context projections need a narrowly-scoped RLS escape hatch.
--
-- A public request has no tenant context by design: it may be checking a
-- certificate, reading a deliberately published workshop, or resolving an
-- opaque integration token. FORCE RLS must still protect the underlying
-- tables, so each such function sets a fixed `app.public_surface` value before
-- its RLS-bearing statement and this helper maps that value to the exact tables
-- it may touch.
--
-- The session-user check is intentional. A caller may set arbitrary custom
-- GUCs, but cannot turn an ordinary Web session into an elevated function call:
-- inside a real definer function current_user is the function owner while
-- session_user remains the canonical request role. Direct owner/admin
-- sessions therefore fail closed instead of gaining a public bypass.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.public_surface_allows(target_table text)
RETURNS boolean
LANGUAGE sql
VOLATILE
AS $$
  SELECT session_user = 'univ_app_web'
     AND current_user <> session_user
     AND CASE current_setting('app.public_surface', true)
       WHEN 'verify_certificate' THEN target_table IN (
         'workshop_certificates', 'workshop_participants', 'students',
         'workshops', 'institutions'
       )
       WHEN 'public_workshop' THEN target_table IN (
         'workshops', 'institutions', 'workshop_registrations'
       )
       WHEN 'register_public_workshop' THEN target_table IN (
         'workshops', 'workshop_registrations'
       )
       WHEN 'resolve_service_account' THEN target_table = 'service_accounts'
       WHEN 'resolve_calendar_subscription' THEN target_table = 'calendar_subscription_tokens'
       ELSE false
     END
$$;

--------------------------------------------------------------------------------
-- One policy shape, applied to every table that holds institutional data.
--
-- `USING` governs what may be read and what an UPDATE or DELETE may reach;
-- `WITH CHECK` governs what may be written. Both are needed and they are not the
-- same rule: without WITH CHECK, a clerk at one university could insert a row
-- stamped with another university's tenant_id — visible to nobody here, and
-- entirely visible over there.
--------------------------------------------------------------------------------
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    -- Institutional records.
    'students', 'professors', 'audit_log',
    -- The letterhead every printed instrument carries. Under the policy like
    -- any other row: unscoped, one university could rename the institution
    -- another university's forms are signed under.
    'institutions',
    -- The office's own calendar notes. One institution's «تعطیلی دانشکده» is
    -- nobody else's business, and the table is writable.
    'calendar_entries', 'calendar_subscription_tokens',
    -- The council: the sitting, the dossiers decided at it, the rulings it
    -- passed, and the supervisions it appointed.
    'council_meetings', 'council_decisions', 'council_rulings', 'council_appointments',
    -- Who sits on the council. A roster is one institution's, and it is
    -- writable: unscoped, a clerk at one university could seat somebody on
    -- another university's council.
    'council_permanent_members',
    -- Supervision quotas, and the workshops the office runs.
    'professor_capacities',
    'workshops', 'workshop_participants', 'workshop_instructors', 'workshop_certificates',
    -- The institution's vocabularies. A faculty list is not public information
    -- and, more to the point, it is *writable*: unscoped, a clerk at one
    -- university could add a department to another university's form.
    'lookups',
    -- The authorisation model. These carry a tenant_id like any other table and
    -- are protected the same way: a role is one institution's, and so is the
    -- assignment of it. Leaving them out would mean the one part of the schema
    -- that decides what everybody may do was the one part with no boundary.
    'roles', 'user_roles', 'tenant_owners',
    -- A person's saved register views. Institutional data like any other: the
    -- name somebody gave a view is theirs, and the query in it describes this
    -- university's records. It is also writable, which is the half that
    -- matters — unscoped, a clerk could plant a view on another university's
    -- account.
    'saved_views',
    -- Durable background exports. Web may enqueue/read, while the operations
    -- worker owns lifecycle transitions through its privileged connection.
    -- Modular-monolith foundations. Every tenant-owned row uses the
    -- same fail-closed policy; operational privilege remains a separate grant.
    'academic_years', 'academic_periods', 'organization_units', 'organization_unit_versions',
    'academic_programs', 'student_supervision_assignments',
    'attachments', 'document_versions', 'document_sequences', 'correspondence', 'correspondence_recipients',
    'tasks', 'task_transitions', 'notifications', 'scheduled_jobs',
    'regulation_versions', 'decision_template_versions', 'quality_rules', 'quality_snapshots',
    'retention_policies', 'pii_access_log', 'break_glass_sessions',
    'service_accounts', 'outbox_events', 'webhook_subscriptions', 'webhook_deliveries', 'integration_connections',
    'attention_summary', 'search_documents', 'tenant_features', 'custom_field_definitions', 'custom_field_values',
    'user_record_pins', 'recent_records', 'research_projects', 'jobs', 'job_attempts',
    'council_decision_transitions', 'import_mapping_profiles', 'workshop_registrations',
    'portal_links', 'api_rate_windows', 'reporting_snapshots', 'external_identity_links',
    'scim_credentials', 'integration_sync_runs', 'integration_staging_records', 'import_batches'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    IF target = ANY (ARRAY[
      'workshop_certificates', 'workshop_participants', 'students', 'workshops',
      'institutions', 'workshop_registrations', 'service_accounts',
      'calendar_subscription_tokens'
    ]) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        'USING (CASE WHEN app.public_surface_allows(%L) THEN true ELSE tenant_id = app.current_tenant() END) '
        'WITH CHECK (CASE WHEN app.public_surface_allows(%L) THEN true ELSE tenant_id = app.current_tenant() END)',
        target, target, target
      );
    ELSE
      /* Keep the common tenant path planner-friendly. Only tables that are
         actually reached by a reviewed no-context public function need the
         public-surface branch above. */
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        'USING (tenant_id = app.current_tenant()) '
        'WITH CHECK (tenant_id = app.current_tenant())',
        target
      );
    END IF;
  END LOOP;
END $$;

--------------------------------------------------------------------------------
-- `role_capabilities` is scoped through its role, not by a column of its own.
--
-- It has no `tenant_id` — a capability belongs to a role, and the role belongs
-- to an institution — so the policy follows the link rather than comparing a
-- column. Without this the table would be readable across tenants: harmless on
-- its own, since it holds only capability names, but it is also *writable*, and
-- an unscoped write is a way to grant a capability inside another university.
--------------------------------------------------------------------------------
ALTER TABLE role_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_capabilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON role_capabilities;
CREATE POLICY tenant_isolation ON role_capabilities
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id = app.current_tenant()))
  WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id = app.current_tenant()));

--------------------------------------------------------------------------------
-- `login_attempts` is scoped through its account, not by a column of its own.
--
-- It has no `tenant_id` — one row per account, keyed by the account's id — so
-- the policy follows the link, exactly as `role_capabilities` follows its role.
-- Tenant accounts keep the fail-closed `app.current_tenant()` branch and
-- `login-guard.ts` reads them inside `withTenant`. Platform operators are the
-- one intentional tenantless identity class: only rows linked through
-- `platform_operators` are visible when *no* tenant setting is present. That
-- lets the installation console use the same account lockout ledger without
-- turning an unscoped tenant query into a silent empty read.
--
-- The other identity tables — "user", session, account, verification — remain
-- outside RLS deliberately because Better Auth performs credential discovery
-- before an application transaction exists. The public login identifier is
-- tenant-local, but is converted to a globally unique internal authentication
-- key before Better Auth sees it. Application-owned reads still carry an
-- explicit tenant/user predicate, while all institutional business tables are
-- protected by the forced policies above.
--------------------------------------------------------------------------------
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON login_attempts;
CREATE POLICY tenant_isolation ON login_attempts
  USING (EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.id = user_id
      AND CASE
        WHEN u.tenant_id IS NULL THEN
          EXISTS (SELECT 1 FROM platform_operators p WHERE p.user_id = u.id)
          AND nullif(current_setting('app.tenant_id', true), '') IS NULL
        ELSE u.tenant_id = app.current_tenant()
      END
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.id = user_id
      AND CASE
        WHEN u.tenant_id IS NULL THEN
          EXISTS (SELECT 1 FROM platform_operators p WHERE p.user_id = u.id)
          AND nullif(current_setting('app.tenant_id', true), '') IS NULL
        ELSE u.tenant_id = app.current_tenant()
      END
  ));

-- Database privileges are defined canonically in `scripts/lib/web-role-policy.mjs`.
-- `db:setup` provisions/rotates the request-serving role, while `db:migrate`
-- reapplies the reviewed allow-list after migrations whenever that role exists.
-- Policy creation remains independent so a fresh database can be migrated
-- before initial request-serving role bootstrap.
