/**
 * Installation Registry (WS-4, Owner Decision #29). Platform-scoped, reserved
 * to the platform super_admin — mirrors platformUsers.ts's and
 * organizationDomains.ts's own requireAuth + requireSuperAdmin pattern
 * exactly (no requireMembership: this is never organization-scoped, even
 * though some routes accept an organizationId to link/unlink).
 */
import { Router } from "express";
import { CreateInstallationBody, UpdateInstallationBody, LinkInstallationOrganizationBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  createInstallation,
  listInstallations,
  getInstallationById,
  updateInstallation,
  listOrganizationsForInstallation,
  linkOrganization,
  unlinkOrganization,
  InstallationNotFoundError,
  DuplicateInstallationKeyError,
  OrganizationNotFoundError,
  OrganizationAlreadyLinkedError,
  OrganizationNotLinkedError,
} from "../lib/installations";

const router = Router();

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value as string, 10);
  return isNaN(id) ? null : id;
}

// GET /installations
router.get("/installations", requireAuth as any, requireSuperAdmin, async (_req, res): Promise<void> => {
  const installations = await listInstallations();
  res.json(installations);
});

// POST /installations
router.post(
  "/installations",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const parsed = CreateInstallationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const installation = await createInstallation(parsed.data, req.userId!);
      res.status(201).json(installation);
    } catch (err) {
      if (err instanceof DuplicateInstallationKeyError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /installations/:id
router.get(
  "/installations/:id",
  requireAuth as any,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid installation ID" });
      return;
    }
    const installation = await getInstallationById(id);
    if (!installation) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(installation);
  },
);

// PATCH /installations/:id
router.patch(
  "/installations/:id",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid installation ID" });
      return;
    }
    const parsed = UpdateInstallationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const installation = await updateInstallation(id, parsed.data, req.userId!);
      res.json(installation);
    } catch (err) {
      if (err instanceof InstallationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /installations/:id/organizations
router.get(
  "/installations/:id/organizations",
  requireAuth as any,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid installation ID" });
      return;
    }
    const links = await listOrganizationsForInstallation(id);
    res.json(links);
  },
);

// POST /installations/:id/organizations
router.post(
  "/installations/:id/organizations",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id == null) {
      res.status(400).json({ error: "Invalid installation ID" });
      return;
    }
    const parsed = LinkInstallationOrganizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const link = await linkOrganization(id, parsed.data.organizationId, req.userId!);
      res.status(201).json(link);
    } catch (err) {
      if (err instanceof InstallationNotFoundError || err instanceof OrganizationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OrganizationAlreadyLinkedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /installations/:id/organizations/:organizationId
router.delete(
  "/installations/:id/organizations/:organizationId",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    const organizationId = parseId(req.params.organizationId);
    if (id == null || organizationId == null) {
      res.status(400).json({ error: "Invalid installation or organization ID" });
      return;
    }

    try {
      const link = await unlinkOrganization(id, organizationId, req.userId!);
      res.json(link);
    } catch (err) {
      if (err instanceof OrganizationNotLinkedError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
