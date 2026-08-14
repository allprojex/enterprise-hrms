import type { Response, NextFunction } from "express";
import { isSuperAdmin } from "../lib/authorization";
import type { AuthenticatedRequest } from "./requireAuth";

/**
 * Must run after requireAuth. Platform-wide tenant-domain management
 * (assigning testing hostnames, adding/disabling custom domains, marking a
 * primary) is reserved to the platform super_admin role — no per-organization
 * permission grants it, matching the brief's "Platform super-admin remains
 * the only platform-wide tenant-management role."
 */
export function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || !isSuperAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
