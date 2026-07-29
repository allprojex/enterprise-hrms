CREATE TYPE "public"."public_holiday_scope" AS ENUM('organization', 'branch', 'region', 'national');--> statement-breakpoint
CREATE TYPE "public"."public_holiday_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"scope" "public_holiday_scope" DEFAULT 'organization' NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"observed_date" date,
	"effective_year" integer,
	"description" text,
	"status" "public_holiday_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_org_date_name_unique" ON "public_holidays" USING btree ("organization_id","date","name");--> statement-breakpoint
CREATE INDEX "public_holidays_org_status_idx" ON "public_holidays" USING btree ("organization_id","status");