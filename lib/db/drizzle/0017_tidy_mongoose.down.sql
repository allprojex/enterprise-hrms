-- Rollback for 0017_tidy_mongoose.sql (Phase 2B, W33: Leave Requests — adds
-- the `leave_requests` table and its status enum). Purely additive in the
-- up direction — no existing table or row was touched — so this rollback
-- only drops what it created.

DROP TABLE IF EXISTS "leave_requests";
DROP TYPE IF EXISTS "public"."leave_request_status";
