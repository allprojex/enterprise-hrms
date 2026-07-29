ALTER TABLE "leave_requests" DROP CONSTRAINT IF EXISTS "leave_requests_approved_by_users_id_fk";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "rejection_reason";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "approved_at";
ALTER TABLE "leave_requests" DROP COLUMN IF EXISTS "approved_by";
