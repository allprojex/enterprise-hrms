CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'in_use', 'maintenance', 'inactive');--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"registration_number" text NOT NULL,
	"make" text,
	"model" text,
	"description" text,
	"default_driver_employee_id" integer,
	"branch_id" integer,
	"status" "vehicle_status" DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_by_membership_id" integer,
	"updated_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_default_driver_employee_id_employees_id_fk" FOREIGN KEY ("default_driver_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_updated_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("updated_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_org_registration_unique" ON "vehicles" USING btree ("organization_id","registration_number");--> statement-breakpoint
CREATE INDEX "vehicles_org_status_idx" ON "vehicles" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "public"."vehicles" ENABLE ROW LEVEL SECURITY;