CREATE TABLE "employee_disciplinary_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"description" text NOT NULL,
	"action_date" timestamp with time zone NOT NULL,
	"recorded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_disciplinary_records" ADD CONSTRAINT "employee_disciplinary_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_disciplinary_records" ADD CONSTRAINT "employee_disciplinary_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_disciplinary_records" ADD CONSTRAINT "employee_disciplinary_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_disciplinary_records_org_employee_idx" ON "employee_disciplinary_records" USING btree ("organization_id","employee_id");