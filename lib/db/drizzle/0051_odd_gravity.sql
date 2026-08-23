CREATE TYPE "public"."office_inventory_movement_condition" AS ENUM('new', 'good', 'fair', 'poor', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_movement_holder_type" AS ENUM('employee', 'department');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_movement_type" AS ENUM('received', 'issued', 'returned', 'transferred_out', 'transferred_in', 'adjustment_in', 'adjustment_out', 'written_off', 'missing', 'recovered', 'asset_handoff');--> statement-breakpoint
CREATE TYPE "public"."office_inventory_source_reference_type" AS ENUM('request_line', 'incident', 'stocktake_line', 'asset');--> statement-breakpoint
CREATE TABLE "office_inventory_stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"movement_type" "office_inventory_movement_type" NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"store_id" integer,
	"holder_type" "office_inventory_movement_holder_type",
	"holder_id" integer,
	"reference_number" text,
	"source_reference_type" "office_inventory_source_reference_type",
	"source_reference_id" integer,
	"source" text,
	"delivery_reference" text,
	"unit_cost" numeric(12, 2),
	"condition" "office_inventory_movement_condition",
	"reason" text,
	"expected_return_date" date,
	"confirmed_by_membership_id" integer,
	"confirmed_at" timestamp with time zone,
	"idempotency_key" text,
	"actor_membership_id" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "office_inventory_stock_movements" ADD CONSTRAINT "office_inventory_stock_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stock_movements" ADD CONSTRAINT "office_inventory_stock_movements_item_id_office_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."office_inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stock_movements" ADD CONSTRAINT "office_inventory_stock_movements_store_id_office_inventory_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."office_inventory_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stock_movements" ADD CONSTRAINT "office_inventory_stock_movements_confirmed_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("confirmed_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_inventory_stock_movements" ADD CONSTRAINT "office_inventory_stock_movements_actor_membership_id_organization_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "office_inventory_stock_movements_idempotency_unique" ON "office_inventory_stock_movements" USING btree ("organization_id","idempotency_key") WHERE "office_inventory_stock_movements"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "office_inventory_stock_movements_org_item_store_idx" ON "office_inventory_stock_movements" USING btree ("organization_id","item_id","store_id");--> statement-breakpoint
CREATE INDEX "office_inventory_stock_movements_org_item_holder_idx" ON "office_inventory_stock_movements" USING btree ("organization_id","item_id","holder_type","holder_id");--> statement-breakpoint
CREATE INDEX "office_inventory_stock_movements_source_ref_idx" ON "office_inventory_stock_movements" USING btree ("organization_id","source_reference_type","source_reference_id");--> statement-breakpoint
CREATE INDEX "office_inventory_stock_movements_reference_number_idx" ON "office_inventory_stock_movements" USING btree ("organization_id","reference_number");--> statement-breakpoint
ALTER TABLE "public"."office_inventory_stock_movements" ENABLE ROW LEVEL SECURITY;