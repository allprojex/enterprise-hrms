-- Down migration for 0063_gorgeous_daredevil.sql (WS-7 closure — Payroll
-- Opening Balances). Additive-only up, so the reverse is a clean drop: the
-- table is new and nothing pre-existing references it.
DROP INDEX IF EXISTS "payroll_opening_balances_org_year_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "payroll_opening_balances_employee_year_unique";--> statement-breakpoint
DROP TABLE IF EXISTS "payroll_opening_balances";
