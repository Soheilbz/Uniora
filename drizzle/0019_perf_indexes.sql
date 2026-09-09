CREATE INDEX "council_tenant_review_status_idx" ON "council_decisions" USING btree ("tenant_id","review_status");--> statement-breakpoint
CREATE INDEX "council_tenant_defence_date_idx" ON "council_decisions" USING btree ("tenant_id","defense_meeting_date");--> statement-breakpoint
CREATE INDEX "students_tenant_faculty_idx" ON "students" USING btree ("tenant_id","faculty");--> statement-breakpoint
CREATE INDEX "students_tenant_field_idx" ON "students" USING btree ("tenant_id","field_of_study");