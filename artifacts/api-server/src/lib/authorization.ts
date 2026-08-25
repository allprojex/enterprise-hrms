import type { usersTable } from "@workspace/db";

type User = typeof usersTable.$inferSelect;

/**
 * PLATFORM BOOTSTRAP IDENTITY (WS-2, Owner Decision #1) — deliberately kept
 * separate from, and not migrated into, the normal organization-membership
 * authorization path below. `users.role === "super_admin"` is the one
 * platform-wide, cross-organization bypass; no per-membership permission
 * grant can produce it, and no safer alternative marker exists in this
 * codebase to migrate to (verified: the `roles` table's `key: "super_admin"`
 * row is an unrelated, ORG-SCOPED role TEMPLATE a membership can hold for
 * broad permissions *within one organization only* — it carries no
 * cross-org bypass power and must never be confused with this function).
 * Every other `users.role` value (`org_admin`/`hr_manager`/`employee`) and
 * `users.organizationId` are NOT authorization sources anywhere in this
 * codebase (confirmed by WS-2's repository-wide usage audit) — normal
 * authorization is membership/role/permission-based
 * (organizationAuthorization.ts, requireMembership + requirePermission).
 */
export function isSuperAdmin(user: User): boolean {
  return user.role === "super_admin";
}

/**
 * Platform-level disablement (WS-2, Owner Decision #20) — a distinct axis
 * from organization_memberships.status: this disables the account itself,
 * across every organization, not access to one specific organization. See
 * lib/userDisablement.ts for the disable/enable operations and
 * middlewares/requireAuth.ts for where this is enforced on every request.
 */
export function isPlatformDisabled(user: User): boolean {
  return user.disabledAt != null;
}
