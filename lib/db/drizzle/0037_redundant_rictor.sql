CREATE TYPE "public"."attendance_event_source" AS ENUM('self_service', 'hr_manual', 'biometric', 'import');--> statement-breakpoint
CREATE TYPE "public"."attendance_event_type" AS ENUM('clock_in', 'clock_out');--> statement-breakpoint
CREATE TYPE "public"."attendance_adjustment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."attendance_adjustment_type" AS ENUM('manual_clock_in', 'manual_clock_out', 'mark_present', 'mark_absent', 'excuse_absence');--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"event_type" "attendance_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" "attendance_event_source" NOT NULL,
	"recorded_by_membership_id" integer,
	"branch_id" integer,
	"device_reference" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "attendance_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"date" date NOT NULL,
	"adjustment_type" "attendance_adjustment_type" NOT NULL,
	"corrected_clock_in" timestamp with time zone,
	"corrected_clock_out" timestamp with time zone,
	"reason" text NOT NULL,
	"status" "attendance_adjustment_status" DEFAULT 'pending' NOT NULL,
	"requested_by_membership_id" integer,
	"decided_by_membership_id" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_recorded_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("recorded_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_requested_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "attendance_adjustments_decided_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("decided_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_events_org_employee_idx" ON "attendance_events" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_events_employee_occurred_idx" ON "attendance_events" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attendance_adjustments_org_employee_idx" ON "attendance_adjustments" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_adjustments_employee_date_idx" ON "attendance_adjustments" USING btree ("employee_id","date");--> statement-breakpoint
ALTER TABLE "public"."attendance_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."attendance_adjustments" ENABLE ROW LEVEL SECURITY;