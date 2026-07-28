CREATE TYPE "public"."leave_balance_entry_type" AS ENUM('opening_balance', 'accrual', 'carry_forward', 'usage', 'reversal', 'expiry', 'manual_adjustment');--> statement-breakpoint
CREATE TABLE "leave_balance_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"leave_type_id" integer NOT NULL,
	"leave_policy_id" integer NOT NULL,
	"entry_type" "leave_balance_entry_type" NOT NULL,
	"amount" numeric(8, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text,
	"related_leave_request_id" integer,
	"source_reference" text,
	"created_by" integer,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_leave_policy_id_leave_policies_id_fk" FOREIGN KEY ("leave_policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_related_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("related_leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_balance_entries_org_employee_type_idx" ON "leave_balance_entries" USING btree ("organization_id","employee_id","leave_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balance_entries_request_type_unique" ON "leave_balance_entries" USING btree ("related_leave_request_id","entry_type") WHERE "leave_balance_entries"."related_leave_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balance_entries_source_reference_unique" ON "leave_balance_entries" USING btree ("organization_id","employee_id","leave_type_id","entry_type","source_reference") WHERE "leave_balance_entries"."source_reference" is not null;