-- Tenant accounts no longer use the platform-operator MFA ceremony.
-- Keep the columns for compatibility with Better Auth and platform accounts,
-- but remove legacy tenant enrollment state and any trusted second-factor
-- session markers so old data cannot re-enable the retired flow.
UPDATE "user"
   SET mfa_enabled = false,
       mfa_secret_encrypted = null,
       mfa_pending_secret_encrypted = null,
       updated_at = now()
 WHERE tenant_id IS NOT NULL
   AND (mfa_enabled OR mfa_secret_encrypted IS NOT NULL OR mfa_pending_secret_encrypted IS NOT NULL);

UPDATE session s
   SET mfa_verified_at = null,
       elevated_until = null,
       mfa_failed_count = 0,
       mfa_locked_until = null,
       updated_at = now()
  FROM "user" u
 WHERE s.user_id = u.id
   AND u.tenant_id IS NOT NULL
   AND (s.mfa_verified_at IS NOT NULL OR s.elevated_until IS NOT NULL OR s.mfa_failed_count <> 0 OR s.mfa_locked_until IS NOT NULL);

-- institutions is FORCE RLS protected. Apply the compatibility cleanup under
-- each tenant context instead of disabling RLS for a release migration.
DO $$
DECLARE
  tenant_key uuid;
BEGIN
  FOR tenant_key IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_key::text, true);
    UPDATE institutions
       SET require_admin_mfa = false,
           updated_at = now()
     WHERE tenant_id = tenant_key
       AND require_admin_mfa;
  END LOOP;
END
$$;
