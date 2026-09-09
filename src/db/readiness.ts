import { sql } from "drizzle-orm";
import { db } from "./client.ts";

/**
 * Deployment/readiness contract for the restricted Web role.
 *
 * Liveness is intentionally only `select 1` (`/api/healthz`). Readiness is
 * stricter: it proves that the process is attached to a schema new enough for
 * this release and that the release-defining schema, role hardening and least-privilege
 * invariants survived migration / db:setup. No tenant data is read and no tenant context is required.
 */
export async function databaseReady(): Promise<boolean> {
  const result = await db().execute(sql`
    select
      to_regclass('public.tenants') is not null
      and to_regclass('public.students') is not null
      and to_regclass('public.audit_log') is not null
      and to_regprocedure('app.current_tenant()') is not null
      and to_regprocedure('app.jalali_year(date)') is not null
      and exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='user' and column_name='employment_start'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='session' and column_name='mfa_verified_at'
      )
      and exists (
        select 1
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='students'
          and c.relrowsecurity and c.relforcerowsecurity
      )
      and exists (
        select 1
        from pg_constraint c
        join pg_class t on t.oid=c.conrelid
        join pg_namespace n on n.oid=t.relnamespace
        where n.nspname='public' and t.relname='roles' and c.conname='roles_tier_check'
      )
      and exists (
        select 1 from pg_roles
        where rolname=current_user and rolcanlogin
          and not rolsuper and not rolbypassrls and not rolcreatedb
          and not rolcreaterole and not rolreplication and not rolinherit
      )
      and has_table_privilege(current_user, 'public.tenants', 'SELECT')
      and not has_table_privilege(current_user, 'public.tenants', 'UPDATE')
      and has_table_privilege(current_user, 'public.audit_log', 'SELECT')
      and has_table_privilege(current_user, 'public.audit_log', 'INSERT')
      and not has_table_privilege(current_user, 'public.audit_log', 'UPDATE')
      and not has_table_privilege(current_user, 'public.audit_log', 'DELETE')
      and not has_table_privilege(current_user, 'public.platform_audit_log', 'SELECT')
      and not has_table_privilege(current_user, 'public.platform_audit_log', 'INSERT')
      and not has_table_privilege(current_user, 'public.platform_audit_log', 'UPDATE')
      and not has_table_privilege(current_user, 'public.platform_audit_log', 'DELETE')
      as ready
  `);
  return result.rows[0]?.ready === true;
}
