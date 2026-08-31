CREATE TYPE "public"."stored_object_backend" AS ENUM('filesystem', 's3');--> statement-breakpoint
CREATE TYPE "public"."stored_object_status" AS ENUM('stored', 'deleted', 'delete_failed', 'orphaned');--> statement-breakpoint
CREATE TABLE "stored_objects" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"backend" "stored_object_backend" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" text NOT NULL,
	"status" "stored_object_status" DEFAULT 'stored' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stored_objects_org_key_unique" ON "stored_objects" USING btree ("organization_id","storage_key");--> statement-breakpoint
CREATE INDEX "stored_objects_org_status_idx" ON "stored_objects" USING btree ("organization_id","status");

-- WS-17 File Storage Durability Pass 1. Row-level security ENABLED with
-- ZERO policies, the standing convention: application-level organizationId
-- scoping is the primary control and every query in fileStorage.ts predicates
-- it explicitly. This table holds binary PERSISTENCE facts only — never a
-- document title, owner, category, confidentiality or retention basis, all of
-- which remain owned by the WS-5 and module tables.
ALTER TABLE "public"."stored_objects" ENABLE ROW LEVEL SECURITY;
