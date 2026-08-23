CREATE TYPE "public"."payroll_period_frequency" AS ENUM('monthly', 'bi_weekly', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('draft', 'calculated');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_line_component_source" AS ENUM('recurring', 'one_off');--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"frequency" "payroll_period_frequency" NOT NULL,
	"period_key" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"pay_date" timestamp with time zone NOT NULL,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"payroll_period_id" integer NOT NULL,
	"status" "payroll_run_status" DEFAULT 'draft' NOT NULL,
	"prepared_by_membership_id" integer,
	"approved_by_membership_id" integer,
	"locked_at" timestamp with time zone,
	"calculated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
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
	"currency" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_line_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"payroll_run_line_id" integer NOT NULL,
	"category" "payroll_compensation_category" NOT NULL,
	"component_type_code" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"taxable_treatment" "payroll_taxable_treatment" NOT NULL,
	"pensionable" boolean NOT NULL,
	"source" "payroll_run_line_component_source" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_input_references" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"payroll_period_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"category" "payroll_compensation_category" NOT NULL,
	"component_type_code" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"taxable_treatment" "payroll_taxable_treatment" DEFAULT 'ordinary' NOT NULL,
	"description" text,
	"created_by_membership_id" integer,
	"approved_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_prepared_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("prepared_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_paye_bands_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("paye_bands_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_pension_rates_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("pension_rates_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_pension_earnings_ceiling_version_id_payroll_statutory_rule_versions_id_fk" FOREIGN KEY ("pension_earnings_ceiling_version_id") REFERENCES "public"."payroll_statutory_rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_line_components" ADD CONSTRAINT "payroll_run_line_components_payroll_run_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("payroll_run_line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input_references" ADD CONSTRAINT "payroll_input_references_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input_references" ADD CONSTRAINT "payroll_input_references_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input_references" ADD CONSTRAINT "payroll_input_references_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input_references" ADD CONSTRAINT "payroll_input_references_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_input_references" ADD CONSTRAINT "payroll_input_references_approved_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_org_frequency_key_unique" ON "payroll_periods" USING btree ("organization_id","frequency","period_key");--> statement-breakpoint
CREATE INDEX "payroll_periods_org_idx" ON "payroll_periods" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_org_period_unique" ON "payroll_runs" USING btree ("organization_id","payroll_period_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_org_idx" ON "payroll_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_lines_run_employee_unique" ON "payroll_run_lines" USING btree ("payroll_run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_org_idx" ON "payroll_run_lines" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_employee_idx" ON "payroll_run_lines" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_line_components_line_idx" ON "payroll_run_line_components" USING btree ("payroll_run_line_id");--> statement-breakpoint
CREATE INDEX "payroll_input_references_org_period_idx" ON "payroll_input_references" USING btree ("organization_id","payroll_period_id");--> statement-breakpoint
CREATE INDEX "payroll_input_references_employee_idx" ON "payroll_input_references" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "public"."payroll_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_run_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_run_line_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_input_references" ENABLE ROW LEVEL SECURITY;