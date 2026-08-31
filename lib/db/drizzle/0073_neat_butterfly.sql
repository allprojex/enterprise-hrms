CREATE TYPE "public"."installation_backup_component_result" AS ENUM('succeeded', 'failed', 'not_attempted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."installation_backup_coverage" AS ENUM('covered', 'not_covered', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."installation_backup_request_status" AS ENUM('requested', 'accepted', 'executing', 'succeeded', 'failed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."installation_backup_run_result" AS ENUM('succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."installation_backup_strategy" AS ENUM('provider_managed', 'logical_dump', 'volume_snapshot', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."installation_deployment_result" AS ENUM('in_progress', 'succeeded', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."operational_executor_type" AS ENUM('operator', 'ci_cd', 'installation_agent', 'provider', 'imported_evidence');--> statement-breakpoint
CREATE TABLE "platform_operation_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"permission_key" text NOT NULL,
	"granted_by" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_backup_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"strategy" "installation_backup_strategy",
	"expected_frequency_hours" integer,
	"target_rpo_minutes" integer,
	"target_rto_minutes" integer,
	"retention_policy_reference" text,
	"database_coverage" "installation_backup_coverage" DEFAULT 'unknown' NOT NULL,
	"binary_storage_coverage" "installation_backup_coverage" DEFAULT 'unknown' NOT NULL,
	"executor_type" "operational_executor_type",
	"supports_backup_requests" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_backup_policies_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "installation_backup_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"status" "installation_backup_request_status" DEFAULT 'requested' NOT NULL,
	"backup_type" "installation_backup_strategy",
	"reason" text NOT NULL,
	"requested_by_user_id" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone,
	"external_reference" text,
	"status_detail" text
);
--> statement-breakpoint
CREATE TABLE "installation_backup_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"request_id" integer,
	"backup_type" "installation_backup_strategy",
	"result" "installation_backup_run_result" NOT NULL,
	"database_result" "installation_backup_component_result" DEFAULT 'unknown' NOT NULL,
	"binary_storage_result" "installation_backup_component_result" DEFAULT 'unknown' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"recovery_point_at" timestamp with time zone,
	"size_bytes" bigint,
	"executor_type" "operational_executor_type" NOT NULL,
	"external_reference" text,
	"failure_category" text,
	"evidence_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" integer,
	"supersedes_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "installation_deployments" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"application_version" text,
	"git_commit" text,
	"migration_version" text,
	"previous_application_version" text,
	"previous_git_commit" text,
	"result" "installation_deployment_result" NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"executor_type" "operational_executor_type" NOT NULL,
	"external_reference" text,
	"rolled_back_from_deployment_id" integer,
	"notes" text,
	"recorded_by_user_id" integer,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reported_application_version" text,
	"reported_git_commit" text,
	"reported_migration_version" text,
	"application_healthy" integer,
	"database_ready" integer,
	"storage_backend" text,
	"storage_healthy" integer,
	"executor_type" "operational_executor_type" NOT NULL,
	"recorded_by_user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installation_telemetry_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
ALTER TABLE "platform_operation_grants" ADD CONSTRAINT "platform_operation_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operation_grants" ADD CONSTRAINT "platform_operation_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operation_grants" ADD CONSTRAINT "platform_operation_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_policies" ADD CONSTRAINT "installation_backup_policies_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_policies" ADD CONSTRAINT "installation_backup_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_requests" ADD CONSTRAINT "installation_backup_requests_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_requests" ADD CONSTRAINT "installation_backup_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_runs" ADD CONSTRAINT "installation_backup_runs_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_runs" ADD CONSTRAINT "installation_backup_runs_request_id_installation_backup_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."installation_backup_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_backup_runs" ADD CONSTRAINT "installation_backup_runs_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_deployments" ADD CONSTRAINT "installation_deployments_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_deployments" ADD CONSTRAINT "installation_deployments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_telemetry" ADD CONSTRAINT "installation_telemetry_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_telemetry" ADD CONSTRAINT "installation_telemetry_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_operation_grants_live_unique" ON "platform_operation_grants" USING btree ("user_id","permission_key") WHERE "platform_operation_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "platform_operation_grants_user_idx" ON "platform_operation_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "installation_backup_requests_installation_idx" ON "installation_backup_requests" USING btree ("installation_id","requested_at");--> statement-breakpoint
CREATE INDEX "installation_backup_runs_installation_idx" ON "installation_backup_runs" USING btree ("installation_id","recovery_point_at");--> statement-breakpoint
CREATE INDEX "installation_backup_runs_installation_received_idx" ON "installation_backup_runs" USING btree ("installation_id","evidence_received_at");--> statement-breakpoint
CREATE INDEX "installation_deployments_installation_idx" ON "installation_deployments" USING btree ("installation_id","recorded_at");

-- WS-17 Slice 1. Row-level security ENABLED with ZERO policies, matching
-- `installations` itself (migration 0059) and every other table in this
-- schema. These are PLATFORM-scoped operational records, not tenant data —
-- none carries an organization_id — so tenant RLS semantics would be the
-- wrong protection entirely. Access is gated in the application by platform
-- context PLUS a specific platform-operation grant; RLS is defence in depth.
ALTER TABLE "public"."platform_operation_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_deployments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_backup_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_backup_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_backup_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_telemetry" ENABLE ROW LEVEL SECURITY;
