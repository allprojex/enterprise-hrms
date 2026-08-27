-- Down migration for 0064 (WS-8 — Custom Fields & Form Builder).
-- Additive-only up: six new tables and their enums, nothing pre-existing
-- referenced them, so the reverse is a clean drop in dependency order.
DROP INDEX IF EXISTS "custom_form_versions_one_published";--> statement-breakpoint
DROP INDEX IF EXISTS "custom_field_definition_versions_one_current";--> statement-breakpoint
DROP TABLE IF EXISTS "custom_form_submissions";--> statement-breakpoint
DROP TABLE IF EXISTS "custom_form_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "custom_forms";--> statement-breakpoint
DROP TABLE IF EXISTS "custom_field_values";--> statement-breakpoint
DROP TABLE IF EXISTS "custom_field_definition_versions";--> statement-breakpoint
DROP TABLE IF EXISTS "custom_field_definitions";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_form_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_form_version_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_form_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_field_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_field_sensitivity";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_field_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."custom_field_scope";
