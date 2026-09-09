-- PostgreSQL replacement backreferences use a single backslash. Keep this
-- corrective migration explicit so the source history documents the fix.
CREATE OR REPLACE VIEW app.platform_audit_explorer
WITH (security_barrier = true)
AS
SELECT id,
       operator,
       action,
       tenant_id,
       target,
       regexp_replace(
         left(changes, 4096),
         '(("(password|secret|token|authorization|cookie|sourceTarget)"[[:space:]]*:[[:space:]]*)("[^"]*"|[^,}]+))',
         '"\3":"[redacted]"',
         'gi'
       ) AS changes,
       outcome,
       request_id,
       created_at
  FROM public.platform_audit_log;
--> statement-breakpoint
REVOKE ALL ON app.platform_audit_explorer FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='univ_app_web') THEN
    GRANT SELECT ON app.platform_audit_explorer TO univ_app_web;
  END IF;
END $$;
