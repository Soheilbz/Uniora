CREATE TABLE "council_permanent_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_name" text NOT NULL,
	"professor_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "council_permanent_members" ADD CONSTRAINT "council_permanent_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_permanent_members" ADD CONSTRAINT "council_permanent_members_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permanent_members_tenant_name_idx" ON "council_permanent_members" USING btree ("tenant_id","member_name") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "permanent_members_tenant_order_idx" ON "council_permanent_members" USING btree ("tenant_id","sort_order");