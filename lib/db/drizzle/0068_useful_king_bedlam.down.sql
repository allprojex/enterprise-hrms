-- Down migration for 0068 (WS-12 — Employee Relations & Offboarding Clearance).
--
-- The up migration is additive apart from one deliberate WIDENING: it drops the
-- NOT NULL on `employee_exit_processes.separation_date` so an offboarding may
-- begin before separation (§28.6). Restoring that constraint is therefore the
-- only step here that can fail, and it fails exactly when it should — if any row
-- has a null separation date, a real WS-12 offboarding is still running ahead of
-- its separation, and silently deleting or backdating it to satisfy a rollback
-- would destroy live work. Resolve those rows deliberately, then re-run.
--
-- Nothing else existing is altered: `employee_disciplinary_records` is untouched
-- (§28.2), the three legacy booleans on `employee_exit_processes` are untouched
-- (§28.8), and `employee_documents` keeps every pre-WS-12 column and behaviour
-- (§28.11).
--
-- `custom_field_scope` keeps its new 'exit_interview' member. PostgreSQL cannot
-- remove an enum value, and rewriting the type would rewrite a live column used
-- by every custom field in the platform — far more destructive than leaving one
-- unused member in place. With the exit_interviews table gone the scope is
-- simply unreachable, which is the same inert state an unused member always has.

DROP TABLE IF EXISTS "exit_interviews";--> statement-breakpoint
DROP TABLE IF EXISTS "clearance_items";--> statement-breakpoint
DROP TABLE IF EXISTS "clearance_template_items";--> statement-breakpoint
DROP TABLE IF EXISTS "clearance_templates";--> statement-breakpoint
DROP TABLE IF EXISTS "grievance_case_events";--> statement-breakpoint
DROP TABLE IF EXISTS "grievance_cases";--> statement-breakpoint
DROP TABLE IF EXISTS "disciplinary_case_events";--> statement-breakpoint
DROP TABLE IF EXISTS "disciplinary_cases";--> statement-breakpoint

DROP INDEX IF EXISTS "employee_exit_processes_open_per_employee_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "employee_exit_processes_org_status_idx";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP CONSTRAINT IF EXISTS "employee_exit_processes_final_cleared_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "final_cleared_by";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "final_cleared_at";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "clearance_template_id";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "expected_separation_date";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "separation_basis_recorded_at";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "separation_basis";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "employee_exit_processes" ALTER COLUMN "separation_date" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "employee_documents" DROP COLUMN IF EXISTS "confidentiality";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."exit_interview_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."clearance_item_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."clearance_item_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."clearance_template_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."grievance_case_event_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."grievance_case_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."grievance_respondent_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."disciplinary_case_event_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."disciplinary_case_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."case_confidentiality";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."exit_process_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."exit_separation_basis";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."document_confidentiality";
