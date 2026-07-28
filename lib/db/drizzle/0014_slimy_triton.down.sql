-- Rollback for 0014_slimy_triton.sql (Phase 2A, W28: Disciplinary Records —
-- adds the `employee_disciplinary_records` table). Purely additive in the up
-- direction — no existing table or row was touched — so this rollback only
-- drops what it created. Also does not touch the new `permissions` row
-- seeded by seed-roles-permissions.ts ("employee.disciplinary.read") —
-- that script is idempotent and re-runnable, not a migration.

DROP TABLE IF EXISTS "employee_disciplinary_records";
