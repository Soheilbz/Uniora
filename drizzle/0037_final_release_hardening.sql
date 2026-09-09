-- Final public-release hardening.
-- 1) Materialize the exact plugin-owned @better-auth/scim 1.7.2 models used by
--    src/lib/auth.ts (managedConnections is not enabled, so only these seven
--    models are required).
-- 2) Add a sanitized operations-to-Web health projection so the Web process
--    never needs backup directories or privileged backup credentials.

CREATE TABLE IF NOT EXISTS scim_connection_binding (
  id text PRIMARY KEY,
  connection_id text NOT NULL,
  connection_key text NOT NULL,
  provisioning_domain_id text NOT NULL,
  created_at timestamptz NOT NULL,
  decommissioned_at timestamptz,
  decommission_status text NOT NULL DEFAULT 'active',
  decommission_cursor_user_id text,
  decommission_reconciled_user_count integer NOT NULL DEFAULT 0,
  decommission_batch_count integer NOT NULL DEFAULT 0,
  decommission_revision integer NOT NULL DEFAULT 0,
  decommission_completed_at timestamptz,
  decommission_lease_id text,
  decommission_lease_expires_at timestamptz
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_connection_binding_connection_idx ON scim_connection_binding(connection_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_connection_binding_key_idx ON scim_connection_binding(connection_key);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_identity_tombstone (
  id text PRIMARY KEY,
  connection_id text NOT NULL,
  provisioning_domain_id text NOT NULL,
  external_id text NOT NULL,
  external_id_key text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  profile text NOT NULL,
  deleted_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_identity_tombstone_connection_idx ON scim_identity_tombstone(connection_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_identity_tombstone_domain_idx ON scim_identity_tombstone(provisioning_domain_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_identity_tombstone_user_idx ON scim_identity_tombstone(user_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_identity_tombstone_external_key_idx ON scim_identity_tombstone(external_id_key);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_subject (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  profile_source_id text,
  revision integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_subject_user_idx ON scim_subject(user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_subject_profile_source_idx ON scim_subject(profile_source_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_user (
  id text PRIMARY KEY,
  connection_id text NOT NULL,
  provisioning_domain_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  connection_user_key text NOT NULL,
  user_name text NOT NULL,
  user_name_key text NOT NULL,
  primary_email text NOT NULL,
  work_email_value_index text NOT NULL,
  email_value_index text NOT NULL,
  display_name text NOT NULL,
  formatted_name text NOT NULL,
  given_name text,
  family_name text,
  serialized_emails text NOT NULL,
  serialized_attributes text,
  external_id text,
  external_id_key text,
  active boolean NOT NULL,
  order_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_user_connection_idx ON scim_user(connection_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_user_domain_idx ON scim_user(provisioning_domain_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_user_user_idx ON scim_user(user_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_user_connection_user_key_idx ON scim_user(connection_user_key);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_user_name_key_idx ON scim_user(user_name_key);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_user_external_key_idx ON scim_user(external_id_key);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_user_order_key_idx ON scim_user(order_key);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_projection_grant (
  id text PRIMARY KEY,
  connection_id text NOT NULL,
  provisioning_domain_id text NOT NULL,
  scim_user_id text NOT NULL REFERENCES scim_user(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  source_value text,
  role text NOT NULL,
  grant_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_projection_grant_connection_idx ON scim_projection_grant(connection_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_projection_grant_domain_idx ON scim_projection_grant(provisioning_domain_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_projection_grant_scim_user_idx ON scim_projection_grant(scim_user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_projection_grant_user_idx ON scim_projection_grant(user_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_projection_grant_key_idx ON scim_projection_grant(grant_key);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_group (
  id text PRIMARY KEY,
  connection_id text NOT NULL,
  provisioning_domain_id text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  display_name text NOT NULL,
  display_name_key text NOT NULL,
  external_id text,
  external_id_key text,
  order_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_group_connection_idx ON scim_group(connection_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_group_domain_idx ON scim_group(provisioning_domain_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_group_display_name_key_idx ON scim_group(display_name_key);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_group_external_key_idx ON scim_group(external_id_key);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_group_order_key_idx ON scim_group(order_key);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS scim_group_member (
  id text PRIMARY KEY,
  connection_id text NOT NULL,
  group_id text NOT NULL REFERENCES scim_group(id) ON DELETE CASCADE,
  scim_user_id text NOT NULL REFERENCES scim_user(id) ON DELETE CASCADE,
  membership_key text NOT NULL,
  created_at timestamptz NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_group_member_connection_idx ON scim_group_member(connection_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_group_member_group_idx ON scim_group_member(group_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scim_group_member_user_idx ON scim_group_member(scim_user_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scim_group_member_key_idx ON scim_group_member(membership_key);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS platform_operational_health (
  key text PRIMARY KEY,
  status text NOT NULL,
  payload_json text NOT NULL DEFAULT '{}',
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_operational_health_status_check CHECK (status IN ('ok','degraded','unavailable'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS platform_operational_health_observed_idx ON platform_operational_health(observed_at);--> statement-breakpoint

-- These tables are intentionally outside tenant RLS. Better Auth SCIM executes
-- before application tenant context exists; platform health contains only a
-- sanitized read-only projection. Rebuild exact grants when the Web role exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='univ_app_web') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON
      scim_connection_binding,scim_identity_tombstone,scim_subject,scim_user,
      scim_projection_grant,scim_group,scim_group_member TO univ_app_web;
    GRANT SELECT ON platform_operational_health TO univ_app_web;
  END IF;
END $$;--> statement-breakpoint
