import { eq, inArray } from "drizzle-orm";
import { db, membershipRolesTable, rolePermissionsTable, permissionsTable } from "@workspace/db";

/** The union of permission keys granted to a membership via all of its roles. */
export async function getEffectivePermissions(membershipId: number): Promise<Set<string>> {
  const roleRows = await db
    .select({ roleId: membershipRolesTable.roleId })
    .from(membershipRolesTable)
    .where(eq(membershipRolesTable.membershipId, membershipId));

  const roleIds = roleRows.map((r) => r.roleId);
  if (roleIds.length === 0) {
    return new Set();
  }

  const permissionRows = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(inArray(rolePermissionsTable.roleId, roleIds));

  return new Set(permissionRows.map((p) => p.key));
}

export async function hasPermission(membershipId: number, permissionKey: string): Promise<boolean> {
  const permissions = await getEffectivePermissions(membershipId);
  return permissions.has(permissionKey);
}
