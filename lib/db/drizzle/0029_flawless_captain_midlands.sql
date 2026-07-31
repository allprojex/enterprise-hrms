CREATE TYPE "public"."interview_status" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."interview_type" AS ENUM('phone', 'virtual', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."interview_panel_member_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"interview_type" "interview_type" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"location" text,
	"meeting_link" text,
	"status" "interview_status" DEFAULT 'scheduled' NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_panel_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"interview_id" integer NOT NULL,
	"interviewer_membership_id" integer,
	"external_interviewer_name" text,
	"external_interviewer_email" text,
	"role" "interview_panel_member_role" DEFAULT 'member' NOT NULL,
	"conflict_declared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel_members" ADD CONSTRAINT "interview_panel_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel_members" ADD CONSTRAINT "interview_panel_members_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panel_members" ADD CONSTRAINT "interview_panel_members_interviewer_membership_id_organization_memberships_id_fk" FOREIGN KEY ("interviewer_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_org_idx" ON "interviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "interviews_application_idx" ON "interviews" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_panel_members_interview_interviewer_unique" ON "interview_panel_members" USING btree ("interview_id","interviewer_membership_id") WHERE "interview_panel_members"."interviewer_membership_id" is not null;--> statement-breakpoint
CREATE INDEX "interview_panel_members_org_idx" ON "interview_panel_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "interview_panel_members_interview_idx" ON "interview_panel_members" USING btree ("interview_id");