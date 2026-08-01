CREATE TABLE "candidate_employee_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"converted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"converted_by_membership_id" integer
);
--> statement-breakpoint
ALTER TABLE "candidate_employee_links" ADD CONSTRAINT "candidate_employee_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_employee_links" ADD CONSTRAINT "candidate_employee_links_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_employee_links" ADD CONSTRAINT "candidate_employee_links_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_employee_links" ADD CONSTRAINT "candidate_employee_links_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_employee_links" ADD CONSTRAINT "candidate_employee_links_converted_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("converted_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_employee_links_application_unique" ON "candidate_employee_links" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_employee_links_employee_unique" ON "candidate_employee_links" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "candidate_employee_links_org_idx" ON "candidate_employee_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_employee_links_candidate_idx" ON "candidate_employee_links" USING btree ("candidate_id");