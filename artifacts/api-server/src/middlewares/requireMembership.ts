import type { Response, NextFunction } from "express";
import type { organizationMembershipsTable } from "@workspace/db";
import { getActiveMembership } from "../lib/membership";
import type { AuthenticatedRequest } from "./requireAuth";

export interface MembershipRequest extends AuthenticatedRequest {
  membership?: typeof organizationMembershipsTable.$inferSelect;
}

/**
 * Resolves an active organization_memberships row for the caller against the
 * organization ID found at `req.params[paramName]`, attaching it to the
 * request as `req.membership`. The client-supplied ID is only ever used as a
 * lookup key — access is granted solely because a live, active membership
 * row was found, never because the ID itself looked valid.
 */
export function requireMembership(paramName: string = "organizationId") {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    const raw = Array.isArray(req.params[paramName]) ? req.params[paramName][0] : req.params[paramName];
    const organizationId = parseInt(raw, 10);
    if (isNaN(organizationId)) {
      res.status(400).json({ error: "Invalid organization ID" });
      return;
    }

    const membership = await getActiveMembership(req.userId!, organizationId);
    if (!membership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    req.membership = membership;
    next();
  };
}
