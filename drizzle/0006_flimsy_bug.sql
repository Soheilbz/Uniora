CREATE TABLE "council_appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_id" uuid,
	"meeting_number" text NOT NULL,
	"meeting_date" date,
	"meeting_time" text,
	"meeting_day" text,
	"meeting_location" text,
	"student_id" uuid,
	"student_number" text,
	"student_name" text,
	"education_level" text,
	"field_of_study" text,
	"primary_supervisor_id" uuid,
	"secondary_supervisor_id" uuid,
	"third_supervisor_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "council_meetings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_number" text NOT NULL,
	"meeting_date" date,
	"meeting_time" text,
	"meeting_day" text,
	"meeting_location" text,
	"research_deputy" text,
	"participants" jsonb,
	"absentees" jsonb,
	"substitutions" jsonb,
	"person_refs" jsonb,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "council_rulings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"meeting_id" uuid,
	"meeting_number" text NOT NULL,
	"meeting_date" date,
	"meeting_time" text,
	"meeting_day" text,
	"meeting_location" text,
	"report_category" text,
	"review_status" text,
	"decision_text" text,
	"decision_description" text,
	"template_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "meeting_time" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "meeting_day" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "meeting_location" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "education_level" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "field_of_study" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "thesis_code" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "research_type" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "primary_supervisor" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "secondary_supervisor" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "third_supervisor" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "first_advisor" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "second_advisor" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "third_advisor" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "reviewer1" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "reviewer2" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "reviewer3" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "reviewer4_invited" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "graduate_studies_representative" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "person_refs" jsonb;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "faculty_dean" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "department_council" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "education_office" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "educational_cultural_deputy" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "research_deputy" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "department_head" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "group_manager" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_meeting_date" date;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_meeting_time" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_meeting_day" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_meeting_location" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "proposal_defense_date" date;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "final_proposal_file" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "proposal_defense_permit_form" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "research_background" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "similarity_certificate" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "lab_safety_certificate" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "bioethics_certificate" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "bioethics_code" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "language_certificate" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "thesis_file" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_permit_form" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_similarity_certificate" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "defense_language_certificate" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "research_performance_reports" boolean;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "achievements" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "decision_text" text;--> statement-breakpoint
ALTER TABLE "council_decisions" ADD COLUMN "council_notes" text;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "council_appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_meeting_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."council_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_student_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_primary_fk" FOREIGN KEY ("primary_supervisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_secondary_fk" FOREIGN KEY ("secondary_supervisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_appointments" ADD CONSTRAINT "appointments_third_fk" FOREIGN KEY ("third_supervisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_meetings" ADD CONSTRAINT "council_meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_rulings" ADD CONSTRAINT "council_rulings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_rulings" ADD CONSTRAINT "rulings_meeting_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."council_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_tenant_meeting_idx" ON "council_appointments" USING btree ("tenant_id","meeting_id");--> statement-breakpoint
CREATE INDEX "appointments_tenant_student_idx" ON "council_appointments" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "appointments_tenant_recent_idx" ON "council_appointments" USING btree ("tenant_id",meeting_date desc);--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_tenant_number_idx" ON "council_meetings" USING btree ("tenant_id","meeting_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "meetings_tenant_recent_idx" ON "council_meetings" USING btree ("tenant_id",meeting_date desc);--> statement-breakpoint
CREATE INDEX "rulings_tenant_meeting_idx" ON "council_rulings" USING btree ("tenant_id","meeting_id");--> statement-breakpoint
CREATE INDEX "rulings_tenant_recent_idx" ON "council_rulings" USING btree ("tenant_id",meeting_date desc);--> statement-breakpoint
ALTER TABLE "council_decisions" ADD CONSTRAINT "decisions_meeting_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."council_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "council_tenant_meeting_idx" ON "council_decisions" USING btree ("tenant_id","meeting_id");