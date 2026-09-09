/**
 * Out-of-band actor authorization.
 *
 * HTTP callers are authorized by the middleware chain (requireAuth →
 * requireMembership → requirePermission). Out-of-band callers — operator CLIs,
 * jobs, installers — have no request, so they supply the actor they are acting
 * as. Those ids are recorded permanently in the audit trail, so they must be
 * PROVEN, never trusted: without this, supplying any two positive integers
 * would produce a governed-looking mutation attributed to an identity that may
 * not hold the authority the equivalent route demands.
 *
 * This is deliberately NOT a second RBAC interpretation. It composes the same
 * services the route chain uses:
 *   - getActiveMembership (lib/membership.ts) — the authoritative
 *     "usable right now" predicate (status active AND not expired), looked up
 *     by (user, organization), exactly as requireMembership does. A revoked,
 *     suspended, invited, expired or cross-tenant membership simply is not
 *     returned, so every one of those fails closed here for free.
 *   - getEffectivePermissions (lib/permissions.ts) — the same union-of-roles
 *     resolution requirePermission consults.
 *   - isPlatformDisabled (lib/authorization.ts) — the same account-level check
 *     requireAuth enforces on every request.
 *
 * NO SUPER-ADMIN BYPASS. `users.role === "super_admin"` is never consulted
 * here. Platform-owner status confers no standing tenant-data authority
 * (WS-2, Owner Decision #1); the only sanctioned elevation is a break-glass
 * grant, which is explicitly read-only and therefore can never authorize a
 * mutation like template activation. A super_admin passes this gate only when
 * they genuinely hold an active membership whose roles carry the required
 * permissions — the same standard as anyone else.
 */
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getActiveMembership } from "./membership";
import { getEffectivePermissions } from "./permissions";
import { isPlatformDisabled } from "./authorization";

/** Raised when a supplied out-of-band actor cannot be proven to hold the required authority. */
export class ActorAuthorizationError extends Error {}

export interface AuthorizedActor {
  /** The validated actor — use THIS for audit attribution, never the raw input. */
  applicationUserId: number;
  membershipId: number;
  organizationId: number;
  /** The actor's effective permissions, so callers can branch without a second lookup. */
  permissions: Set<string>;
}

/**
 * Proves that `actorApplicationUserId` / `actorMembershipId` is a live,
 * authorized actor in `organizationId` holding every key in
 * `requiredPermissions`. Throws ActorAuthorizationError otherwise. Performs no
 * writes, so callers can (and must) run it before any mutation.
 */
export async function authorizeActor(params: {
  organizationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
  requiredPermissions: readonly string[];
}): Promise<AuthorizedActor> {
  const { organizationId, actorApplicationUserId, actorMembershipId } = params;

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new ActorAuthorizationError("An explicit target organizationId is required");
  }
  if (!Number.isInteger(actorApplicationUserId) || actorApplicationUserId <= 0) {
    throw new ActorAuthorizationError("An explicit actor user id is required");
  }
  if (!Number.isInteger(actorMembershipId) || actorMembershipId <= 0) {
    throw new ActorAuthorizationError("An explicit actor membership id is required");
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, actorApplicationUserId)).limit(1);
  if (!user) throw new ActorAuthorizationError("Actor user does not exist");
  if (isPlatformDisabled(user)) throw new ActorAuthorizationError("Actor user is disabled");

  // Resolved by (user, organization), so a membership belonging to a different
  // user, or to a different tenant, is never returned — and neither is a
  // revoked/suspended/invited/expired one.
  const membership = await getActiveMembership(actorApplicationUserId, organizationId);
  if (!membership) {
    throw new ActorAuthorizationError("Actor has no active membership in this organization");
  }
  // The supplied membership id must be that very membership: a caller may not
  // attribute the act to one membership while deriving authority from another.
  if (membership.id !== actorMembershipId) {
    throw new ActorAuthorizationError("Actor membership does not belong to this actor user in this organization");
  }

  const permissions = await getEffectivePermissions(membership.id);
  for (const key of params.requiredPermissions) {
    if (!permissions.has(key)) {
      throw new ActorAuthorizationError(`Actor lacks the required permission "${key}"`);
    }
  }

  return { applicationUserId: user.id, membershipId: membership.id, organizationId, permissions };
}
