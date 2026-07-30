CREATE TYPE "public"."application_score_type" AS ENUM('screening', 'interview', 'overall');--> statement-breakpoint
CREATE TABLE "application_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"vacancy_question_id" integer NOT NULL,
	"answer_text" text NOT NULL,
	"knockout_failed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"scored_by_membership_id" integer,
	"score_type" "application_score_type" NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_vacancy_question_id_vacancy_questions_id_fk" FOREIGN KEY ("vacancy_question_id") REFERENCES "public"."vacancy_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "application_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "application_scores_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_scores" ADD CONSTRAINT "application_scores_scored_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("scored_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_answers_application_question_unique" ON "application_answers" USING btree ("application_id","vacancy_question_id");--> statement-breakpoint
CREATE INDEX "application_answers_org_idx" ON "application_answers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "application_answers_application_idx" ON "application_answers" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_scores_org_idx" ON "application_scores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "application_scores_application_idx" ON "application_scores" USING btree ("application_id");