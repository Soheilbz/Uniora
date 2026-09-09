ALTER TABLE "council_meetings" ADD COLUMN "search_text" text GENERATED ALWAYS AS (app.fold_text(
        coalesce(meeting_number, '') || ' ' ||
        coalesce(meeting_location, '') || ' ' ||
        coalesce(research_deputy, '') || ' ' ||
        coalesce(meeting_day, '') || ' ' ||
        coalesce(notes, '')
      )) STORED;--> statement-breakpoint
CREATE INDEX "meetings_search_idx" ON "council_meetings" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "workshops" ADD COLUMN "search_text" text GENERATED ALWAYS AS (app.fold_text(
        coalesce(title, '') || ' ' ||
        coalesce(venue, '') || ' ' ||
        coalesce(description, '')
      )) STORED;--> statement-breakpoint
CREATE INDEX "workshops_search_idx" ON "workshops" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint

ALTER TABLE "tenants" ADD COLUMN "provisioning_request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_provisioning_request_idx" ON "tenants" USING btree ("provisioning_request_id") WHERE "provisioning_request_id" is not null;--> statement-breakpoint

-- Platform operators are tenantless identities, but they need the same account-level
-- password-guessing ledger as university users. Preserve the fail-closed tenant
-- behavior for tenant accounts while allowing only registered platform operators
-- to access their own ledger when no tenant context is set.
DROP POLICY IF EXISTS tenant_isolation ON login_attempts;--> statement-breakpoint
CREATE POLICY tenant_isolation ON login_attempts
  USING (EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.id = user_id
      AND CASE
        WHEN u.tenant_id IS NULL THEN
          EXISTS (SELECT 1 FROM platform_operators p WHERE p.user_id = u.id)
          AND nullif(current_setting('app.tenant_id', true), '') IS NULL
        ELSE u.tenant_id = app.current_tenant()
      END
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "user" u
    WHERE u.id = user_id
      AND CASE
        WHEN u.tenant_id IS NULL THEN
          EXISTS (SELECT 1 FROM platform_operators p WHERE p.user_id = u.id)
          AND nullif(current_setting('app.tenant_id', true), '') IS NULL
        ELSE u.tenant_id = app.current_tenant()
      END
  ));
