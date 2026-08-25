DROP INDEX IF EXISTS "audit_events_break_glass_grant_idx";
ALTER TABLE "audit_events" DROP COLUMN IF EXISTS "break_glass_grant_id";
DROP TABLE IF EXISTS "break_glass_grants";
DROP TABLE IF EXISTS "installation_organizations";
DROP TABLE IF EXISTS "installations";
DROP TYPE IF EXISTS "public"."break_glass_grant_status";
DROP TYPE IF EXISTS "public"."installation_status";
DROP TYPE IF EXISTS "public"."installation_hosting_model";
DROP TYPE IF EXISTS "public"."installation_environment_type";
