-- Better Auth enterprise identity runtime + explicit identity provisioning.
-- Plugin-owned auth tables intentionally remain outside tenant RLS because
-- OIDC/SAML callback resolution occurs before an application tenant context is
-- established. The application-owned link catalog remains fully tenant-scoped.

CREATE TABLE IF NOT EXISTS sso_provider (
  id text PRIMARY KEY,
  issuer text NOT NULL,
  domain text NOT NULL,
  oidc_config text,
  saml_config text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  provider_id text NOT NULL,
  organization_id text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sso_provider_provider_id_idx ON sso_provider(provider_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sso_provider_user_idx ON sso_provider(user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sso_provider_domain_idx ON sso_provider(domain);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS external_identity_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL,
  provider_id text NOT NULL,
  protocol text NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT external_identity_links_user_tenant_fk FOREIGN KEY (tenant_id,user_id) REFERENCES "user"(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT external_identity_links_protocol_check CHECK (protocol IN ('oidc','saml','scim')),
  CONSTRAINT external_identity_links_status_check CHECK (status IN ('active','disabled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS external_identity_links_subject_idx
  ON external_identity_links(provider_id,issuer,subject) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS external_identity_links_user_provider_idx
  ON external_identity_links(tenant_id,user_id,provider_id) WHERE deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE external_identity_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE external_identity_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON external_identity_links;--> statement-breakpoint
CREATE POLICY tenant_isolation ON external_identity_links
  USING (tenant_id=app.current_tenant()) WITH CHECK (tenant_id=app.current_tenant());--> statement-breakpoint

-- Narrow pre-auth resolver: returns only a user id after protocol authority and
-- immutable subject have matched an enabled link whose connection and tenant
-- are both active. No profile/PII is exposed across this boundary.
CREATE OR REPLACE FUNCTION app.resolve_external_identity(
  p_provider_id text,
  p_issuer text,
  p_subject text
) RETURNS TABLE(user_id text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,public,app AS $$
  SELECT l.user_id
  FROM public.external_identity_links l
  JOIN public.integration_connections c
    ON c.tenant_id=l.tenant_id AND c.id=l.connection_id
  JOIN public.tenants t ON t.id=l.tenant_id
  JOIN public."user" u ON u.id=l.user_id AND u.tenant_id=l.tenant_id
  WHERE l.provider_id=p_provider_id
    AND l.issuer=p_issuer
    AND l.subject=p_subject
    AND l.status='active' AND l.deleted_at IS NULL
    AND c.status='active' AND c.deleted_at IS NULL
    AND t.status='active' AND t.provisioning_status='active'
    AND u.suspended_at IS NULL
    AND (u.account_expires_at IS NULL OR u.account_expires_at>clock_timestamp())
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_external_identity(text,text,text) FROM PUBLIC;--> statement-breakpoint

-- Public discovery contains no secrets. It exists only to let the sign-in page
-- render an enterprise-login choice for a known tenant slug.
CREATE OR REPLACE FUNCTION app.list_tenant_sso_providers(p_tenant_slug text)
RETURNS TABLE(provider_id text, provider_kind text, provider_name text)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path=pg_catalog,public,app AS $$
  SELECT 'univ-sso-' || replace(c.id::text,'-',''), c.kind, c.name
  FROM public.integration_connections c
  JOIN public.tenants t ON t.id=c.tenant_id
  WHERE t.slug=lower(trim(p_tenant_slug))
    AND t.status='active' AND t.provisioning_status='active'
    AND c.kind IN ('identity_oidc','identity_saml')
    AND c.status='active' AND c.deleted_at IS NULL
  ORDER BY c.name, c.id
  LIMIT 8
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.list_tenant_sso_providers(text) FROM PUBLIC;--> statement-breakpoint

-- Tenant-checked control plane for the plugin-owned provider table. Web has
-- read-only access to sso_provider for pre-auth callbacks and may mutate it only
-- through these narrow functions while a tenant transaction is active.
CREATE OR REPLACE FUNCTION app.materialize_sso_provider(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_provider_id text,
  p_issuer text,
  p_domain text,
  p_oidc_config text,
  p_saml_config text,
  p_owner_user_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF p_provider_id IS DISTINCT FROM ('univ-sso-' || replace(p_connection_id::text,'-','')) THEN
    RAISE EXCEPTION 'provider id does not match connection';
  END IF;
  IF app.current_tenant() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'tenant context mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_connections c
    WHERE c.id=p_connection_id AND c.tenant_id=p_tenant_id
      AND c.kind IN ('identity_oidc','identity_saml')
      AND c.status='active' AND c.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'active SSO connection not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."user" u
    WHERE u.id=p_owner_user_id AND u.tenant_id=p_tenant_id AND u.suspended_at IS NULL
  ) THEN RAISE EXCEPTION 'provider owner not found'; END IF;
  DELETE FROM public.sso_provider WHERE provider_id=p_provider_id;
  INSERT INTO public.sso_provider(id,issuer,domain,oidc_config,saml_config,user_id,provider_id,organization_id)
  VALUES(gen_random_uuid()::text,p_issuer,p_domain,p_oidc_config,p_saml_config,p_owner_user_id,p_provider_id,NULL);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.materialize_sso_provider(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.remove_sso_provider(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_provider_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,app AS $$
BEGIN
  IF p_provider_id IS DISTINCT FROM ('univ-sso-' || replace(p_connection_id::text,'-','')) THEN
    RAISE EXCEPTION 'provider id does not match connection';
  END IF;
  IF app.current_tenant() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'tenant context mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.integration_connections c
    WHERE c.id=p_connection_id AND c.tenant_id=p_tenant_id
  ) THEN RAISE EXCEPTION 'SSO connection not found'; END IF;
  DELETE FROM public.sso_provider WHERE provider_id=p_provider_id;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.remove_sso_provider(uuid,uuid,text) FROM PUBLIC;--> statement-breakpoint
