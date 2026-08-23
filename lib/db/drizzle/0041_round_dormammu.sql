CREATE TABLE "numbering_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sequence_key" text NOT NULL,
	"period_key" text DEFAULT '' NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_number_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"employee_number" text NOT NULL,
	"allocation_method" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"allocated_by_membership_id" integer,
	"released_by_membership_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "numbering_sequences" ADD CONSTRAINT "numbering_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_number_allocations" ADD CONSTRAINT "employee_number_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_number_allocations" ADD CONSTRAINT "employee_number_allocations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_number_allocations" ADD CONSTRAINT "employee_number_allocations_allocated_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("allocated_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_number_allocations" ADD CONSTRAINT "employee_number_allocations_released_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("released_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "numbering_sequences_org_key_period_unique" ON "numbering_sequences" USING btree ("organization_id","sequence_key","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_number_allocations_org_number_open_unique" ON "employee_number_allocations" USING btree ("organization_id","employee_number") WHERE "employee_number_allocations"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "employee_number_allocations_org_employee_idx" ON "employee_number_allocations" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "employee_number_allocations_org_number_idx" ON "employee_number_allocations" USING btree ("organization_id","employee_number");--> statement-breakpoint
ALTER TABLE "public"."numbering_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."employee_number_allocations" ENABLE ROW LEVEL SECURITY;