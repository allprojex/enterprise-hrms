-- Rollback for 0003_abandoned_dormammu.sql (Per-Organization Module
-- Enablement: new `organization_modules` table). Purely additive in the up
-- direction — no existing table or column was touched — so this rollback
-- only drops what it created.

DROP TABLE IF EXISTS "organization_modules";
