CREATE TYPE "public"."records_location_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."custody_state" AS ENUM('in_registry', 'checked_out', 'missing');--> statement-breakpoint
CREATE TYPE "public"."personnel_file_volume_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."personnel_file_movement_event_type" AS ENUM('checked_out', 'returned', 'marked_missing', 'recovered');--> statement-breakpoint
CREATE TABLE "records_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"description" text,
	"status" "records_location_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_file_volumes" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"personnel_file_id" integer NOT NULL,
	"volume_number" integer NOT NULL,
	"status" "personnel_file_volume_status" DEFAULT 'open' NOT NULL,
	"current_location_id" integer,
	"current_custody_state" "custody_state" DEFAULT 'in_registry' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_file_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"personnel_file_id" integer NOT NULL,
	"volume_id" integer,
	"event_type" "personnel_file_movement_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_membership_id" integer,
	"purpose" text,
	"destination" text,
	"expected_return_date" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personnel_files" ADD COLUMN "current_location_id" integer;--> statement-breakpoint
ALTER TABLE "personnel_files" ADD COLUMN "current_custody_state" "custody_state" DEFAULT 'in_registry' NOT NULL;--> statement-breakpoint
ALTER TABLE "records_locations" ADD CONSTRAINT "records_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records_locations" ADD CONSTRAINT "records_locations_parent_id_records_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."records_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_volumes" ADD CONSTRAINT "personnel_file_volumes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_volumes" ADD CONSTRAINT "personnel_file_volumes_personnel_file_id_personnel_files_id_fk" FOREIGN KEY ("personnel_file_id") REFERENCES "public"."personnel_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_volumes" ADD CONSTRAINT "personnel_file_volumes_current_location_id_records_locations_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."records_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_movements" ADD CONSTRAINT "personnel_file_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_movements" ADD CONSTRAINT "personnel_file_movements_personnel_file_id_personnel_files_id_fk" FOREIGN KEY ("personnel_file_id") REFERENCES "public"."personnel_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_movements" ADD CONSTRAINT "personnel_file_movements_volume_id_personnel_file_volumes_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."personnel_file_volumes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_movements" ADD CONSTRAINT "personnel_file_movements_actor_membership_id_organization_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "records_locations_org_idx" ON "records_locations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "records_locations_org_parent_idx" ON "records_locations" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personnel_file_volumes_file_number_unique" ON "personnel_file_volumes" USING btree ("personnel_file_id","volume_number");--> statement-breakpoint
CREATE INDEX "personnel_file_movements_org_file_idx" ON "personnel_file_movements" USING btree ("organization_id","personnel_file_id");--> statement-breakpoint
CREATE INDEX "personnel_file_movements_org_volume_idx" ON "personnel_file_movements" USING btree ("organization_id","volume_id");--> statement-breakpoint
ALTER TABLE "personnel_files" ADD CONSTRAINT "personnel_files_current_location_id_records_locations_id_fk" FOREIGN KEY ("current_location_id") REFERENCES "public"."records_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."records_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."personnel_file_volumes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."personnel_file_movements" ENABLE ROW LEVEL SECURITY;