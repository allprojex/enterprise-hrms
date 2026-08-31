CREATE TYPE "public"."delegatable_authority_type" AS ENUM('department_head');--> statement-breakpoint
CREATE TABLE "authority_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"authority_type" "delegatable_authority_type" NOT NULL,
	"department_id" integer NOT NULL,
	"delegator_membership_id" integer NOT NULL,
	"delegate_membership_id" integer NOT NULL,
	"reason" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"revoked_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authority_delegations_no_self_delegation" CHECK ("authority_delegations"."delegate_membership_id" <> "authority_delegations"."delegator_membership_id"),
	CONSTRAINT "authority_delegations_valid_range" CHECK ("authority_delegations"."valid_to" is null or "authority_delegations"."valid_to" >= "authority_delegations"."valid_from"),
	CONSTRAINT "authority_delegations_reason_not_blank" CHECK ("authority_delegations"."reason" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "authority_delegations" ADD CONSTRAINT "authority_delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_delegations" ADD CONSTRAINT "authority_delegations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_delegations" ADD CONSTRAINT "authority_delegations_delegator_membership_id_organization_memberships_id_fk" FOREIGN KEY ("delegator_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_delegations" ADD CONSTRAINT "authority_delegations_delegate_membership_id_organization_memberships_id_fk" FOREIGN KEY ("delegate_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_delegations" ADD CONSTRAINT "authority_delegations_revoked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("revoked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authority_delegations_open_unique" ON "authority_delegations" USING btree ("organization_id","authority_type","department_id","delegator_membership_id") WHERE "authority_delegations"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "authority_delegations_org_scope_idx" ON "authority_delegations" USING btree ("organization_id","authority_type","department_id");--> statement-breakpoint
CREATE INDEX "authority_delegations_delegate_idx" ON "authority_delegations" USING btree ("delegate_membership_id");

-- WS-16 Pass 2B (§32.10). Row-level security ENABLED with ZERO policies, the
-- standing convention for every table in this schema: application-level
-- organizationId scoping remains the primary control, and RLS is defence in
-- depth against a query that forgets it. The service layer predicates
-- organization_id explicitly on every read and write regardless — a foreign
-- key proves a membership exists, never that it belongs to this tenant.
ALTER TABLE "public"."authority_delegations" ENABLE ROW LEVEL SECURITY;
