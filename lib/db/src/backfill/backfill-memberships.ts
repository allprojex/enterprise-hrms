/**
 * Backfills organization_memberships + membership_roles from the existing
 * `users` table (its organizationId + role columns). Idempotent — a
 * (user, org) pair that already has a membership row is skipped via
 * onConflictDoNothing. Only reads `users` and inserts into the new tables;
 * never modifies, deletes, or destroys anything in `users`. Run manually
 * after applying migrations and seeding roles:
 *   pnpm --filter @workspace/db run backfill:memberships
 */
import { db, usersTable, rolesTable, organizationMembershipsTable, membershipRolesTable } from "../index";

async function main() {
  const users = await db.select().from(usersTable);
  const roles = await db.select().from(rolesTable);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    const [membership] = await db
      .insert(organizationMembershipsTable)
      .values({
        applicationUserId: user.id,
        organizationId: user.organizationId,
        status: "active",
        joinedAt: user.createdAt,
      })
      .onConflictDoNothing({
        target: [organizationMembershipsTable.applicationUserId, organizationMembershipsTable.organizationId],
      })
      .returning();

    if (!membership) {
      skipped++;
      continue;
    }

    const role = roleByKey.get(user.role);
    if (role) {
      await db
        .insert(membershipRolesTable)
        .values({ membershipId: membership.id, roleId: role.id })
        .onConflictDoNothing({
          target: [membershipRolesTable.membershipId, membershipRolesTable.roleId],
        });
    }

    created++;
  }

  console.log(`Backfill complete. Created ${created} membership(s), skipped ${skipped} already-migrated user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
