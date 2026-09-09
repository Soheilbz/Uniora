-- Data-contract cleanup: make boolean state native and reject malformed durable JSON.
-- Historical migrations stay immutable; all conversions are explicit and reversible.

ALTER TABLE tenant_features DROP CONSTRAINT IF EXISTS tenant_features_enabled_check;
ALTER TABLE tenant_features ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE tenant_features ALTER COLUMN enabled TYPE boolean USING enabled::boolean;
ALTER TABLE tenant_features ALTER COLUMN enabled SET DEFAULT false;

ALTER TABLE custom_field_definitions DROP CONSTRAINT IF EXISTS custom_field_definitions_required_check;
ALTER TABLE custom_field_definitions ALTER COLUMN required DROP DEFAULT;
ALTER TABLE custom_field_definitions ALTER COLUMN required TYPE boolean USING required::boolean;
ALTER TABLE custom_field_definitions ALTER COLUMN required SET DEFAULT false;

ALTER TABLE workshops DROP CONSTRAINT IF EXISTS workshops_public_registration_check;
ALTER TABLE workshops ALTER COLUMN public_registration DROP DEFAULT;
ALTER TABLE workshops ALTER COLUMN public_registration TYPE boolean USING public_registration::boolean;
ALTER TABLE workshops ALTER COLUMN public_registration SET DEFAULT false;

ALTER TABLE quality_rules DROP CONSTRAINT IF EXISTS quality_rules_enabled_check;
ALTER TABLE quality_rules ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE quality_rules ALTER COLUMN enabled TYPE boolean USING enabled::boolean;
ALTER TABLE quality_rules ALTER COLUMN enabled SET DEFAULT true;

ALTER TABLE retention_policies DROP CONSTRAINT IF EXISTS retention_policies_enabled_check;
ALTER TABLE retention_policies DROP CONSTRAINT IF EXISTS retention_policies_hold_check;
ALTER TABLE retention_policies ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE retention_policies ALTER COLUMN enabled TYPE boolean USING enabled::boolean;
ALTER TABLE retention_policies ALTER COLUMN enabled SET DEFAULT true;
ALTER TABLE retention_policies ALTER COLUMN legal_hold DROP DEFAULT;
ALTER TABLE retention_policies ALTER COLUMN legal_hold TYPE boolean USING legal_hold::boolean;
ALTER TABLE retention_policies ALTER COLUMN legal_hold SET DEFAULT false;

ALTER TABLE scheduled_jobs DROP CONSTRAINT IF EXISTS scheduled_jobs_enabled_check;
ALTER TABLE scheduled_jobs ALTER COLUMN enabled DROP DEFAULT;
ALTER TABLE scheduled_jobs ALTER COLUMN enabled TYPE boolean USING enabled::boolean;
ALTER TABLE scheduled_jobs ALTER COLUMN enabled SET DEFAULT true;

-- Durable JSON remains text in this release to preserve the existing application
-- wire contract, but PostgreSQL is now the final integrity boundary. The next
-- major schema revision can move these columns to jsonb without first having to
-- repair malformed historical values.
ALTER TABLE attention_summary ADD CONSTRAINT attention_summary_payload_json_check CHECK (payload IS JSON OBJECT);
ALTER TABLE tenant_features ADD CONSTRAINT tenant_features_config_json_check CHECK (config IS JSON OBJECT);
ALTER TABLE custom_field_definitions ADD CONSTRAINT custom_field_definitions_options_json_check CHECK (options_json IS JSON ARRAY);
ALTER TABLE custom_field_values ADD CONSTRAINT custom_field_values_value_json_check CHECK (value_json IS JSON);
ALTER TABLE regulation_versions ADD CONSTRAINT regulation_versions_rules_json_check CHECK (rules_json IS JSON);
ALTER TABLE decision_template_versions ADD CONSTRAINT decision_template_versions_schema_json_check CHECK (schema_json IS JSON OBJECT);
ALTER TABLE quality_snapshots ADD CONSTRAINT quality_snapshots_sample_ids_json_check CHECK (sample_entity_ids IS JSON ARRAY);
ALTER TABLE scheduled_jobs ADD CONSTRAINT scheduled_jobs_payload_json_check CHECK (payload IS JSON OBJECT);
ALTER TABLE jobs ADD CONSTRAINT jobs_payload_json_check CHECK (payload IS JSON OBJECT);
ALTER TABLE jobs ADD CONSTRAINT jobs_result_json_check CHECK (result IS NULL OR result IS JSON);
ALTER TABLE import_mapping_profiles ADD CONSTRAINT import_mapping_profiles_mapping_json_check CHECK (mapping_json IS JSON OBJECT);
ALTER TABLE import_mapping_profiles ADD CONSTRAINT import_mapping_profiles_match_strategy_json_check CHECK (match_strategy_json IS JSON OBJECT);
ALTER TABLE import_batches ADD CONSTRAINT import_batches_mapping_json_check CHECK (mapping_json IS JSON OBJECT);
ALTER TABLE import_batches ADD CONSTRAINT import_batches_faults_json_check CHECK (faults_json IS JSON ARRAY);
ALTER TABLE reporting_snapshots ADD CONSTRAINT reporting_snapshots_payload_json_check CHECK (payload_json IS JSON OBJECT);
ALTER TABLE research_projects ADD CONSTRAINT research_projects_collaborators_json_check CHECK (collaborators_json IS JSON ARRAY);
ALTER TABLE research_projects ADD CONSTRAINT research_projects_outputs_json_check CHECK (outputs_json IS JSON ARRAY);
ALTER TABLE platform_operational_health ADD CONSTRAINT platform_operational_health_payload_json_check CHECK (payload_json IS JSON OBJECT);
ALTER TABLE service_accounts ADD CONSTRAINT service_accounts_capabilities_json_check CHECK (capabilities IS JSON ARRAY);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_payload_json_check CHECK (payload IS JSON OBJECT);
ALTER TABLE webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_event_types_json_check CHECK (event_types IS JSON ARRAY);
ALTER TABLE scim_credentials ADD CONSTRAINT scim_credentials_scopes_json_check CHECK (scopes IS JSON ARRAY);
ALTER TABLE integration_staging_records ADD CONSTRAINT integration_staging_payload_json_check CHECK (payload_json IS JSON OBJECT);

