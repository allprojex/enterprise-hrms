/**
 * Idempotent seed for system roles, permissions, and their default
 * role_permissions mapping. Safe to re-run — every insert conflicts
 * harmlessly on the table's unique key. Never touches existing data in
 * other tables. Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:roles
 */
import { sql } from "drizzle-orm";
import { db, rolesTable, permissionsTable, rolePermissionsTable } from "../index";

import { SYSTEM_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "./roles-permissions-definitions";

async function main() {
  // roles.key has no plain unique constraint — only two partial ones
  // (roles_system_key_unique on key WHERE organization_id is null,
  // roles_org_key_unique on (organization_id, key) WHERE organization_id is
  // not null, per ADR-015's system/org-copy split). SYSTEM_ROLES are always
  // system templates (organizationId unset), so the conflict target must
  // carry the same partial condition as roles_system_key_unique or Postgres
  // rejects it with "no unique or exclusion constraint matching the ON
  // CONFLICT specification" (42P10).
  await db
    .insert(rolesTable)
    .values([...SYSTEM_ROLES])
    .onConflictDoNothing({ target: rolesTable.key, where: sql`${rolesTable.organizationId} is null` });
  await db
    .insert(permissionsTable)
    .values([...PERMISSIONS])
    .onConflictDoNothing({ target: permissionsTable.key });

  const roles = await db.select().from(rolesTable);
  const permissions = await db.select().from(permissionsTable);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleByKey.get(roleKey);
    if (!role) continue;

    for (const permissionKey of permissionKeys) {
      const permission = permissionByKey.get(permissionKey);
      if (!permission) continue;

      await db
        .insert(rolePermissionsTable)
        .values({ roleId: role.id, permissionId: permission.id })
        .onConflictDoNothing({
          target: [rolePermissionsTable.roleId, rolePermissionsTable.permissionId],
        });
    }
  }

  console.log("Seeded roles, permissions, and role_permissions.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
