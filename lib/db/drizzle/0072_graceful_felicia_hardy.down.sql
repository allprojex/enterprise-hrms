-- Down migration for 0072 (WS-17 File Storage Durability Pass 1 —
-- provider-neutral storage foundation and SHA-256 integrity).
--
-- The up migration is PURELY ADDITIVE: two new enum types and one new table,
-- with zero drops, zero altered columns and zero touched rows anywhere else.
-- That is the whole design, not a happy accident:
--
--   `stored_objects` is keyed on (organization_id, storage_key) — the SAME
--   opaque key the ten business tables that hold storage references already
--   store — precisely so that NONE of them needed a new column or a foreign
--   key. `organization_documents`, `organization_document_versions`,
--   `employee_documents`, `generated_documents`, `candidate_documents`,
--   `background_checks`, `offer_versions`, `pre_employment_requirements`,
--   `migration_sources` and `employees.profile_picture_key` are untouched;
--   WS-5 and each owning module remain the sole authority for what a file
--   MEANS.
--
--   Files written before this migration have no row here and never gain one:
--   nothing is backfilled, and no download writes to the database. They stay
--   fully readable, with integrity honestly reported as unknown.
--
-- Reversing therefore only removes what 0072 created. Dropping the table
-- discards integrity digests and any recorded delete_failed/orphaned states —
-- it does NOT touch a single stored binary, and no business record depends on
-- it, so the application continues to read and write files exactly as it did
-- before Pass 1.
--
-- Order matters: the table depends on both enum types, so it goes first.

DROP TABLE IF EXISTS "stored_objects";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."stored_object_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."stored_object_backend";
