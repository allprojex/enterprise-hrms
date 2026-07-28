-- Rollback for 0013_noisy_kulan_gath.sql (Phase 2A, W24: Skills &
-- Qualifications — adds the `employee_skills`, `employee_qualifications`,
-- and `employee_certifications` tables). Purely additive in the up
-- direction — no existing table or row was touched — so this rollback only
-- drops what it created.

DROP TABLE IF EXISTS "employee_certifications";
DROP TABLE IF EXISTS "employee_qualifications";
DROP TABLE IF EXISTS "employee_skills";
