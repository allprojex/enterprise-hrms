DROP INDEX "organization_settings_org_unique";--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "namespace" varchar(64) DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_settings_org_namespace_unique" ON "organization_settings" USING btree ("organization_id","namespace");