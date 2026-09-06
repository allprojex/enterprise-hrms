-- Down migration for 0076 (WS-26A — Tenant Form, Workflow & Signature Engine
-- foundation).
--
-- The up migration is PURELY ADDITIVE: six new tables and eight new enum
-- types, zero drops and zero altered columns. `custom_forms`,
-- `document_templates`, `generated_documents`, `request_approval_stages`,
-- `employees`, `leave_requests` and `performance_reviews` are referenced or
-- left alone, never modified.
--
-- This down migration is therefore a clean reversal: child tables first, then
-- parents, then the enum types. Nothing pre-existing is touched.
DROP TABLE IF EXISTS "form_submission_events";
DROP TABLE IF EXISTS "form_submission_revisions";
DROP TABLE IF EXISTS "form_submissions";
DROP TABLE IF EXISTS "form_workflow_stages";
DROP TABLE IF EXISTS "form_template_versions";
DROP TABLE IF EXISTS "form_templates";
DROP TYPE IF EXISTS "public"."form_submission_event_type";
DROP TYPE IF EXISTS "public"."form_revision_kind";
DROP TYPE IF EXISTS "public"."form_submission_status";
DROP TYPE IF EXISTS "public"."form_stage_resolver";
DROP TYPE IF EXISTS "public"."form_stage_participant";
DROP TYPE IF EXISTS "public"."form_template_version_status";
DROP TYPE IF EXISTS "public"."form_template_status";
DROP TYPE IF EXISTS "public"."form_template_type";
