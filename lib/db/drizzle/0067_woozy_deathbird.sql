CREATE TYPE "public"."employment_term_status" AS ENUM('active', 'superseded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."employment_term_type" AS ENUM('permanent', 'fixed_term');--> statement-breakpoint
CREATE TYPE "public"."employment_assignment_type" AS ENUM('acting', 'secondment');--> statement-breakpoint
CREATE TYPE "public"."secondment_destination_type" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TABLE "employment_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"term_type" "employment_term_type" NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"status" "employment_term_status" DEFAULT 'active' NOT NULL,
	"renewed_from_term_id" integer,
	"reason" text,
	"closed_at" timestamp with time zone,
	"closed_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employment_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"assignment_type" "employment_assignment_type" NOT NULL,
	"acting_position_id" integer,
	"acting_department_id" integer,
	"destination_description" text,
	"destination_type" "secondment_destination_type",
	"start_date" timestamp with time zone NOT NULL,
	"expected_end_date" timestamp with time zone,
	"actual_end_date" timestamp with time zone,
	"reason" text,
	"end_reason" text,
	"created_by" integer,
	"ended_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_renewed_from_term_id_employment_terms_id_fk" FOREIGN KEY ("renewed_from_term_id") REFERENCES "public"."employment_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_terms" ADD CONSTRAINT "employment_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_acting_position_id_positions_id_fk" FOREIGN KEY ("acting_position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_acting_department_id_departments_id_fk" FOREIGN KEY ("acting_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_assignments" ADD CONSTRAINT "employment_assignments_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employment_terms_active_per_employee_unique" ON "employment_terms" USING btree ("organization_id","employee_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "employment_terms_org_employee_idx" ON "employment_terms" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employment_terms_expiry_idx" ON "employment_terms" USING btree ("organization_id","end_date");--> statement-breakpoint
CREATE INDEX "employment_terms_renewed_from_idx" ON "employment_terms" USING btree ("renewed_from_term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_assignments_open_per_type_unique" ON "employment_assignments" USING btree ("organization_id","employee_id","assignment_type") WHERE actual_end_date is null;--> statement-breakpoint
CREATE INDEX "employment_assignments_org_employee_idx" ON "employment_assignments" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employment_assignments_open_idx" ON "employment_assignments" USING btree ("organization_id","assignment_type","expected_end_date");--> statement-breakpoint
-- WS-11 — repository convention: every new tenant table is RLS-enabled with
-- ZERO policies (deny-by-default at the database). Real tenant isolation is
-- enforced in the application layer through requireMembership plus an explicit
-- organization_id predicate on every query; this is defence in depth, not the
-- primary control.
ALTER TABLE "public"."employment_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employment_assignments" ENABLE ROW LEVEL SECURITY;
