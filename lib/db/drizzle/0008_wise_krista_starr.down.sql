-- Rollback for 0008_wise_krista_starr.sql (Employee Separation: adds
-- separation_date/separation_reason to `employees`). Purely additive in the
-- up direction — no existing column or row was touched — so this rollback
-- only drops what it created.

ALTER TABLE "employees" DROP COLUMN IF EXISTS "separation_reason";
ALTER TABLE "employees" DROP COLUMN IF EXISTS "separation_date";
