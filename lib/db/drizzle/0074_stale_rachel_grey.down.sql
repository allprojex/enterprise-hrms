-- Down migration for 0074 (WS-17 Restore Governance).
--
-- The up migration is ADDITIVE ONLY: four new tables, eight new enum types, and
-- ONE new column on `installations`. There are zero drops, zero altered column
-- types and zero rewritten rows.
--
-- The single change to an existing table is
-- `installations.restore_approval_policy`, added NOT NULL with a default of
-- 'always_required'. That default is the safety property: every pre-existing
-- installation acquires the STRICTEST setting automatically, so the migration
-- cannot relax authority anywhere. It also cannot relax production at all,
-- because the service ignores the column entirely when environmentType is
-- 'production'.
--
-- Nothing else is touched:
--
--   `installation_backup_runs` (WS-17 Slice 1) is referenced as a restore point
--   and as the pre-restore checkpoint, but never modified — restore reuses
--   backup evidence rather than duplicating it, so there is no restore-point
--   catalogue to unwind;
--   `installation_organizations` is read to derive blast radius and never
--   written; the affected-organization snapshot lives as JSON evidence on the
--   request, not as tenant rows;
--   `platform_operation_grants` already carried the reserved
--   platform.restore.request / platform.restore.approve keys and needed no
--   change.
--
-- Reversing therefore removes what 0074 created and drops the added column.
-- That discards restore governance EVIDENCE — requests, approvals, execution
-- attempts and validation results — which is why this is a development and
-- rollback tool, not a routine operation: §46 of the frozen scope requires that
-- restore history is never hard-deleted through ordinary application behaviour.
-- No business or HR data is affected, and no infrastructure state depends on it.
--
-- Order matters: validations and executions reference requests; approvals
-- reference requests; tables precede the enum types they use.

DROP TABLE IF EXISTS "installation_restore_validations";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_restore_executions";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_restore_approvals";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_restore_requests";--> statement-breakpoint
ALTER TABLE "installations" DROP COLUMN IF EXISTS "restore_approval_policy";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_restore_approval_policy";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_validation_source";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_validation_result";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_restore_execution_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_decision";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_restore_request_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_quiescence_state";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."pre_restore_checkpoint_state";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_completeness";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_point_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."restore_purpose";
