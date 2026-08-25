/**
 * Break-Glass Access Foundation (WS-4, Owner Decision #31). Platform-scoped,
 * reserved to the platform super_admin — grant management is itself a
 * platform operation, distinct from the elevated access a grant subsequently
 * unlocks through requireMembership/requirePermission (see
 * middlewares/requireMembership.ts). Mirrors platformUsers.ts's own
 * requireAuth + requireSuperAdmin pattern.
 */
import { Router } from "express";
import { CreateBreakGlassGrantBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  createBreakGlassGrant,
  listBreakGlassGrants,
  getBreakGlassGrantById,
  revokeBreakGlassGrant,
  InvalidGrantInputError,
  GrantNotFoundError,
  GrantAlreadyRevokedError,
} from "../lib/breakGlass";

const router = Router();

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value as string, 10);
  return isNaN(id) ? null : id;
}

// GET /break-glass/grants?targetOrganizationId=
router.get(
  "/break-glass/grants",
  requireAuth as any,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const rawOrgId = req.query.targetOrganizationId;
    let targetOrganizationId: number | undefined;
    if (rawOrgId != null) {
      const parsedId = parseId(rawOrgId);
      if (parsedId == null) {
        res.status(400).json({ error: "Invalid targetOrganizationId" });
        return;
      }
      targetOrganizationId = parsedId;
    }

    const grants = await listBreakGlassGrants(targetOrganizationId != null ? { targetOrganizationId } : undefined);
    res.json(grants);
  },
);

// POST /break-glass/grants
router.post(
  "/break-glass/grants",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const parsed = CreateBreakGlassGrantBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const grant = await createBreakGlassGrant({
        actorUserId: req.userId!,
        targetOrganizationId: parsed.data.targetOrganizationId,
        targetInstallationId: parsed.data.targetInstallationId ?? null,
        reason: parsed.data.reason,
        scope: parsed.data.scope,
        expiresAt: parsed.data.expiresAt,
        metadata: parsed.data.metadata ?? null,
      });
      res.status(201).json(grant);
    } catch (err) {
      if (err instanceof InvalidGrantInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /break-glass/grants/:id
router.get(
  "/break-glass/grants/:id",
  requireAuth as any,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid grant ID" });
      return;
    }
    const grant = await getBreakGlassGrantById(id);
    if (!grant) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(grant);
  },
);

// POST /break-glass/grants/:id/revoke
router.post(
  "/break-glass/grants/:id/revoke",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid grant ID" });
      return;
    }

    try {
      const grant = await revokeBreakGlassGrant(id, req.userId!);
      res.json(grant);
    } catch (err) {
      if (err instanceof GrantNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof GrantAlreadyRevokedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
