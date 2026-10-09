/**
 * The backfill:memberships core — derives organization_memberships and
 * membership_roles from the legacy `users` table (its organizationId + role
 * columns). Idempotent: a (user, org) pair that already has a membership row is
 * skipped via onConflictDoNothing. Only reads `users` and inserts into the
 * membership tables; never modifies, deletes, or destroys anything in `users`.
 * `backfill-memberships.ts` is the command-line runner.
 *
 * `users.role` names a SYSTEM role template, so it is resolved against
 * templates only — organization_id IS NULL AND is_system_role (the same
 * predicate as the api-server's systemRoles.ts and roles-permissions-seeder.ts;
 * this package cannot import api-server code). `roles.key` is unique only per
 * scope, so an earlier version that mapped key → role over EVERY role let an
 * organization-owned role sharing a template key — possibly another tenant's —
 * be attached to the backfilled membership.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, rolesTable, organizationMembershipsTable, membershipRolesTable } from "../index";

/** Key → SYSTEM template. Organization-owned roles never appear, whatever their key. */
export async function systemRoleTemplatesByKey(): Promise<Map<string, typeof rolesTable.$inferSelect>> {
  const templates = await db
    .select()
    .from(rolesTable)
    .where(and(isNull(rolesTable.organizationId), eq(rolesTable.isSystemRole, true)));
  // roles_system_key_unique guarantees one template per key.
  return new Map(templates.map((r) => [r.key, r]));
}

export async function backfillMemberships(): Promise<{ created: number; skipped: number }> {
  const users = await db.select().from(usersTable);
  const templateByKey = await systemRoleTemplatesByKey();

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

    const role = templateByKey.get(user.role);
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

  return { created, skipped };
}
