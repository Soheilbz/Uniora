-- The migration stream creates policies that reference this function before
-- the final RLS policy bundle is installed. Defining the fail-closed tenant
-- context up front keeps a brand-new E2E database on the same safe path as a
-- long-lived production database.
CREATE SCHEMA IF NOT EXISTS app;

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
