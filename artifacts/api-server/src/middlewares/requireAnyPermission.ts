import type { Response, NextFunction } from "express";
import { hasPermission } from "../lib/permissions";
import type { MembershipRequest } from "./requireMembership";

/**
 * Must run after requireMembership. Passes when the resolved membership holds
 * AT LEAST ONE of `permissionKeys`.
 *
 * This exists for the read/manage pair, where a narrower read key is
 * introduced alongside an existing broader manage key that already implies
 * it. Gating such a read on the read key alone would REVOKE access from every
 * existing holder of the manage key — including organization-defined custom
 * roles this codebase cannot see — so both are accepted and the manage key
 * keeps implying its own read. It is deliberately NOT a general "any of these
 * unrelated permissions" escape hatch: a route whose keys are not in an
 * implication relationship should state its own rule explicitly instead.
 *
 * Semantics are otherwise identical to requirePermission, including WS-4
 * break-glass handling: under an active grant there is no membership, so
 * authorization comes from the grant's own explicit read-only scope
 * allow-list rather than the role/permission system, and the same
 * at-least-one rule applies to it.
 */
export function requireAnyPermission(permissionKeys: readonly string[]) {
  if (permissionKeys.length === 0) {
    throw new Error("requireAnyPermission requires at least one permission key");
  }

  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.membership) {
      for (const key of permissionKeys) {
        if (await hasPermission(req.membership.id, key)) {
          next();
          return;
        }
      }
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (req.breakGlassGrant) {
      if (!permissionKeys.some((key) => req.breakGlassGrant!.scope.includes(key))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
      return;
    }

    res.status(500).json({ error: "requireAnyPermission used without requireMembership" });
  };
}
