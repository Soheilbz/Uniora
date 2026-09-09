-- Large search indexes are deliberately outside Drizzle's transactional migration.
-- db.mjs applies after-SQL files through psql in autocommit mode, allowing
-- CONCURRENTLY to keep the append-only operational surfaces writable.
-- A failed concurrent build can leave an INVALID index behind. `IF NOT EXISTS`
-- would otherwise preserve that broken object forever, so remove only invalid
-- members of this release-owned index set before rebuilding them. `\gexec` is
-- a psql meta-command and therefore each emitted DROP still runs outside a
-- transaction, as CONCURRENTLY requires.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I;', n.nspname, c.relname)
FROM pg_index i
JOIN pg_class c ON c.oid=i.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND NOT i.indisvalid
  AND c.relname IN (
    'platform_audit_time_id_idx',
    'platform_audit_operator_search_idx',
    'platform_audit_action_search_idx',
    'platform_audit_target_search_idx',
    'platform_audit_request_search_idx',
    'platform_operation_requests_target_slug_idx',
    'platform_operation_requests_target_username_idx',
    'platform_operation_requests_target_name_idx'
  )
\gexec

CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_audit_time_id_idx
  ON platform_audit_log(created_at DESC, id DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_audit_operator_search_idx
  ON platform_audit_log USING gin(operator gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_audit_action_search_idx
  ON platform_audit_log USING gin(action gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_audit_target_search_idx
  ON platform_audit_log USING gin(target gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_audit_request_search_idx
  ON platform_audit_log USING gin(request_id gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_operation_requests_target_slug_idx
  ON platform_operation_requests USING gin(target_slug gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_operation_requests_target_username_idx
  ON platform_operation_requests USING gin(target_username gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS platform_operation_requests_target_name_idx
  ON platform_operation_requests USING gin(target_name gin_trgm_ops);
