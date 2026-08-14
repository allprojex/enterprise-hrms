CREATE TYPE "public"."organization_domain_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."organization_domain_type" AS ENUM('platform_subdomain', 'custom_domain');--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"hostname" text NOT NULL,
	"domain_type" "organization_domain_type" NOT NULL,
	"status" "organization_domain_status" DEFAULT 'pending' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verification_token" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domains_hostname_unique" ON "organization_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "organization_domains_org_idx" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domains_org_primary_unique" ON "organization_domains" USING btree ("organization_id") WHERE "organization_domains"."is_primary" = true;