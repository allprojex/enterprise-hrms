CREATE TABLE "candidate_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"application_id" integer,
	"author_membership_id" integer,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "talent_pool_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"talent_pool_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"added_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_notes" ADD CONSTRAINT "candidate_notes_author_membership_id_organization_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_tags" ADD CONSTRAINT "candidate_tags_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pools" ADD CONSTRAINT "talent_pools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_talent_pool_id_talent_pools_id_fk" FOREIGN KEY ("talent_pool_id") REFERENCES "public"."talent_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_added_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("added_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_notes_org_idx" ON "candidate_notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_notes_candidate_idx" ON "candidate_notes" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_tags_candidate_tag_unique" ON "candidate_tags" USING btree ("candidate_id","tag");--> statement-breakpoint
CREATE INDEX "candidate_tags_org_idx" ON "candidate_tags" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_tags_candidate_idx" ON "candidate_tags" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_pools_org_name_unique" ON "talent_pools" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "talent_pools_org_idx" ON "talent_pools" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "talent_pool_members_pool_candidate_unique" ON "talent_pool_members" USING btree ("talent_pool_id","candidate_id");--> statement-breakpoint
CREATE INDEX "talent_pool_members_org_idx" ON "talent_pool_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "talent_pool_members_pool_idx" ON "talent_pool_members" USING btree ("talent_pool_id");--> statement-breakpoint
CREATE INDEX "talent_pool_members_candidate_idx" ON "talent_pool_members" USING btree ("candidate_id");