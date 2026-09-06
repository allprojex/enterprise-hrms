CREATE TYPE "public"."form_signature_method" AS ENUM('drawn', 'uploaded', 'device');--> statement-breakpoint
CREATE TYPE "public"."signature_asset_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "form_signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"revision_id" integer NOT NULL,
	"template_version_id" integer NOT NULL,
	"slot_key" text NOT NULL,
	"signer_user_id" integer NOT NULL,
	"signer_membership_id" integer NOT NULL,
	"represented_employee_id" integer,
	"authority" text NOT NULL,
	"stage_order" integer,
	"method" "form_signature_method" NOT NULL,
	"source_asset_id" integer,
	"device_provider" text,
	"device_metadata" jsonb,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"byte_size" integer,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"session_id_hash" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_membership_id" integer,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"owner_user_id" integer NOT NULL,
	"owner_membership_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"byte_size" integer,
	"status" "signature_asset_status" DEFAULT 'active' NOT NULL,
	"uploaded_by_membership_id" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_membership_id" integer,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_revision_id_form_submission_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."form_submission_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_template_version_id_form_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."form_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_signer_membership_id_organization_memberships_id_fk" FOREIGN KEY ("signer_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_represented_employee_id_employees_id_fk" FOREIGN KEY ("represented_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_source_asset_id_signature_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."signature_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_revoked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("revoked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_owner_membership_id_organization_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_uploaded_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("uploaded_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_assets" ADD CONSTRAINT "signature_assets_revoked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("revoked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_signatures_submission_slot_active_unique" ON "form_signatures" USING btree ("submission_id","slot_key") WHERE "form_signatures"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "form_signatures_org_idx" ON "form_signatures" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "form_signatures_submission_idx" ON "form_signatures" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "form_signatures_org_signer_idx" ON "form_signatures" USING btree ("organization_id","signer_user_id");--> statement-breakpoint
CREATE INDEX "signature_assets_org_owner_idx" ON "signature_assets" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "signature_assets_org_status_idx" ON "signature_assets" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "public"."signature_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."form_signatures" ENABLE ROW LEVEL SECURITY;
