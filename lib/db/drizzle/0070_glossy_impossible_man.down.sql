-- Down migration for 0070 (WS-14 — Skills, Competency Framework & Succession).
--
-- The up migration is PURELY ADDITIVE: eleven new tables and nine new enum
-- types, with zero drops and zero altered columns anywhere. Nothing existing is
-- touched, and that is deliberate rather than incidental:
--
--   `employee_skills` (Phase 2A, W24) keeps every row, column and route it
--   shipped with (§30.22) — WS-14 built a new typed record beside it and
--   reinterpreted no legacy data;
--   Performance's competency and rating-scale tables are untouched (§30.2, §30.15);
--   the Learning module is referenced but never modified (§30.14);
--   `positions`, `employee_certifications` and `employee_qualifications` are
--   unchanged (§30.9, §30.20);
--   the `skill` Master Data domain and the shared `master_data_items` table are
--   untouched (§30.4).
--
-- This down migration is therefore a clean reversal. Tables drop in dependency
-- order so foreign keys never block the rollback.

DROP TABLE IF EXISTS "development_actions";--> statement-breakpoint
DROP TABLE IF EXISTS "succession_candidate_events";--> statement-breakpoint
DROP TABLE IF EXISTS "succession_candidates";--> statement-breakpoint
DROP TABLE IF EXISTS "succession_plans";--> statement-breakpoint
DROP TABLE IF EXISTS "readiness_levels";--> statement-breakpoint
DROP TABLE IF EXISTS "position_skill_requirements";--> statement-breakpoint
DROP TABLE IF EXISTS "employee_skill_assessments";--> statement-breakpoint
DROP TABLE IF EXISTS "employee_skill_records";--> statement-breakpoint
DROP TABLE IF EXISTS "proficiency_levels";--> statement-breakpoint
DROP TABLE IF EXISTS "proficiency_scales";--> statement-breakpoint
DROP TABLE IF EXISTS "skills";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."development_action_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."succession_candidate_event_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."succession_candidate_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."succession_plan_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."assessor_role";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employee_skill_assessment_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employee_skill_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employee_skill_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."skill_category";
