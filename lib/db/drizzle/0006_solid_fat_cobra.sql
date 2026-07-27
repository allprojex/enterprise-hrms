ALTER TABLE "roles" DROP CONSTRAINT "roles_key_unique";--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "organization_id" integer;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_unique" ON "roles" USING btree ("key") WHERE "roles"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_key_unique" ON "roles" USING btree ("organization_id","key") WHERE "roles"."organization_id" is not null;