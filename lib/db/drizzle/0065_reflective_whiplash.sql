CREATE TYPE "public"."hire_authorization_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recruitment_approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."recruitment_approval_purpose" AS ENUM('requisition', 'hire');--> statement-breakpoint
CREATE TYPE "public"."recruitment_authority_resolver" AS ENUM('department_head', 'permission_holder', 'specific_membership');--> statement-breakpoint
CREATE TYPE "public"."offer_response_channel" AS ENUM('candidate_token', 'recorded_by_staff');--> statement-breakpoint
CREATE TYPE "public"."offer_response_type" AS ENUM('accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "hire_authorization_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"hire_authorization_id" integer NOT NULL,
	"stage_order" integer NOT NULL,
	"stage_name" text NOT NULL,
	"resolver_type" "recruitment_authority_resolver" NOT NULL,
	"authority_basis" text NOT NULL,
	"decision" "recruitment_approval_decision" NOT NULL,
	"reason" text,
	"decided_by_membership_id" integer,
	"decided_by_user_id" integer,
	"decided_by_name_snapshot" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hire_authorizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"status" "hire_authorization_status" DEFAULT 'pending' NOT NULL,
	"total_stages" integer NOT NULL,
	"current_stage_order" integer,
	"requested_by_membership_id" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_approval_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"purpose" "recruitment_approval_purpose" NOT NULL,
	"stage_order" integer NOT NULL,
	"name" text NOT NULL,
	"resolver_type" "recruitment_authority_resolver" NOT NULL,
	"resolver_config" jsonb,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_particulars" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"offer_version_id" integer NOT NULL,
	"employer_name" text,
	"worker_name" text,
	"date_of_first_appointment" timestamp with time zone,
	"job_title_or_grade" text,
	"pay_rate" text,
	"pay_method" text,
	"pay_interval" text,
	"hours_of_work" text,
	"holiday_terms" text,
	"sick_pay_terms" text,
	"pension_terms" text,
	"notice_by_employer" text,
	"notice_by_worker" text,
	"disciplinary_rules" text,
	"grievance_procedure" text,
	"overtime_terms" text,
	"probation_terms" text,
	"derived_from" jsonb,
	"issued_at" timestamp with time zone,
	"issued_by_membership_id" integer,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_response_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"offer_id" integer NOT NULL,
	"offer_version_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"offer_id" integer NOT NULL,
	"offer_version_id" integer NOT NULL,
	"response_type" "offer_response_type" NOT NULL,
	"channel" "offer_response_channel" NOT NULL,
	"reason" text,
	"evidence" jsonb,
	"responded_by_membership_id" integer,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD COLUMN "stage_name" text;--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD COLUMN "resolver_type" text;--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD COLUMN "authority_basis" text;--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD COLUMN "decided_by_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "source_code" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "source_code" text;--> statement-breakpoint
ALTER TABLE "hire_authorization_decisions" ADD CONSTRAINT "hire_authorization_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_authorization_decisions" ADD CONSTRAINT "hire_authorization_decisions_hire_authorization_id_hire_authorizations_id_fk" FOREIGN KEY ("hire_authorization_id") REFERENCES "public"."hire_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_authorization_decisions" ADD CONSTRAINT "hire_authorization_decisions_decided_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("decided_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_authorization_decisions" ADD CONSTRAINT "hire_authorization_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_authorizations" ADD CONSTRAINT "hire_authorizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_authorizations" ADD CONSTRAINT "hire_authorizations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hire_authorizations" ADD CONSTRAINT "hire_authorizations_requested_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_approval_stages" ADD CONSTRAINT "recruitment_approval_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_approval_stages" ADD CONSTRAINT "recruitment_approval_stages_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_particulars" ADD CONSTRAINT "employment_particulars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_particulars" ADD CONSTRAINT "employment_particulars_offer_version_id_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."offer_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_particulars" ADD CONSTRAINT "employment_particulars_issued_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("issued_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_particulars" ADD CONSTRAINT "employment_particulars_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_response_tokens" ADD CONSTRAINT "offer_response_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_response_tokens" ADD CONSTRAINT "offer_response_tokens_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_response_tokens" ADD CONSTRAINT "offer_response_tokens_offer_version_id_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."offer_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_response_tokens" ADD CONSTRAINT "offer_response_tokens_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_responses" ADD CONSTRAINT "offer_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_responses" ADD CONSTRAINT "offer_responses_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_responses" ADD CONSTRAINT "offer_responses_offer_version_id_offer_versions_id_fk" FOREIGN KEY ("offer_version_id") REFERENCES "public"."offer_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_responses" ADD CONSTRAINT "offer_responses_responded_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("responded_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hire_authorization_decisions_stage_unique" ON "hire_authorization_decisions" USING btree ("hire_authorization_id","stage_order");--> statement-breakpoint
CREATE INDEX "hire_authorization_decisions_org_idx" ON "hire_authorization_decisions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hire_authorizations_application_unique" ON "hire_authorizations" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "hire_authorizations_org_status_idx" ON "hire_authorizations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_approval_stages_org_purpose_order_unique" ON "recruitment_approval_stages" USING btree ("organization_id","purpose","stage_order");--> statement-breakpoint
CREATE INDEX "recruitment_approval_stages_org_purpose_idx" ON "recruitment_approval_stages" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_particulars_offer_version_unique" ON "employment_particulars" USING btree ("offer_version_id");--> statement-breakpoint
CREATE INDEX "employment_particulars_org_idx" ON "employment_particulars" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_response_tokens_hash_unique" ON "offer_response_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "offer_response_tokens_version_idx" ON "offer_response_tokens" USING btree ("offer_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_responses_version_unique" ON "offer_responses" USING btree ("offer_version_id");--> statement-breakpoint
CREATE INDEX "offer_responses_org_offer_idx" ON "offer_responses" USING btree ("organization_id","offer_id");
--> statement-breakpoint
ALTER TABLE "public"."recruitment_approval_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."hire_authorizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."hire_authorization_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employment_particulars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."offer_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."offer_response_tokens" ENABLE ROW LEVEL SECURITY;
