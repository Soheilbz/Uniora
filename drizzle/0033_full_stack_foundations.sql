-- Additive modular-monolith foundations. No legacy column is dropped in this migration.
-- Existing text fields remain historical snapshots while canonical identities are added beside them.

-- Legacy tables predate the tenant-scoped foreign-key convention used below.
-- Establish the composite uniqueness they need before any new table references
-- `(tenant_id,id)`. The data audit confirmed these pairs are already unique.
CREATE UNIQUE INDEX IF NOT EXISTS students_tenant_id_idx ON students(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS professors_tenant_id_idx ON professors(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS council_decisions_tenant_id_idx ON council_decisions(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workshops_tenant_id_idx ON workshops(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS professor_capacities_tenant_id_idx ON professor_capacities(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_tenant_id_idx ON saved_views(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_id_idx ON roles(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_tenant_id_idx ON "user"(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS academic_years (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL, label text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT academic_years_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT academic_years_status_check CHECK (status IN ('planned','active','closed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS academic_years_tenant_code_idx ON academic_years(tenant_id,code) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS academic_years_tenant_id_idx ON academic_years(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS academic_years_tenant_dates_idx ON academic_years(tenant_id,starts_on,ends_on);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS academic_periods (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  academic_year_id uuid NOT NULL, code text NOT NULL, label text NOT NULL, kind text NOT NULL DEFAULT 'semester',
  starts_on date NOT NULL, ends_on date NOT NULL, position integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'planned',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT academic_periods_year_tenant_fk FOREIGN KEY (tenant_id,academic_year_id) REFERENCES academic_years(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT academic_periods_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT academic_periods_kind_check CHECK (kind IN ('semester','summer','annual','custom')),
  CONSTRAINT academic_periods_status_check CHECK (status IN ('planned','active','closed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS academic_periods_tenant_code_idx ON academic_periods(tenant_id,code) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS academic_periods_tenant_id_idx ON academic_periods(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS academic_periods_tenant_year_idx ON academic_periods(tenant_id,academic_year_id,position);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS organization_units (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  parent_id uuid, type text NOT NULL, code text NOT NULL, name text NOT NULL, name_en text,
  valid_from date NOT NULL, valid_to date, status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT organization_units_tenant_id_key UNIQUE (tenant_id,id),
  CONSTRAINT organization_units_parent_tenant_fk FOREIGN KEY (tenant_id,parent_id) REFERENCES organization_units(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT organization_units_type_check CHECK (type IN ('university','faculty','department','center','institute','office','other')),
  CONSTRAINT organization_units_status_check CHECK (status IN ('active','inactive','merged','closed')),
  CONSTRAINT organization_units_dates_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS organization_units_tenant_code_idx ON organization_units(tenant_id,code) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS organization_units_tenant_id_idx ON organization_units(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS organization_units_tenant_parent_idx ON organization_units(tenant_id,parent_id,type);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS organization_unit_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  organization_unit_id uuid NOT NULL, version_no integer NOT NULL, code_snapshot text NOT NULL, name_snapshot text NOT NULL,
  parent_name_snapshot text, valid_from date NOT NULL, valid_to date, reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_unit_versions_unit_tenant_fk FOREIGN KEY (tenant_id,organization_unit_id) REFERENCES organization_units(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT organization_unit_versions_dates_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS organization_unit_versions_tenant_unit_version_idx ON organization_unit_versions(tenant_id,organization_unit_id,version_no);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS academic_programs (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  department_id uuid NOT NULL, code text NOT NULL, name text NOT NULL, degree_level text NOT NULL, field text NOT NULL, orientation text,
  valid_from date NOT NULL, valid_to date, status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT academic_programs_department_tenant_fk FOREIGN KEY (tenant_id,department_id) REFERENCES organization_units(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT academic_programs_dates_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT academic_programs_status_check CHECK (status IN ('active','inactive','retired'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS academic_programs_tenant_code_idx ON academic_programs(tenant_id,code) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS academic_programs_tenant_id_idx ON academic_programs(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS academic_programs_department_idx ON academic_programs(tenant_id,department_id,degree_level);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS student_supervision_assignments (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL, professor_id uuid NOT NULL, role text NOT NULL, valid_from date NOT NULL, valid_to date,
  source_decision_id uuid, professor_name_snapshot text NOT NULL, department_name_snapshot text,
  status text NOT NULL DEFAULT 'active', notes text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supervision_assignments_student_tenant_fk FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT supervision_assignments_professor_tenant_fk FOREIGN KEY (tenant_id,professor_id) REFERENCES professors(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT supervision_assignments_role_check CHECK (role IN ('primary_supervisor','secondary_supervisor','third_supervisor','advisor')),
  CONSTRAINT supervision_assignments_dates_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT supervision_assignments_status_check CHECK (status IN ('active','ended','cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS supervision_assignments_tenant_id_idx ON student_supervision_assignments(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS supervision_assignments_student_timeline_idx ON student_supervision_assignments(tenant_id,student_id,valid_from);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS supervision_assignments_professor_timeline_idx ON student_supervision_assignments(tenant_id,professor_id,valid_from);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL, entity_id text NOT NULL, object_key text NOT NULL, filename text NOT NULL, mime_type text NOT NULL,
  size_bytes bigint NOT NULL, sha256 text, uploaded_by text NOT NULL, classification text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'quarantine', version integer NOT NULL DEFAULT 1, scan_provider text, scan_result text,
  scanned_at timestamptz, available_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT attachments_uploader_tenant_fk FOREIGN KEY (tenant_id,uploaded_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT attachments_size_check CHECK (size_bytes >= 0),
  CONSTRAINT attachments_classification_check CHECK (classification IN ('public','internal','confidential','restricted')),
  CONSTRAINT attachments_status_check CHECK (status IN ('quarantine','scanning','available','rejected','superseded','deleted'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS attachments_tenant_object_key_idx ON attachments(tenant_id,object_key);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS attachments_tenant_id_idx ON attachments(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments(tenant_id,entity_type,entity_id,created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  document_type text NOT NULL, document_id text NOT NULL, version_no integer NOT NULL, attachment_id uuid,
  content_sha256 text NOT NULL, status text NOT NULL DEFAULT 'draft', supersedes_version_id uuid,
  finalized_at timestamptz, finalized_by text, finalization_reason text, signature_provider text, signature_reference text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_versions_attachment_tenant_fk FOREIGN KEY (tenant_id,attachment_id) REFERENCES attachments(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT document_versions_finalizer_tenant_fk FOREIGN KEY (tenant_id,finalized_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT document_versions_version_check CHECK (version_no > 0),
  CONSTRAINT document_versions_status_check CHECK (status IN ('draft','finalized','superseded','void'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_tenant_doc_version_idx ON document_versions(tenant_id,document_type,document_id,version_no);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS document_versions_tenant_id_idx ON document_versions(tenant_id,id);--> statement-breakpoint
ALTER TABLE document_versions ADD CONSTRAINT document_versions_supersedes_tenant_fk FOREIGN KEY (tenant_id,supersedes_version_id) REFERENCES document_versions(tenant_id,id) ON DELETE RESTRICT;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS document_sequences (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  document_type text NOT NULL, year integer NOT NULL, prefix text NOT NULL DEFAULT '', next_number integer NOT NULL DEFAULT 1,
  format text NOT NULL DEFAULT '{prefix}{year}/{number}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_sequences_next_number_check CHECK (next_number > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS document_sequences_tenant_type_year_idx ON document_sequences(tenant_id,document_type,year);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS correspondence (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  direction text NOT NULL, number text, subject text NOT NULL, body text, sender text, received_on date, sent_on date,
  due_at timestamptz, status text NOT NULL DEFAULT 'draft', classification text NOT NULL DEFAULT 'internal',
  created_by text NOT NULL, finalized_version_id uuid, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT correspondence_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT correspondence_final_version_tenant_fk FOREIGN KEY (tenant_id,finalized_version_id) REFERENCES document_versions(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT correspondence_direction_check CHECK (direction IN ('incoming','outgoing','internal')),
  CONSTRAINT correspondence_status_check CHECK (status IN ('draft','registered','referred','closed','cancelled')),
  CONSTRAINT correspondence_classification_check CHECK (classification IN ('public','internal','confidential','restricted'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS correspondence_tenant_id_idx ON correspondence(tenant_id,id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS correspondence_tenant_number_idx ON correspondence(tenant_id,number) WHERE number IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS correspondence_status_due_idx ON correspondence(tenant_id,status,due_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS correspondence_recipients (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  correspondence_id uuid NOT NULL, recipient_type text NOT NULL DEFAULT 'text', recipient_id text,
  recipient_label text NOT NULL, role text NOT NULL DEFAULT 'to', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correspondence_recipients_message_tenant_fk FOREIGN KEY (tenant_id,correspondence_id) REFERENCES correspondence(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT correspondence_recipient_role_check CHECK (role IN ('to','cc','bcc','referral'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS correspondence_recipients_message_idx ON correspondence_recipients(tenant_id,correspondence_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  title text NOT NULL, description text, entity_type text, entity_id text, assigned_to text, assigned_role_id uuid,
  due_at timestamptz, priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open', created_by text NOT NULL,
  completed_at timestamptz, completed_by text, source_event_id uuid, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT tasks_assignee_tenant_fk FOREIGN KEY (tenant_id,assigned_to) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT tasks_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT tasks_completer_tenant_fk FOREIGN KEY (tenant_id,completed_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT tasks_priority_check CHECK (priority IN ('low','normal','high','critical')),
  CONSTRAINT tasks_status_check CHECK (status IN ('open','in_progress','blocked','completed','cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tasks_tenant_id_idx ON tasks(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_assignee_status_due_idx ON tasks(tenant_id,assigned_to,status,due_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_entity_idx ON tasks(tenant_id,entity_type,entity_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS task_transitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL, actor_id text NOT NULL, from_status text, to_status text NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_transitions_task_tenant_fk FOREIGN KEY (tenant_id,task_id) REFERENCES tasks(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT task_transitions_actor_tenant_fk FOREIGN KEY (tenant_id,actor_id) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_transitions_task_idx ON task_transitions(tenant_id,task_id,created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id text NOT NULL, kind text NOT NULL, title text NOT NULL, body text, href text, severity text NOT NULL DEFAULT 'info',
  source_event_id uuid, read_at timestamptz, dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT notifications_severity_check CHECK (severity IN ('info','success','warning','error'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(tenant_id,user_id,read_at,created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL, kind text NOT NULL, schedule text NOT NULL, timezone text NOT NULL DEFAULT 'UTC', payload text NOT NULL DEFAULT '{}',
  enabled text NOT NULL DEFAULT 'true', next_run_at timestamptz, last_run_at timestamptz, created_by text NOT NULL,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT scheduled_jobs_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT scheduled_jobs_enabled_check CHECK (enabled IN ('true','false'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_tenant_name_idx ON scheduled_jobs(tenant_id,name) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx ON scheduled_jobs(enabled,next_run_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS regulation_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  regulation_code text NOT NULL, version_code text NOT NULL, title text NOT NULL, effective_from date NOT NULL, effective_to date,
  publication_reference text, approved_by text, rules_json text NOT NULL, rules_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'draft', published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regulation_versions_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT regulation_versions_status_check CHECK (status IN ('draft','published','retired'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS regulation_versions_tenant_code_version_idx ON regulation_versions(tenant_id,regulation_code,version_code);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS regulation_versions_tenant_id_idx ON regulation_versions(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS decision_template_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  template_code text NOT NULL, version_no integer NOT NULL, title text NOT NULL, body_template text NOT NULL, schema_json text NOT NULL DEFAULT '{}',
  content_sha256 text NOT NULL, status text NOT NULL DEFAULT 'draft', published_at timestamptz, retired_at timestamptz, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_template_versions_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT decision_template_versions_version_check CHECK (version_no > 0),
  CONSTRAINT decision_template_versions_status_check CHECK (status IN ('draft','published','retired'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS decision_template_versions_tenant_code_version_idx ON decision_template_versions(tenant_id,template_code,version_no);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS decision_template_versions_tenant_id_idx ON decision_template_versions(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS quality_rules (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  code text NOT NULL, entity text NOT NULL, severity text NOT NULL DEFAULT 'warning', enabled text NOT NULL DEFAULT 'true',
  owner_capability text, description text NOT NULL, remediation_route text, evaluator text NOT NULL, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT quality_rules_severity_check CHECK (severity IN ('info','warning','error','critical')),
  CONSTRAINT quality_rules_enabled_check CHECK (enabled IN ('true','false'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quality_rules_tenant_code_idx ON quality_rules(tenant_id,code) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quality_rules_tenant_id_idx ON quality_rules(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS quality_snapshots (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rule_id uuid NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(), count integer NOT NULL, sample_entity_ids text NOT NULL DEFAULT '[]', duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quality_snapshots_rule_tenant_fk FOREIGN KEY (tenant_id,rule_id) REFERENCES quality_rules(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT quality_snapshots_count_check CHECK (count >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quality_snapshots_rule_time_idx ON quality_snapshots(tenant_id,rule_id,captured_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS retention_policies (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  resource text NOT NULL, retain_days integer NOT NULL, mode text NOT NULL DEFAULT 'purge', enabled text NOT NULL DEFAULT 'true', legal_hold text NOT NULL DEFAULT 'false',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_policies_days_check CHECK (retain_days >= 1),
  CONSTRAINT retention_policies_mode_check CHECK (mode IN ('purge','archive')),
  CONSTRAINT retention_policies_enabled_check CHECK (enabled IN ('true','false')),
  CONSTRAINT retention_policies_hold_check CHECK (legal_hold IN ('true','false'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS retention_policies_tenant_resource_idx ON retention_policies(tenant_id,resource);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS pii_access_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, field text NOT NULL, purpose text, request_id text,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pii_access_log_actor_tenant_fk FOREIGN KEY (tenant_id,actor_id) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pii_access_log_entity_idx ON pii_access_log(tenant_id,entity_type,entity_id,accessed_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pii_access_log_actor_idx ON pii_access_log(tenant_id,actor_id,accessed_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS break_glass_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  platform_operator_id text NOT NULL, platform_session_id text NOT NULL, reason text NOT NULL, approved_by text, starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  ended_at timestamptz, tenant_notified_at timestamptz, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT break_glass_platform_operator_fk FOREIGN KEY (platform_operator_id) REFERENCES platform_operators(user_id) ON DELETE NO ACTION,
  CONSTRAINT break_glass_platform_session_fk FOREIGN KEY (platform_session_id) REFERENCES session(id) ON DELETE CASCADE,
  CONSTRAINT break_glass_approver_tenant_fk FOREIGN KEY (tenant_id,approved_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT break_glass_status_check CHECK (status IN ('active','expired','ended','revoked')),
  CONSTRAINT break_glass_duration_check CHECK (expires_at > starts_at),
  CONSTRAINT break_glass_max_duration_check CHECK (expires_at <= starts_at + interval '30 minutes')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS break_glass_sessions_active_idx ON break_glass_sessions(tenant_id,platform_operator_id,status,expires_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS service_accounts (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL, description text, status text NOT NULL DEFAULT 'active', capabilities text NOT NULL DEFAULT '[]',
  token_hash text NOT NULL, token_prefix text NOT NULL, rate_limit_per_minute integer NOT NULL DEFAULT 120, expires_at timestamptz, last_used_at timestamptz, created_by text NOT NULL, rotated_at timestamptz,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT service_accounts_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT service_accounts_status_check CHECK (status IN ('active','suspended','revoked')),
  CONSTRAINT service_accounts_rate_limit_check CHECK (rate_limit_per_minute BETWEEN 10 AND 1000)
);--> statement-breakpoint
ALTER TABLE service_accounts ADD COLUMN IF NOT EXISTS rate_limit_per_minute integer NOT NULL DEFAULT 120;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='service_accounts_rate_limit_check') THEN
    ALTER TABLE service_accounts ADD CONSTRAINT service_accounts_rate_limit_check CHECK (rate_limit_per_minute BETWEEN 10 AND 1000);
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS service_accounts_tenant_name_idx ON service_accounts(tenant_id,name) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS service_accounts_token_hash_idx ON service_accounts(token_hash);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS service_accounts_tenant_id_idx ON service_accounts(tenant_id,id);--> statement-breakpoint

-- Resolve a bearer token before a tenant context exists. The Web role receives
-- EXECUTE on this one narrow function, never SELECT across service_accounts.
-- It returns only an active account belonging to an active, fully provisioned
-- tenant and touches last_used_at at most once every five minutes.
CREATE OR REPLACE FUNCTION app.resolve_service_account(p_token_hash text)
RETURNS TABLE(
  tenant_id uuid,
  service_account_id uuid,
  name text,
  capabilities text,
  rate_limit_per_minute integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RETURN;
  END IF;

  SELECT sa.id
    INTO v_id
    FROM public.service_accounts sa
    JOIN public.tenants t ON t.id = sa.tenant_id
   WHERE sa.token_hash = p_token_hash
     AND sa.status = 'active'
     AND sa.deleted_at IS NULL
     AND (sa.expires_at IS NULL OR sa.expires_at > clock_timestamp())
     AND t.status = 'active'
     AND t.provisioning_status = 'active'
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.service_accounts
     SET last_used_at = clock_timestamp()
   WHERE id = v_id
     AND (last_used_at IS NULL OR last_used_at < clock_timestamp() - interval '5 minutes');

  RETURN QUERY
  SELECT sa.tenant_id, sa.id, sa.name, sa.capabilities, sa.rate_limit_per_minute
    FROM public.service_accounts sa
   WHERE sa.id = v_id;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_service_account(text) FROM PUBLIC;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type text NOT NULL, aggregate_type text NOT NULL, aggregate_id text NOT NULL, payload text NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  attempt integer NOT NULL DEFAULT 0, last_error text, correlation_id text, causation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_attempt_check CHECK (attempt >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_tenant_id_idx ON outbox_events(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx ON outbox_events(published_at,available_at,created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_events_aggregate_idx ON outbox_events(tenant_id,aggregate_type,aggregate_id,occurred_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name text NOT NULL, endpoint text NOT NULL, event_types text NOT NULL DEFAULT '[]', secret_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'active', created_by text NOT NULL, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT webhook_subscriptions_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT webhook_subscriptions_status_check CHECK (status IN ('active','paused','disabled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS webhook_subscriptions_tenant_name_idx ON webhook_subscriptions(tenant_id,name) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS webhook_subscriptions_tenant_id_idx ON webhook_subscriptions(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL, event_id uuid NOT NULL, status text NOT NULL DEFAULT 'queued', attempt integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz, delivered_at timestamptz, response_status integer, response_excerpt text, error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_subscription_tenant_fk FOREIGN KEY (tenant_id,subscription_id) REFERENCES webhook_subscriptions(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT webhook_deliveries_event_tenant_fk FOREIGN KEY (tenant_id,event_id) REFERENCES outbox_events(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('queued','delivering','delivered','retry','dead_letter'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_event_subscription_idx ON webhook_deliveries(tenant_id,subscription_id,event_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS webhook_deliveries_queue_idx ON webhook_deliveries(status,next_attempt_at,created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind text NOT NULL, name text NOT NULL, config_encrypted text NOT NULL, status text NOT NULL DEFAULT 'disabled', last_sync_at timestamptz, last_error text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT integration_connections_kind_check CHECK (kind IN ('sis','hr','finance','identity_oidc','identity_saml','identity_ldap','scim','signing','storage','antivirus','other')),
  CONSTRAINT integration_connections_status_check CHECK (status IN ('disabled','active','error'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_tenant_kind_name_idx ON integration_connections(tenant_id,kind,name) WHERE deleted_at IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS attention_summary (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id text NOT NULL, category text NOT NULL, count integer NOT NULL DEFAULT 0, payload text NOT NULL DEFAULT '{}', last_calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attention_summary_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT attention_summary_count_check CHECK (count >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS attention_summary_tenant_user_category_idx ON attention_summary(tenant_id,user_id,category);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS search_documents (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL, entity_id text NOT NULL, title text NOT NULL, subtitle text, href text NOT NULL,
  search_text text NOT NULL, visibility_capability text, source_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS search_documents_tenant_entity_idx ON search_documents(tenant_id,entity_type,entity_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS search_documents_tenant_type_idx ON search_documents(tenant_id,entity_type,source_updated_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS search_documents_search_idx ON search_documents USING gin(search_text gin_trgm_ops);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS tenant_features (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  feature text NOT NULL, enabled text NOT NULL DEFAULT 'false', config text NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_features_enabled_check CHECK (enabled IN ('true','false'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tenant_features_tenant_feature_idx ON tenant_features(tenant_id,feature);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL, key text NOT NULL, label text NOT NULL, data_type text NOT NULL, required text NOT NULL DEFAULT 'false',
  options_json text NOT NULL DEFAULT '[]', position integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT custom_field_definitions_type_check CHECK (data_type IN ('text','number','date','boolean','select','multiselect')),
  CONSTRAINT custom_field_definitions_entity_check CHECK (entity_type IN ('student','professor','workshop','research_project','correspondence')),
  CONSTRAINT custom_field_definitions_key_check CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT custom_field_definitions_required_check CHECK (required IN ('true','false')),
  CONSTRAINT custom_field_definitions_status_check CHECK (status IN ('active','retired'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_definitions_tenant_entity_key_idx ON custom_field_definitions(tenant_id,entity_type,key) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_definitions_tenant_id_idx ON custom_field_definitions(tenant_id,id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS custom_field_values (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  definition_id uuid NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, value_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_field_values_definition_tenant_fk FOREIGN KEY (tenant_id,definition_id) REFERENCES custom_field_definitions(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT custom_field_values_entity_check CHECK (entity_type IN ('student','professor','workshop','research_project','correspondence'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_values_tenant_definition_entity_idx ON custom_field_values(tenant_id,definition_id,entity_type,entity_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS custom_field_values_entity_idx ON custom_field_values(tenant_id,entity_type,entity_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_record_pins (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, label_snapshot text NOT NULL, href text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_record_pins_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_record_pins_owner_entity_idx ON user_record_pins(tenant_id,user_id,entity_type,entity_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_record_pins_owner_time_idx ON user_record_pins(tenant_id,user_id,updated_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS recent_records (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, label_snapshot text NOT NULL, href text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recent_records_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS recent_records_owner_entity_idx ON recent_records(tenant_id,user_id,entity_type,entity_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recent_records_owner_time_idx ON recent_records(tenant_id,user_id,opened_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS research_projects (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  project_code text NOT NULL, title text NOT NULL, principal_investigator_id uuid, principal_investigator_snapshot text NOT NULL,
  collaborators_json text NOT NULL DEFAULT '[]', budget numeric(20,2), currency text NOT NULL DEFAULT 'IRR', funding_source text,
  starts_on date, ends_on date, status text NOT NULL DEFAULT 'draft', council_decision_id uuid, outputs_json text NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT research_projects_pi_tenant_fk FOREIGN KEY (tenant_id,principal_investigator_id) REFERENCES professors(tenant_id,id) ON DELETE NO ACTION,
  CONSTRAINT research_projects_status_check CHECK (status IN ('draft','proposed','approved','active','completed','cancelled')),
  CONSTRAINT research_projects_dates_check CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS research_projects_tenant_code_idx ON research_projects(tenant_id,project_code) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS research_projects_tenant_id_idx ON research_projects(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS research_projects_status_idx ON research_projects(tenant_id,status,starts_on);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind text NOT NULL, execution_class text NOT NULL DEFAULT 'tenant', status text NOT NULL DEFAULT 'queued', payload text NOT NULL DEFAULT '{}',
  requested_by text NOT NULL, dedupe_key text, attempt integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
  lease_until timestamptz, heartbeat_at timestamptz, scheduled_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz,
  completed_at timestamptz, error_code text, public_error text, private_error text, result text, correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_requester_tenant_fk FOREIGN KEY (tenant_id,requested_by) REFERENCES "user"(tenant_id,id) ON DELETE RESTRICT,
  CONSTRAINT jobs_execution_class_check CHECK (execution_class IN ('tenant','platform')),
  CONSTRAINT jobs_status_check CHECK (status IN ('queued','running','retry','completed','failed','cancelled','expired')),
  CONSTRAINT jobs_attempt_check CHECK (attempt >= 0), CONSTRAINT jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 20)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS jobs_tenant_id_idx ON jobs(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(execution_class,status,scheduled_at,created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs(execution_class,status,lease_until);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_requester_idx ON jobs(tenant_id,requested_by,created_at);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_dedupe_idx ON jobs(tenant_id,kind,dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running','retry');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS job_attempts (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL, attempt integer NOT NULL, worker_id text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  outcome text, error_code text, error_detail text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_attempts_job_tenant_fk FOREIGN KEY (tenant_id,job_id) REFERENCES jobs(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT job_attempts_attempt_check CHECK (attempt > 0),
  CONSTRAINT job_attempts_outcome_check CHECK (outcome IS NULL OR outcome IN ('completed','retry','failed','cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS job_attempts_job_attempt_idx ON job_attempts(tenant_id,job_id,attempt);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_attempts_job_idx ON job_attempts(tenant_id,job_id,started_at);--> statement-breakpoint

-- Backward-compatible canonical links on existing records.
ALTER TABLE students ADD COLUMN IF NOT EXISTS organization_unit_id uuid;--> statement-breakpoint
ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_program_id uuid;--> statement-breakpoint
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_period_id uuid;--> statement-breakpoint
ALTER TABLE professors ADD COLUMN IF NOT EXISTS organization_unit_id uuid;--> statement-breakpoint
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS academic_period_id uuid;--> statement-breakpoint
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS public_registration text NOT NULL DEFAULT 'false';--> statement-breakpoint
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS public_slug text;--> statement-breakpoint
ALTER TABLE workshops ADD COLUMN IF NOT EXISTS registration_closes_at date;--> statement-breakpoint
ALTER TABLE council_decisions ADD COLUMN IF NOT EXISTS academic_period_id uuid;--> statement-breakpoint
ALTER TABLE council_decisions ADD COLUMN IF NOT EXISTS template_version_id uuid;--> statement-breakpoint
ALTER TABLE council_decisions ADD COLUMN IF NOT EXISTS workflow_state text NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE council_decisions ADD COLUMN IF NOT EXISTS finalized_version_id uuid;--> statement-breakpoint
ALTER TABLE professor_capacities ADD COLUMN IF NOT EXISTS regulation_version_id uuid;--> statement-breakpoint
ALTER TABLE professor_capacities ADD COLUMN IF NOT EXISTS academic_year_id uuid;--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'private';--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS published_by text;--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS audience_role_id uuid;--> statement-breakpoint

ALTER TABLE students ADD CONSTRAINT students_organization_unit_tenant_fk FOREIGN KEY (tenant_id,organization_unit_id) REFERENCES organization_units(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE students ADD CONSTRAINT students_academic_program_tenant_fk FOREIGN KEY (tenant_id,academic_program_id) REFERENCES academic_programs(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE students ADD CONSTRAINT students_admission_period_tenant_fk FOREIGN KEY (tenant_id,admission_period_id) REFERENCES academic_periods(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE professors ADD CONSTRAINT professors_organization_unit_tenant_fk FOREIGN KEY (tenant_id,organization_unit_id) REFERENCES organization_units(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE workshops ADD CONSTRAINT workshops_academic_period_tenant_fk FOREIGN KEY (tenant_id,academic_period_id) REFERENCES academic_periods(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE council_decisions ADD CONSTRAINT decisions_academic_period_tenant_fk FOREIGN KEY (tenant_id,academic_period_id) REFERENCES academic_periods(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE council_decisions ADD CONSTRAINT decisions_template_version_tenant_fk FOREIGN KEY (tenant_id,template_version_id) REFERENCES decision_template_versions(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE council_decisions ADD CONSTRAINT decisions_finalized_version_tenant_fk FOREIGN KEY (tenant_id,finalized_version_id) REFERENCES document_versions(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE professor_capacities ADD CONSTRAINT capacities_regulation_version_tenant_fk FOREIGN KEY (tenant_id,regulation_version_id) REFERENCES regulation_versions(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE professor_capacities ADD CONSTRAINT capacities_academic_year_tenant_fk FOREIGN KEY (tenant_id,academic_year_id) REFERENCES academic_years(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE saved_views ADD CONSTRAINT saved_views_publisher_tenant_fk FOREIGN KEY (tenant_id,published_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION;--> statement-breakpoint
ALTER TABLE saved_views ADD CONSTRAINT saved_views_audience_role_tenant_fk FOREIGN KEY (tenant_id,audience_role_id) REFERENCES roles(tenant_id,id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE workshops ADD CONSTRAINT workshops_public_registration_check CHECK (public_registration IN ('true','false'));--> statement-breakpoint
ALTER TABLE council_decisions ADD CONSTRAINT council_decisions_workflow_state_check CHECK (workflow_state IN ('draft','submitted','administrative_review','ready_for_council','council_reviewed','approved','revision_required','rejected','finalized'));--> statement-breakpoint
ALTER TABLE saved_views ADD CONSTRAINT saved_views_scope_check CHECK (scope IN ('private','team','tenant'));--> statement-breakpoint
ALTER TABLE saved_views ADD CONSTRAINT saved_views_scope_audience_check CHECK ((scope = 'team' AND audience_role_id IS NOT NULL) OR (scope <> 'team' AND audience_role_id IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workshops_tenant_public_slug_idx ON workshops(tenant_id,public_slug) WHERE public_slug IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint

-- Unified search/read-model refresh helper. Projections may also be maintained from outbox events.
CREATE OR REPLACE FUNCTION app.refresh_search_documents(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  DELETE FROM search_documents WHERE tenant_id=p_tenant;
  INSERT INTO search_documents(tenant_id,entity_type,entity_id,title,subtitle,href,search_text,visibility_capability,source_updated_at)
  SELECT tenant_id,'students',id::text,(first_name || ' ' || last_name),coalesce(student_number,''),('/students/' || id),search_text,'students.view',updated_at
    FROM students WHERE tenant_id=p_tenant AND deleted_at IS NULL;
  INSERT INTO search_documents(tenant_id,entity_type,entity_id,title,subtitle,href,search_text,visibility_capability,source_updated_at)
  SELECT tenant_id,'professors',id::text,(first_name || ' ' || last_name),coalesce(professor_code,''),('/professors/' || id),search_text,'professors.view',updated_at
    FROM professors WHERE tenant_id=p_tenant AND deleted_at IS NULL;
  INSERT INTO search_documents(tenant_id,entity_type,entity_id,title,subtitle,href,search_text,visibility_capability,source_updated_at)
  SELECT tenant_id,'councilMeetings',id::text,meeting_number,concat_ws(' — ',meeting_date::text,nullif(research_deputy,'')),('/council-meetings/' || id),search_text,'council.view',updated_at
    FROM council_meetings WHERE tenant_id=p_tenant AND deleted_at IS NULL;
  INSERT INTO search_documents(tenant_id,entity_type,entity_id,title,subtitle,href,search_text,visibility_capability,source_updated_at)
  SELECT tenant_id,'councilDecisions',id::text,coalesce(nullif(student_name,''),nullif(thesis_title,''),meeting_number,'Council decision'),concat_ws(' — ',nullif(meeting_number,''),meeting_date::text,nullif(student_number,''),nullif(thesis_title,'')),('/council-decisions/' || id),search_text,'council.view',updated_at
    FROM council_decisions WHERE tenant_id=p_tenant AND deleted_at IS NULL;
  INSERT INTO search_documents(tenant_id,entity_type,entity_id,title,subtitle,href,search_text,visibility_capability,source_updated_at)
  SELECT tenant_id,'workshops',id::text,title,coalesce(workshop_date::text,''),('/workshops/' || id),search_text,'workshops.view',updated_at
    FROM workshops WHERE tenant_id=p_tenant AND deleted_at IS NULL;
END $$;--> statement-breakpoint

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS council_decision_transitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  decision_id uuid NOT NULL, from_state text NOT NULL, to_state text NOT NULL, reason text, actor_id text NOT NULL,
  correlation_id text, occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT council_transition_decision_tenant_fk FOREIGN KEY (tenant_id,decision_id) REFERENCES council_decisions(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT council_transition_actor_tenant_fk FOREIGN KEY (tenant_id,actor_id) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS council_transition_decision_idx ON council_decision_transitions(tenant_id,decision_id,occurred_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS import_mapping_profiles (
 id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, entity_type text NOT NULL, name text NOT NULL,
 mapping_json text NOT NULL DEFAULT '{}', match_strategy_json text NOT NULL DEFAULT '{}', created_by text NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CONSTRAINT import_mapping_profiles_creator_tenant_fk FOREIGN KEY (tenant_id,created_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS import_mapping_profiles_tenant_entity_name_idx ON import_mapping_profiles(tenant_id,entity_type,name) WHERE deleted_at IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS workshop_registrations (
 id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, workshop_id uuid NOT NULL,
 full_name text NOT NULL, email text, phone text, external_reference text, identity_key text, participant_id uuid,
 status text NOT NULL DEFAULT 'pending', source text NOT NULL DEFAULT 'public',
 consent_at timestamptz NOT NULL DEFAULT now(), approved_by text, approved_at timestamptz, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CONSTRAINT workshop_registrations_workshop_tenant_fk FOREIGN KEY (tenant_id,workshop_id) REFERENCES workshops(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT workshop_registrations_approver_tenant_fk FOREIGN KEY (tenant_id,approved_by) REFERENCES "user"(tenant_id,id) ON DELETE NO ACTION,
 CONSTRAINT workshop_registrations_participant_tenant_fk FOREIGN KEY (tenant_id,participant_id) REFERENCES workshop_participants(tenant_id,id) ON DELETE NO ACTION,
 CONSTRAINT workshop_registrations_status_check CHECK (status IN ('pending','approved','rejected','cancelled','attended')),
 CONSTRAINT workshop_registrations_source_check CHECK (source IN ('public','staff','integration'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workshop_registrations_tenant_id_idx ON workshop_registrations(tenant_id,id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workshop_registrations_workshop_status_idx ON workshop_registrations(tenant_id,workshop_id,status,created_at);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workshop_registrations_active_identity_idx ON workshop_registrations(tenant_id,workshop_id,identity_key) WHERE deleted_at IS NULL AND identity_key IS NOT NULL AND status IN ('pending','approved','attended');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workshop_registrations_participant_idx ON workshop_registrations(tenant_id,participant_id) WHERE participant_id IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS portal_links (
 id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, user_id text NOT NULL, subject_type text NOT NULL,
 student_id uuid, professor_id uuid, status text NOT NULL DEFAULT 'active', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CONSTRAINT portal_links_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT portal_links_student_tenant_fk FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT portal_links_professor_tenant_fk FOREIGN KEY (tenant_id,professor_id) REFERENCES professors(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT portal_links_subject_type_check CHECK (subject_type IN ('student','professor')),
 CONSTRAINT portal_links_status_check CHECK (status IN ('active','suspended','revoked')),
 CONSTRAINT portal_links_subject_check CHECK ((subject_type='student' AND student_id IS NOT NULL AND professor_id IS NULL) OR (subject_type='professor' AND professor_id IS NOT NULL AND student_id IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS portal_links_tenant_user_subject_idx ON portal_links(tenant_id,user_id,subject_type) WHERE deleted_at IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS passkey (
 id text PRIMARY KEY NOT NULL, name text, public_key text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 credential_id text NOT NULL, counter integer NOT NULL DEFAULT 0, device_type text NOT NULL, backed_up boolean NOT NULL DEFAULT false,
 transports text, created_at timestamptz NOT NULL DEFAULT now(), aaguid text,
 CONSTRAINT passkey_counter_check CHECK (counter >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS passkey_credential_idx ON passkey(credential_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS passkey_user_idx ON passkey(user_id,created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS api_rate_windows (
 id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, service_account_id uuid NOT NULL,
 window_started_at timestamptz NOT NULL, request_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT api_rate_windows_account_tenant_fk FOREIGN KEY (tenant_id,service_account_id) REFERENCES service_accounts(tenant_id,id) ON DELETE CASCADE,
 CONSTRAINT api_rate_windows_count_check CHECK (request_count >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS api_rate_windows_account_window_idx ON api_rate_windows(tenant_id,service_account_id,window_started_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS reporting_snapshots (
 id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT, projection text NOT NULL, period_key text NOT NULL DEFAULT 'current',
 payload_json text NOT NULL DEFAULT '{}', source_max_updated_at timestamptz, calculated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS reporting_snapshots_projection_idx ON reporting_snapshots(tenant_id,projection,period_key);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reporting_snapshots_time_idx ON reporting_snapshots(tenant_id,calculated_at);--> statement-breakpoint

--> statement-breakpoint
INSERT INTO document_sequences(tenant_id,document_type,year,prefix,next_number,format)
SELECT tenant_id,'workshop-certificate',app.jalali_year(issue_date),'W',
       coalesce(max(nullif(substring(certificate_number from '[0-9]+$'),'')::int),0)+1,
       'W{year}-{number:3}'
  FROM workshop_certificates
 WHERE deleted_at IS NULL
 GROUP BY tenant_id,app.jalali_year(issue_date)
ON CONFLICT (tenant_id,document_type,year)
DO UPDATE SET next_number=greatest(document_sequences.next_number,excluded.next_number),updated_at=now();
CREATE INDEX IF NOT EXISTS saved_views_audience_idx ON saved_views (tenant_id,register,scope,audience_role_id);--> statement-breakpoint

-- Preserve existing-tenant intent when the expanded capability vocabulary becomes finer-grained.
INSERT INTO role_capabilities (role_id, capability)
SELECT rc.role_id, 'students.sensitive.read'
FROM role_capabilities rc
WHERE rc.capability = 'students.nationality'
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO role_capabilities (role_id, capability)
SELECT rc.role_id, 'professors.sensitive.read'
FROM role_capabilities rc
WHERE rc.capability = 'professors.manage'
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO role_capabilities (role_id, capability)
SELECT rc.role_id, 'professors.bank.read'
FROM role_capabilities rc
WHERE rc.capability = 'professors.manage'
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- System administrators retain administration coverage across additive platform surfaces.
INSERT INTO role_capabilities (role_id, capability)
SELECT r.id, capability
FROM roles r
CROSS JOIN unnest(ARRAY[
  'master-data.manage','documents.view','documents.manage','correspondence.view','correspondence.manage',
  'tasks.view','tasks.manage','notifications.manage','research-projects.view','research-projects.manage',
  'saved-views.publish','templates.manage','regulations.manage','features.manage','custom-fields.manage',
  'integrations.manage','api.manage','reports.schedule','retention.manage','security.break-glass','data.quality.manage'
]::text[]) AS capability
WHERE r.tier = 2
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- The seeded research-officer role receives the operational administration tools expected by the default model.
INSERT INTO role_capabilities (role_id, capability)
SELECT r.id, capability
FROM roles r
CROSS JOIN unnest(ARRAY[
  'master-data.manage','documents.view','documents.manage','correspondence.view','correspondence.manage',
  'tasks.view','tasks.manage','research-projects.view','research-projects.manage'
]::text[]) AS capability
WHERE r.key = 'research-officer'
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE platform_operation_requests DROP CONSTRAINT IF EXISTS platform_operation_requests_kind_check;--> statement-breakpoint
ALTER TABLE platform_operation_requests ADD CONSTRAINT platform_operation_requests_kind_check CHECK (kind IN ('tenant.create','tenant.rename','tenant.suspend','tenant.resume','tenant.archive','tenant.owner.set','tenant.user.create','break-glass.start','break-glass.end'));--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE council_rulings ADD COLUMN IF NOT EXISTS template_version_id uuid;
--> statement-breakpoint
ALTER TABLE council_rulings DROP CONSTRAINT IF EXISTS rulings_template_version_tenant_fk;
--> statement-breakpoint
ALTER TABLE council_rulings ADD CONSTRAINT rulings_template_version_tenant_fk FOREIGN KEY (tenant_id,template_version_id) REFERENCES decision_template_versions(tenant_id,id) ON DELETE NO ACTION;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS council_rulings_template_version_idx ON council_rulings(tenant_id,template_version_id) WHERE template_version_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS calendar_subscription_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_subscription_tokens_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS calendar_subscription_tokens_hash_idx ON calendar_subscription_tokens(token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS calendar_subscription_tokens_user_idx ON calendar_subscription_tokens(tenant_id,user_id,created_at);
--> statement-breakpoint
ALTER TABLE calendar_subscription_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calendar_subscription_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_calendar_subscription_tokens ON calendar_subscription_tokens;
DROP POLICY IF EXISTS tenant_isolation ON calendar_subscription_tokens;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON calendar_subscription_tokens USING (tenant_id=app.current_tenant()) WITH CHECK (tenant_id=app.current_tenant());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.resolve_calendar_subscription(p_token_hash text)
RETURNS TABLE(tenant_id uuid,user_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,app AS $$
BEGIN
  RETURN QUERY
  UPDATE public.calendar_subscription_tokens t
     SET last_used_at = CASE WHEN t.last_used_at IS NULL OR t.last_used_at < clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE t.last_used_at END,
         updated_at = CASE WHEN t.last_used_at IS NULL OR t.last_used_at < clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE t.updated_at END
   WHERE t.token_hash=p_token_hash
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at>clock_timestamp())
   RETURNING t.tenant_id,t.user_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_calendar_subscription(text) FROM PUBLIC;
