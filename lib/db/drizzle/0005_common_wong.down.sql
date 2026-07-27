-- Rollback for 0005_common_wong.sql (Administrative User Management, W10:
-- invitation token columns on `organization_memberships`). Purely additive
-- in the up direction -- no existing column was touched -- so this rollback
-- only drops what it created.

ALTER TABLE "organization_memberships" DROP CONSTRAINT IF EXISTS "organization_memberships_invite_token_unique";
ALTER TABLE "organization_memberships" DROP COLUMN IF EXISTS "invite_token_expires_at";
ALTER TABLE "organization_memberships" DROP COLUMN IF EXISTS "invite_token";
