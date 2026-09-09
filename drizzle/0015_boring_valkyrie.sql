ALTER TABLE "institutions" ADD COLUMN "name_en" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "professors" ADD COLUMN "search_text" text GENERATED ALWAYS AS (app.fold_text(
        coalesce(first_name, '') || ' ' ||
        coalesce(last_name, '') || ' ' ||
        coalesce(professor_code, '') || ' ' ||
        coalesce(national_id, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(specialization, '')
      )) STORED;--> statement-breakpoint
CREATE INDEX "professors_tenant_status_idx" ON "professors" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "professors_tenant_rank_idx" ON "professors" USING btree ("tenant_id","academic_rank");--> statement-breakpoint
CREATE INDEX "professors_tenant_university_idx" ON "professors" USING btree ("tenant_id","university");--> statement-breakpoint
CREATE INDEX "professors_tenant_faculty_idx" ON "professors" USING btree ("tenant_id","faculty");--> statement-breakpoint
CREATE INDEX "professors_tenant_department_idx" ON "professors" USING btree ("tenant_id","department");--> statement-breakpoint
CREATE INDEX "professors_search_idx" ON "professors" USING gin ("search_text" gin_trgm_ops);