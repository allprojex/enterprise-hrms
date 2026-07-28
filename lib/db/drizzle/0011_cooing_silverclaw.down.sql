-- Rollback for 0011_cooing_silverclaw.sql (Phase 2A, W22: Employment Period
-- History Service — adds the `employment_periods` table). Purely additive in
-- the up direction — no existing table or row was touched — so this rollback
-- only drops what it created.

DROP TABLE IF EXISTS "employment_periods";
