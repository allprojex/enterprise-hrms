CREATE TYPE "public"."reference_background_check_status" AS ENUM('requested', 'in_progress', 'completed', 'flagged', 'unable_to_complete');--> statement-breakpoint
CREATE TABLE "reference_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"referee_name" text NOT NULL,
	"referee_contact" text NOT NULL,
	"referee_relationship" text,
	"status" "reference_background_check_status" DEFAULT 'requested' NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"check_type" text NOT NULL,
	"status" "reference_background_check_status" DEFAULT 'requested' NOT NULL,
	"vendor_reference" text,
	"result_summary" text,
	"document_storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reference_checks" ADD CONSTRAINT "reference_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_checks" ADD CONSTRAINT "reference_checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reference_checks_org_idx" ON "reference_checks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reference_checks_application_idx" ON "reference_checks" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "reference_checks_status_idx" ON "reference_checks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "background_checks_org_idx" ON "background_checks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "background_checks_application_idx" ON "background_checks" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "background_checks_status_idx" ON "background_checks" USING btree ("status");