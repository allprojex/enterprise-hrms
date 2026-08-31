-- Down migration for 0073 (WS-17 Slice 1 — deployment history, backup
-- policy/requests/evidence, telemetry, and platform-operation grants).
--
-- The up migration is PURELY ADDITIVE: six new tables and eight new enum
-- types, with zero drops, zero altered columns and zero touched rows anywhere
-- else. Nothing existing is modified, and that is deliberate:
--
--   `installations` and `installation_organizations` (WS-4) keep every column
--   they shipped with. WS-17 EXTENDS that registry rather than replacing it —
--   the current version/commit/migration/deployedAt columns remain the
--   current-state truth, and `installation_deployments` is the history behind
--   them, never a second competing current;
--   `permissions`, `roles`, `role_permissions` and `membership_roles` are
--   untouched: platform-operation keys are seeded into the existing catalogue,
--   but they are GRANTED on the user axis, which is why
--   `platform_operation_grants` exists rather than a change to membership
--   roles;
--   `stored_objects` and the storage backends (WS-17 storage Passes 0–2) are
--   read for aggregates only and are not modified.
--
-- Reversing therefore only removes what 0073 created. Dropping these tables
-- discards operational EVIDENCE — deployment history, backup evidence and
-- telemetry — which is why this is a development/rollback tool rather than a
-- routine operation. No business or HR data depends on any of it, and no
-- binary or tenant record is affected.
--
-- Order matters: backup_runs references backup_requests, so it goes first;
-- tables precede the enum types they use.

DROP TABLE IF EXISTS "installation_backup_runs";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_backup_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_backup_policies";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_deployments";--> statement-breakpoint
DROP TABLE IF EXISTS "installation_telemetry";--> statement-breakpoint
DROP TABLE IF EXISTS "platform_operation_grants";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_backup_component_result";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_backup_run_result";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_backup_request_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_backup_coverage";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_backup_strategy";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."installation_deployment_result";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."operational_executor_type";
