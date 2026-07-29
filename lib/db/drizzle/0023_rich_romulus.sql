CREATE TYPE "public"."requisition_approval_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "requisition_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"requisition_id" integer NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"approver_membership_id" integer,
	"decision" "requisition_approval_decision" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD CONSTRAINT "requisition_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD CONSTRAINT "requisition_approvals_requisition_id_job_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."job_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisition_approvals" ADD CONSTRAINT "requisition_approvals_approver_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approver_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requisition_approvals_requisition_sequence_unique" ON "requisition_approvals" USING btree ("requisition_id","sequence");--> statement-breakpoint
CREATE INDEX "requisition_approvals_org_decision_idx" ON "requisition_approvals" USING btree ("organization_id","decision");--> statement-breakpoint
CREATE INDEX "requisition_approvals_requisition_idx" ON "requisition_approvals" USING btree ("requisition_id");