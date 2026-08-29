-- Down migration for 0069 (WS-13 — Employee Data Change Approval & HR Service
-- Requests).
--
-- The up migration is PURELY ADDITIVE: eight new tables and nine new enum
-- types, with zero drops and zero altered columns anywhere. Nothing existing is
-- touched — `employees` keeps every column and constraint it had, WS-8's
-- `custom_forms`/`custom_form_submissions` gain no workflow state (§29.14),
-- WS-5's `generated_documents` and `employee_documents` are referenced but
-- unchanged (§29.13), and shipped Recruitment approval configuration is neither
-- read nor modified (§29.8).
--
-- This down migration is therefore a clean reversal. Tables are dropped in
-- dependency order so foreign keys never block the rollback.

DROP TABLE IF EXISTS "service_request_events";--> statement-breakpoint
DROP TABLE IF EXISTS "service_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "service_request_types";--> statement-breakpoint
DROP TABLE IF EXISTS "data_change_events";--> statement-breakpoint
DROP TABLE IF EXISTS "data_change_request_fields";--> statement-breakpoint
DROP TABLE IF EXISTS "data_change_requests";--> statement-breakpoint
DROP TABLE IF EXISTS "data_change_field_policies";--> statement-breakpoint
DROP TABLE IF EXISTS "request_approval_stages";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."service_request_event_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."service_request_approval_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."service_request_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."service_request_fulfilment_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."data_change_event_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."data_change_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."data_change_origin";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."request_authority_resolver";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."request_approval_purpose";
