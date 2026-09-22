import { eq, inArray } from "drizzle-orm";
import {
  db,
  membershipRolesTable,
  organizationMembershipsTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
} from "@workspace/db";

/**
 * The union of permission keys granted to a membership via all of its roles.
 *
 * A role counts only if it is a system template (organization_id IS NULL) or
 * is owned by the membership's OWN organization. A `membership_roles` row
 * linking a membership to another organization's role grants nothing, however
 * it came to exist — a historical writer bug (organization onboarding once
 * resolved `org_admin` by key alone), an operator script, manual SQL, or a
 * future defect. Every assignment path already refuses such a link
 * (roleDelegation.ts loadAssignableRole); this is the read-side backstop, so a
 * malformed link can never let one tenant's role govern another tenant's
 * member. The filter only ever removes foreign roles: templates and
 * same-organization roles behave exactly as before.
 */
export async function getEffectivePermissions(membershipId: number): Promise<Set<string>> {
  const roleRows = await db
    .select({
      roleId: membershipRolesTable.roleId,
      roleOrganizationId: rolesTable.organizationId,
      membershipOrganizationId: organizationMembershipsTable.organizationId,
    })
    .from(membershipRolesTable)
    .innerJoin(organizationMembershipsTable, eq(organizationMembershipsTable.id, membershipRolesTable.membershipId))
    .innerJoin(rolesTable, eq(rolesTable.id, membershipRolesTable.roleId))
    .where(eq(membershipRolesTable.membershipId, membershipId));

  // organization_memberships.organization_id is NOT NULL, so a role is kept
  // only when it is a template (no owner) or its owner is exactly the
  // membership's organization.
  const roleIds = roleRows
    .filter((r) => r.roleOrganizationId === null || r.roleOrganizationId === r.membershipOrganizationId)
    .map((r) => r.roleId);
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
