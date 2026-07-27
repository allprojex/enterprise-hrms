-- Rollback for 0007_smiling_nehzno.sql (Branch, Organizational Unit and
-- Position Completion: adds a `status` column to `departments` and
-- `positions`, mirroring `branches.status`, for the archive/reactivate
-- lifecycle). Purely additive in the up direction — no existing column or
-- row was touched — so this rollback only drops what it created.

ALTER TABLE "positions" DROP COLUMN IF EXISTS "status";
ALTER TABLE "departments" DROP COLUMN IF EXISTS "status";
DROP TYPE IF EXISTS "public"."position_status";
DROP TYPE IF EXISTS "public"."department_status";
