/**
 * Platform-level user administration (WS-2, Owner Decisions #1 and #20).
 * Reserved to the platform super_admin — deliberately NOT delegable to an
 * organization admin, who may only manage membership within their own
 * organization (a user can belong to other organizations they have no
 * authority over). Mirrors organizationDomains.ts's own requireAuth +
 * requireSuperAdmin pattern exactly — no requireMembership, since this is
 * platform-scoped, not organization-scoped.
 */
import { Router } from "express";
import type { usersTable } from "@workspace/db";
import { DisablePlatformUserBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { disableUser, enableUser, UserNotFoundError, CannotDisableSelfError } from "../lib/userDisablement";

const router = Router();

function formatPlatformUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    disabledAt: user.disabledAt,
    disabledBy: user.disabledBy,
    disabledReason: user.disabledReason,
  };
}

function parseUserId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value as string, 10);
  return isNaN(id) ? null : id;
}

// POST /platform/users/:userId/disable
router.post(
  "/platform/users/:userId/disable",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const userId = parseUserId(req.params.userId);
    if (userId == null) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    const parsed = DisablePlatformUserBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const user = await disableUser({ userId, disabledBy: req.userId!, reason: parsed.data.reason });
      res.json(formatPlatformUser(user));
    } catch (err) {
      if (err instanceof CannotDisableSelfError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof UserNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /platform/users/:userId/enable
router.post(
  "/platform/users/:userId/enable",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const userId = parseUserId(req.params.userId);
    if (userId == null) {
      res.status(400).json({ error: "Invalid user ID" });
      return;
    }

    try {
      const user = await enableUser({ userId, enabledBy: req.userId! });
      res.json(formatPlatformUser(user));
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
