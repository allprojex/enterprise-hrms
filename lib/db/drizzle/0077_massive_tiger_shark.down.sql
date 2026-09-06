-- Down migration for 0077 (WS-26B — Signature & Signature Device Engine).
--
-- The up migration is PURELY ADDITIVE: two new tables (signature_assets,
-- form_signatures) and two new enum types (signature_asset_status,
-- form_signature_method), zero drops and zero altered columns. The WS-26A form
-- tables, employees, users and memberships are referenced only, never modified.
--
-- Clean reversal: child table first (form_signatures references
-- signature_assets), then the parent, then the enum types.
DROP TABLE IF EXISTS "form_signatures";
DROP TABLE IF EXISTS "signature_assets";
DROP TYPE IF EXISTS "public"."form_signature_method";
DROP TYPE IF EXISTS "public"."signature_asset_status";
