-- Down migration for 0066 (WS-10 — Onboarding, Induction & Handbook).
-- The up migration is additive only: seven new tables, nine new enum types and
-- two defaulted boolean columns on organization_documents. Dropping the two
-- columns is safe precisely because they carry a default and no pre-existing
-- row depended on them.
--
-- Tables are dropped in reverse dependency order: document_acknowledgements
-- references onboarding_instances, induction details and tasks reference
-- onboarding_tasks/onboarding_instances, and instances reference the template
-- tables.
DROP TABLE IF EXISTS "document_acknowledgements";--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_induction_details";--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_tasks";--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_instances";--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_template_tasks";--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_template_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "onboarding_templates";--> statement-breakpoint
ALTER TABLE "organization_documents" DROP COLUMN IF EXISTS "reacknowledge_on_new_version";--> statement-breakpoint
ALTER TABLE "organization_documents" DROP COLUMN IF EXISTS "requires_acknowledgement";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."acknowledgement_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."acknowledgement_audience";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."onboarding_task_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."onboarding_instance_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."induction_delivery_mode";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."onboarding_template_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."onboarding_task_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."onboarding_responsibility_resolver";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."onboarding_due_basis";
