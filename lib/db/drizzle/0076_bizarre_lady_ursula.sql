CREATE TYPE "public"."form_revision_kind" AS ENUM('draft', 'submitted', 'resubmitted', 'stage_update');--> statement-breakpoint
CREATE TYPE "public"."form_stage_participant" AS ENUM('employee', 'supervisor', 'department_head', 'hr', 'final_approver', 'assessor');--> statement-breakpoint
CREATE TYPE "public"."form_stage_resolver" AS ENUM('subject_employee', 'reporting_manager', 'department_head', 'permission_holder', 'specific_membership');--> statement-breakpoint
CREATE TYPE "public"."form_submission_event_type" AS ENUM('created', 'draft_saved', 'submitted', 'stage_completed', 'returned', 'rejected', 'resubmitted', 'approved', 'signature_applied', 'signature_revoked', 'final_document_generated', 'finalized', 'archived', 'downloaded');--> statement-breakpoint
CREATE TYPE "public"."form_submission_status" AS ENUM('draft', 'submitted', 'pending_approval', 'returned', 'rejected', 'resubmitted', 'approved', 'finalized', 'archived');--> statement-breakpoint
CREATE TYPE "public"."form_template_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."form_template_type" AS ENUM('leave_application', 'personal_information', 'staff_evaluation', 'probationary_assessment', 'generic');--> statement-breakpoint
CREATE TYPE "public"."form_template_version_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "form_submission_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"event_type" "form_submission_event_type" NOT NULL,
	"stage_order" integer,
	"stage_name" text,
	"revision_id" integer,
	"notes" text,
	"details" jsonb,
	"actor_user_id" integer,
	"actor_membership_id" integer,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submission_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"revision_number" integer NOT NULL,
	"kind" "form_revision_kind" NOT NULL,
	"answers" jsonb NOT NULL,
	"autofill_snapshot" jsonb NOT NULL,
	"computed" jsonb NOT NULL,
	"stage_order" integer,
	"saved_by_membership_id" integer NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"subject_employee_id" integer NOT NULL,
	"status" "form_submission_status" DEFAULT 'draft' NOT NULL,
	"current_stage_order" integer,
	"stage_count_snapshot" integer,
	"current_revision_id" integer,
	"linked_entity_type" text,
	"linked_entity_id" integer,
	"created_by_membership_id" integer NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"final_document_id" integer,
	"final_sha256" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"status" "form_template_version_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"definition" jsonb NOT NULL,
	"definition_sha256" text NOT NULL,
	"signature_policy" jsonb,
	"render_config" jsonb,
	"change_note" text,
	"first_used_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by_membership_id" integer,
	"archived_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_key" text NOT NULL,
	"form_type" "form_template_type" NOT NULL,
	"module_key" text,
	"title" text NOT NULL,
	"description" text,
	"status" "form_template_status" DEFAULT 'active' NOT NULL,
	"current_published_version_id" integer,
	"created_by_membership_id" integer,
	"archived_at" timestamp with time zone,
	"archived_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_workflow_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"stage_order" integer NOT NULL,
	"name" text NOT NULL,
	"participant" "form_stage_participant" NOT NULL,
	"resolver" "form_stage_resolver" NOT NULL,
	"resolver_config" jsonb,
	"editable_section_keys" jsonb NOT NULL,
	"allowed_actions" jsonb NOT NULL,
	"signature_slot_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_revision_id_form_submission_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."form_submission_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_actor_membership_id_organization_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_revisions" ADD CONSTRAINT "form_submission_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_revisions" ADD CONSTRAINT "form_submission_revisions_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_revisions" ADD CONSTRAINT "form_submission_revisions_saved_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("saved_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_template_version_id_form_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."form_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_subject_employee_id_employees_id_fk" FOREIGN KEY ("subject_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_final_document_id_generated_documents_id_fk" FOREIGN KEY ("final_document_id") REFERENCES "public"."generated_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_published_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("published_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD CONSTRAINT "form_template_versions_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_archived_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("archived_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_workflow_stages" ADD CONSTRAINT "form_workflow_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_workflow_stages" ADD CONSTRAINT "form_workflow_stages_template_version_id_form_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."form_template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_submission_events_submission_idx" ON "form_submission_events" USING btree ("submission_id","occurred_at");--> statement-breakpoint
CREATE INDEX "form_submission_events_org_idx" ON "form_submission_events" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_revisions_submission_number_unique" ON "form_submission_revisions" USING btree ("submission_id","revision_number");--> statement-breakpoint
CREATE INDEX "form_submission_revisions_org_idx" ON "form_submission_revisions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "form_submissions_org_template_idx" ON "form_submissions" USING btree ("organization_id","template_id");--> statement-breakpoint
CREATE INDEX "form_submissions_org_subject_idx" ON "form_submissions" USING btree ("organization_id","subject_employee_id");--> statement-breakpoint
CREATE INDEX "form_submissions_org_status_idx" ON "form_submissions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "form_submissions_org_linked_idx" ON "form_submissions" USING btree ("organization_id","linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_template_versions_template_number_unique" ON "form_template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "form_template_versions_one_published_unique" ON "form_template_versions" USING btree ("template_id") WHERE "form_template_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "form_template_versions_org_idx" ON "form_template_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "form_template_versions_template_idx" ON "form_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_org_key_unique" ON "form_templates" USING btree ("organization_id","template_key");--> statement-breakpoint
CREATE INDEX "form_templates_org_type_idx" ON "form_templates" USING btree ("organization_id","form_type");--> statement-breakpoint
CREATE INDEX "form_templates_org_status_idx" ON "form_templates" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "form_workflow_stages_version_order_unique" ON "form_workflow_stages" USING btree ("template_version_id","stage_order");--> statement-breakpoint
CREATE INDEX "form_workflow_stages_org_idx" ON "form_workflow_stages" USING btree ("organization_id");ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."form_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."form_workflow_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."form_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."form_submission_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."form_submission_events" ENABLE ROW LEVEL SECURITY;
