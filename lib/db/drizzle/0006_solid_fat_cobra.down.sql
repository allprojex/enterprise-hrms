-- Rollback for 0006_solid_fat_cobra.sql (Roles, Permissions and Templates:
-- adds organization_id to `roles` so an org can copy a system role
-- template into its own customizable row). Reverses only what the up
-- migration added — existing role rows and their data are untouched
-- (organization_id was nullable and defaulted to null, so no data loss
-- from dropping it).

DROP INDEX IF EXISTS "roles_org_key_unique";
DROP INDEX IF EXISTS "roles_system_key_unique";
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_organization_id_organizations_id_fk";
ALTER TABLE "roles" DROP COLUMN IF EXISTS "organization_id";
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_unique" UNIQUE ("key");
