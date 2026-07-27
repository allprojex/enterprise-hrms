import type { Response, NextFunction } from "express";
import { hasPermission } from "../lib/permissions";
import type { MembershipRequest } from "./requireMembership";

/** Must run after requireMembership. Checks the resolved membership has `permissionKey`. */
export function requirePermission(permissionKey: string) {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.membership) {
      res.status(500).json({ error: "requirePermission used without requireMembership" });
      return;
    }

    const allowed = await hasPermission(req.membership.id, permissionKey);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
