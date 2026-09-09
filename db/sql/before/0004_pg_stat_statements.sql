-- Query diagnostics are part of the observability contract. db:start
-- preloads this library for the project-local cluster; managed PostgreSQL
-- must enable it through its normal cluster configuration.
--
-- pg_stat_statements is intentionally optional at migration time: managed
-- PostgreSQL commonly gives the migration owner DDL rights inside the
-- application database but not cluster-superuser rights required by this
-- extension. The diagnostics page reports `not-enabled` in that case, while
-- migrations and the application schema remain usable. Production bootstrap
-- should install it once through the provider/admin channel.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_stat_statements requires a cluster administrator; continuing without query statistics';
END
$$;
