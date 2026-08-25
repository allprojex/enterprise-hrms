ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_disabled_by_users_id_fk";
ALTER TABLE "users" DROP COLUMN IF EXISTS "disabled_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "disabled_by";
ALTER TABLE "users" DROP COLUMN IF EXISTS "disabled_reason";
