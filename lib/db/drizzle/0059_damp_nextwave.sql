CREATE TYPE "public"."installation_environment_type" AS ENUM('development', 'staging', 'demo', 'production');--> statement-breakpoint
CREATE TYPE "public"."installation_hosting_model" AS ENUM('shared', 'dedicated_owner_managed', 'dedicated_customer_managed', 'other');--> statement-breakpoint
CREATE TYPE "public"."installation_status" AS ENUM('active', 'inactive', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."break_glass_grant_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "installations" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_key" text NOT NULL,
	"name" text NOT NULL,
	"environment_type" "installation_environment_type" NOT NULL,
	"hosting_model" "installation_hosting_model" NOT NULL,
	"hosting_provider" text,
	"primary_domain" text,
	"application_version" text,
	"git_commit" text,
	"migration_version" text,
	"deployed_at" timestamp with time zone,
	"health_url" text,
	"extension_profile" text,
	"status" "installation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installations_installation_key_unique" UNIQUE("installation_key")
);
--> statement-breakpoint
CREATE TABLE "installation_organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "break_glass_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer NOT NULL,
	"target_organization_id" integer NOT NULL,
	"target_installation_id" integer,
	"reason" text NOT NULL,
	"scope" jsonb NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer,
	"status" "break_glass_grant_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "break_glass_grant_id" integer;--> statement-breakpoint
ALTER TABLE "installation_organizations" ADD CONSTRAINT "installation_organizations_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_organizations" ADD CONSTRAINT "installation_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_target_organization_id_organizations_id_fk" FOREIGN KEY ("target_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_target_installation_id_installations_id_fk" FOREIGN KEY ("target_installation_id") REFERENCES "public"."installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "installation_organizations_active_unique" ON "installation_organizations" USING btree ("installation_id","organization_id") WHERE "installation_organizations"."unlinked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "installation_organizations_installation_idx" ON "installation_organizations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "installation_organizations_organization_idx" ON "installation_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "break_glass_grants_actor_idx" ON "break_glass_grants" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "break_glass_grants_target_org_idx" ON "break_glass_grants" USING btree ("target_organization_id","status");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_break_glass_grant_id_break_glass_grants_id_fk" FOREIGN KEY ("break_glass_grant_id") REFERENCES "public"."break_glass_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_break_glass_grant_idx" ON "audit_events" USING btree ("break_glass_grant_id");--> statement-breakpoint
ALTER TABLE "public"."installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."installation_organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."break_glass_grants" ENABLE ROW LEVEL SECURITY;