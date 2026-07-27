CREATE TYPE "public"."master_data_classification" AS ENUM('system-defined', 'organization-overridable', 'organization-defined');--> statement-breakpoint
CREATE TYPE "public"."master_data_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "master_data_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"classification" "master_data_classification" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_data_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" varchar(64) NOT NULL,
	"organization_id" integer,
	"code" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_data_items" ADD CONSTRAINT "master_data_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "master_data_domains_key_unique" ON "master_data_domains" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "master_data_items_system_unique" ON "master_data_items" USING btree ("domain","code") WHERE "master_data_items"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "master_data_items_org_unique" ON "master_data_items" USING btree ("domain","organization_id","code") WHERE "master_data_items"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "master_data_items_domain_org_idx" ON "master_data_items" USING btree ("domain","organization_id");