-- Rollback for 0009_wandering_shard.sql (Reporting Foundation: adds the
-- `reports` registry table). Purely additive in the up direction — no
-- existing table or row was touched — so this rollback only drops what it
-- created.

DROP TABLE IF EXISTS "reports";
