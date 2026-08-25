DROP INDEX IF EXISTS "audit_events_category_idx";
ALTER TABLE "audit_events" DROP COLUMN IF EXISTS "outcome";
ALTER TABLE "audit_events" DROP COLUMN IF EXISTS "request_id";
ALTER TABLE "audit_events" DROP COLUMN IF EXISTS "category";
DROP TYPE IF EXISTS "public"."audit_outcome";
DROP TYPE IF EXISTS "public"."audit_category";
