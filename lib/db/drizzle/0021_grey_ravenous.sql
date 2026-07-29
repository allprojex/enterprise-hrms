CREATE TYPE "public"."recruitment_stage_category" AS ENUM('applied', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."recruitment_duplicate_candidate_policy" AS ENUM('allow', 'flag', 'block');--> statement-breakpoint
CREATE TABLE "recruitment_workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" "recruitment_stage_category" NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"icon" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"internal_recruitment_enabled" boolean DEFAULT true NOT NULL,
	"external_recruitment_enabled" boolean DEFAULT true NOT NULL,
	"require_candidate_account" boolean DEFAULT false NOT NULL,
	"default_workflow_id" integer,
	"candidate_data_retention_months" integer,
	"reapplication_waiting_days" integer DEFAULT 0 NOT NULL,
	"duplicate_candidate_policy" "recruitment_duplicate_candidate_policy" DEFAULT 'flag' NOT NULL,
	"default_offer_expiry_days" integer,
	"default_document_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"application_limit_per_candidate" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recruitment_workflows" ADD CONSTRAINT "recruitment_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_stages" ADD CONSTRAINT "recruitment_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_stages" ADD CONSTRAINT "recruitment_stages_workflow_id_recruitment_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."recruitment_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_settings" ADD CONSTRAINT "recruitment_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_settings" ADD CONSTRAINT "recruitment_settings_default_workflow_id_recruitment_workflows_id_fk" FOREIGN KEY ("default_workflow_id") REFERENCES "public"."recruitment_workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_workflows_org_name_unique" ON "recruitment_workflows" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_workflows_org_default_unique" ON "recruitment_workflows" USING btree ("organization_id") WHERE "recruitment_workflows"."is_default" = true;--> statement-breakpoint
CREATE INDEX "recruitment_workflows_org_idx" ON "recruitment_workflows" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_stages_workflow_order_unique" ON "recruitment_stages" USING btree ("workflow_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_stages_workflow_name_unique" ON "recruitment_stages" USING btree ("workflow_id","name");--> statement-breakpoint
CREATE INDEX "recruitment_stages_org_idx" ON "recruitment_stages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recruitment_stages_workflow_idx" ON "recruitment_stages" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_settings_org_unique" ON "recruitment_settings" USING btree ("organization_id");