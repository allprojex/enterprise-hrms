-- Rollback for 0004_special_kylun.sql (Master Data Management: new
-- `master_data_domains` and `master_data_items` tables). Purely additive in
-- the up direction — no existing table or column was touched — so this
-- rollback only drops what it created.

DROP TABLE IF EXISTS "master_data_items";
DROP TABLE IF EXISTS "master_data_domains";
DROP TYPE IF EXISTS "public"."master_data_status";
DROP TYPE IF EXISTS "public"."master_data_classification";
