CREATE TYPE "public"."vacancy_status" AS ENUM('draft', 'scheduled', 'published', 'paused', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."vacancy_visibility" AS ENUM('internal', 'external', 'both');--> statement-breakpoint
CREATE TYPE "public"."vacancy_question_type" AS ENUM('text', 'yes_no', 'multiple_choice', 'numeric');--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"requisition_id" integer NOT NULL,
	"workflow_id" integer,
	"public_id" text NOT NULL,
	"title" text NOT NULL,
	"visibility" "vacancy_visibility" DEFAULT 'internal' NOT NULL,
	"status" "vacancy_status" DEFAULT 'draft' NOT NULL,
	"openings_count" integer DEFAULT 1 NOT NULL,
	"filled_count" integer DEFAULT 0 NOT NULL,
	"open_date" timestamp with time zone,
	"close_date" timestamp with time zone,
	"job_description" text,
	"responsibilities" text,
	"requirements" text,
	"preferred_qualifications" text,
	"seo_title" text,
	"seo_description" text,
	"featured" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancy_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"vacancy_id" integer NOT NULL,
	"branch_id" integer,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vacancy_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"vacancy_id" integer NOT NULL,
	"question_text" text NOT NULL,
	"question_type" "vacancy_question_type" DEFAULT 'text' NOT NULL,
	"is_knockout" boolean DEFAULT false NOT NULL,
	"expected_answer" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_requisition_id_job_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."job_requisitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_workflow_id_recruitment_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."recruitment_workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_locations" ADD CONSTRAINT "vacancy_locations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_questions" ADD CONSTRAINT "vacancy_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_questions" ADD CONSTRAINT "vacancy_questions_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vacancies_public_id_unique" ON "vacancies" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "vacancies_org_idx" ON "vacancies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vacancies_org_status_idx" ON "vacancies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "vacancies_requisition_idx" ON "vacancies" USING btree ("requisition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacancy_locations_vacancy_branch_unique" ON "vacancy_locations" USING btree ("vacancy_id","branch_id");--> statement-breakpoint
CREATE INDEX "vacancy_locations_org_idx" ON "vacancy_locations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vacancy_locations_vacancy_idx" ON "vacancy_locations" USING btree ("vacancy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacancy_questions_vacancy_order_unique" ON "vacancy_questions" USING btree ("vacancy_id","display_order");--> statement-breakpoint
CREATE INDEX "vacancy_questions_org_idx" ON "vacancy_questions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vacancy_questions_vacancy_idx" ON "vacancy_questions" USING btree ("vacancy_id");