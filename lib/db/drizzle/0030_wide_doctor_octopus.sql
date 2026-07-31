CREATE TYPE "public"."interview_scorecard_recommendation" AS ENUM('strong_yes', 'yes', 'no', 'strong_no');--> statement-breakpoint
CREATE TABLE "interview_scorecards" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"interview_id" integer NOT NULL,
	"interviewer_membership_id" integer,
	"external_interviewer_token" text,
	"external_interviewer_token_expires_at" timestamp with time zone,
	"recommendation" "interview_scorecard_recommendation",
	"overall_comment" text,
	"submitted_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_scorecard_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"scorecard_id" integer NOT NULL,
	"criterion" text NOT NULL,
	"rating" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interviewer_membership_id_organization_memberships_id_fk" FOREIGN KEY ("interviewer_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecard_responses" ADD CONSTRAINT "interview_scorecard_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecard_responses" ADD CONSTRAINT "interview_scorecard_responses_scorecard_id_interview_scorecards_id_fk" FOREIGN KEY ("scorecard_id") REFERENCES "public"."interview_scorecards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_scorecards_interview_interviewer_unique" ON "interview_scorecards" USING btree ("interview_id","interviewer_membership_id");--> statement-breakpoint
CREATE INDEX "interview_scorecards_org_idx" ON "interview_scorecards" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "interview_scorecards_interview_idx" ON "interview_scorecards" USING btree ("interview_id");--> statement-breakpoint
CREATE INDEX "interview_scorecard_responses_org_idx" ON "interview_scorecard_responses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "interview_scorecard_responses_scorecard_idx" ON "interview_scorecard_responses" USING btree ("scorecard_id");