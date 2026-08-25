CREATE TYPE "public"."audit_category" AS ENUM('hr', 'payroll', 'security', 'documents', 'assets_inventory', 'platform_configuration');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failure', 'denied');--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "category" "audit_category" DEFAULT 'security' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "outcome" "audit_outcome";--> statement-breakpoint
CREATE INDEX "audit_events_category_idx" ON "audit_events" USING btree ("organization_id","category","occurred_at");