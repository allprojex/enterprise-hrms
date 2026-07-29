import { Router } from "express";
import { UpdateRecruitmentSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import {
  getRecruitmentSettings,
  updateRecruitmentSettings,
  InvalidRecruitmentSettingsError,
  CrossOrganizationReferenceError,
} from "../lib/recruitmentSettings";

const router = Router();

// GET /organizations/:organizationId/recruitment-settings
router.get(
  "/organizations/:organizationId/recruitment-settings",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const settings = await getRecruitmentSettings(req.membership!.organizationId);
    res.json(settings);
  },
);

// PATCH /organizations/:organizationId/recruitment-settings
router.patch(
  "/organizations/:organizationId/recruitment-settings",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = UpdateRecruitmentSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const settings = await updateRecruitmentSettings({
        organizationId: req.membership!.organizationId,
        patch: parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(settings);
    } catch (err) {
      if (err instanceof InvalidRecruitmentSettingsError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
