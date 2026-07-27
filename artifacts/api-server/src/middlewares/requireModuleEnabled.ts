import type { Response, NextFunction } from "express";
import { getModuleAccess } from "../lib/organizationModules";
import type { MembershipRequest } from "./requireMembership";

/**
 * Backend Module Gating (W5). Must run after requireMembership. Blocks the
 * request unless `moduleKey` is effectively enabled for the caller's
 * organization — future module route handlers compose this the same way
 * they compose requirePermission. No route in this codebase uses it yet:
 * every module currently in the registry (W3) is status "hidden" with no
 * shipped feature routes, so there is nothing to gate until a module's
 * owning workstream lands.
 */
export function requireModuleEnabled(moduleKey: string) {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.membership) {
      res.status(500).json({ error: "requireModuleEnabled used without requireMembership" });
      return;
    }

    const access = await getModuleAccess(req.membership.organizationId, moduleKey);
    if (!access.found || !access.enabled) {
      res.status(403).json({ error: `Module "${moduleKey}" is not enabled for this organization` });
      return;
    }

    next();
  };
}
