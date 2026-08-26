CREATE TYPE "public"."scheduled_job_error_class" AS ENUM('transient', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_status" AS ENUM('scheduled', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"job_type" varchar(64) NOT NULL,
	"source_reference_type" varchar(32),
	"source_reference_id" integer,
	"idempotency_key" text NOT NULL,
	"payload" jsonb,
	"status" "scheduled_job_status" DEFAULT 'scheduled' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error_class" "scheduled_job_error_class",
	"last_error_message" text,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(160),
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_reference_type" varchar(32);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_reference_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_job_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "action_path" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_jobs_type_idempotency_unique" ON "scheduled_jobs" USING btree ("job_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_due_idx" ON "scheduled_jobs" USING btree ("scheduled_for") WHERE "scheduled_jobs"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "scheduled_jobs_org_idx" ON "scheduled_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_source_idx" ON "scheduled_jobs" USING btree ("source_reference_type","source_reference_id");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_running_lock_idx" ON "scheduled_jobs" USING btree ("locked_at") WHERE "scheduled_jobs"."status" = 'running';--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_job_id_scheduled_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."scheduled_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "public"."scheduled_jobs" ENABLE ROW LEVEL SECURITY;