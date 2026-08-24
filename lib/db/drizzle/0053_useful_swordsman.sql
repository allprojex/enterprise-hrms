CREATE TYPE "public"."office_inventory_incident_status" AS ENUM('open', 'reviewed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_incident_type" AS ENUM('damage', 'missing');--> statement-breakpoint
CREATE TABLE "office_inventory_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"holder_type" "office_inventory_movement_holder_type",
	"holder_id" integer,
	"incident_type" "office_inventory_incident_type" NOT NULL,
	"description" text NOT NULL,
	"reported_by_membership_id" integer NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "office_inventory_incident_status" DEFAULT 'open' NOT NULL,
	"reviewed_by_membership_id" integer,
	"reviewed_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_inventory_incidents" ADD CONSTRAINT "office_inventory_incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_incidents" ADD CONSTRAINT "office_inventory_incidents_item_id_office_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."office_inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_incidents" ADD CONSTRAINT "office_inventory_incidents_reported_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("reported_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_incidents" ADD CONSTRAINT "office_inventory_incidents_reviewed_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "office_inventory_incidents_org_item_idx" ON "office_inventory_incidents" USING btree ("organization_id","item_id");--> statement-breakpoint
CREATE INDEX "office_inventory_incidents_org_status_idx" ON "office_inventory_incidents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "office_inventory_incidents_org_holder_idx" ON "office_inventory_incidents" USING btree ("organization_id","holder_type","holder_id");--> statement-breakpoint
ALTER TABLE "public"."office_inventory_incidents" ENABLE ROW LEVEL SECURITY;