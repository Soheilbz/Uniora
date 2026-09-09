CREATE TABLE "platform_operation_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_operation_requests_kind_check" CHECK ("platform_operation_requests"."kind" in ('tenant.create','tenant.rename','tenant.suspend','tenant.resume','tenant.archive','tenant.owner.set')),
	CONSTRAINT "platform_operation_requests_status_check" CHECK ("platform_operation_requests"."status" in ('queued','running','completed','failed'))
);
--> statement-breakpoint
ALTER TABLE "platform_operation_requests" ADD CONSTRAINT "platform_operation_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_operation_requests_queue_idx" ON "platform_operation_requests" USING btree ("status","created_at");