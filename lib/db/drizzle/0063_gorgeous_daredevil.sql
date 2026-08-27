CREATE TABLE "payroll_opening_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"cutover_date" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"gross_earnings" numeric(14, 2) NOT NULL,
	"taxable_income" numeric(14, 2) NOT NULL,
	"paye_amount" numeric(14, 2) NOT NULL,
	"pensionable_earnings" numeric(14, 2) NOT NULL,
	"employee_pension_deduction" numeric(14, 2) NOT NULL,
	"employer_pension_contribution" numeric(14, 2) NOT NULL,
	"source_reference_type" text,
	"source_reference_id" integer,
	"source_row_number" integer,
	"locked_at" timestamp with time zone,
	"created_by_membership_id" integer,
	"updated_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_opening_balances" ADD CONSTRAINT "payroll_opening_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_opening_balances" ADD CONSTRAINT "payroll_opening_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_opening_balances" ADD CONSTRAINT "payroll_opening_balances_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_opening_balances" ADD CONSTRAINT "payroll_opening_balances_updated_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_opening_balances_employee_year_unique" ON "payroll_opening_balances" USING btree ("organization_id","employee_id","tax_year");--> statement-breakpoint
CREATE INDEX "payroll_opening_balances_org_year_idx" ON "payroll_opening_balances" USING btree ("organization_id","tax_year");--> statement-breakpoint
ALTER TABLE "public"."payroll_opening_balances" ENABLE ROW LEVEL SECURITY;
