/**
 * WS-17 Slice 1 — route gate for platform operations.
 *
 * Deliberately layered ON TOP of `requireSuperAdmin` rather than replacing it:
 * super-admin remains the platform boundary, and this narrows what a
 * super-admin may actually do. Both are required, and a route that needs
 * protection must list both — the conjunction is never implicit.
 *
 * Returns 403 with no detail about which grant was missing: an unauthorized
 * caller learns that they may not act, not what they would need.
 */
import type { Response, NextFunction } from "express";
import { hasPlatformAuthority } from "../lib/platformOperations/authority";
import type { AuthenticatedRequest } from "./requireAuth";

export function requirePlatformOperation(permissionKey: string) {
  return async function (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    if (!(await hasPlatformAuthority(req.user, permissionKey))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
