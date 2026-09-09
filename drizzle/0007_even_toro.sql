CREATE TABLE "professor_capacities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"professor_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"doctorate_concurrent_total" integer DEFAULT 0 NOT NULL,
	"doctorate_annual_total" integer DEFAULT 0 NOT NULL,
	"masters_concurrent_total" integer DEFAULT 0 NOT NULL,
	"masters_annual_total" integer DEFAULT 0 NOT NULL,
	"doctorate_concurrent_campus" integer DEFAULT 0 NOT NULL,
	"doctorate_annual_campus" integer DEFAULT 0 NOT NULL,
	"masters_concurrent_campus" integer DEFAULT 0 NOT NULL,
	"masters_annual_campus" integer DEFAULT 0 NOT NULL,
	"doctorate_concurrent_external" integer DEFAULT 0 NOT NULL,
	"doctorate_annual_external" integer DEFAULT 0 NOT NULL,
	"masters_concurrent_external" integer DEFAULT 0 NOT NULL,
	"masters_annual_external" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workshop_certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workshop_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"certificate_number" text NOT NULL,
	"issue_date" date NOT NULL,
	"verification_code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workshop_instructors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workshop_id" uuid NOT NULL,
	"professor_id" uuid,
	"external_name" text,
	"external_national_id" text,
	"external_affiliation" text,
	"role" text DEFAULT 'main' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workshop_participants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workshop_id" uuid NOT NULL,
	"student_id" uuid,
	"external_name" text,
	"external_national_id" text,
	"external_mobile" text,
	"external_affiliation" text,
	"registration_date" date,
	"attendance_status" text DEFAULT 'registered' NOT NULL,
	"payment_status" text DEFAULT 'free' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workshops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"workshop_date" date,
	"duration_hours" numeric(5, 2),
	"location_type" text,
	"venue" text,
	"capacity" integer DEFAULT 0 NOT NULL,
	"cost" numeric(12, 2),
	"status" text DEFAULT 'planned' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "professor_capacities" ADD CONSTRAINT "professor_capacities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_capacities" ADD CONSTRAINT "capacities_professor_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_certificates" ADD CONSTRAINT "workshop_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_certificates" ADD CONSTRAINT "certificates_workshop_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_certificates" ADD CONSTRAINT "certificates_participant_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."workshop_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "workshop_instructors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "instructors_workshop_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_instructors" ADD CONSTRAINT "instructors_professor_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_participants" ADD CONSTRAINT "workshop_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_participants" ADD CONSTRAINT "participants_workshop_fk" FOREIGN KEY ("workshop_id") REFERENCES "public"."workshops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshop_participants" ADD CONSTRAINT "participants_student_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workshops" ADD CONSTRAINT "workshops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capacities_tenant_professor_year_idx" ON "professor_capacities" USING btree ("tenant_id","professor_id","year") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "capacities_tenant_year_idx" ON "professor_capacities" USING btree ("tenant_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_tenant_number_idx" ON "workshop_certificates" USING btree ("tenant_id","certificate_number") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_tenant_code_idx" ON "workshop_certificates" USING btree ("tenant_id","verification_code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_tenant_participant_idx" ON "workshop_certificates" USING btree ("tenant_id","participant_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "certificates_tenant_workshop_idx" ON "workshop_certificates" USING btree ("tenant_id","workshop_id");--> statement-breakpoint
CREATE INDEX "instructors_tenant_workshop_idx" ON "workshop_instructors" USING btree ("tenant_id","workshop_id");--> statement-breakpoint
CREATE INDEX "participants_tenant_workshop_idx" ON "workshop_participants" USING btree ("tenant_id","workshop_id");--> statement-breakpoint
CREATE INDEX "participants_tenant_student_idx" ON "workshop_participants" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "workshops_tenant_date_idx" ON "workshops" USING btree ("tenant_id",workshop_date desc);--> statement-breakpoint
CREATE INDEX "workshops_tenant_status_idx" ON "workshops" USING btree ("tenant_id","status");