-- Rollback for 0015_mute_marten_broadcloak.sql (Phase 2A, W29: Exit
-- Management — adds the `employee_exit_processes` table). Purely additive
-- in the up direction — no existing table or row was touched — so this
-- rollback only drops what it created. Never touched `employees` (no
-- separation logic was modified or duplicated).

DROP TABLE IF EXISTS "employee_exit_processes";
