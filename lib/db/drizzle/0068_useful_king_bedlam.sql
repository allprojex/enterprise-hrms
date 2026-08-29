CREATE TYPE "public"."document_confidentiality" AS ENUM('normal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."exit_process_status" AS ENUM('legacy', 'initiated', 'clearance_in_progress', 'ready_for_separation', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."exit_separation_basis" AS ENUM('already_separated', 'contract_end');--> statement-breakpoint
CREATE TYPE "public"."case_confidentiality" AS ENUM('normal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."disciplinary_case_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."disciplinary_case_event_type" AS ENUM('case_opened', 'allegation_recorded', 'notice_issued', 'response_received', 'investigation_recorded', 'hearing_held', 'finding_recorded', 'outcome_recorded', 'stage_changed', 'appeal_lodged', 'appeal_decided', 'evidence_attached', 'case_closed', 'case_reopened');--> statement-breakpoint
CREATE TYPE "public"."grievance_case_status" AS ENUM('submitted', 'acknowledged', 'under_review', 'resolved', 'closed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."grievance_respondent_type" AS ENUM('employee', 'department', 'unspecified');--> statement-breakpoint
CREATE TYPE "public"."grievance_case_event_type" AS ENUM('submitted', 'acknowledged', 'assigned', 'reassigned', 'review_recorded', 'meeting_held', 'information_requested', 'information_provided', 'finding_recorded', 'resolution_recorded', 'escalated', 'appeal_lodged', 'appeal_decided', 'evidence_attached', 'withdrawn', 'closed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."clearance_item_type" AS ENUM('general', 'asset_return', 'inventory_return', 'personnel_file', 'access_revocation', 'final_settlement', 'document_handover');--> statement-breakpoint
CREATE TYPE "public"."clearance_template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."clearance_item_status" AS ENUM('pending', 'completed', 'returned', 'waived');--> statement-breakpoint
CREATE TYPE "public"."exit_interview_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."custom_field_scope" ADD VALUE 'exit_interview';--> statement-breakpoint
CREATE TABLE "disciplinary_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"severity_code" text,
	"stage_code" text,
	"subject" text NOT NULL,
	"description" text,
	"status" "disciplinary_case_status" DEFAULT 'open' NOT NULL,
	"confidentiality" "case_confidentiality" DEFAULT 'confidential' NOT NULL,
	"outcome_code" text,
	"outcome_recorded_at" timestamp with time zone,
	"warning_expires_at" timestamp with time zone,
	"responsible_membership_id" integer,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disciplinary_case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"case_id" integer NOT NULL,
	"event_type" "disciplinary_case_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"details" jsonb,
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grievance_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"complainant_employee_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"respondent_type" "grievance_respondent_type" DEFAULT 'unspecified' NOT NULL,
	"respondent_employee_id" integer,
	"respondent_department_id" integer,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"status" "grievance_case_status" DEFAULT 'submitted' NOT NULL,
	"confidentiality" "case_confidentiality" DEFAULT 'confidential' NOT NULL,
	"assigned_membership_id" integer,
	"submitted_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolution_summary" text,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grievance_case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"case_id" integer NOT NULL,
	"event_type" "grievance_case_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"details" jsonb,
	"visible_to_complainant" boolean DEFAULT false NOT NULL,
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearance_template_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"item_type" "clearance_item_type" DEFAULT 'general' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"responsible_department_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearance_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "clearance_template_status" DEFAULT 'draft' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clearance_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"exit_process_id" integer NOT NULL,
	"source_template_item_id" integer,
	"sequence" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"item_type" "clearance_item_type" DEFAULT 'general' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"responsible_department_id" integer,
	"responsible_membership_id" integer,
	"status" "clearance_item_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"evidence_document_id" integer,
	"completed_at" timestamp with time zone,
	"completed_by" integer,
	"returned_reason" text,
	"waived_reason" text,
	"waived_at" timestamp with time zone,
	"waived_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"exit_process_id" integer NOT NULL,
	"status" "exit_interview_status" DEFAULT 'scheduled' NOT NULL,
	"interview_date" timestamp with time zone,
	"interviewer_membership_id" integer,
	"reason_for_leaving_code" text,
	"confidential_notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ALTER COLUMN "separation_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "confidentiality" "document_confidentiality" DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "status" "exit_process_status" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "separation_basis" "exit_separation_basis";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "separation_basis_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "expected_separation_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "clearance_template_id" integer;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "final_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD COLUMN "final_cleared_by" integer;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_cases" ADD CONSTRAINT "disciplinary_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_case_events" ADD CONSTRAINT "disciplinary_case_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_case_events" ADD CONSTRAINT "disciplinary_case_events_case_id_disciplinary_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disciplinary_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disciplinary_case_events" ADD CONSTRAINT "disciplinary_case_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_complainant_employee_id_employees_id_fk" FOREIGN KEY ("complainant_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_respondent_employee_id_employees_id_fk" FOREIGN KEY ("respondent_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_respondent_department_id_departments_id_fk" FOREIGN KEY ("respondent_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_cases" ADD CONSTRAINT "grievance_cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_case_events" ADD CONSTRAINT "grievance_case_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_case_events" ADD CONSTRAINT "grievance_case_events_case_id_grievance_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."grievance_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grievance_case_events" ADD CONSTRAINT "grievance_case_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_template_items" ADD CONSTRAINT "clearance_template_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_template_items" ADD CONSTRAINT "clearance_template_items_template_id_clearance_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."clearance_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_template_items" ADD CONSTRAINT "clearance_template_items_responsible_department_id_departments_id_fk" FOREIGN KEY ("responsible_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_templates" ADD CONSTRAINT "clearance_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_templates" ADD CONSTRAINT "clearance_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_exit_process_id_employee_exit_processes_id_fk" FOREIGN KEY ("exit_process_id") REFERENCES "public"."employee_exit_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_source_template_item_id_clearance_template_items_id_fk" FOREIGN KEY ("source_template_item_id") REFERENCES "public"."clearance_template_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_responsible_department_id_departments_id_fk" FOREIGN KEY ("responsible_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_evidence_document_id_employee_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_exit_process_id_employee_exit_processes_id_fk" FOREIGN KEY ("exit_process_id") REFERENCES "public"."employee_exit_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disciplinary_cases_org_employee_idx" ON "disciplinary_cases" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "disciplinary_cases_org_status_idx" ON "disciplinary_cases" USING btree ("organization_id","status","opened_at");--> statement-breakpoint
CREATE INDEX "disciplinary_case_events_case_idx" ON "disciplinary_case_events" USING btree ("organization_id","case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "grievance_cases_org_complainant_idx" ON "grievance_cases" USING btree ("organization_id","complainant_employee_id");--> statement-breakpoint
CREATE INDEX "grievance_cases_org_status_idx" ON "grievance_cases" USING btree ("organization_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "grievance_case_events_case_idx" ON "grievance_case_events" USING btree ("organization_id","case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "clearance_template_items_template_idx" ON "clearance_template_items" USING btree ("organization_id","template_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "clearance_templates_default_per_org_unique" ON "clearance_templates" USING btree ("organization_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "clearance_templates_org_status_idx" ON "clearance_templates" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "clearance_items_exit_process_idx" ON "clearance_items" USING btree ("organization_id","exit_process_id","sequence");--> statement-breakpoint
CREATE INDEX "clearance_items_org_status_idx" ON "clearance_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "clearance_items_responsible_idx" ON "clearance_items" USING btree ("organization_id","responsible_department_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_interviews_exit_process_unique" ON "exit_interviews" USING btree ("exit_process_id");--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD CONSTRAINT "employee_exit_processes_final_cleared_by_users_id_fk" FOREIGN KEY ("final_cleared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_exit_processes_open_per_employee_unique" ON "employee_exit_processes" USING btree ("organization_id","employee_id") WHERE status in ('initiated', 'clearance_in_progress', 'ready_for_separation');--> statement-breakpoint
CREATE INDEX "employee_exit_processes_org_status_idx" ON "employee_exit_processes" USING btree ("organization_id","status");
--> statement-breakpoint
-- WS-12 — repository convention: every new tenant table is RLS-enabled with
-- ZERO policies (deny-by-default at the database). Real tenant isolation is
-- enforced in the application layer through requireMembership plus an explicit
-- organization_id predicate on every query; this is defence in depth, not the
-- primary control. `employee_exit_processes` and `employee_documents` are
-- pre-existing tables and their RLS state is deliberately left untouched.
ALTER TABLE "public"."disciplinary_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."disciplinary_case_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."grievance_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."grievance_case_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."clearance_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."clearance_template_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."clearance_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."exit_interviews" ENABLE ROW LEVEL SECURITY;
