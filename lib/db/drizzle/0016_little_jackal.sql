CREATE TYPE "public"."leave_type_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."leave_accrual_method" AS ENUM('annual', 'monthly', 'per_pay_period', 'none');--> statement-breakpoint
CREATE TYPE "public"."leave_entitlement_period" AS ENUM('calendar_year', 'anniversary_year');--> statement-breakpoint
CREATE TYPE "public"."leave_policy_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" "leave_type_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"name" text NOT NULL,
	"employment_type" "employment_type",
	"branch_id" integer,
	"department_id" integer,
	"position_id" integer,
	"gender" "gender",
	"minimum_service_months" integer,
	"probation_restricted" boolean DEFAULT false NOT NULL,
	"annual_entitlement_days" numeric(6, 2) NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual_method" "leave_accrual_method" DEFAULT 'annual' NOT NULL,
	"accrual_rate" numeric(6, 2),
	"entitlement_period" "leave_entitlement_period" DEFAULT 'calendar_year' NOT NULL,
	"carry_forward_allowed" boolean DEFAULT false NOT NULL,
	"max_carry_forward_days" numeric(6, 2),
	"carry_forward_expiry_months" integer,
	"min_request_duration_days" numeric(6, 2),
	"max_request_duration_days" numeric(6, 2),
	"notice_period_days" integer,
	"attachment_required" boolean DEFAULT false NOT NULL,
	"count_weekends" boolean DEFAULT false NOT NULL,
	"count_public_holidays" boolean DEFAULT false NOT NULL,
	"allow_negative_balance" boolean DEFAULT false NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"status" "leave_policy_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_org_code_unique" ON "leave_types" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "leave_types_org_idx" ON "leave_types" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leave_policies_org_type_idx" ON "leave_policies" USING btree ("organization_id","leave_type_id");