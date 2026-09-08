CREATE TABLE "form_submission_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"domain_type" varchar(32) NOT NULL,
	"domain_entity_id" integer NOT NULL,
	"relation_type" varchar(32) DEFAULT 'represents' NOT NULL,
	"created_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submission_links" ADD CONSTRAINT "form_submission_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_links" ADD CONSTRAINT "form_submission_links_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission_links" ADD CONSTRAINT "form_submission_links_created_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_links_unique" ON "form_submission_links" USING btree ("submission_id","domain_type","domain_entity_id","relation_type");--> statement-breakpoint
CREATE INDEX "form_submission_links_org_idx" ON "form_submission_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "form_submission_links_org_domain_idx" ON "form_submission_links" USING btree ("organization_id","domain_type","domain_entity_id");--> statement-breakpoint
ALTER TABLE "public"."form_submission_links" ENABLE ROW LEVEL SECURITY;
