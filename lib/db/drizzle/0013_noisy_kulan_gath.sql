CREATE TABLE "employee_skills" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"skill_code" text NOT NULL,
	"proficiency_level" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_qualifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"qualification_type_code" text NOT NULL,
	"institution" text,
	"field_of_study" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"grade" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_certifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"certification_type_code" text NOT NULL,
	"issuing_organization" text,
	"issue_date" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"credential_id" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_skills_org_employee_idx" ON "employee_skills" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_qualifications_org_employee_idx" ON "employee_qualifications" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_certifications_org_employee_idx" ON "employee_certifications" USING btree ("organization_id","employee_id");