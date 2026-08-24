ALTER TABLE "leave_requests" DROP CONSTRAINT IF EXISTS "leave_requests_department_head_approved_by_users_id_fk";
ALTER TABLE "leave_requests" DROP CONSTRAINT IF EXISTS "leave_requests_department_head_rejected_by_users_id_fk";
ALTER TABLE "leave_requests" DROP CONSTRAINT IF EXISTS "leave_requests_rejected_by_users_id_fk";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "department_head_approved_by";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "department_head_approved_at";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "department_head_rejected_by";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "department_head_rejected_at";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "department_head_rejection_reason";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "rejected_by";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "rejected_at";
-- Postgres has no ALTER TYPE ... DROP VALUE: removing 'pending_hr' from
-- leave_request_status is not reversible without rebuilding the enum type
-- (rename, recreate, migrate column, drop old) — not done here since no
-- production data depends on this value existing or not existing at
-- rollback time for this workstream.
