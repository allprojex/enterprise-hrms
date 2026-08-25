import type { Response, NextFunction } from "express";
import { hasPermission } from "../lib/permissions";
import type { MembershipRequest } from "./requireMembership";

/**
 * Must run after requireMembership. Checks the resolved membership has
 * `permissionKey`.
 *
 * WS-4 (Break-Glass Access Foundation): when requireMembership resolved a
 * break-glass grant instead of a real membership (req.breakGlassGrant set,
 * req.membership absent), authorization comes from the grant's own explicit
 * scope allow-list instead of the role/permission system — a grant never
 * exceeds platform policy (§22) and the grant itself was already validated,
 * at creation, to contain only real, read-only permission keys
 * (lib/breakGlass.ts).
 */
export function requirePermission(permissionKey: string) {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.membership) {
      const allowed = await hasPermission(req.membership.id, permissionKey);
      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
      return;
    }

    if (req.breakGlassGrant) {
      if (!req.breakGlassGrant.scope.includes(permissionKey)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
      return;
    }

    res.status(500).json({ error: "requirePermission used without requireMembership" });
  };
}
