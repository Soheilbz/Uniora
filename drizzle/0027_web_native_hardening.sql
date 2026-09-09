-- Web-native multi-tenant security and operations hardening.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'active';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('active','suspended','archived'));
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_provisioning_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_provisioning_status_check CHECK (provisioning_status IN ('provisioning','active','failed'));

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_login_ip text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_login_user_agent text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS employment_start date;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS employment_end date;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS account_expires_at timestamptz;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mfa_secret_encrypted text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS mfa_pending_secret_encrypted text;
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_employment_dates_check;
ALTER TABLE "user" ADD CONSTRAINT user_employment_dates_check CHECK (employment_end IS NULL OR employment_start IS NULL OR employment_end >= employment_start);
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_mfa_consistency_check;
ALTER TABLE "user" ADD CONSTRAINT user_mfa_consistency_check CHECK (NOT mfa_enabled OR mfa_secret_encrypted IS NOT NULL);

-- Preserve the local login name, then namespace Better Auth's internal username.
UPDATE "user" u
SET display_username = lower(COALESCE(NULLIF(display_username,''), username))
WHERE tenant_id IS NOT NULL AND username IS NOT NULL;
UPDATE "user" u
SET username = length(t.slug)::text || '_' || t.slug || '_' || lower(u.display_username)
FROM tenants t
WHERE u.tenant_id=t.id AND u.display_username IS NOT NULL
  AND u.username IS DISTINCT FROM (length(t.slug)::text || '_' || t.slug || '_' || lower(u.display_username));
CREATE UNIQUE INDEX IF NOT EXISTS user_tenant_display_username_idx
  ON "user"(tenant_id, display_username)
  WHERE tenant_id IS NOT NULL AND display_username IS NOT NULL;

ALTER TABLE session ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;
ALTER TABLE session ADD COLUMN IF NOT EXISTS elevated_until timestamptz;
ALTER TABLE session ADD COLUMN IF NOT EXISTS mfa_failed_count integer NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN IF NOT EXISTS mfa_locked_until timestamptz;
ALTER TABLE session DROP CONSTRAINT IF EXISTS session_mfa_failed_count_check;
ALTER TABLE session ADD CONSTRAINT session_mfa_failed_count_check CHECK (mfa_failed_count BETWEEN 0 AND 20);


ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_tier_check;
ALTER TABLE roles ADD CONSTRAINT roles_tier_check CHECK (tier BETWEEN 0 AND 2);
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_id_idx ON roles(tenant_id,id);
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_id_roles_id_fk;
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_tenant_role_fk;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_tenant_role_fk
  FOREIGN KEY (tenant_id,role_id) REFERENCES roles(tenant_id,id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS tenant_owners (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_owner_tenant_user_fk FOREIGN KEY (tenant_id,user_id)
    REFERENCES "user"(tenant_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_owner_user_idx ON tenant_owners(tenant_id,user_id);
INSERT INTO tenant_owners(tenant_id,user_id)
SELECT r.tenant_id, min(ur.user_id)
FROM roles r JOIN user_roles ur ON ur.role_id=r.id AND ur.tenant_id=r.tenant_id
WHERE r.key='administrator'
GROUP BY r.tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE institutions ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Tehran';
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'fa';
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS calendar_system text NOT NULL DEFAULT 'jalali';
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS academic_year_start_month integer NOT NULL DEFAULT 7;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS require_admin_mfa boolean NOT NULL DEFAULT true;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS session_hours integer NOT NULL DEFAULT 8;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS password_min_length integer NOT NULL DEFAULT 12;
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_academic_month_check;
ALTER TABLE institutions ADD CONSTRAINT institutions_academic_month_check CHECK (academic_year_start_month BETWEEN 1 AND 12);
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_session_hours_check;
ALTER TABLE institutions ADD CONSTRAINT institutions_session_hours_check CHECK (session_hours BETWEEN 1 AND 24);
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_password_min_length_check;
ALTER TABLE institutions ADD CONSTRAINT institutions_password_min_length_check CHECK (password_min_length BETWEEN 12 AND 64);
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_locale_check;
ALTER TABLE institutions ADD CONSTRAINT institutions_locale_check CHECK (locale IN ('fa','en'));
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_calendar_check;
ALTER TABLE institutions ADD CONSTRAINT institutions_calendar_check CHECK (calendar_system IN ('jalali','gregorian'));

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS subject_id text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'success';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent text;

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  operator text NOT NULL,
  action text NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  target text,
  changes text,
  outcome text NOT NULL DEFAULT 'success',
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_time_idx ON platform_audit_log(created_at DESC);
ALTER TABLE platform_audit_log DROP CONSTRAINT IF EXISTS platform_audit_log_tenant_id_tenants_id_fk;
ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_log_tenant_id_tenants_id_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

-- Remove permissions that have no Web route or belong to platform operations.
DELETE FROM role_capabilities WHERE capability IN ('data.backup','education.view','education.manage','data.quality.manage','diagnostics.view','capacity.manage','worksheets.manage');

-- A dossier may return to council at a later stage, but the same stage in the
-- same sitting must not exist twice for one thesis/dissertation code. Keep the
-- predicate aligned with the import contract: records without a code remain
-- legal for manual filing, while coded records have a database-enforced natural
-- identity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM council_decisions
    WHERE deleted_at IS NULL
      AND report_category IS NOT NULL AND btrim(report_category) <> ''
      AND thesis_code IS NOT NULL AND btrim(thesis_code) <> ''
    GROUP BY tenant_id, meeting_number, report_category, thesis_code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce council decision identity: duplicate active rows exist for tenant + meeting_number + report_category + thesis_code';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS council_decision_identity_idx
  ON council_decisions(tenant_id, meeting_number, report_category, thesis_code)
  WHERE deleted_at IS NULL
    AND report_category IS NOT NULL AND btrim(report_category) <> ''
    AND thesis_code IS NOT NULL AND btrim(thesis_code) <> '';
