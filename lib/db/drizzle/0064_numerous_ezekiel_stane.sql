CREATE TYPE "public"."custom_field_scope" AS ENUM('employee', 'candidate', 'application', 'onboarding', 'organization_profile', 'position');--> statement-breakpoint
CREATE TYPE "public"."custom_field_sensitivity" AS ENUM('normal', 'sensitive');--> statement-breakpoint
CREATE TYPE "public"."custom_field_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."custom_field_type" AS ENUM('short_text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'single_select', 'multi_select', 'email', 'phone', 'url', 'employee_reference', 'master_data_reference');--> statement-breakpoint
CREATE TYPE "public"."custom_form_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."custom_form_type" AS ENUM('internal_hr', 'employee_ess', 'onboarding', 'candidate_application');--> statement-breakpoint
CREATE TYPE "public"."custom_form_version_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "custom_field_definition_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"definition_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"field_type" "custom_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sensitivity" "custom_field_sensitivity" DEFAULT 'normal' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"validation" jsonb,
	"options" jsonb,
	"visibility" jsonb,
	"default_value" jsonb,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"scope" "custom_field_scope" NOT NULL,
	"field_key" text NOT NULL,
	"status" "custom_field_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"definition_id" integer NOT NULL,
	"definition_version_id" integer NOT NULL,
	"scope" "custom_field_scope" NOT NULL,
	"entity_id" integer NOT NULL,
	"value" jsonb,
	"created_by_membership_id" integer,
	"updated_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_form_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"form_version_id" integer NOT NULL,
	"scope" "custom_field_scope" NOT NULL,
	"entity_id" integer,
	"answers" jsonb NOT NULL,
	"submitted_by_membership_id" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_form_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"layout" jsonb NOT NULL,
	"status" "custom_form_version_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"form_key" text NOT NULL,
	"form_type" "custom_form_type" NOT NULL,
	"scope" "custom_field_scope" NOT NULL,
	"status" "custom_form_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_field_definition_versions" ADD CONSTRAINT "custom_field_definition_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definition_versions" ADD CONSTRAINT "custom_field_definition_versions_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definition_versions" ADD CONSTRAINT "custom_field_definition_versions_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_version_id_custom_field_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."custom_field_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_updated_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_submissions" ADD CONSTRAINT "custom_form_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_submissions" ADD CONSTRAINT "custom_form_submissions_form_id_custom_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."custom_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_submissions" ADD CONSTRAINT "custom_form_submissions_form_version_id_custom_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."custom_form_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_submissions" ADD CONSTRAINT "custom_form_submissions_submitted_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("submitted_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_versions" ADD CONSTRAINT "custom_form_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_versions" ADD CONSTRAINT "custom_form_versions_form_id_custom_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."custom_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_form_versions" ADD CONSTRAINT "custom_form_versions_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_forms" ADD CONSTRAINT "custom_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_forms" ADD CONSTRAINT "custom_forms_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definition_versions_def_number_unique" ON "custom_field_definition_versions" USING btree ("definition_id","version_number");--> statement-breakpoint
CREATE INDEX "custom_field_definition_versions_def_idx" ON "custom_field_definition_versions" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "custom_field_definition_versions_org_idx" ON "custom_field_definition_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_org_scope_key_unique" ON "custom_field_definitions" USING btree ("organization_id","scope","field_key");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_org_scope_idx" ON "custom_field_definitions" USING btree ("organization_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_definition_entity_unique" ON "custom_field_values" USING btree ("definition_id","scope","entity_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_org_scope_entity_idx" ON "custom_field_values" USING btree ("organization_id","scope","entity_id");--> statement-breakpoint
CREATE INDEX "custom_form_submissions_org_form_idx" ON "custom_form_submissions" USING btree ("organization_id","form_id");--> statement-breakpoint
CREATE INDEX "custom_form_submissions_org_scope_entity_idx" ON "custom_form_submissions" USING btree ("organization_id","scope","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_form_versions_form_number_unique" ON "custom_form_versions" USING btree ("form_id","version_number");--> statement-breakpoint
CREATE INDEX "custom_form_versions_form_idx" ON "custom_form_versions" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "custom_form_versions_org_idx" ON "custom_form_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_forms_org_key_unique" ON "custom_forms" USING btree ("organization_id","form_key");--> statement-breakpoint
CREATE INDEX "custom_forms_org_type_idx" ON "custom_forms" USING btree ("organization_id","form_type");
--> statement-breakpoint
-- Exactly one CURRENT version per field definition. Drizzle cannot express a
-- partial unique index, so it is declared here: this is the database-level
-- guarantee that "the current configuration" is never ambiguous, mirroring
-- employee_compensation_components_open_unique's own precedent.
CREATE UNIQUE INDEX "custom_field_definition_versions_one_current" ON "custom_field_definition_versions" ("definition_id") WHERE "is_current";--> statement-breakpoint
-- Exactly one PUBLISHED version per form, for the same reason.
CREATE UNIQUE INDEX "custom_form_versions_one_published" ON "custom_form_versions" ("form_id") WHERE "status" = 'published';--> statement-breakpoint
ALTER TABLE "public"."custom_field_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."custom_field_definition_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."custom_field_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."custom_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."custom_form_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."custom_form_submissions" ENABLE ROW LEVEL SECURITY;
