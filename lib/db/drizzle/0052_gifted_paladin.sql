CREATE TYPE "public"."office_inventory_request_line_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_request_status" AS ENUM('pending', 'partially_approved', 'approved', 'rejected', 'fulfilled', 'partially_fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_request_type" AS ENUM('employee', 'department');--> statement-breakpoint
CREATE TABLE "office_inventory_approval_delegations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"delegating_head_membership_id" integer NOT NULL,
	"delegate_membership_id" integer NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"created_by_membership_id" integer,
	"revoked_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_inventory_request_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity_requested" numeric(12, 2) NOT NULL,
	"approval_status" "office_inventory_request_line_approval_status" DEFAULT 'pending' NOT NULL,
	"approved_quantity" numeric(12, 2),
	"approved_by_membership_id" integer,
	"acted_as_delegate" boolean DEFAULT false NOT NULL,
	"delegator_head_membership_id" integer,
	"delegation_id" integer,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"quantity_issued_so_far" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_inventory_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"request_reference" text NOT NULL,
	"requested_by_membership_id" integer NOT NULL,
	"request_type" "office_inventory_request_type" NOT NULL,
	"for_employee_id" integer,
	"for_department_id" integer NOT NULL,
	"reason" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "office_inventory_request_status" DEFAULT 'pending' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_membership_id" integer
);
--> statement-breakpoint
ALTER TABLE "office_inventory_approval_delegations" ADD CONSTRAINT "office_inventory_approval_delegations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_approval_delegations" ADD CONSTRAINT "office_inventory_approval_delegations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_approval_delegations" ADD CONSTRAINT "office_inventory_approval_delegations_delegating_head_membership_id_organization_memberships_id_fk" FOREIGN KEY ("delegating_head_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_approval_delegations" ADD CONSTRAINT "office_inventory_approval_delegations_delegate_membership_id_organization_memberships_id_fk" FOREIGN KEY ("delegate_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_approval_delegations" ADD CONSTRAINT "office_inventory_approval_delegations_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_approval_delegations" ADD CONSTRAINT "office_inventory_approval_delegations_revoked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("revoked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_request_lines" ADD CONSTRAINT "office_inventory_request_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_request_lines" ADD CONSTRAINT "office_inventory_request_lines_request_id_office_inventory_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."office_inventory_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_request_lines" ADD CONSTRAINT "office_inventory_request_lines_item_id_office_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."office_inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_request_lines" ADD CONSTRAINT "office_inventory_request_lines_approved_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_request_lines" ADD CONSTRAINT "office_inventory_request_lines_delegator_head_membership_id_organization_memberships_id_fk" FOREIGN KEY ("delegator_head_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_request_lines" ADD CONSTRAINT "office_inventory_request_lines_delegation_id_office_inventory_approval_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."office_inventory_approval_delegations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_requests" ADD CONSTRAINT "office_inventory_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_requests" ADD CONSTRAINT "office_inventory_requests_requested_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_requests" ADD CONSTRAINT "office_inventory_requests_for_employee_id_employees_id_fk" FOREIGN KEY ("for_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_requests" ADD CONSTRAINT "office_inventory_requests_for_department_id_departments_id_fk" FOREIGN KEY ("for_department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_requests" ADD CONSTRAINT "office_inventory_requests_cancelled_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("cancelled_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_approval_delegations_open_unique" ON "office_inventory_approval_delegations" USING btree ("organization_id","department_id","delegating_head_membership_id") WHERE "office_inventory_approval_delegations"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "office_inventory_approval_delegations_org_dept_idx" ON "office_inventory_approval_delegations" USING btree ("organization_id","department_id");--> statement-breakpoint
CREATE INDEX "office_inventory_approval_delegations_delegate_idx" ON "office_inventory_approval_delegations" USING btree ("delegate_membership_id");--> statement-breakpoint
CREATE INDEX "office_inventory_request_lines_request_idx" ON "office_inventory_request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "office_inventory_request_lines_org_item_idx" ON "office_inventory_request_lines" USING btree ("organization_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_requests_org_reference_unique" ON "office_inventory_requests" USING btree ("organization_id","request_reference");--> statement-breakpoint
CREATE INDEX "office_inventory_requests_org_department_status_idx" ON "office_inventory_requests" USING btree ("organization_id","for_department_id","status");--> statement-breakpoint
CREATE INDEX "office_inventory_requests_org_requester_idx" ON "office_inventory_requests" USING btree ("organization_id","requested_by_membership_id");--> statement-breakpoint
CREATE INDEX "office_inventory_requests_for_employee_idx" ON "office_inventory_requests" USING btree ("for_employee_id");--> statement-breakpoint
ALTER TABLE "public"."office_inventory_approval_delegations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."office_inventory_request_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."office_inventory_requests" ENABLE ROW LEVEL SECURITY;