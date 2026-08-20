CREATE TYPE "public"."performance_rating_scale_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."performance_template_applicability_scope" AS ENUM('all_active', 'department', 'position', 'manual');--> statement-breakpoint
CREATE TYPE "public"."performance_template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."performance_cycle_applicability_scope" AS ENUM('all_active', 'department', 'position', 'manual');--> statement-breakpoint
CREATE TYPE "public"."performance_cycle_status" AS ENUM('draft', 'open', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."performance_cycle_type" AS ENUM('annual', 'semiannual', 'quarterly', 'monthly', 'probation', 'ad_hoc');--> statement-breakpoint
CREATE TYPE "public"."performance_review_status" AS ENUM('draft', 'self_assessment', 'manager_review', 'hr_review', 'finalized', 'acknowledged');--> statement-breakpoint
CREATE TYPE "public"."performance_goal_approval_status" AS ENUM('accepted', 'proposed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."performance_goal_measurement_type" AS ENUM('numeric', 'percentage', 'currency', 'boolean', 'rating', 'qualitative');--> statement-breakpoint
CREATE TYPE "public"."performance_goal_origin_type" AS ENUM('manager', 'employee_proposed');--> statement-breakpoint
CREATE TYPE "public"."performance_goal_status" AS ENUM('not_started', 'in_progress', 'completed', 'missed');--> statement-breakpoint
CREATE TABLE "performance_rating_scales" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "performance_rating_scale_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_rating_scale_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"rating_scale_id" integer NOT NULL,
	"value" numeric(5, 2) NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_review_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rating_scale_id" integer NOT NULL,
	"goals_weight" integer NOT NULL,
	"competencies_weight" integer NOT NULL,
	"applicability_scope" "performance_template_applicability_scope" NOT NULL,
	"applicability_department_ids" jsonb,
	"applicability_position_ids" jsonb,
	"status" "performance_template_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_template_competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"weight" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"cycle_type" "performance_cycle_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"self_assessment_window_start" date,
	"self_assessment_window_end" date,
	"manager_review_window_start" date,
	"manager_review_window_end" date,
	"hr_finalization_window_start" date,
	"hr_finalization_window_end" date,
	"template_id" integer NOT NULL,
	"rating_scale_id" integer NOT NULL,
	"applicability_scope" "performance_cycle_applicability_scope" NOT NULL,
	"applicability_department_ids" jsonb,
	"applicability_position_ids" jsonb,
	"status" "performance_cycle_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"cycle_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"rating_scale_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"reviewer_employee_id" integer,
	"department_id_snapshot" integer,
	"position_id_snapshot" integer,
	"goals_weight" integer NOT NULL,
	"competencies_weight" integer NOT NULL,
	"scoring_precision_snapshot" integer NOT NULL,
	"acknowledgement_required_snapshot" boolean NOT NULL,
	"status" "performance_review_status" DEFAULT 'draft' NOT NULL,
	"self_assessment_submitted_at" timestamp with time zone,
	"manager_review_submitted_at" timestamp with time zone,
	"hr_finalized_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"employee_final_comment" text,
	"computed_overall_score" numeric(5, 2),
	"hr_override_score" numeric(5, 2),
	"hr_override_reason" text,
	"revision_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_review_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"review_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"measurement_type" "performance_goal_measurement_type" NOT NULL,
	"target" numeric(12, 2),
	"actual_result" numeric(12, 2),
	"unit" text,
	"weight" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"status" "performance_goal_status" DEFAULT 'not_started' NOT NULL,
	"employee_comment" text,
	"manager_comment" text,
	"computed_score" numeric(5, 2),
	"origin_type" "performance_goal_origin_type" NOT NULL,
	"approval_status" "performance_goal_approval_status" NOT NULL,
	"not_applicable" boolean DEFAULT false NOT NULL,
	"not_applicable_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_review_competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"review_id" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"weight" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"employee_rating_value" numeric(5, 2),
	"employee_comment" text,
	"manager_rating_value" numeric(5, 2),
	"manager_comment" text,
	"not_applicable" boolean DEFAULT false NOT NULL,
	"not_applicable_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_review_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"review_id" integer NOT NULL,
	"goal_id" integer,
	"employee_document_id" integer NOT NULL,
	"added_by_membership_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_rating_scales" ADD CONSTRAINT "performance_rating_scales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_rating_scale_levels" ADD CONSTRAINT "performance_rating_scale_levels_rating_scale_id_performance_rating_scales_id_fk" FOREIGN KEY ("rating_scale_id") REFERENCES "public"."performance_rating_scales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_templates" ADD CONSTRAINT "performance_review_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_templates" ADD CONSTRAINT "performance_review_templates_rating_scale_id_performance_rating_scales_id_fk" FOREIGN KEY ("rating_scale_id") REFERENCES "public"."performance_rating_scales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_template_competencies" ADD CONSTRAINT "performance_template_competencies_template_id_performance_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."performance_review_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_template_id_performance_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."performance_review_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_rating_scale_id_performance_rating_scales_id_fk" FOREIGN KEY ("rating_scale_id") REFERENCES "public"."performance_rating_scales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_performance_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_template_id_performance_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."performance_review_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_rating_scale_id_performance_rating_scales_id_fk" FOREIGN KEY ("rating_scale_id") REFERENCES "public"."performance_rating_scales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_employee_id_employees_id_fk" FOREIGN KEY ("reviewer_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_department_id_snapshot_departments_id_fk" FOREIGN KEY ("department_id_snapshot") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_position_id_snapshot_positions_id_fk" FOREIGN KEY ("position_id_snapshot") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_goals" ADD CONSTRAINT "performance_review_goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_goals" ADD CONSTRAINT "performance_review_goals_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_competencies" ADD CONSTRAINT "performance_review_competencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_competencies" ADD CONSTRAINT "performance_review_competencies_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_evidence" ADD CONSTRAINT "performance_review_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_evidence" ADD CONSTRAINT "performance_review_evidence_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_evidence" ADD CONSTRAINT "performance_review_evidence_goal_id_performance_review_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."performance_review_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_evidence" ADD CONSTRAINT "performance_review_evidence_employee_document_id_employee_documents_id_fk" FOREIGN KEY ("employee_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_evidence" ADD CONSTRAINT "performance_review_evidence_added_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("added_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_rating_scales_org_idx" ON "performance_rating_scales" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_rating_scale_levels_scale_value_unique" ON "performance_rating_scale_levels" USING btree ("rating_scale_id","value");--> statement-breakpoint
CREATE INDEX "performance_rating_scale_levels_scale_idx" ON "performance_rating_scale_levels" USING btree ("rating_scale_id");--> statement-breakpoint
CREATE INDEX "performance_review_templates_org_idx" ON "performance_review_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "performance_template_competencies_template_idx" ON "performance_template_competencies" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "performance_cycles_org_idx" ON "performance_cycles" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_reviews_cycle_employee_unique" ON "performance_reviews" USING btree ("cycle_id","employee_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_org_employee_idx" ON "performance_reviews" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_org_reviewer_idx" ON "performance_reviews" USING btree ("organization_id","reviewer_employee_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_org_cycle_status_idx" ON "performance_reviews" USING btree ("organization_id","cycle_id","status");--> statement-breakpoint
CREATE INDEX "performance_review_goals_org_review_idx" ON "performance_review_goals" USING btree ("organization_id","review_id");--> statement-breakpoint
CREATE INDEX "performance_review_competencies_org_review_idx" ON "performance_review_competencies" USING btree ("organization_id","review_id");--> statement-breakpoint
CREATE INDEX "performance_review_evidence_org_review_idx" ON "performance_review_evidence" USING btree ("organization_id","review_id");--> statement-breakpoint
ALTER TABLE "public"."performance_rating_scales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_rating_scale_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_review_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_template_competencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_cycles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_review_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_review_competencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."performance_review_evidence" ENABLE ROW LEVEL SECURITY;