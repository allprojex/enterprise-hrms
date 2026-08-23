CREATE TYPE "public"."payroll_correction_status" AS ENUM('draft', 'approved');--> statement-breakpoint
ALTER TYPE "public"."payroll_run_status" ADD VALUE 'approved';--> statement-breakpoint
ALTER TYPE "public"."payroll_run_status" ADD VALUE 'locked';--> statement-breakpoint
CREATE TABLE "payroll_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"original_run_id" integer NOT NULL,
	"original_run_line_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"status" "payroll_correction_status" DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"staff_number_snapshot" text,
	"paye_bands_version_id" integer,
	"pension_rates_version_id" integer,
	"pension_earnings_ceiling_version_id" integer,
	"gross_earnings" numeric(12, 2) NOT NULL,
	"pensionable_earnings" numeric(12, 2) NOT NULL,
	"employee_pension_deduction" numeric(12, 2) NOT NULL,
	"employer_pension_contribution" numeric(12, 2) NOT NULL,
	"tier1_amount" numeric(12, 2) NOT NULL,
	"tier2_amount" numeric(12, 2) NOT NULL,
	"taxable_income" numeric(12, 2) NOT NULL,
	"paye_amount" numeric(12, 2) NOT NULL,
	"other_deductions" numeric(12, 2) NOT NULL,
	"net_pay" numeric(12, 2) NOT NULL,
	"net_pay_delta" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"created_by_membership_id" integer,
	"approved_by_membership_id" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_correction_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_correction_id" integer NOT NULL,
	"category" "payroll_compensation_category" NOT NULL,
	"component_type_code" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"taxable_treatment" "payroll_taxable_treatment" NOT NULL,
	"pensionable" boolean NOT NULL,
	"source" "payroll_run_line_component_source" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_original_run_id_payroll_runs_id_fk" FOREIGN KEY ("original_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_original_run_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("original_run_line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_paye_bands_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("paye_bands_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_pension_rates_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("pension_rates_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_pension_earnings_ceiling_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("pension_earnings_ceiling_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_corrections" ADD CONSTRAINT "payroll_corrections_approved_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_correction_components" ADD CONSTRAINT "payroll_correction_components_payroll_correction_id_payroll_corrections_id_fk" FOREIGN KEY ("payroll_correction_id") REFERENCES "public"."payroll_corrections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_corrections_open_draft_per_line_unique" ON "payroll_corrections" USING btree ("original_run_line_id") WHERE "payroll_corrections"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "payroll_corrections_org_idx" ON "payroll_corrections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payroll_corrections_original_run_idx" ON "payroll_corrections" USING btree ("original_run_id");--> statement-breakpoint
CREATE INDEX "payroll_corrections_employee_idx" ON "payroll_corrections" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_correction_components_correction_idx" ON "payroll_correction_components" USING btree ("payroll_correction_id");--> statement-breakpoint
ALTER TABLE "public"."payroll_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_correction_components" ENABLE ROW LEVEL SECURITY;