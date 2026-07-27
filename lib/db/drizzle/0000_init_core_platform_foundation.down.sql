-- Rollback for 0000_init_core_platform_foundation.sql
--
-- This reverses only the objects that are actually new relative to the
-- pre-existing schema (organizations, users, sessions, notifications
-- already exist independently of this migration — see drizzle/README.md).
-- Drops are ordered to satisfy foreign-key dependencies; nothing here
-- touches the original columns or data of the four pre-existing tables.

DROP TABLE IF EXISTS "audit_events";
DROP TABLE IF EXISTS "organization_relationships";
DROP TABLE IF EXISTS "employee_user_links";
DROP TABLE IF EXISTS "employees";
DROP TABLE IF EXISTS "primary_hr_assignments";
DROP TABLE IF EXISTS "membership_scopes";
DROP TABLE IF EXISTS "positions";
DROP TABLE IF EXISTS "departments";
DROP TABLE IF EXISTS "branches";
DROP TABLE IF EXISTS "membership_roles";
DROP TABLE IF EXISTS "organization_memberships";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "permissions";
DROP TABLE IF EXISTS "roles";
DROP TABLE IF EXISTS "organization_settings";

-- Must drop the FK column before the table it references.
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "organization_type_id";
DROP TABLE IF EXISTS "organization_types";

ALTER TABLE "sessions" DROP COLUMN IF EXISTS "active_organization_id";

DROP TYPE IF EXISTS "public"."membership_status";
DROP TYPE IF EXISTS "public"."branch_status";
DROP TYPE IF EXISTS "public"."membership_scope_type";
DROP TYPE IF EXISTS "public"."employment_status";
DROP TYPE IF EXISTS "public"."employment_type";
DROP TYPE IF EXISTS "public"."gender";
DROP TYPE IF EXISTS "public"."marital_status";
