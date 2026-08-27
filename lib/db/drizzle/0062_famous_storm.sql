CREATE TYPE "public"."migration_batch_status" AS ENUM('draft', 'mapped', 'validated', 'approved', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."migration_source_status" AS ENUM('uploaded', 'mapped', 'validated');--> statement-breakpoint
CREATE TYPE "public"."migration_row_execution_status" AS ENUM('pending', 'created', 'updated', 'matched', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."migration_row_operation" AS ENUM('create', 'match_existing', 'skip', 'error');--> statement-breakpoint
CREATE TYPE "public"."migration_row_validation_status" AS ENUM('pending', 'valid', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "migration_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" "migration_batch_status" DEFAULT 'draft' NOT NULL,
	"approved_sources_snapshot" jsonb,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"execution_started_at" timestamp with time zone,
	"execution_completed_at" timestamp with time zone,
	"execution_entity_type" text,
	"execution_cursor_row_id" integer,
	"reconciliation_summary" jsonb,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"sha256_digest" varchar(64) NOT NULL,
	"sheet_name" text,
	"column_mapping" jsonb,
	"row_count" integer,
	"status" "migration_source_status" DEFAULT 'uploaded' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_saved_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"entity_type" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"column_mapping" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_staged_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"normalized_data" jsonb NOT NULL,
	"operation" "migration_row_operation",
	"matched_entity_id" integer,
	"validation_status" "migration_row_validation_status" DEFAULT 'pending' NOT NULL,
	"validation_messages" jsonb,
	"execution_status" "migration_row_execution_status" DEFAULT 'pending' NOT NULL,
	"execution_result_id" integer,
	"execution_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "migration_batches" ADD CONSTRAINT "migration_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_batches" ADD CONSTRAINT "migration_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_batches" ADD CONSTRAINT "migration_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_sources" ADD CONSTRAINT "migration_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_sources" ADD CONSTRAINT "migration_sources_batch_id_migration_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."migration_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_sources" ADD CONSTRAINT "migration_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_saved_mappings" ADD CONSTRAINT "migration_saved_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_saved_mappings" ADD CONSTRAINT "migration_saved_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_staged_rows" ADD CONSTRAINT "migration_staged_rows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_staged_rows" ADD CONSTRAINT "migration_staged_rows_source_id_migration_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."migration_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "migration_batches_org_idx" ON "migration_batches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "migration_batches_org_status_idx" ON "migration_batches" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_sources_batch_entity_unique" ON "migration_sources" USING btree ("batch_id","entity_type");--> statement-breakpoint
CREATE INDEX "migration_sources_org_idx" ON "migration_sources" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "migration_sources_batch_idx" ON "migration_sources" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_saved_mappings_org_entity_name_unique" ON "migration_saved_mappings" USING btree ("organization_id","entity_type","name");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_staged_rows_source_row_unique" ON "migration_staged_rows" USING btree ("source_id","row_number");--> statement-breakpoint
CREATE INDEX "migration_staged_rows_source_validation_idx" ON "migration_staged_rows" USING btree ("source_id","validation_status");--> statement-breakpoint
CREATE INDEX "migration_staged_rows_source_execution_idx" ON "migration_staged_rows" USING btree ("source_id","execution_status");--> statement-breakpoint
ALTER TABLE "public"."migration_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."migration_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."migration_saved_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."migration_staged_rows" ENABLE ROW LEVEL SECURITY;