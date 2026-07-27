import type { usersTable } from "@workspace/db";

type User = typeof usersTable.$inferSelect;

/** super_admin is the only role allowed to cross organization boundaries. */
export function isSuperAdmin(user: User): boolean {
  return user.role === "super_admin";
}

/** Whether `user` may read/write data belonging to `organizationId`. */
export function canAccessOrganization(user: User, organizationId: number): boolean {
  return isSuperAdmin(user) || user.organizationId === organizationId;
}

/** Whether `user` may update or change the lifecycle status of `organizationId`. */
export function canManageOrganization(user: User, organizationId: number): boolean {
  return isSuperAdmin(user) || (user.organizationId === organizationId && user.role === "org_admin");
}
