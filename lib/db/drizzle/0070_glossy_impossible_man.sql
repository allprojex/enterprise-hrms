CREATE TYPE "public"."skill_category" AS ENUM('technical', 'behavioural', 'leadership', 'functional', 'compliance', 'other');--> statement-breakpoint
CREATE TYPE "public"."assessor_role" AS ENUM('hr', 'reporting_manager');--> statement-breakpoint
CREATE TYPE "public"."employee_skill_assessment_kind" AS ENUM('assessment', 'verification', 'rejection');--> statement-breakpoint
CREATE TYPE "public"."employee_skill_source" AS ENUM('employee_self_service', 'hr_entry', 'assessment', 'import');--> statement-breakpoint
CREATE TYPE "public"."employee_skill_status" AS ENUM('claimed', 'assessed', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."development_action_status" AS ENUM('open', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."succession_candidate_event_type" AS ENUM('nominated', 'readiness_changed', 'rationale_updated', 'removed', 'reinstated', 'appointed_elsewhere');--> statement-breakpoint
CREATE TYPE "public"."succession_candidate_status" AS ENUM('active', 'removed', 'appointed');--> statement-breakpoint
CREATE TYPE "public"."succession_plan_status" AS ENUM('active', 'under_review', 'closed');--> statement-breakpoint
CREATE TABLE "proficiency_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"scale_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proficiency_scales" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "skill_category" DEFAULT 'technical' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"proficiency_applicable" boolean DEFAULT true NOT NULL,
	"evidence_expected" boolean DEFAULT false NOT NULL,
	"certification_applicable" boolean DEFAULT false NOT NULL,
	"source_master_data_code" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_skill_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"kind" "employee_skill_assessment_kind" NOT NULL,
	"level_id" integer,
	"assessor_role" "assessor_role" NOT NULL,
	"assessor_user_id" integer,
	"assessor_membership_id" integer,
	"assessed_at" timestamp with time zone NOT NULL,
	"notes" text,
	"evidence_document_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_skill_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"status" "employee_skill_status" DEFAULT 'claimed' NOT NULL,
	"source" "employee_skill_source" NOT NULL,
	"claimed_level_id" integer,
	"verified_level_id" integer,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" integer,
	"evidence_document_id" integer,
	"certification_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_skill_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"position_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"minimum_level_id" integer,
	"mandatory" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_id" integer,
	"succession_candidate_id" integer,
	"action" text NOT NULL,
	"status" "development_action_status" DEFAULT 'open' NOT NULL,
	"target_date" timestamp with time zone,
	"learning_course_id" integer,
	"learning_enrollment_id" integer,
	"evidence_document_id" integer,
	"responsible_membership_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "succession_candidate_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"event_type" "succession_candidate_event_type" NOT NULL,
	"previous_readiness_level_id" integer,
	"new_readiness_level_id" integer,
	"notes" text,
	"actor_user_id" integer,
	"actor_membership_id" integer,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "succession_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"status" "succession_candidate_status" DEFAULT 'active' NOT NULL,
	"readiness_level_id" integer,
	"rationale" text,
	"nominated_by_user_id" integer,
	"nominated_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "succession_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"position_id" integer NOT NULL,
	"status" "succession_plan_status" DEFAULT 'active' NOT NULL,
	"criticality_notes" text,
	"review_due_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proficiency_levels" ADD CONSTRAINT "proficiency_levels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_levels" ADD CONSTRAINT "proficiency_levels_scale_id_proficiency_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "public"."proficiency_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_scales" ADD CONSTRAINT "proficiency_scales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proficiency_scales" ADD CONSTRAINT "proficiency_scales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_assessments" ADD CONSTRAINT "employee_skill_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_assessments" ADD CONSTRAINT "employee_skill_assessments_record_id_employee_skill_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."employee_skill_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_assessments" ADD CONSTRAINT "employee_skill_assessments_level_id_proficiency_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."proficiency_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_assessments" ADD CONSTRAINT "employee_skill_assessments_assessor_user_id_users_id_fk" FOREIGN KEY ("assessor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_assessments" ADD CONSTRAINT "employee_skill_assessments_evidence_document_id_employee_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_claimed_level_id_proficiency_levels_id_fk" FOREIGN KEY ("claimed_level_id") REFERENCES "public"."proficiency_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_verified_level_id_proficiency_levels_id_fk" FOREIGN KEY ("verified_level_id") REFERENCES "public"."proficiency_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_evidence_document_id_employee_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_certification_id_employee_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."employee_certifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skill_records" ADD CONSTRAINT "employee_skill_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_minimum_level_id_proficiency_levels_id_fk" FOREIGN KEY ("minimum_level_id") REFERENCES "public"."proficiency_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_skill_requirements" ADD CONSTRAINT "position_skill_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_succession_candidate_id_succession_candidates_id_fk" FOREIGN KEY ("succession_candidate_id") REFERENCES "public"."succession_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_learning_course_id_learning_courses_id_fk" FOREIGN KEY ("learning_course_id") REFERENCES "public"."learning_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_learning_enrollment_id_learning_enrollments_id_fk" FOREIGN KEY ("learning_enrollment_id") REFERENCES "public"."learning_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_evidence_document_id_employee_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_actions" ADD CONSTRAINT "development_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_levels" ADD CONSTRAINT "readiness_levels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_levels" ADD CONSTRAINT "readiness_levels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidate_events" ADD CONSTRAINT "succession_candidate_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidate_events" ADD CONSTRAINT "succession_candidate_events_candidate_id_succession_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."succession_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidate_events" ADD CONSTRAINT "succession_candidate_events_previous_readiness_level_id_readiness_levels_id_fk" FOREIGN KEY ("previous_readiness_level_id") REFERENCES "public"."readiness_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidate_events" ADD CONSTRAINT "succession_candidate_events_new_readiness_level_id_readiness_levels_id_fk" FOREIGN KEY ("new_readiness_level_id") REFERENCES "public"."readiness_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidate_events" ADD CONSTRAINT "succession_candidate_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_plan_id_succession_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."succession_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_readiness_level_id_readiness_levels_id_fk" FOREIGN KEY ("readiness_level_id") REFERENCES "public"."readiness_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_nominated_by_user_id_users_id_fk" FOREIGN KEY ("nominated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_candidates" ADD CONSTRAINT "succession_candidates_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "succession_plans" ADD CONSTRAINT "succession_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proficiency_levels_scale_ordinal_unique" ON "proficiency_levels" USING btree ("scale_id","ordinal");--> statement-breakpoint
CREATE INDEX "proficiency_levels_org_scale_idx" ON "proficiency_levels" USING btree ("organization_id","scale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proficiency_scales_active_per_org_unique" ON "proficiency_scales" USING btree ("organization_id") WHERE active = true;--> statement-breakpoint
CREATE INDEX "proficiency_scales_org_idx" ON "proficiency_scales" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skills_org_code_unique" ON "skills" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "skills_org_active_idx" ON "skills" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "skills_org_category_idx" ON "skills" USING btree ("organization_id","category");--> statement-breakpoint
CREATE INDEX "employee_skill_assessments_record_idx" ON "employee_skill_assessments" USING btree ("organization_id","record_id","assessed_at");--> statement-breakpoint
CREATE INDEX "employee_skill_assessments_org_kind_idx" ON "employee_skill_assessments" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_skill_records_employee_skill_unique" ON "employee_skill_records" USING btree ("organization_id","employee_id","skill_id");--> statement-breakpoint
CREATE INDEX "employee_skill_records_org_employee_idx" ON "employee_skill_records" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_skill_records_org_skill_idx" ON "employee_skill_records" USING btree ("organization_id","skill_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "position_skill_requirements_unique" ON "position_skill_requirements" USING btree ("organization_id","position_id","skill_id");--> statement-breakpoint
CREATE INDEX "position_skill_requirements_org_position_idx" ON "position_skill_requirements" USING btree ("organization_id","position_id","active");--> statement-breakpoint
CREATE INDEX "development_actions_org_employee_idx" ON "development_actions" USING btree ("organization_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "development_actions_org_status_idx" ON "development_actions" USING btree ("organization_id","status","target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_levels_org_ordinal_unique" ON "readiness_levels" USING btree ("organization_id","ordinal");--> statement-breakpoint
CREATE INDEX "readiness_levels_org_idx" ON "readiness_levels" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "succession_candidate_events_candidate_idx" ON "succession_candidate_events" USING btree ("organization_id","candidate_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "succession_candidates_active_unique" ON "succession_candidates" USING btree ("organization_id","plan_id","employee_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "succession_candidates_plan_idx" ON "succession_candidates" USING btree ("organization_id","plan_id","status");--> statement-breakpoint
CREATE INDEX "succession_candidates_employee_idx" ON "succession_candidates" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "succession_plans_open_per_position_unique" ON "succession_plans" USING btree ("organization_id","position_id") WHERE status in ('active', 'under_review');--> statement-breakpoint
CREATE INDEX "succession_plans_org_status_idx" ON "succession_plans" USING btree ("organization_id","status");
--> statement-breakpoint
-- WS-14 — repository convention: every new tenant table is RLS-enabled with
-- ZERO policies (deny-by-default at the database). Real tenant isolation is
-- enforced in the application layer through requireMembership plus an explicit
-- organization_id predicate on every query; this is defence in depth, not the
-- primary control.
ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."proficiency_scales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."proficiency_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employee_skill_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employee_skill_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."position_skill_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."readiness_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."succession_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."succession_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."succession_candidate_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."development_actions" ENABLE ROW LEVEL SECURITY;
