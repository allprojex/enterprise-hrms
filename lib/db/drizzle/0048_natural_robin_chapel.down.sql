DROP TABLE IF EXISTS "payroll_correction_components";
DROP TABLE IF EXISTS "payroll_corrections";
DROP TYPE IF EXISTS "public"."payroll_correction_status";
-- Postgres has no ALTER TYPE ... DROP VALUE: the 'approved'/'locked'
-- values added to payroll_run_status by this migration cannot be cleanly
-- removed here. Harmless if no payroll_runs row uses them (true
-- immediately after this rollback, since W4 is being fully reverted), and
-- development-only per this repository's own down-migration convention.
