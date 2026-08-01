CREATE TYPE "public"."pre_employment_requirement_status" AS ENUM('pending', 'satisfied', 'waived');--> statement-breakpoint
CREATE TABLE "pre_employment_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"requirement_code" text NOT NULL,
	"status" "pre_employment_requirement_status" DEFAULT 'pending' NOT NULL,
	"satisfied_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pre_employment_requirements" ADD CONSTRAINT "pre_employment_requirements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_employment_requirements" ADD CONSTRAINT "pre_employment_requirements_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_employment_requirements_application_code_unique" ON "pre_employment_requirements" USING btree ("application_id","requirement_code");--> statement-breakpoint
CREATE INDEX "pre_employment_requirements_org_idx" ON "pre_employment_requirements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "pre_employment_requirements_application_idx" ON "pre_employment_requirements" USING btree ("application_id");