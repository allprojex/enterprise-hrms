CREATE TABLE "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" jsonb,
	"nationality" text,
	"work_authorization_status" text,
	"national_identifier_type" text,
	"national_identifier_value" text,
	"experience_summary" jsonb,
	"education_summary" jsonb,
	"skills" jsonb,
	"languages" jsonb,
	"source" text DEFAULT 'careers_portal' NOT NULL,
	"linked_internal_employee_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"privacy_notice_version" text NOT NULL,
	"consent_text" text NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"application_id" integer,
	"category_code" text DEFAULT 'resume' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"vacancy_id" integer NOT NULL,
	"current_stage_id" integer,
	"public_id" text NOT NULL,
	"source" text DEFAULT 'careers_portal' NOT NULL,
	"rejection_reason_code" text,
	"withdrawal_reason_code" text,
	"score" numeric(5, 2),
	"status_check_token" text,
	"status_check_token_expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_linked_internal_employee_id_employees_id_fk" FOREIGN KEY ("linked_internal_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_consents" ADD CONSTRAINT "candidate_consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_consents" ADD CONSTRAINT "candidate_consents_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_current_stage_id_recruitment_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."recruitment_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_org_email_unique" ON "candidates" USING btree ("organization_id",lower("email"));--> statement-breakpoint
CREATE INDEX "candidates_org_idx" ON "candidates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_consents_org_idx" ON "candidate_consents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_consents_candidate_idx" ON "candidate_consents" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_documents_org_idx" ON "candidate_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "candidate_documents_candidate_idx" ON "candidate_documents" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_documents_application_idx" ON "candidate_documents" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_candidate_vacancy_unique" ON "applications" USING btree ("candidate_id","vacancy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_public_id_unique" ON "applications" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_status_check_token_unique" ON "applications" USING btree ("status_check_token");--> statement-breakpoint
CREATE INDEX "applications_org_idx" ON "applications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "applications_vacancy_idx" ON "applications" USING btree ("vacancy_id");--> statement-breakpoint
CREATE INDEX "applications_candidate_idx" ON "applications" USING btree ("candidate_id");