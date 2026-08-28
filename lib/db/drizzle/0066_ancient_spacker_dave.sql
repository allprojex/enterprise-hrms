CREATE TYPE "public"."onboarding_due_basis" AS ENUM('onboarding_start', 'commencement_date', 'dependency_completion');--> statement-breakpoint
CREATE TYPE "public"."onboarding_responsibility_resolver" AS ENUM('employee_self', 'reporting_manager', 'department_head', 'permission_holder', 'specific_membership');--> statement-breakpoint
CREATE TYPE "public"."onboarding_task_kind" AS ENUM('general', 'document', 'acknowledgement', 'induction', 'asset_reference', 'inventory_reference', 'access_reference', 'payroll_reference', 'personnel_file_reference');--> statement-breakpoint
CREATE TYPE "public"."onboarding_template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."induction_delivery_mode" AS ENUM('in_person', 'virtual', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."onboarding_instance_status" AS ENUM('not_started', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."onboarding_task_status" AS ENUM('pending', 'completed', 'waived', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."acknowledgement_audience" AS ENUM('all_employees', 'branch', 'department', 'position', 'employment_type', 'specific_employees', 'onboarding');--> statement-breakpoint
CREATE TYPE "public"."acknowledgement_status" AS ENUM('pending', 'acknowledged');--> statement-breakpoint
CREATE TABLE "onboarding_template_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"display_order" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"task_kind" "onboarding_task_kind" DEFAULT 'general' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"responsible_resolver" "onboarding_responsibility_resolver" DEFAULT 'employee_self' NOT NULL,
	"responsible_permission_key" text,
	"responsible_membership_id" integer,
	"due_basis" "onboarding_due_basis",
	"due_offset_days" integer,
	"depends_on_template_task_id" integer,
	"document_category_code" text,
	"acknowledgement_document_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"status" "onboarding_template_status" DEFAULT 'draft' NOT NULL,
	"change_note" text,
	"activated_at" timestamp with time zone,
	"activated_by" integer,
	"archived_at" timestamp with time zone,
	"archived_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"branch_id" integer,
	"department_id" integer,
	"position_id" integer,
	"employment_type" "employment_type",
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_induction_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"facilitator_membership_id" integer,
	"scheduled_at" timestamp with time zone,
	"delivery_mode" "induction_delivery_mode",
	"location" text,
	"meeting_details" text,
	"attended_at" timestamp with time zone,
	"attendance_notes" text,
	"reschedule_count" integer DEFAULT 0 NOT NULL,
	"last_rescheduled_at" timestamp with time zone,
	"last_reschedule_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"status" "onboarding_instance_status" DEFAULT 'not_started' NOT NULL,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"commencement_date" timestamp with time zone,
	"candidate_id" integer,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" integer,
	"cancellation_reason" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"instance_id" integer NOT NULL,
	"template_task_id" integer,
	"display_order" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"task_kind" "onboarding_task_kind" DEFAULT 'general' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"responsible_resolver" "onboarding_responsibility_resolver" DEFAULT 'employee_self' NOT NULL,
	"responsible_permission_key" text,
	"responsible_membership_id" integer,
	"due_at" timestamp with time zone,
	"status" "onboarding_task_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" integer,
	"completed_by_name" text,
	"completion_notes" text,
	"waived_at" timestamp with time zone,
	"waived_by" integer,
	"waived_by_name" text,
	"waiver_reason" text,
	"document_requirement_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_acknowledgements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"document_version_id" integer NOT NULL,
	"status" "acknowledgement_status" DEFAULT 'pending' NOT NULL,
	"audience" "acknowledgement_audience" NOT NULL,
	"onboarding_instance_id" integer,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" integer,
	"due_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" integer,
	"acknowledged_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_documents" ADD COLUMN "requires_acknowledgement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_documents" ADD COLUMN "reacknowledge_on_new_version" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_template_version_id_onboarding_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."onboarding_template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_responsible_membership_id_organization_memberships_id_fk" FOREIGN KEY ("responsible_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_depends_on_template_task_id_onboarding_template_tasks_id_fk" FOREIGN KEY ("depends_on_template_task_id") REFERENCES "public"."onboarding_template_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_acknowledgement_document_id_organization_documents_id_fk" FOREIGN KEY ("acknowledgement_document_id") REFERENCES "public"."organization_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_template_versions" ADD CONSTRAINT "onboarding_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_induction_details" ADD CONSTRAINT "onboarding_induction_details_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_induction_details" ADD CONSTRAINT "onboarding_induction_details_task_id_onboarding_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."onboarding_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_induction_details" ADD CONSTRAINT "onboarding_induction_details_facilitator_membership_id_organization_memberships_id_fk" FOREIGN KEY ("facilitator_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_template_version_id_onboarding_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."onboarding_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_instances" ADD CONSTRAINT "onboarding_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_instance_id_onboarding_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."onboarding_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_template_task_id_onboarding_template_tasks_id_fk" FOREIGN KEY ("template_task_id") REFERENCES "public"."onboarding_template_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_responsible_membership_id_organization_memberships_id_fk" FOREIGN KEY ("responsible_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_document_requirement_id_document_requirements_id_fk" FOREIGN KEY ("document_requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_document_id_organization_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."organization_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_document_version_id_organization_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."organization_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_onboarding_instance_id_onboarding_instances_id_fk" FOREIGN KEY ("onboarding_instance_id") REFERENCES "public"."onboarding_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_template_tasks_version_idx" ON "onboarding_template_tasks" USING btree ("template_version_id","display_order");--> statement-breakpoint
CREATE INDEX "onboarding_template_tasks_org_idx" ON "onboarding_template_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_template_versions_number_unique" ON "onboarding_template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_template_versions_active_unique" ON "onboarding_template_versions" USING btree ("template_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "onboarding_template_versions_org_idx" ON "onboarding_template_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_templates_org_name_unique" ON "onboarding_templates" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "onboarding_templates_org_idx" ON "onboarding_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_induction_details_task_unique" ON "onboarding_induction_details" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "onboarding_induction_details_org_idx" ON "onboarding_induction_details" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_instances_open_per_employee_unique" ON "onboarding_instances" USING btree ("organization_id","employee_id") WHERE status in ('not_started', 'in_progress');--> statement-breakpoint
CREATE INDEX "onboarding_instances_org_status_idx" ON "onboarding_instances" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "onboarding_instances_employee_idx" ON "onboarding_instances" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_instance_idx" ON "onboarding_tasks" USING btree ("instance_id","display_order");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_org_status_idx" ON "onboarding_tasks" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_due_idx" ON "onboarding_tasks" USING btree ("organization_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_acknowledgements_employee_version_unique" ON "document_acknowledgements" USING btree ("organization_id","employee_id","document_version_id");--> statement-breakpoint
CREATE INDEX "document_acknowledgements_org_status_idx" ON "document_acknowledgements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "document_acknowledgements_employee_idx" ON "document_acknowledgements" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "document_acknowledgements_instance_idx" ON "document_acknowledgements" USING btree ("onboarding_instance_id");--> statement-breakpoint
-- WS-10 — repository convention: every new tenant table is RLS-enabled with
-- ZERO policies (deny-by-default at the database). Real tenant isolation is
-- enforced in the application layer through requireMembership plus an explicit
-- organization_id predicate on every query; this is defence in depth, not the
-- primary control.
ALTER TABLE "public"."onboarding_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."onboarding_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."onboarding_template_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."onboarding_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."onboarding_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."onboarding_induction_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_acknowledgements" ENABLE ROW LEVEL SECURITY;
