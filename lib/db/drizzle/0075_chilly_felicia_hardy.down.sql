-- Down migration for 0075 (Tenant Identity Hardening).
--
-- The up migration is ADDITIVE ONLY: one new column on `organizations`
-- (`tenant_uuid`, NOT NULL with a database-generated default, so every
-- pre-existing organization acquires an identity at migration time without a
-- data backfill), one unique index on that column, and one BEFORE UPDATE
-- trigger (plus its function) that rejects any change to `id` or
-- `tenant_uuid`. There are zero drops, zero altered column types, zero
-- rewritten rows and no change to any other table.
--
-- Reversing removes exactly those four objects. Doing so DISCARDS every
-- organization's tenant_uuid: re-applying 0075 later generates NEW values, so
-- any tenant identifier quoted in a support ticket, maintenance record or log
-- line captured while 0075 was applied would no longer match. Treat this as a
-- development and emergency rollback, not a routine one.
DROP TRIGGER IF EXISTS organizations_identity_immutable ON "organizations";
DROP FUNCTION IF EXISTS organizations_identity_immutable();
DROP INDEX IF EXISTS "organizations_tenant_uuid_unique";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "tenant_uuid";
