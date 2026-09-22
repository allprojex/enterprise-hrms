/**
 * Backfills organization_memberships + membership_roles from the existing
 * `users` table (its organizationId + role columns). Idempotent — a
 * (user, org) pair that already has a membership row is skipped via
 * onConflictDoNothing. Only reads `users` and inserts into the new tables;
 * never modifies, deletes, or destroys anything in `users`. Roles are resolved
 * against SYSTEM templates only (see memberships-backfiller.ts). Run manually
 * after applying migrations and seeding roles:
 *   pnpm --filter @workspace/db run backfill:memberships
 */
import { backfillMemberships } from "./memberships-backfiller";

async function main() {
  const { created, skipped } = await backfillMemberships();
  console.log(`Backfill complete. Created ${created} membership(s), skipped ${skipped} already-migrated user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
