-- Down migration for 0065 (WS-9 — Recruitment Completion).
-- The up migration is additive only: six new tables plus six nullable columns
-- on three existing tables. Dropping the columns is safe precisely because
-- they are nullable and no pre-existing row depended on them.
DROP TABLE IF EXISTS "offer_response_tokens";--> statement-breakpoint
DROP TABLE IF EXISTS "offer_responses";--> statement-breakpoint
DROP TABLE IF EXISTS "employment_particulars";--> statement-breakpoint
DROP TABLE IF EXISTS "hire_authorization_decisions";--> statement-breakpoint
DROP TABLE IF EXISTS "hire_authorizations";--> statement-breakpoint
DROP TABLE IF EXISTS "recruitment_approval_stages";--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN IF EXISTS "source_code";--> statement-breakpoint
ALTER TABLE "candidates" DROP COLUMN IF EXISTS "source_code";--> statement-breakpoint
ALTER TABLE "requisition_approvals" DROP COLUMN IF EXISTS "decided_by_name_snapshot";--> statement-breakpoint
ALTER TABLE "requisition_approvals" DROP COLUMN IF EXISTS "authority_basis";--> statement-breakpoint
ALTER TABLE "requisition_approvals" DROP COLUMN IF EXISTS "resolver_type";--> statement-breakpoint
ALTER TABLE "requisition_approvals" DROP COLUMN IF EXISTS "stage_name";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."offer_response_channel";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."offer_response_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."hire_authorization_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."recruitment_approval_decision";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."recruitment_authority_resolver";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."recruitment_approval_purpose";
