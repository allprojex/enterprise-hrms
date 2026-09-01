CREATE TYPE "public"."pre_restore_checkpoint_state" AS ENUM('not_required', 'required', 'satisfied', 'unsupported_acknowledged');--> statement-breakpoint
CREATE TYPE "public"."restore_quiescence_state" AS ENUM('not_required', 'required', 'requested', 'confirmed', 'unavailable', 'released');--> statement-breakpoint
CREATE TYPE "public"."restore_completeness" AS ENUM('complete', 'partial', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."restore_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."installation_restore_execution_status" AS ENUM('dispatched', 'accepted', 'started', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."restore_point_type" AS ENUM('backup_run', 'pitr', 'provider_snapshot');--> statement-breakpoint
CREATE TYPE "public"."restore_purpose" AS ENUM('recovery', 'test');--> statement-breakpoint
CREATE TYPE "public"."installation_restore_request_status" AS ENUM('submitted', 'approved', 'rejected', 'dispatched', 'executing', 'succeeded', 'failed', 'validated', 'validation_failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."restore_validation_result" AS ENUM('passed', 'failed', 'unknown', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."restore_validation_source" AS ENUM('automated', 'operator_attestation');--> statement-breakpoint
CREATE TYPE "public"."installation_restore_approval_policy" AS ENUM('always_required', 'single_operator_non_production');--> statement-breakpoint
CREATE TABLE "installation_restore_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"decision" "restore_decision" NOT NULL,
	"approver_user_id" integer NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"comment" text,
	"affected_organization_ids_at_decision" jsonb NOT NULL,
	"completeness_at_decision" "restore_completeness" NOT NULL,
	"pre_restore_checkpoint_at_decision" "pre_restore_checkpoint_state" NOT NULL,
	"expires_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text
);
--> statement-breakpoint
CREATE TABLE "installation_restore_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" "installation_restore_execution_status" DEFAULT 'dispatched' NOT NULL,
	"idempotency_key" text NOT NULL,
	"dispatched_by_user_id" integer,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"executor_type" text,
	"external_reference" text,
	"failure_category" text,
	"cancellation_requested_at" timestamp with time zone,
	"status_detail" text
);
--> statement-breakpoint
CREATE TABLE "installation_restore_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"environment_snapshot" text NOT NULL,
	"purpose" "restore_purpose" NOT NULL,
	"status" "installation_restore_request_status" DEFAULT 'submitted' NOT NULL,
	"restore_point_type" "restore_point_type" NOT NULL,
	"backup_run_id" integer,
	"pitr_timestamp" timestamp with time zone,
	"provider_reference" text,
	"recovery_point_at" timestamp with time zone,
	"completeness" "restore_completeness" NOT NULL,
	"incomplete_components" jsonb,
	"incomplete_acknowledged_at" timestamp with time zone,
	"incomplete_acknowledgement_note" text,
	"pre_restore_checkpoint_state" "pre_restore_checkpoint_state" NOT NULL,
	"pre_restore_backup_run_id" integer,
	"pre_restore_exception_note" text,
	"quiescence_state" "restore_quiescence_state" DEFAULT 'not_required' NOT NULL,
	"quiescence_confirmed_by_user_id" integer,
	"quiescence_confirmed_at" timestamp with time zone,
	"quiescence_evidence" text,
	"affected_organization_ids_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"confirmation_verified_at" timestamp with time zone NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_detail" text,
	"application_version_at_request" text,
	"git_commit_at_request" text,
	"migration_version_at_request" text,
	"drift_acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "installation_restore_validations" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"execution_id" integer,
	"check_key" text NOT NULL,
	"result" "restore_validation_result" NOT NULL,
	"source" "restore_validation_source" NOT NULL,
	"detail" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" integer
);
--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "restore_approval_policy" "installation_restore_approval_policy" DEFAULT 'always_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "installation_restore_approvals" ADD CONSTRAINT "installation_restore_approvals_request_id_installation_restore_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."installation_restore_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_approvals" ADD CONSTRAINT "installation_restore_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_executions" ADD CONSTRAINT "installation_restore_executions_request_id_installation_restore_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."installation_restore_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_executions" ADD CONSTRAINT "installation_restore_executions_dispatched_by_user_id_users_id_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_requests" ADD CONSTRAINT "installation_restore_requests_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_requests" ADD CONSTRAINT "installation_restore_requests_backup_run_id_installation_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."installation_backup_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_requests" ADD CONSTRAINT "installation_restore_requests_pre_restore_backup_run_id_installation_backup_runs_id_fk" FOREIGN KEY ("pre_restore_backup_run_id") REFERENCES "public"."installation_backup_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_requests" ADD CONSTRAINT "installation_restore_requests_quiescence_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("quiescence_confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_requests" ADD CONSTRAINT "installation_restore_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_validations" ADD CONSTRAINT "installation_restore_validations_request_id_installation_restore_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."installation_restore_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_validations" ADD CONSTRAINT "installation_restore_validations_execution_id_installation_restore_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."installation_restore_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_restore_validations" ADD CONSTRAINT "installation_restore_validations_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "installation_restore_approvals_request_idx" ON "installation_restore_approvals" USING btree ("request_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_restore_executions_idempotency_unique" ON "installation_restore_executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "installation_restore_executions_attempt_unique" ON "installation_restore_executions" USING btree ("request_id","attempt_number");--> statement-breakpoint
CREATE INDEX "installation_restore_requests_installation_idx" ON "installation_restore_requests" USING btree ("installation_id","submitted_at");--> statement-breakpoint
CREATE INDEX "installation_restore_requests_status_idx" ON "installation_restore_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "installation_restore_validations_request_idx" ON "installation_restore_validations" USING btree ("request_id","observed_at");

-- WS-17 Restore Governance. Row-level security ENABLED with ZERO policies,
-- matching `installations` and every other table in this schema. These are
-- PLATFORM-scoped records — none carries an organization_id, because a
-- physical restore belongs to an installation and may affect every tenant on
-- it. Access is gated in the application by platform context PLUS a specific
-- restore grant, with production maker-checker on top; RLS is defence in depth.
ALTER TABLE "public"."installation_restore_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_restore_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_restore_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."installation_restore_validations" ENABLE ROW LEVEL SECURITY;
