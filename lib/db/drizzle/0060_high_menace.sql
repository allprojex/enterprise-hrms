CREATE TYPE "public"."document_sensitivity" AS ENUM('standard', 'confidential');--> statement-breakpoint
CREATE TYPE "public"."organization_document_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."organization_document_version_status" AS ENUM('current', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_requirement_owner_type" AS ENUM('employee', 'candidate', 'organization');--> statement-breakpoint
CREATE TYPE "public"."document_requirement_status" AS ENUM('pending', 'provided', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_retention_archive_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."document_retention_disposal_status" AS ENUM('none', 'eligible', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."document_template_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."document_template_content_format" AS ENUM('plain_text');--> statement-breakpoint
CREATE TYPE "public"."document_template_version_status" AS ENUM('draft', 'active', 'superseded');--> statement-breakpoint
CREATE TABLE "document_category_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"category_code" varchar(64) NOT NULL,
	"verification_required" boolean DEFAULT false NOT NULL,
	"expiry_supported" boolean DEFAULT false NOT NULL,
	"expiry_required" boolean DEFAULT false NOT NULL,
	"sensitivity" "document_sensitivity" DEFAULT 'standard' NOT NULL,
	"retention_basis" text,
	"retention_period_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "organization_document_status" DEFAULT 'active' NOT NULL,
	"current_version_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"status" "organization_document_version_status" DEFAULT 'current' NOT NULL,
	"effective_date" date,
	"expiry_date" date,
	"change_note" text,
	"superseded_at" timestamp with time zone,
	"superseded_by" integer,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"owner_type" "document_requirement_owner_type" NOT NULL,
	"owner_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" "document_requirement_status" DEFAULT 'pending' NOT NULL,
	"fulfilled_document_table" varchar(32),
	"fulfilled_document_id" integer,
	"verified_by" integer,
	"verified_at" timestamp with time zone,
	"expiry_date" date,
	"rejection_reason" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_retention_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_table" varchar(32) NOT NULL,
	"document_id" integer NOT NULL,
	"retention_basis" text,
	"retain_until" date,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"legal_hold_reason" text,
	"legal_hold_set_by" integer,
	"legal_hold_set_at" timestamp with time zone,
	"archive_status" "document_retention_archive_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" integer,
	"disposal_status" "document_retention_disposal_status" DEFAULT 'none' NOT NULL,
	"disposal_reason" text,
	"disposal_authorized_by" integer,
	"disposal_authorized_at" timestamp with time zone,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_version_id" integer,
	"status" "document_template_status" DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_template_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"format" "document_template_content_format" DEFAULT 'plain_text' NOT NULL,
	"status" "document_template_version_status" DEFAULT 'draft' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer,
	"template_version_id" integer,
	"category_code" text NOT NULL,
	"source_type" varchar(32),
	"source_id" integer,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"file_size" integer NOT NULL,
	"generated_by" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_category_settings" ADD CONSTRAINT "document_category_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_documents" ADD CONSTRAINT "organization_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_documents" ADD CONSTRAINT "organization_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_document_versions" ADD CONSTRAINT "organization_document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_document_versions" ADD CONSTRAINT "organization_document_versions_document_id_organization_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."organization_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_document_versions" ADD CONSTRAINT "organization_document_versions_superseded_by_users_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_document_versions" ADD CONSTRAINT "organization_document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_records" ADD CONSTRAINT "document_retention_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_records" ADD CONSTRAINT "document_retention_records_legal_hold_set_by_users_id_fk" FOREIGN KEY ("legal_hold_set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_records" ADD CONSTRAINT "document_retention_records_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_records" ADD CONSTRAINT "document_retention_records_disposal_authorized_by_users_id_fk" FOREIGN KEY ("disposal_authorized_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_version_id_document_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_category_settings_system_unique" ON "document_category_settings" USING btree ("category_code") WHERE "document_category_settings"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "document_category_settings_org_unique" ON "document_category_settings" USING btree ("category_code","organization_id") WHERE "document_category_settings"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "organization_documents_org_idx" ON "organization_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_documents_org_category_idx" ON "organization_documents" USING btree ("organization_id","category_code");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_document_versions_doc_version_unique" ON "organization_document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_document_versions_current_unique" ON "organization_document_versions" USING btree ("document_id") WHERE "organization_document_versions"."status" = 'current';--> statement-breakpoint
CREATE INDEX "organization_document_versions_org_idx" ON "organization_document_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_document_versions_document_idx" ON "organization_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "organization_document_versions_expiry_idx" ON "organization_document_versions" USING btree ("organization_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "document_requirements_owner_category_unique" ON "document_requirements" USING btree ("organization_id","owner_type","owner_id","category_code");--> statement-breakpoint
CREATE INDEX "document_requirements_owner_idx" ON "document_requirements" USING btree ("organization_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "document_requirements_org_status_idx" ON "document_requirements" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "document_requirements_expiry_idx" ON "document_requirements" USING btree ("organization_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "document_retention_records_document_unique" ON "document_retention_records" USING btree ("document_table","document_id");--> statement-breakpoint
CREATE INDEX "document_retention_records_org_archive_idx" ON "document_retention_records" USING btree ("organization_id","archive_status");--> statement-breakpoint
CREATE INDEX "document_retention_records_org_disposal_idx" ON "document_retention_records" USING btree ("organization_id","disposal_status");--> statement-breakpoint
CREATE INDEX "document_retention_records_retain_until_idx" ON "document_retention_records" USING btree ("organization_id","retain_until");--> statement-breakpoint
CREATE INDEX "document_templates_org_idx" ON "document_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_templates_org_category_idx" ON "document_templates" USING btree ("organization_id","category_code");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_template_version_unique" ON "document_template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_active_unique" ON "document_template_versions" USING btree ("template_id") WHERE "document_template_versions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "document_template_versions_org_idx" ON "document_template_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_template_versions_template_idx" ON "document_template_versions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "generated_documents_org_idx" ON "generated_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "generated_documents_source_idx" ON "generated_documents" USING btree ("organization_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "generated_documents_template_idx" ON "generated_documents" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_letter_template_id_document_templates_id_fk" FOREIGN KEY ("letter_template_id") REFERENCES "public"."document_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."document_category_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."organization_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."organization_document_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_retention_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."document_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."generated_documents" ENABLE ROW LEVEL SECURITY;