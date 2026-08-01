CREATE TYPE "public"."offer_version_status" AS ENUM('draft', 'pending_approval', 'approved', 'issued', 'accepted', 'declined', 'expired', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."offer_version_workplace_type" AS ENUM('onsite', 'remote', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."offer_approval_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"current_version_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"offer_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"proposed_start_date" date,
	"employment_type" "employment_type",
	"workplace_type" "offer_version_workplace_type",
	"location" text,
	"compensation_summary" jsonb,
	"conditions" text,
	"expiry_date" date,
	"letter_template_id" integer,
	"generated_document_storage_key" text,
	"status" "offer_version_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"offer_version_id" integer NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"approver_membership_id" integer,
	"decision" "offer_approval_decision" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_versions" ADD CONSTRAINT "offer_versions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_approvals" ADD CONSTRAINT "offer_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_approvals" ADD CONSTRAINT "offer_approvals_offer_version_id_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."offer_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_approvals" ADD CONSTRAINT "offer_approvals_approver_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approver_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_application_unique" ON "offers" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "offers_org_idx" ON "offers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_versions_offer_version_number_unique" ON "offer_versions" USING btree ("offer_id","version_number");--> statement-breakpoint
CREATE INDEX "offer_versions_org_idx" ON "offer_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "offer_versions_offer_idx" ON "offer_versions" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "offer_versions_status_idx" ON "offer_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_approvals_offer_version_sequence_unique" ON "offer_approvals" USING btree ("offer_version_id","sequence");--> statement-breakpoint
CREATE INDEX "offer_approvals_org_decision_idx" ON "offer_approvals" USING btree ("organization_id","decision");--> statement-breakpoint
CREATE INDEX "offer_approvals_offer_version_idx" ON "offer_approvals" USING btree ("offer_version_id");