ALTER TABLE "audit_log" DROP CONSTRAINT "audit_actor_tenant_fk";
--> statement-breakpoint
ALTER TABLE "calendar_entries" DROP CONSTRAINT "calendar_author_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_meeting_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_student_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_primary_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_secondary_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_appointments" DROP CONSTRAINT "appointments_third_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_decisions" DROP CONSTRAINT "decisions_meeting_fk";
--> statement-breakpoint
ALTER TABLE "council_decisions" DROP CONSTRAINT "decisions_student_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_permanent_members" DROP CONSTRAINT "permanent_members_professor_tenant_fk";
--> statement-breakpoint
ALTER TABLE "council_rulings" DROP CONSTRAINT "rulings_meeting_tenant_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_primary_supervisor_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_secondary_supervisor_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_third_supervisor_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_advisor_fk";
--> statement-breakpoint
ALTER TABLE "workshop_instructors" DROP CONSTRAINT "instructors_professor_tenant_fk";
--> statement-breakpoint
ALTER TABLE "workshop_participants" DROP CONSTRAINT "participants_student_tenant_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_actor_tenant_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_author_tenant_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."user"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_meeting_tenant_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."council_meetings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_student_tenant_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_primary_tenant_fk" FOREIGN KEY ("tenant_id","primary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_secondary_tenant_fk" FOREIGN KEY ("tenant_id","secondary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_third_tenant_fk" FOREIGN KEY ("tenant_id","third_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD CONSTRAINT "decisions_meeting_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."council_meetings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD CONSTRAINT "decisions_student_tenant_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_permanent_members" ADD CONSTRAINT "permanent_members_professor_tenant_fk" FOREIGN KEY ("tenant_id","professor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_rulings" ADD CONSTRAINT "rulings_meeting_tenant_fk" FOREIGN KEY ("tenant_id","meeting_id") REFERENCES "public"."council_meetings"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_primary_supervisor_fk" FOREIGN KEY ("tenant_id","primary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_secondary_supervisor_fk" FOREIGN KEY ("tenant_id","secondary_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_third_supervisor_fk" FOREIGN KEY ("tenant_id","third_supervisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_advisor_fk" FOREIGN KEY ("tenant_id","advisor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "instructors_professor_tenant_fk" FOREIGN KEY ("tenant_id","professor_id") REFERENCES "public"."professors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_participants" ADD CONSTRAINT "participants_student_tenant_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;