-- Down migration for 0081 (VR-02A — Vehicle Request domain foundation).
-- Purely additive up-migration: three new tables and six new enum types, no
-- altered columns on any existing table. vehicles / departments / employees /
-- organizations / organization_memberships / users are referenced only, and
-- VR-01's own vehicle_status enum is untouched.
-- Clean reversal: drop the children before their parent, then the enum types
-- they own.
DROP TABLE IF EXISTS "vehicle_request_approvals";--> statement-breakpoint
DROP TABLE IF EXISTS "vehicle_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "vehicle_request_approval_stages";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_request_cancellation_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_request_decision";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_request_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_request_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_request_authority_resolver";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_request_approval_purpose";
