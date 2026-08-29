CREATE TYPE "public"."data_change_origin" AS ENUM('employee_self_service', 'hr_originated');--> statement-breakpoint
CREATE TYPE "public"."data_change_status" AS ENUM('pending', 'returned', 'approved', 'applied', 'rejected', 'withdrawn', 'stale', 'application_failed');--> statement-breakpoint
CREATE TYPE "public"."data_change_event_type" AS ENUM('requested', 'stage_approved', 'approved', 'rejected', 'returned', 'resubmitted', 'withdrawn', 'stale_detected', 'reconfirmed', 'applied', 'application_failed');--> statement-breakpoint
CREATE TYPE "public"."request_approval_purpose" AS ENUM('data_change', 'service_request');--> statement-breakpoint
CREATE TYPE "public"."request_authority_resolver" AS ENUM('department_head', 'permission_holder', 'specific_membership');--> statement-breakpoint
CREATE TYPE "public"."service_request_approval_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."service_request_event_type" AS ENUM('submitted', 'acknowledged', 'assigned', 'reassigned', 'stage_approved', 'approved', 'rejected', 'information_requested', 'employee_responded', 'note_added', 'fulfilled', 'closed', 'cancelled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."service_request_fulfilment_kind" AS ENUM('acknowledgement', 'document');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('submitted', 'acknowledged', 'in_progress', 'awaiting_employee', 'fulfilled', 'closed', 'cancelled', 'withdrawn');--> statement-breakpoint
CREATE TABLE "data_change_request_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"active_status" boolean DEFAULT true NOT NULL,
	"field_key" text NOT NULL,
	"previous_value" jsonb,
	"requested_value" jsonb,
	"stale_detected_at" timestamp with time zone,
	"stale_current_value" jsonb,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"origin" "data_change_origin" NOT NULL,
	"status" "data_change_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"stage_count_at_request" integer DEFAULT 0 NOT NULL,
	"current_stage_order" integer,
	"requested_by_user_id" integer,
	"requested_by_membership_id" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_date" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"applied_by_user_id" integer,
	"application_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_change_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_id" integer NOT NULL,
	"event_type" "data_change_event_type" NOT NULL,
	"stage_order" integer,
	"stage_name" text,
	"notes" text,
	"details" jsonb,
	"actor_user_id" integer,
	"actor_membership_id" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_change_field_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"field_key" text NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_approval_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"purpose" "request_approval_purpose" NOT NULL,
	"stage_order" integer NOT NULL,
	"name" text NOT NULL,
	"resolver_type" "request_authority_resolver" NOT NULL,
	"resolver_config" jsonb,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_id" integer NOT NULL,
	"event_type" "service_request_event_type" NOT NULL,
	"stage_order" integer,
	"stage_name" text,
	"notes" text,
	"details" jsonb,
	"visible_to_employee" boolean DEFAULT false NOT NULL,
	"actor_user_id" integer,
	"actor_membership_id" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"employee_visible" boolean DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT false NOT NULL,
	"fulfilment_kind" "service_request_fulfilment_kind" DEFAULT 'acknowledgement' NOT NULL,
	"form_id" integer,
	"responsible_department_id" integer,
	"target_days" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"type_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"subject" text NOT NULL,
	"details" text,
	"status" "service_request_status" DEFAULT 'submitted' NOT NULL,
	"approval_status" "service_request_approval_status" DEFAULT 'not_required' NOT NULL,
	"stage_count_at_request" integer DEFAULT 0 NOT NULL,
	"current_stage_order" integer,
	"assigned_membership_id" integer,
	"form_submission_id" integer,
	"generated_document_id" integer,
	"evidence_document_id" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by" integer,
	"closed_at" timestamp with time zone,
	"resolution_summary" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_change_request_fields" ADD CONSTRAINT "data_change_request_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_request_fields" ADD CONSTRAINT "data_change_request_fields_request_id_data_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."data_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_request_fields" ADD CONSTRAINT "data_change_request_fields_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_requests" ADD CONSTRAINT "data_change_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_requests" ADD CONSTRAINT "data_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_requests" ADD CONSTRAINT "data_change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_requests" ADD CONSTRAINT "data_change_requests_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_events" ADD CONSTRAINT "data_change_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_events" ADD CONSTRAINT "data_change_events_request_id_data_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."data_change_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_events" ADD CONSTRAINT "data_change_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_field_policies" ADD CONSTRAINT "data_change_field_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_change_field_policies" ADD CONSTRAINT "data_change_field_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_approval_stages" ADD CONSTRAINT "request_approval_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_approval_stages" ADD CONSTRAINT "request_approval_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_types" ADD CONSTRAINT "service_request_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_types" ADD CONSTRAINT "service_request_types_form_id_custom_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."custom_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_types" ADD CONSTRAINT "service_request_types_responsible_department_id_departments_id_fk" FOREIGN KEY ("responsible_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_types" ADD CONSTRAINT "service_request_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_type_id_service_request_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."service_request_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_form_submission_id_custom_form_submissions_id_fk" FOREIGN KEY ("form_submission_id") REFERENCES "public"."custom_form_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_generated_document_id_generated_documents_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_evidence_document_id_employee_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_fulfilled_by_users_id_fk" FOREIGN KEY ("fulfilled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_change_request_fields_request_idx" ON "data_change_request_fields" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_change_request_fields_active_unique" ON "data_change_request_fields" USING btree ("organization_id","employee_id","field_key") WHERE active_status = true;--> statement-breakpoint
CREATE INDEX "data_change_request_fields_field_idx" ON "data_change_request_fields" USING btree ("organization_id","field_key");--> statement-breakpoint
CREATE INDEX "data_change_requests_org_employee_idx" ON "data_change_requests" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "data_change_requests_org_status_idx" ON "data_change_requests" USING btree ("organization_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "data_change_events_request_idx" ON "data_change_events" USING btree ("organization_id","request_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_change_field_policies_org_field_unique" ON "data_change_field_policies" USING btree ("organization_id","field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "request_approval_stages_org_purpose_order_unique" ON "request_approval_stages" USING btree ("organization_id","purpose","stage_order");--> statement-breakpoint
CREATE INDEX "request_approval_stages_org_purpose_idx" ON "request_approval_stages" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE INDEX "service_request_events_request_idx" ON "service_request_events" USING btree ("organization_id","request_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_request_types_org_code_unique" ON "service_request_types" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "service_request_types_org_active_idx" ON "service_request_types" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "service_requests_org_employee_idx" ON "service_requests" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "service_requests_org_status_idx" ON "service_requests" USING btree ("organization_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "service_requests_org_assigned_idx" ON "service_requests" USING btree ("organization_id","assigned_membership_id","status");
--> statement-breakpoint
-- WS-13 — repository convention: every new tenant table is RLS-enabled with
-- ZERO policies (deny-by-default at the database). Real tenant isolation is
-- enforced in the application layer through requireMembership plus an explicit
-- organization_id predicate on every query; this is defence in depth, not the
-- primary control.
ALTER TABLE "public"."data_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."data_change_request_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."data_change_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."data_change_field_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."request_approval_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."service_request_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."service_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."service_request_events" ENABLE ROW LEVEL SECURITY;
