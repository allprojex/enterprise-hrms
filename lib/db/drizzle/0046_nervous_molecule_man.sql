CREATE TYPE "public"."payroll_compensation_category" AS ENUM('earning', 'deduction');--> statement-breakpoint
CREATE TYPE "public"."payroll_taxable_treatment" AS ENUM('ordinary', 'benefit_in_kind', 'bonus', 'overtime');--> statement-breakpoint
CREATE TABLE "employee_compensation_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"category" "payroll_compensation_category" NOT NULL,
	"component_type_code" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"recurring" boolean DEFAULT true NOT NULL,
	"taxable_treatment" "payroll_taxable_treatment" DEFAULT 'ordinary' NOT NULL,
	"pensionable" boolean DEFAULT false NOT NULL,
	"source_reference_type" text,
	"source_reference_id" integer,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_banking_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"branch" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_statutory_identifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"ssnit_number" text,
	"tin" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_compensation_components" ADD CONSTRAINT "employee_compensation_components_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_compensation_components" ADD CONSTRAINT "employee_compensation_components_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_compensation_components" ADD CONSTRAINT "employee_compensation_components_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_banking_details" ADD CONSTRAINT "employee_banking_details_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_banking_details" ADD CONSTRAINT "employee_banking_details_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_banking_details" ADD CONSTRAINT "employee_banking_details_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_statutory_identifiers" ADD CONSTRAINT "employee_statutory_identifiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_statutory_identifiers" ADD CONSTRAINT "employee_statutory_identifiers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_statutory_identifiers" ADD CONSTRAINT "employee_statutory_identifiers_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_compensation_components_open_unique" ON "employee_compensation_components" USING btree ("employee_id","category","component_type_code") WHERE "employee_compensation_components"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "employee_compensation_components_org_employee_idx" ON "employee_compensation_components" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_banking_details_open_unique" ON "employee_banking_details" USING btree ("employee_id") WHERE "employee_banking_details"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "employee_banking_details_org_employee_idx" ON "employee_banking_details" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_statutory_identifiers_open_unique" ON "employee_statutory_identifiers" USING btree ("employee_id") WHERE "employee_statutory_identifiers"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "employee_statutory_identifiers_org_employee_idx" ON "employee_statutory_identifiers" USING btree ("organization_id","employee_id");--> statement-breakpoint
ALTER TABLE "public"."employee_compensation_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employee_banking_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employee_statutory_identifiers" ENABLE ROW LEVEL SECURITY;