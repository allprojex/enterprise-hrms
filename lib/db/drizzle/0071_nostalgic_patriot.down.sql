-- Down migration for 0071 (WS-16 Pass 2B — shared authority-delegation foundation).
--
-- The up migration is PURELY ADDITIVE: one new enum type and one new table,
-- with zero drops, zero altered columns and zero touched rows anywhere else.
-- Nothing existing is modified, and that is deliberate rather than incidental:
--
--   `office_inventory_approval_delegations` (Office Inventory, Workstream 3)
--   keeps every row, column, index and route it shipped with (§32.20) — WS-16
--   built a shared primitive BESIDE it and migrated nothing. There is no
--   dual-write, no cutover and no historical rewrite, so this down migration
--   has nothing there to restore;
--   `department_heads` is consumed, never modified — the delegation foundation
--   composes with the existing shared department-head resolver rather than
--   creating a competing source of truth (§32.23);
--   `organizations`, `departments` and `organization_memberships` are
--   referenced by new foreign keys only.
--
-- Reversing therefore only has to remove what 0071 created. Dropping the table
-- destroys delegation history, which is why this is a development/rollback
-- tool rather than a routine operation: §32.17 requires delegation rows to be
-- preserved as historical records in normal use, never deleted.
--
-- Order matters: the table depends on the enum type, so the table goes first.

DROP TABLE IF EXISTS "authority_delegations";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."delegatable_authority_type";
