CREATE TYPE "public"."asset_condition" AS ENUM('new', 'good', 'fair', 'poor', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('available', 'assigned', 'maintenance', 'lost', 'retired');--> statement-breakpoint
CREATE TYPE "public"."asset_assignment_end_reason" AS ENUM('returned', 'lost', 'transferred', 'retired');--> statement-breakpoint
CREATE TYPE "public"."asset_maintenance_status" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."asset_incident_status" AS ENUM('open', 'reviewed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."asset_incident_type" AS ENUM('damage', 'loss');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"asset_tag" text NOT NULL,
	"category_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"manufacturer" text,
	"model" text,
	"serial_number" text,
	"branch_id" integer,
	"purchase_date" date,
	"purchase_cost" numeric(12, 2),
	"purchase_currency" text,
	"warranty_expiry_date" date,
	"condition" "asset_condition" DEFAULT 'good' NOT NULL,
	"status" "asset_status" DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"asset_tag_snapshot" text NOT NULL,
	"asset_name_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"department_id_snapshot" integer,
	"position_id_snapshot" integer,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by_membership_id" integer,
	"expected_return_date" date,
	"issue_condition" "asset_condition" NOT NULL,
	"issue_notes" text,
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_note" text,
	"custody_ended_at" timestamp with time zone,
	"end_reason" "asset_assignment_end_reason",
	"received_by_membership_id" integer,
	"return_condition" "asset_condition",
	"return_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_maintenance" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"maintenance_type" text NOT NULL,
	"description" text,
	"provider_text" text,
	"status" "asset_maintenance_status" DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cost" numeric(10, 2),
	"notes" text,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"employee_document_id" integer NOT NULL,
	"added_by_membership_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"assignment_id" integer NOT NULL,
	"reported_by_employee_id" integer NOT NULL,
	"incident_type" "asset_incident_type" NOT NULL,
	"description" text NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "asset_incident_status" DEFAULT 'open' NOT NULL,
	"reviewed_by_membership_id" integer,
	"reviewed_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_issued_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("issued_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_received_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("received_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_employee_document_id_employee_documents_id_fk" FOREIGN KEY ("employee_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_added_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("added_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_incidents" ADD CONSTRAINT "asset_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_incidents" ADD CONSTRAINT "asset_incidents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_incidents" ADD CONSTRAINT "asset_incidents_assignment_id_asset_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."asset_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_incidents" ADD CONSTRAINT "asset_incidents_reported_by_employee_id_employees_id_fk" FOREIGN KEY ("reported_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_incidents" ADD CONSTRAINT "asset_incidents_reviewed_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_tag_unique" ON "assets" USING btree ("organization_id","asset_tag");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_org_serial_unique" ON "assets" USING btree ("organization_id","serial_number") WHERE "assets"."serial_number" is not null;--> statement-breakpoint
CREATE INDEX "assets_org_status_idx" ON "assets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assets_org_category_idx" ON "assets" USING btree ("organization_id","category_code");--> statement-breakpoint
CREATE INDEX "assets_org_branch_idx" ON "assets" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_assignments_one_active_per_asset" ON "asset_assignments" USING btree ("asset_id") WHERE "asset_assignments"."custody_ended_at" is null;--> statement-breakpoint
CREATE INDEX "asset_assignments_org_asset_idx" ON "asset_assignments" USING btree ("organization_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_assignments_org_employee_idx" ON "asset_assignments" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "asset_assignments_expected_return_idx" ON "asset_assignments" USING btree ("organization_id","expected_return_date");--> statement-breakpoint
CREATE INDEX "asset_maintenance_org_asset_idx" ON "asset_maintenance" USING btree ("organization_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_maintenance_org_status_idx" ON "asset_maintenance" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "asset_maintenance_dates_idx" ON "asset_maintenance" USING btree ("started_at","completed_at");--> statement-breakpoint
CREATE INDEX "asset_evidence_org_asset_idx" ON "asset_evidence" USING btree ("organization_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_evidence_employee_document_idx" ON "asset_evidence" USING btree ("employee_document_id");--> statement-breakpoint
CREATE INDEX "asset_incidents_org_asset_idx" ON "asset_incidents" USING btree ("organization_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_incidents_org_status_idx" ON "asset_incidents" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."asset_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."asset_maintenance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."asset_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."asset_incidents" ENABLE ROW LEVEL SECURITY;