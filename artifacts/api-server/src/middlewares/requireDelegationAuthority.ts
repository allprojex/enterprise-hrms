import type { Response, NextFunction } from "express";
import type { MembershipRequest } from "./requireMembership";
import { resolveDelegationAuthority, type DelegationAuthority } from "../lib/roleDelegation";

export interface DelegationRequest extends MembershipRequest {
  delegation?: DelegationAuthority;
}

/**
 * Replaces `requirePermission("membership.manage" | "role.manage")` on the
 * member/role administration routes. Admits the traditional unscoped
 * administrator (org_admin path) exactly as before, OR the organization's
 * active Primary HR holding `hr_team.manage` (hr_team path). Attaches the
 * resolved authority to `req.delegation` so the handler can apply the
 * ownership / template / subset / prohibited-key guards from
 * lib/roleDelegation.ts. Must run after requireMembership.
 */
export function requireDelegationAuthority(adminKey: "membership.manage" | "role.manage") {
  return async (req: DelegationRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.membership && !req.breakGlassGrant) {
      res.status(500).json({ error: "requireDelegationAuthority used without requireMembership" });
      return;
    }
    const authority = await resolveDelegationAuthority(req, adminKey);
    if (!authority) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    req.delegation = authority;
    next();
  };
}
