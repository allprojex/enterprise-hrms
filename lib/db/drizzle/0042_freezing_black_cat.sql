CREATE TABLE "personnel_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"pif_number" text NOT NULL,
	"allocation_method" text NOT NULL,
	"allocated_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personnel_files_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
ALTER TABLE "personnel_files" ADD CONSTRAINT "personnel_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_files" ADD CONSTRAINT "personnel_files_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_files" ADD CONSTRAINT "personnel_files_allocated_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("allocated_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personnel_files_org_pif_number_unique" ON "personnel_files" USING btree ("organization_id","pif_number");--> statement-breakpoint
ALTER TABLE "public"."personnel_files" ENABLE ROW LEVEL SECURITY;