CREATE TYPE "public"."office_inventory_item_classification" AS ENUM('consumable', 'returnable');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_item_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_store_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "department_heads" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"head_membership_id" integer NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"assigned_by_membership_id" integer,
	"revoked_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"item_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_code" text NOT NULL,
	"unit_of_measure" text NOT NULL,
	"classification" "office_inventory_item_classification" NOT NULL,
	"reorder_level" numeric(12, 2),
	"unit_cost" numeric(12, 2),
	"currency" text,
	"status" "office_inventory_item_status" DEFAULT 'active' NOT NULL,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_inventory_stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"branch_id" integer,
	"responsible_membership_id" integer,
	"status" "office_inventory_store_status" DEFAULT 'active' NOT NULL,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "department_heads" ADD CONSTRAINT "department_heads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_heads" ADD CONSTRAINT "department_heads_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_heads" ADD CONSTRAINT "department_heads_head_membership_id_organization_memberships_id_fk" FOREIGN KEY ("head_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_heads" ADD CONSTRAINT "department_heads_assigned_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("assigned_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_heads" ADD CONSTRAINT "department_heads_revoked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("revoked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_items" ADD CONSTRAINT "office_inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_items" ADD CONSTRAINT "office_inventory_items_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stores" ADD CONSTRAINT "office_inventory_stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stores" ADD CONSTRAINT "office_inventory_stores_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stores" ADD CONSTRAINT "office_inventory_stores_responsible_membership_id_organization_memberships_id_fk" FOREIGN KEY ("responsible_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stores" ADD CONSTRAINT "office_inventory_stores_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_heads_dept_open_unique" ON "department_heads" USING btree ("organization_id","department_id") WHERE "department_heads"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "department_heads_org_dept_idx" ON "department_heads" USING btree ("organization_id","department_id");--> statement-breakpoint
CREATE INDEX "department_heads_membership_idx" ON "department_heads" USING btree ("head_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_items_org_code_unique" ON "office_inventory_items" USING btree ("organization_id","item_code");--> statement-breakpoint
CREATE INDEX "office_inventory_items_org_category_idx" ON "office_inventory_items" USING btree ("organization_id","category_code");--> statement-breakpoint
CREATE INDEX "office_inventory_items_org_status_idx" ON "office_inventory_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_stores_org_code_unique" ON "office_inventory_stores" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "office_inventory_stores_org_idx" ON "office_inventory_stores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "office_inventory_stores_branch_idx" ON "office_inventory_stores" USING btree ("branch_id");--> statement-breakpoint
ALTER TABLE "public"."department_heads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."office_inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."office_inventory_stores" ENABLE ROW LEVEL SECURITY;