CREATE TYPE "public"."payroll_payment_batch_status" AS ENUM('draft', 'exported');--> statement-breakpoint
CREATE TYPE "public"."payroll_payment_method" AS ENUM('bank_transfer');--> statement-breakpoint
CREATE TABLE "payroll_payment_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"payroll_run_id" integer NOT NULL,
	"payment_method" "payroll_payment_method" DEFAULT 'bank_transfer' NOT NULL,
	"reference" text NOT NULL,
	"status" "payroll_payment_batch_status" DEFAULT 'draft' NOT NULL,
	"currency" text NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"employee_count" integer NOT NULL,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exported_at" timestamp with time zone,
	"exported_by_membership_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_payment_batch_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_batch_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"payroll_run_line_id" integer NOT NULL,
	"source_correction_id" integer,
	"employee_id" integer NOT NULL,
	"staff_number_snapshot" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"branch" text,
	"payment_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batches_exported_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("exported_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batch_lines" ADD CONSTRAINT "payroll_payment_batch_lines_payment_batch_id_payroll_payment_batches_id_fk" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payroll_payment_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batch_lines" ADD CONSTRAINT "payroll_payment_batch_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batch_lines" ADD CONSTRAINT "payroll_payment_batch_lines_payroll_run_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("payroll_run_line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batch_lines" ADD CONSTRAINT "payroll_payment_batch_lines_source_correction_id_payroll_corrections_id_fk" FOREIGN KEY ("source_correction_id") REFERENCES "public"."payroll_corrections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payment_batch_lines" ADD CONSTRAINT "payroll_payment_batch_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payment_batches_run_unique" ON "payroll_payment_batches" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payment_batches_reference_unique" ON "payroll_payment_batches" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "payroll_payment_batches_org_idx" ON "payroll_payment_batches" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payment_batch_lines_batch_line_unique" ON "payroll_payment_batch_lines" USING btree ("payment_batch_id","payroll_run_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payment_batch_lines_reference_unique" ON "payroll_payment_batch_lines" USING btree ("payment_reference");--> statement-breakpoint
CREATE INDEX "payroll_payment_batch_lines_batch_idx" ON "payroll_payment_batch_lines" USING btree ("payment_batch_id");--> statement-breakpoint
CREATE INDEX "payroll_payment_batch_lines_org_idx" ON "payroll_payment_batch_lines" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "payroll_payment_batch_lines_employee_idx" ON "payroll_payment_batch_lines" USING btree ("employee_id");--> statement-breakpoint
ALTER TABLE "public"."payroll_payment_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."payroll_payment_batch_lines" ENABLE ROW LEVEL SECURITY;