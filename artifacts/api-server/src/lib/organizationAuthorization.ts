import type { usersTable } from "@workspace/db";
import { isSuperAdmin } from "./authorization";
import { getActiveMembership } from "./membership";
import { hasPermission } from "./permissions";

type User = typeof usersTable.$inferSelect;

/**
 * Organization Permission Gates (W9): whether `user` may perform
 * `permissionKey` on `organizationId`. super_admin bypasses the membership
 * check entirely (platform-wide access, same rule as everywhere else this
 * role appears). Everyone else needs an active membership in that specific
 * organization AND that membership must carry the permission -- replaces
 * organizations.ts's prior role-string checks (canAccessOrganization /
 * canManageOrganization) with the same requireMembership + requirePermission
 * infrastructure every other org-scoped route already uses.
 */
export async function authorizeOrganizationAction(
  user: User,
  organizationId: number,
  permissionKey: string,
): Promise<boolean> {
  if (isSuperAdmin(user)) {
    return true;
  }

  const membership = await getActiveMembership(user.id, organizationId);
  if (!membership) {
    return false;
  }

  return hasPermission(membership.id, permissionKey);
}
