import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adminDb } from "@/db/admin.ts";

/*
 * The RLS migration is executable security policy, not application decoration.
 * Keep its inventory under test so a future table cannot quietly become a
 * cross-university read/write surface simply because somebody forgot to add it
 * to db/sql/after/0001_row_level_security.sql.
 */
const TENANT_TABLES = [
  "academic_periods",
  "academic_programs",
  "academic_years",
  "api_rate_windows",
  "attachments",
  "attention_summary",
  "audit_log",
  "break_glass_sessions",
  "calendar_entries",
  "calendar_subscription_tokens",
  "correspondence",
  "correspondence_recipients",
  "council_appointments",
  "council_decision_transitions",
  "council_decisions",
  "council_meetings",
  "council_permanent_members",
  "council_rulings",
  "custom_field_definitions",
  "custom_field_values",
  "decision_template_versions",
  "document_sequences",
  "document_versions",
  "external_identity_links",
  "import_mapping_profiles",
  "import_batches",
  "institutions",
  "integration_connections",
  "integration_staging_records",
  "integration_sync_runs",
  "job_attempts",
  "jobs",
  "login_attempts",
  "lookups",
  "notifications",
  "organization_unit_versions",
  "organization_units",
  "outbox_events",
  "pii_access_log",
  "portal_links",
  "professor_capacities",
  "professors",
  "quality_rules",
  "quality_snapshots",
  "recent_records",
  "regulation_versions",
  "reporting_snapshots",
  "research_projects",
  "retention_policies",
  "role_capabilities",
  "roles",
  "saved_views",
  "scheduled_jobs",
  "scim_credentials",
  "search_documents",
  "service_accounts",
  "student_supervision_assignments",
  "students",
  "task_transitions",
  "tasks",
  "tenant_features",
  "tenant_owners",
  "user_record_pins",
  "user_roles",
  "webhook_deliveries",
  "webhook_subscriptions",
  "workshop_certificates",
  "workshop_instructors",
  "workshop_participants",
  "workshop_registrations",
  "workshops",
] as const;

/* Better Auth's pre-auth identity tables and platform-owned tables cannot be
 * tenant-scoped before a username identifies an account, or intentionally span
 * institutions. They remain explicit exceptions so a new public table can
 * never silently bypass this inventory. */
const NON_TENANT_TABLES = [
  "account",
  "passkey",
  "platform_audit_log",
  "platform_operation_requests",
  "platform_operational_health",
  "platform_operators",
  "rate_limit",
  "session",
  "scim_connection_binding",
  "scim_group",
  "scim_group_member",
  "scim_identity_tombstone",
  "scim_projection_grant",
  "scim_subject",
  "scim_user",
  "sso_provider",
  "tenants",
  "user",
  "verification",
  "worker_runtime_health",
] as const;

/* These tables are tenant-scoped through a relationship or are read before a
 * tenant is known, so they intentionally do not carry a leading tenant index.
 * Platform audit rows may optionally point at a tenant, but the platform log
 * itself is deliberately global and is never queried through tenant RLS. */
const TENANT_COLUMN_TABLES = TENANT_TABLES.filter(
  (name) => name !== "login_attempts" && name !== "role_capabilities",
);

describe.skipIf(!process.env.DATABASE_URL)("database tenant guardrails", () => {
  it("enables RLS and a tenant policy on every institutional table", async () => {
    const result = await adminDb().execute(sql`
      select
        c.relname as name,
        c.relrowsecurity as rls,
        c.relforcerowsecurity as forced,
        exists (
          select 1
          from pg_policies p
          where p.schemaname = 'public'
            and p.tablename = c.relname
            and p.policyname = 'tenant_isolation'
        ) as policy
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
    `);

    const rows = (
      result.rows as Array<{ name: string; rls: boolean; forced: boolean; policy: boolean }>
    ).filter((row) => TENANT_TABLES.includes(row.name as (typeof TENANT_TABLES)[number]));
    expect(new Set(rows.map((row) => row.name))).toEqual(new Set(TENANT_TABLES));
    expect(rows.every((row) => row.rls && row.forced && row.policy)).toBe(true);
  });

  it("accounts for every public table in the tenant boundary inventory", async () => {
    const result = await adminDb().execute(sql`
      select c.relname as name
      from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
      order by c.relname
    `);
    const actual = new Set((result.rows as Array<{ name: string }>).map((row) => row.name));
    const expected = new Set([...TENANT_TABLES, ...NON_TENANT_TABLES]);
    expect([...actual].sort(), "every public table must be explicitly classified").toEqual(
      [...expected].sort(),
    );
  });

  it("keeps tenant_id as the leading key of an index on every tenant table", async () => {
    const result = await adminDb().execute(sql`
      select
        c.relname as name,
        exists (
          select 1
          from pg_index i
          where i.indrelid = c.oid
            and i.indnkeyatts > 0
            and (i.indkey::int[])[array_lower(i.indkey::int[], 1)] = a.attnum
        ) as indexed
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where c.relnamespace = 'public'::regnamespace
        and c.relkind = 'r'
        and c.relname not in ('user', 'platform_audit_log')
        and not a.attisdropped
    `);
    const rows = result.rows as Array<{ name: string; indexed: boolean }>;
    expect(new Set(rows.map((row) => row.name))).toEqual(new Set(TENANT_COLUMN_TABLES));
    expect(
      rows.every((row) => row.indexed),
      "tenant_id must lead an index",
    ).toBe(true);
  });

  it("enforces the council decision natural identity in PostgreSQL", async () => {
    const result = await adminDb().execute(sql`
      select
        i.indisunique as unique,
        pg_get_expr(i.indpred, i.indrelid) as predicate,
        pg_get_indexdef(i.indexrelid) as definition
      from pg_index i
      join pg_class idx on idx.oid = i.indexrelid
      where idx.relname = 'council_decision_identity_idx'
    `);
    const [row] = result.rows as Array<{
      unique: boolean;
      predicate: string | null;
      definition: string;
    }>;
    expect(row?.unique).toBe(true);
    expect(row?.definition).toContain("tenant_id");
    expect(row?.definition).toContain("meeting_number");
    expect(row?.definition).toContain("report_category");
    expect(row?.definition).toContain("thesis_code");
    expect(row?.predicate).toContain("deleted_at IS NULL");
  });
});
