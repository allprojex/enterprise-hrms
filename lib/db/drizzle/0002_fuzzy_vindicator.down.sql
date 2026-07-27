-- Rollback for 0002_fuzzy_vindicator.sql (Module Registry: new `modules`
-- table). Purely additive in the up direction — no existing table or column
-- was touched — so this rollback only drops what it created.

DROP TABLE IF EXISTS "modules";
DROP TYPE IF EXISTS "public"."module_status";
