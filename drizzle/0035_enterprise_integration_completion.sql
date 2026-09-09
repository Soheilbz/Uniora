-- Enterprise integration completion: SCIM credential control-plane + fail-closed provisioning.
-- Better Auth plugin-owned SCIM resource tables are intentionally generated
-- from the official @better-auth/scim schema on Windows validation; this
-- migration owns only application control-plane records and narrow pre-auth
-- resolvers.

CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_tenant_id_idx
  ON integration_connections(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_credentials (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  scopes text NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  last_used_at timestamptz,
  created_by text NOT NULL,
  revoked_at timestamptz,
  rotated_from_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scim_credentials_connection_tenant_fk
    FOREIGN KEY (tenant_id,connection_id)
    REFERENCES integration_connections(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT scim_credentials_creator_tenant_fk
    FOREIGN KEY (tenant_id,created_by)
    REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT scim_credentials_status_check CHECK (status IN ('active','revoked'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_credentials_token_hash_idx ON scim_credentials(token_hash);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_credentials_connection_idx ON scim_credentials(tenant_id,connection_id,created_at);--> statement-breakpoint
ALTER TABLE scim_credentials ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE scim_credentials FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON scim_credentials;--> statement-breakpoint
CREATE POLICY tenant_isolation ON scim_credentials
  USING (tenant_id=app.current_tenant()) WITH CHECK (tenant_id=app.current_tenant());--> statement-breakpoint

-- Resolve a bearer token by digest without granting Web an unscoped SELECT.
-- The function validates the complete tenant/connection/credential lifecycle
-- and records last-used at a deliberately coarse cadence.
CREATE OR REPLACE FUNCTION app.resolve_scim_credential(p_token_hash text)
RETURNS TABLE(
  tenant_id uuid,
  connection_id uuid,
  credential_id uuid,
  scopes text,
  expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app AS $$
DECLARE
  v_row record;
BEGIN
  SELECT c.tenant_id,c.connection_id,c.id AS credential_id,c.scopes,c.expires_at,c.last_used_at
    INTO v_row
  FROM public.scim_credentials c
  JOIN public.integration_connections ic
    ON ic.tenant_id=c.tenant_id AND ic.id=c.connection_id
  JOIN public.tenants t ON t.id=c.tenant_id
  WHERE c.token_hash=p_token_hash
    AND c.status='active' AND c.revoked_at IS NULL
    AND (c.expires_at IS NULL OR c.expires_at>clock_timestamp())
    AND ic.kind='scim' AND ic.status='active' AND ic.deleted_at IS NULL
    AND t.status='active' AND t.provisioning_status='active'
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_row.last_used_at IS NULL OR v_row.last_used_at < clock_timestamp() - interval '15 minutes' THEN
    UPDATE public.scim_credentials
      SET last_used_at=clock_timestamp(), updated_at=clock_timestamp()
      WHERE id=v_row.credential_id;
  END IF;

  tenant_id := v_row.tenant_id;
  connection_id := v_row.connection_id;
  credential_id := v_row.credential_id;
  scopes := v_row.scopes;
  expires_at := v_row.expires_at;
  RETURN NEXT;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_scim_credential(text) FROM PUBLIC;--> statement-breakpoint

-- Exact, pre-provisioned SCIM subject mapping. No email/userName fallback is
-- permitted; inactive users/tenants/connections fail closed.
CREATE OR REPLACE FUNCTION app.resolve_scim_identity(
  p_runtime_connection_id text,
  p_external_id text
) RETURNS TABLE(user_id text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,public,app AS $$
  SELECT l.user_id
  FROM public.external_identity_links l
  JOIN public.integration_connections c
    ON c.tenant_id=l.tenant_id AND c.id=l.connection_id
  JOIN public.tenants t ON t.id=l.tenant_id
  JOIN public."user" u ON u.id=l.user_id AND u.tenant_id=l.tenant_id
  WHERE l.provider_id=p_runtime_connection_id
    AND l.protocol='scim'
    AND l.issuer=p_runtime_connection_id
    AND l.subject=p_external_id
    AND l.status='active' AND l.deleted_at IS NULL
    AND c.kind='scim' AND c.status='active' AND c.deleted_at IS NULL
    AND t.status='active' AND t.provisioning_status='active'
    AND u.suspended_at IS NULL
    AND (u.account_expires_at IS NULL OR u.account_expires_at>clock_timestamp())
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_scim_identity(text,text) FROM PUBLIC;--> statement-breakpoint

-- External-system adapter staging. Adapters never overwrite core SIS/HR/domain
-- rows directly; reconciliation remains an explicit application operation.
CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL, job_id uuid, kind text NOT NULL, status text NOT NULL DEFAULT 'queued',
  received integer NOT NULL DEFAULT 0, staged integer NOT NULL DEFAULT 0, error_count integer NOT NULL DEFAULT 0,
  public_error text, started_at timestamptz, completed_at timestamptz, requested_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_sync_runs_connection_tenant_fk FOREIGN KEY(tenant_id,connection_id) REFERENCES integration_connections(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT integration_sync_runs_requester_tenant_fk FOREIGN KEY(tenant_id,requested_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT integration_sync_runs_kind_check CHECK(kind IN ('sis','hr','identity_ldap')),
  CONSTRAINT integration_sync_runs_status_check CHECK(status IN ('queued','running','completed','failed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS integration_sync_runs_tenant_id_idx ON integration_sync_runs(tenant_id,id);--> statement-breakpoint
ALTER TABLE integration_sync_runs ADD CONSTRAINT integration_sync_runs_job_tenant_fk FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS integration_sync_runs_connection_idx ON integration_sync_runs(tenant_id,connection_id,created_at);--> statement-breakpoint
ALTER TABLE integration_sync_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_sync_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON integration_sync_runs USING(tenant_id=app.current_tenant()) WITH CHECK(tenant_id=app.current_tenant());--> statement-breakpoint

CREATE TABLE IF NOT EXISTS integration_staging_records (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL, connection_id uuid NOT NULL, source_key text NOT NULL, entity_type text NOT NULL,
  payload_json text NOT NULL, payload_hash text NOT NULL, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_staging_connection_tenant_fk FOREIGN KEY(tenant_id,connection_id) REFERENCES integration_connections(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT integration_staging_status_check CHECK(status IN ('pending','applied','ignored','error'))
);--> statement-breakpoint
-- The table is FORCE RLS before this relationship is added. PostgreSQL checks
-- existing rows while adding a validated FK, which calls app.current_tenant()
-- without a transaction context during a fresh migration and aborts the whole
-- bootstrap. NOT VALID still enforces every new row; existing rows can be
-- validated later by an owner/superuser maintenance operation after a tenant
-- context is available.
ALTER TABLE integration_staging_records ADD CONSTRAINT integration_staging_run_tenant_fk FOREIGN KEY(tenant_id,run_id) REFERENCES integration_sync_runs(tenant_id,id) ON DELETE CASCADE NOT VALID;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS integration_staging_records_source_idx ON integration_staging_records(tenant_id,connection_id,source_key);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS integration_staging_records_run_idx ON integration_staging_records(tenant_id,run_id,created_at);--> statement-breakpoint
ALTER TABLE integration_staging_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_staging_records FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON integration_staging_records USING(tenant_id=app.current_tenant()) WITH CHECK(tenant_id=app.current_tenant());--> statement-breakpoint

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workshop_id uuid NOT NULL, requested_by text NOT NULL, object_key text NOT NULL, filename text NOT NULL,
  size_bytes integer NOT NULL, mapping_json text NOT NULL DEFAULT '{}', conflict_policy text NOT NULL DEFAULT 'skip',
  status text NOT NULL DEFAULT 'uploading', job_id uuid, processed_rows integer NOT NULL DEFAULT 0, total_rows integer,
  created_count integer NOT NULL DEFAULT 0, updated_count integer NOT NULL DEFAULT 0, skipped_count integer NOT NULL DEFAULT 0,
  fault_count integer NOT NULL DEFAULT 0, faults_json text NOT NULL DEFAULT '[]', public_error text,
  expires_at timestamptz NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_workshop_tenant_fk FOREIGN KEY(tenant_id,workshop_id) REFERENCES workshops(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT import_batches_requester_tenant_fk FOREIGN KEY(tenant_id,requested_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT import_batches_status_check CHECK(status IN ('uploading','queued','running','completed','failed','expired','cancelled')),
  CONSTRAINT import_batches_conflict_check CHECK(conflict_policy IN ('skip','update')),
  CONSTRAINT import_batches_size_check CHECK(size_bytes BETWEEN 1 AND 104857600)
);--> statement-breakpoint
ALTER TABLE import_batches ADD CONSTRAINT import_batches_job_tenant_fk FOREIGN KEY(tenant_id,job_id) REFERENCES jobs(tenant_id,id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS import_batches_tenant_status_idx ON import_batches(tenant_id,status,created_at);--> statement-breakpoint
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE import_batches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON import_batches USING(tenant_id=app.current_tenant()) WITH CHECK(tenant_id=app.current_tenant());--> statement-breakpoint
--> statement-breakpoint
-- System-owned background work (outbox drain, future projections) must not be
-- forced to impersonate a tenant user. User-triggered jobs continue to persist
-- a real requester and re-check that requester in the worker.
ALTER TABLE jobs ALTER COLUMN requested_by DROP NOT NULL;--> statement-breakpoint
