CREATE TABLE "lookups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"set" text NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"parent_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "id_number" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "passport_number" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "marital_status" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "birth_year" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "birth_place" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "military_status_type" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "military_status" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "admission_date" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "source_university" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "faculty" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "primary_supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "secondary_supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "third_supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "advisor_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "admission_type" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "funding_type" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "entry_method" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "quota" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_university" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_student_number" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_field" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_gpa" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_graduation_date" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "previous_graduation_confirmed" boolean;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "overall_gpa" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "diploma_type" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "diploma_written_gpa" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "diploma_gpa" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "completed_units" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "current_semester_units" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "semesters_count" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "academic_status_included" boolean;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "academic_status_excluded" boolean;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "military_letter_status" text;--> statement-breakpoint
ALTER TABLE "lookups" ADD CONSTRAINT "lookups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookups" ADD CONSTRAINT "lookups_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."lookups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lookups_tenant_set_value_idx" ON "lookups" USING btree ("tenant_id","set","value");--> statement-breakpoint
CREATE INDEX "lookups_tenant_set_position_idx" ON "lookups" USING btree ("tenant_id","set","position");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_primary_supervisor_fk" FOREIGN KEY ("primary_supervisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_secondary_supervisor_fk" FOREIGN KEY ("secondary_supervisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_third_supervisor_fk" FOREIGN KEY ("third_supervisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_advisor_fk" FOREIGN KEY ("advisor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "students_tenant_status_idx" ON "students" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "students_tenant_degree_idx" ON "students" USING btree ("tenant_id","degree");--> statement-breakpoint
CREATE INDEX "students_tenant_department_idx" ON "students" USING btree ("tenant_id","department");