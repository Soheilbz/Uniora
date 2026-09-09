-- Production hardening: scalable audit reads and durable background exports.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    app.fold_text(
      coalesce(entity_id, '') || ' ' ||
      coalesce(action, '') || ' ' ||
      coalesce(entity_type, '') || ' ' ||
      coalesce(subject_id, '') || ' ' ||
      coalesce(request_id, '') || ' ' ||
      coalesce(changes, '')
    )
  ) STORED;
CREATE INDEX IF NOT EXISTS audit_tenant_time_id_idx
  ON audit_log(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_search_idx
  ON audit_log USING gin(search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  requested_by text NOT NULL,
  kind text NOT NULL,
  request_hash text NOT NULL,
  parameters text NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  artifact_path text,
  artifact_sha256 text,
  row_count integer,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_jobs_requester_tenant_fk FOREIGN KEY (tenant_id,requested_by)
    REFERENCES "user"(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT export_jobs_kind_check CHECK (kind IN ('students','tenant-portability')),
  CONSTRAINT export_jobs_status_check CHECK (status IN ('queued','running','completed','failed','expired')),
  CONSTRAINT export_jobs_row_count_check CHECK (row_count IS NULL OR row_count >= 0)
);
CREATE INDEX IF NOT EXISTS export_jobs_queue_idx ON export_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS export_jobs_tenant_requester_idx ON export_jobs(tenant_id,requested_by,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_active_dedupe_idx
  ON export_jobs(tenant_id,requested_by,kind,request_hash)
  WHERE status IN ('queued','running');