-- Search indexes are built concurrently by db/sql/after/0005_data_contract_indexes.sql.

-- Materialize the semantic operation target fields once at write time so the
-- console does not repeatedly search inside JSON payloads.
ALTER TABLE platform_operation_requests
  ADD COLUMN target_slug text GENERATED ALWAYS AS (nullif(payload->>'slug', '')) STORED,
  ADD COLUMN target_username text GENERATED ALWAYS AS (nullif(payload->>'username', '')) STORED,
  ADD COLUMN target_name text GENERATED ALWAYS AS (nullif(coalesce(payload->>'name', payload->>'adminName'), '')) STORED;
--> statement-breakpoint
CREATE TABLE worker_runtime_health (
  worker_id text PRIMARY KEY,
  execution_class text NOT NULL,
  status text NOT NULL,
  payload_json text NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_runtime_health_execution_class_check CHECK (execution_class IN ('tenant','platform')),
  CONSTRAINT worker_runtime_health_status_check CHECK (status IN ('ok','degraded','stopping')),
  CONSTRAINT worker_runtime_health_payload_json_check CHECK (payload_json IS JSON OBJECT)
);--> statement-breakpoint
CREATE INDEX worker_runtime_health_class_observed_idx ON worker_runtime_health(execution_class,observed_at);--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.upsert_tenant_worker_health(
  p_worker_id text,
  p_status text,
  p_payload_json text,
  p_started_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF p_worker_id NOT LIKE 'tenant:%' THEN
    RAISE EXCEPTION 'tenant worker health id must use tenant: namespace';
  END IF;
  DELETE FROM public.worker_runtime_health
    WHERE execution_class='tenant' AND observed_at < now() - interval '7 days';
  INSERT INTO public.worker_runtime_health(worker_id,execution_class,status,payload_json,started_at,observed_at)
  VALUES(p_worker_id,'tenant',p_status,p_payload_json,p_started_at,now())
  ON CONFLICT (worker_id) DO UPDATE
    SET status=excluded.status,payload_json=excluded.payload_json,
        started_at=excluded.started_at,observed_at=now()
    WHERE worker_runtime_health.execution_class='tenant';
END;
$$;
REVOKE ALL ON FUNCTION app.upsert_tenant_worker_health(text,text,text,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.upsert_platform_worker_health(
  p_worker_id text,
  p_status text,
  p_payload_json text,
  p_started_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF p_worker_id NOT LIKE 'platform:%' THEN
    RAISE EXCEPTION 'platform worker health id must use platform: namespace';
  END IF;
  DELETE FROM public.worker_runtime_health
    WHERE execution_class='platform' AND observed_at < now() - interval '7 days';
  INSERT INTO public.worker_runtime_health(worker_id,execution_class,status,payload_json,started_at,observed_at)
  VALUES(p_worker_id,'platform',p_status,p_payload_json,p_started_at,now())
  ON CONFLICT (worker_id) DO UPDATE
    SET status=excluded.status,payload_json=excluded.payload_json,
        started_at=excluded.started_at,observed_at=now()
    WHERE worker_runtime_health.execution_class='platform';
END;
$$;
REVOKE ALL ON FUNCTION app.upsert_platform_worker_health(text,text,text,timestamptz) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='univ_app_web') THEN
    GRANT SELECT ON worker_runtime_health TO univ_app_web;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='univ_job_worker') THEN
    REVOKE ALL ON worker_runtime_health FROM univ_job_worker;
    GRANT USAGE ON SCHEMA app TO univ_job_worker;
    GRANT EXECUTE ON FUNCTION app.upsert_tenant_worker_health(text,text,text,timestamptz) TO univ_job_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='univ_platform_worker') THEN
    REVOKE INSERT,UPDATE,DELETE ON worker_runtime_health FROM univ_platform_worker;
    GRANT EXECUTE ON FUNCTION app.upsert_platform_worker_health(text,text,text,timestamptz) TO univ_platform_worker;
  END IF;
END $$;
