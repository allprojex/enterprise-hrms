CREATE TYPE "public"."job_requisition_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'partially_filled', 'filled', 'cancelled', 'closed');--> statement-breakpoint
CREATE TYPE "public"."job_requisition_type" AS ENUM('new_role', 'replacement', 'temporary', 'internship', 'volunteer', 'contract', 'ministry');--> statement-breakpoint
CREATE TYPE "public"."job_requisition_workplace_type" AS ENUM('onsite', 'remote', 'hybrid');--> statement-breakpoint
CREATE TABLE "job_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"requisition_type" "job_requisition_type" NOT NULL,
	"position_id" integer,
	"department_id" integer,
	"branch_id" integer,
	"hiring_manager_employee_id" integer,
	"recruiter_employee_id" integer,
	"requested_headcount" integer NOT NULL,
	"filled_count" integer DEFAULT 0 NOT NULL,
	"employment_type" "employment_type",
	"workplace_type" "job_requisition_workplace_type",
	"expected_start_date" date,
	"salary_range_min" numeric(12, 2),
	"salary_range_max" numeric(12, 2),
	"salary_currency" text,
	"justification" text,
	"replacement_employee_id" integer,
	"status" "job_requisition_status" DEFAULT 'draft' NOT NULL,
	"cancellation_reason" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_hiring_manager_employee_id_employees_id_fk" FOREIGN KEY ("hiring_manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_recruiter_employee_id_employees_id_fk" FOREIGN KEY ("recruiter_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_replacement_employee_id_employees_id_fk" FOREIGN KEY ("replacement_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_requisitions_org_idx" ON "job_requisitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "job_requisitions_org_status_idx" ON "job_requisitions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "job_requisitions_recruiter_idx" ON "job_requisitions" USING btree ("recruiter_employee_id");--> statement-breakpoint
CREATE INDEX "job_requisitions_hiring_manager_idx" ON "job_requisitions" USING btree ("hiring_manager_employee_id");