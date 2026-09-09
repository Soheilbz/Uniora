CREATE UNIQUE INDEX "meetings_tenant_id_idx" ON "council_meetings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "lookups_tenant_id_idx" ON "lookups" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "professors_tenant_id_idx" ON "professors" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_tenant_id_idx" ON "students" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tenant_id_idx" ON "user" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_tenant_id_idx" ON "workshop_participants" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workshops_tenant_id_idx" ON "workshops" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_entries" DROP CONSTRAINT "calendar_entries_author_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_meeting_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_student_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_primary_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_secondary_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_third_fk";
--> statement-breakpoint
ALTER TABLE "council_decisions" DROP CONSTRAINT "council_decisions_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "council_decisions" DROP CONSTRAINT "decisions_meeting_fk";
--> statement-breakpoint
ALTER TABLE "council_permanent_members" DROP CONSTRAINT "council_permanent_members_professor_id_professors_id_fk";
--> statement-breakpoint
ALTER TABLE "council_rulings" DROP CONSTRAINT "rulings_meeting_fk";
--> statement-breakpoint
ALTER TABLE "lookups" DROP CONSTRAINT "lookups_parent_fk";
--> statement-breakpoint
ALTER TABLE "professor_capacities" DROP CONSTRAINT "capacities_professor_fk";
--> statement-breakpoint
ALTER TABLE "saved_views" DROP CONSTRAINT "saved_views_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_primary_supervisor_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_secondary_supervisor_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_third_supervisor_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_advisor_fk";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "workshop_certificates" DROP CONSTRAINT "certificates_workshop_fk";
--> statement-breakpoint
ALTER TABLE "workshop_certificates" DROP CONSTRAINT "certificates_participant_fk";
--> statement-breakpoint
ALTER TABLE "workshop_instructors" DROP CONSTRAINT "instructors_workshop_fk";
--> statement-breakpoint
ALTER TABLE "workshop_instructors" DROP CONSTRAINT "instructors_professor_fk";
--> statement-breakpoint
ALTER TABLE "workshop_participants" DROP CONSTRAINT "participants_workshop_fk";
--> statement-breakpoint
ALTER TABLE "workshop_participants" DROP CONSTRAINT "participants_student_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_actor_tenant_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_author_tenant_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_meeting_tenant_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."council_meetings"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_student_tenant_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_primary_tenant_fk" FOREIGN KEY ("tenant_id","primary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_secondary_tenant_fk" FOREIGN KEY ("tenant_id","secondary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_third_tenant_fk" FOREIGN KEY ("tenant_id","third_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD CONSTRAINT "decisions_student_tenant_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD CONSTRAINT "decisions_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."council_meetings"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_permanent_members" ADD CONSTRAINT "permanent_members_professor_tenant_fk" FOREIGN KEY ("tenant_id","professor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_rulings" ADD CONSTRAINT "rulings_meeting_tenant_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."council_meetings"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookups" ADD CONSTRAINT "lookups_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."lookups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_capacities" ADD CONSTRAINT "capacities_professor_tenant_fk" FOREIGN KEY ("tenant_id","professor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_tenant_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_primary_supervisor_fk" FOREIGN KEY ("tenant_id","primary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_secondary_supervisor_fk" FOREIGN KEY ("tenant_id","secondary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_third_supervisor_fk" FOREIGN KEY ("tenant_id","third_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_advisor_fk" FOREIGN KEY ("tenant_id","advisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_certificates" ADD CONSTRAINT "certificates_workshop_tenant_fk" FOREIGN KEY ("tenant_id","workshop_id") REFERENCES "public"."workshops"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_certificates" ADD CONSTRAINT "certificates_participant_tenant_fk" FOREIGN KEY ("tenant_id","participant_id") REFERENCES "public"."workshop_participants"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "instructors_workshop_tenant_fk" FOREIGN KEY ("tenant_id","workshop_id") REFERENCES "public"."workshops"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "instructors_professor_tenant_fk" FOREIGN KEY ("tenant_id","professor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_participants" ADD CONSTRAINT "participants_workshop_tenant_fk" FOREIGN KEY ("tenant_id","workshop_id") REFERENCES "public"."workshops"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_participants" ADD CONSTRAINT "participants_student_tenant_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
