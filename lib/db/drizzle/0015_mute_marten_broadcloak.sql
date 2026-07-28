CREATE TABLE "employee_exit_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"separation_date" timestamp with time zone NOT NULL,
	"checklist_completed" boolean DEFAULT false NOT NULL,
	"clearance_completed" boolean DEFAULT false NOT NULL,
	"exit_interview_completed" boolean DEFAULT false NOT NULL,
	"exit_interview_notes" text,
	"initiated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD CONSTRAINT "employee_exit_processes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD CONSTRAINT "employee_exit_processes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ADD CONSTRAINT "employee_exit_processes_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_exit_processes_org_employee_idx" ON "employee_exit_processes" USING btree ("organization_id","employee_id");