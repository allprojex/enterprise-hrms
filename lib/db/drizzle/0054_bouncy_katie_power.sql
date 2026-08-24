CREATE TYPE "public"."office_inventory_stocktake_resolution_type" AS ENUM('recount', 'adjustment', 'missing');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_stocktake_status" AS ENUM('draft', 'counting', 'finalized');--> statement-breakpoint
CREATE TABLE "office_inventory_stocktake_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"stocktake_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"expected_quantity_snapshot" numeric(12, 2) NOT NULL,
	"counted_quantity" numeric(12, 2),
	"counted_by_membership_id" integer,
	"counted_at" timestamp with time zone,
	"variance" numeric(12, 2),
	"resolution_type" "office_inventory_stocktake_resolution_type",
	"resolution_movement_id" integer,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "office_inventory_stocktakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"stocktake_reference" text NOT NULL,
	"status" "office_inventory_stocktake_status" DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"started_by_membership_id" integer,
	"finalized_at" timestamp with time zone,
	"finalized_by_membership_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_inventory_stocktake_lines" ADD CONSTRAINT "office_inventory_stocktake_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktake_lines" ADD CONSTRAINT "office_inventory_stocktake_lines_stocktake_id_office_inventory_stocktakes_id_fk" FOREIGN KEY ("stocktake_id") REFERENCES "public"."office_inventory_stocktakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktake_lines" ADD CONSTRAINT "office_inventory_stocktake_lines_item_id_office_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."office_inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktake_lines" ADD CONSTRAINT "office_inventory_stocktake_lines_counted_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("counted_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktake_lines" ADD CONSTRAINT "office_inventory_stocktake_lines_resolution_movement_id_office_inventory_stock_movements_id_fk" FOREIGN KEY ("resolution_movement_id") REFERENCES "public"."office_inventory_stock_movements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktakes" ADD CONSTRAINT "office_inventory_stocktakes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktakes" ADD CONSTRAINT "office_inventory_stocktakes_store_id_office_inventory_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."office_inventory_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktakes" ADD CONSTRAINT "office_inventory_stocktakes_started_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("started_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stocktakes" ADD CONSTRAINT "office_inventory_stocktakes_finalized_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("finalized_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_stocktake_lines_stocktake_item_unique" ON "office_inventory_stocktake_lines" USING btree ("stocktake_id","item_id");--> statement-breakpoint
CREATE INDEX "office_inventory_stocktake_lines_org_item_idx" ON "office_inventory_stocktake_lines" USING btree ("organization_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_stocktakes_org_reference_unique" ON "office_inventory_stocktakes" USING btree ("organization_id","stocktake_reference");--> statement-breakpoint
CREATE INDEX "office_inventory_stocktakes_org_store_status_idx" ON "office_inventory_stocktakes" USING btree ("organization_id","store_id","status");--> statement-breakpoint
ALTER TABLE "public"."office_inventory_stocktake_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."office_inventory_stocktakes" ENABLE ROW LEVEL SECURITY;