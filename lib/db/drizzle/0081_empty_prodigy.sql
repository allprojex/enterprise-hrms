CREATE TYPE "public"."vehicle_request_approval_purpose" AS ENUM('vehicle_request');--> statement-breakpoint
CREATE TYPE "public"."vehicle_request_authority_resolver" AS ENUM('department_head', 'permission_holder', 'specific_membership');--> statement-breakpoint
CREATE TYPE "public"."vehicle_request_cancellation_kind" AS ENUM('submitter', 'operational');--> statement-breakpoint
CREATE TYPE "public"."vehicle_request_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vehicle_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."vehicle_request_type" AS ENUM('employee', 'department');--> statement-breakpoint
CREATE TABLE "vehicle_request_approval_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"purpose" "vehicle_request_approval_purpose" NOT NULL,
	"stage_order" integer NOT NULL,
	"name" text NOT NULL,
	"resolver_type" "vehicle_request_authority_resolver" NOT NULL,
	"resolver_config" jsonb,
	"created_by_membership_id" integer,
	"updated_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_request_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_id" integer NOT NULL,
	"stage_order" integer NOT NULL,
	"stage_name_snapshot" text NOT NULL,
	"resolver_type_snapshot" "vehicle_request_authority_resolver" NOT NULL,
	"decision" "vehicle_request_decision" NOT NULL,
	"decided_by_membership_id" integer NOT NULL,
	"decided_by_user_id" integer,
	"acted_as_delegate" boolean DEFAULT false NOT NULL,
	"delegator_head_membership_id" integer,
	"reason" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_reference" text NOT NULL,
	"request_type" "vehicle_request_type" NOT NULL,
	"submitted_by_membership_id" integer NOT NULL,
	"requester_employee_id" integer,
	"requesting_department_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"destination" text,
	"planned_time_out" timestamp with time zone NOT NULL,
	"planned_time_in" timestamp with time zone NOT NULL,
	"status" "vehicle_request_status" DEFAULT 'pending' NOT NULL,
	"total_stages" integer NOT NULL,
	"current_stage_order" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_membership_id" integer,
	"cancellation_kind" "vehicle_request_cancellation_kind",
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_requests_planned_window_check" CHECK ("vehicle_requests"."planned_time_in" > "vehicle_requests"."planned_time_out")
);
--> statement-breakpoint
ALTER TABLE "vehicle_request_approval_stages" ADD CONSTRAINT "vehicle_request_approval_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approval_stages" ADD CONSTRAINT "vehicle_request_approval_stages_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approval_stages" ADD CONSTRAINT "vehicle_request_approval_stages_updated_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approvals" ADD CONSTRAINT "vehicle_request_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approvals" ADD CONSTRAINT "vehicle_request_approvals_request_id_vehicle_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."vehicle_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approvals" ADD CONSTRAINT "vehicle_request_approvals_decided_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("decided_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approvals" ADD CONSTRAINT "vehicle_request_approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_request_approvals" ADD CONSTRAINT "vehicle_request_approvals_delegator_head_membership_id_organization_memberships_id_fk" FOREIGN KEY ("delegator_head_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_submitted_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("submitted_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_requester_employee_id_employees_id_fk" FOREIGN KEY ("requester_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_requesting_department_id_departments_id_fk" FOREIGN KEY ("requesting_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_cancelled_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("cancelled_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_request_approval_stages_org_purpose_order_unique" ON "vehicle_request_approval_stages" USING btree ("organization_id","purpose","stage_order");--> statement-breakpoint
CREATE INDEX "vehicle_request_approval_stages_org_purpose_idx" ON "vehicle_request_approval_stages" USING btree ("organization_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_request_approvals_request_stage_unique" ON "vehicle_request_approvals" USING btree ("request_id","stage_order");--> statement-breakpoint
CREATE INDEX "vehicle_request_approvals_org_request_idx" ON "vehicle_request_approvals" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_requests_org_reference_unique" ON "vehicle_requests" USING btree ("organization_id","request_reference");--> statement-breakpoint
CREATE INDEX "vehicle_requests_org_department_status_idx" ON "vehicle_requests" USING btree ("organization_id","requesting_department_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_requests_org_submitter_idx" ON "vehicle_requests" USING btree ("organization_id","submitted_by_membership_id");--> statement-breakpoint
CREATE INDEX "vehicle_requests_org_vehicle_status_idx" ON "vehicle_requests" USING btree ("organization_id","vehicle_id","status");--> statement-breakpoint
CREATE INDEX "vehicle_requests_org_status_stage_idx" ON "vehicle_requests" USING btree ("organization_id","status","current_stage_order");--> statement-breakpoint
ALTER TABLE "public"."vehicle_request_approval_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."vehicle_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."vehicle_request_approvals" ENABLE ROW LEVEL SECURITY;
