-- Down migration for 0080 (VR-01 — the organizational vehicle register).
-- Purely additive: one new table and one new enum type, no altered columns on
-- any existing table; organizations / employees / branches / assets /
-- organization_memberships are untouched. Clean reversal: drop the table
-- (its indexes and foreign keys go with it), then the enum type it owns.
DROP TABLE IF EXISTS "vehicles";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."vehicle_status";
