CREATE TYPE "public"."payroll_statutory_rule_status" AS ENUM('draft', 'validated', 'approved');--> statement-breakpoint
CREATE TYPE "public"."payroll_statutory_rule_type" AS ENUM('paye_bands', 'pension_rates', 'pension_earnings_ceiling');--> statement-breakpoint
CREATE TYPE "public"."payroll_paye_taxpayer_category" AS ENUM('resident', 'non_resident');--> statement-breakpoint
CREATE TABLE "payroll_statutory_rule_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"rule_type" "payroll_statutory_rule_type" NOT NULL,
	"status" "payroll_statutory_rule_status" DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by_membership_id" integer NOT NULL,
	"approved_by_membership_id" integer,
	"approved_at" timestamp with time zone,
	"source_url" text,
	"source_description" text,
	"source_retrieved_at" timestamp with time zone,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"reason_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_paye_bands" (
	"id" serial PRIMARY KEY NOT NULL,
	"statutory_rule_version_id" integer NOT NULL,
	"band_order" integer NOT NULL,
	"taxpayer_category" "payroll_paye_taxpayer_category" DEFAULT 'resident' NOT NULL,
	"threshold_amount" numeric(14, 2),
	"rate_percent" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_pension_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"statutory_rule_version_id" integer NOT NULL,
	"employee_rate_percent" numeric(5, 2) NOT NULL,
	"employer_rate_percent" numeric(5, 2) NOT NULL,
	"tier1_allocation_percent" numeric(5, 2) NOT NULL,
	"tier2_allocation_percent" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_pension_earnings_ceiling" (
	"id" serial PRIMARY KEY NOT NULL,
	"statutory_rule_version_id" integer NOT NULL,
	"minimum_insurable_earnings" numeric(14, 2),
	"maximum_insurable_earnings" numeric(14, 2)
);
--> statement-breakpoint
ALTER TABLE "payroll_statutory_rule_versions" ADD CONSTRAINT "payroll_statutory_rule_versions_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statutory_rule_versions" ADD CONSTRAINT "payroll_statutory_rule_versions_approved_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_paye_bands" ADD CONSTRAINT "payroll_paye_bands_statutory_rule_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("statutory_rule_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_pension_rates" ADD CONSTRAINT "payroll_pension_rates_statutory_rule_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("statutory_rule_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_pension_earnings_ceiling" ADD CONSTRAINT "payroll_pension_earnings_ceiling_statutory_rule_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("statutory_rule_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_statutory_rule_versions_open_approved_unique" ON "payroll_statutory_rule_versions" USING btree ("rule_type") WHERE "payroll_statutory_rule_versions"."status" = 'approved' and "payroll_statutory_rule_versions"."effective_to" is null;--> statement-breakpoint
CREATE INDEX "payroll_statutory_rule_versions_rule_type_idx" ON "payroll_statutory_rule_versions" USING btree ("rule_type");--> statement-breakpoint
CREATE INDEX "payroll_statutory_rule_versions_status_idx" ON "payroll_statutory_rule_versions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_paye_bands_version_category_order_unique" ON "payroll_paye_bands" USING btree ("statutory_rule_version_id","taxpayer_category","band_order");--> statement-breakpoint
CREATE INDEX "payroll_paye_bands_version_idx" ON "payroll_paye_bands" USING btree ("statutory_rule_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_pension_rates_version_unique" ON "payroll_pension_rates" USING btree ("statutory_rule_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_pension_earnings_ceiling_version_unique" ON "payroll_pension_earnings_ceiling" USING btree ("statutory_rule_version_id");--> statement-breakpoint
ALTER TABLE "public"."payroll_statutory_rule_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_paye_bands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_pension_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_pension_earnings_ceiling" ENABLE ROW LEVEL SECURITY;