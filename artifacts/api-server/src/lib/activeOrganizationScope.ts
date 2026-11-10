import type { Membership } from "./membership";
import { getActiveMembership, resolveActiveOrganizationId } from "./membership";
import { hostnameOrganizationMismatch, shouldFailClosedForTenantResolution } from "./organizationDomains";
import { bindTenantContext } from "./requestContext";
import type { MembershipRequest } from "../middlewares/requireMembership";

/**
 * Which organization a caller-scoped request (one with no :organizationId in
 * its URL, such as GET /notifications) is acting in.
 *
 * The same resolution as routes/me.ts's requireActiveOrganizationMembership:
 * the session's active organization if that membership is still live, else
 * the legacy home organization, else any other live membership. Then:
 *   - a tenant-host lookup that failed outright fails closed (503);
 *   - a tenant host pinned to a different organization is refused (403), so
 *     a WWM hostname never reads or changes another tenant's rows;
 *   - the membership is re-verified as active and unexpired.
 *
 * Unlike that middleware, a caller with no live membership at all is a
 * distinct `none` result rather than an error: there is no tenant to scope
 * to, so a caller-scoped surface like the notification bell has nothing to
 * show, and showing nothing reveals nothing.
 *
 * The organization is never taken from the client. A caller-supplied id is
 * at most compared against this result.
 */
export type ActiveOrganizationScope =
  | { kind: "organization"; organizationId: number; membership: Membership }
  | { kind: "none" }
  | { kind: "denied"; status: 403 | 503; error: string };

export async function resolveActiveOrganizationScope(req: MembershipRequest): Promise<ActiveOrganizationScope> {
  if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, false)) {
    return { kind: "denied", status: 503, error: "Tenant resolution is temporarily unavailable" };
  }

  const organizationId = await resolveActiveOrganizationId(req.userId!, req.session?.activeOrganizationId, req.user!.organizationId);
  if (organizationId == null) return { kind: "none" };

  if (hostnameOrganizationMismatch(req.resolvedTenantOrganizationId, organizationId)) {
    return { kind: "denied", status: 403, error: "No active organization membership" };
  }

  const membership = await getActiveMembership(req.userId!, organizationId);
  if (!membership) return { kind: "none" };

  bindTenantContext(organizationId, "membership");
  return { kind: "organization", organizationId, membership };
}
