import { Router } from "express";
import { UpdateOrganizationModuleBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import {
  listOrganizationModules,
  setModuleEnabled,
  ModuleNotFoundError,
  ModuleNotEnableableError,
  MissingRequiredModulesError,
  ModuleRequiredByEnabledModulesError,
} from "../lib/organizationModules";

const router = Router();

// GET /organizations/:organizationId/modules
// The registry (modules.ts) merged with this organization's enablement
// overrides. Any member can view it, matching the organization-config GET
// pattern (organization.read) — this list is not sensitive.
router.get(
  "/organizations/:organizationId/modules",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const result = await listOrganizationModules(req.membership!.organizationId);
    res.json(result);
  },
);

// PATCH /organizations/:organizationId/modules/:moduleKey
router.patch(
  "/organizations/:organizationId/modules/:moduleKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("module.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const moduleKey = Array.isArray(req.params.moduleKey) ? req.params.moduleKey[0] : req.params.moduleKey;

    const parsed = UpdateOrganizationModuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await setModuleEnabled({
        organizationId: req.membership!.organizationId,
        moduleKey,
        enabled: parsed.data.enabled,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof ModuleNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (
        err instanceof ModuleNotEnableableError ||
        err instanceof MissingRequiredModulesError ||
        err instanceof ModuleRequiredByEnabledModulesError
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
