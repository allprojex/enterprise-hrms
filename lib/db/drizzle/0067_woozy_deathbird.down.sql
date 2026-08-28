-- Down migration for 0067 (WS-11 — Employment Lifecycle Events Expansion).
-- The up migration is additive only: two new tables and four new enum types.
-- Nothing existing is altered — in particular `employment_periods.eventType`
-- remains free text (§27.4) and `employment_status` is unchanged (§27.12).
DROP TABLE IF EXISTS "employment_assignments";--> statement-breakpoint
DROP TABLE IF EXISTS "employment_terms";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."secondment_destination_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employment_assignment_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employment_term_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."employment_term_status";
