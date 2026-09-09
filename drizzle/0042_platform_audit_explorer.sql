-- Expose only a narrow, read-only audit projection to the Web role. The
-- append-only platform_audit_log table remains privileged and is still used by
-- workers and operator scripts for writes and recovery reconciliation.
CREATE OR REPLACE VIEW app.platform_audit_explorer
WITH (security_barrier = true)
AS
SELECT id,
       operator,
       action,
       tenant_id,
       target,
       left(changes, 4096) AS changes,
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
