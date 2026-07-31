import { Router } from "express";
import multer from "multer";
import { CreateBackgroundCheckBody, UpdateBackgroundCheckStatusBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import {
  listBackgroundChecks,
  createBackgroundCheck,
  updateBackgroundCheckStatus,
  attachBackgroundCheckEvidence,
  readBackgroundCheckEvidence,
  ApplicationNotFoundForBackgroundCheckError,
  BackgroundCheckNotFoundError,
  InvalidBackgroundCheckError,
  DuplicateBackgroundCheckError,
  BackgroundCheckNotEditableError,
  InvalidDocumentError,
} from "../lib/backgroundChecks";

const router = Router();
const uploadEvidence = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleBackgroundCheckError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof ApplicationNotFoundForBackgroundCheckError || err instanceof BackgroundCheckNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidBackgroundCheckError || err instanceof DuplicateBackgroundCheckError || err instanceof BackgroundCheckNotEditableError || err instanceof InvalidDocumentError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/applications/:applicationId/background-checks
router.get(
  "/organizations/:organizationId/applications/:applicationId/background-checks",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("background_check.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    try {
      const checks = await listBackgroundChecks({ organizationId: req.membership!.organizationId, applicationId });
      res.json(checks);
    } catch (err) {
      if (handleBackgroundCheckError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:applicationId/background-checks
router.post(
  "/organizations/:organizationId/applications/:applicationId/background-checks",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("background_check.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = CreateBackgroundCheckBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const check = await createBackgroundCheck({
        organizationId: req.membership!.organizationId,
        applicationId,
        checkType: parsed.data.checkType,
        vendorReference: parsed.data.vendorReference,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(check);
    } catch (err) {
      if (handleBackgroundCheckError(err, res)) return;
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/applications/:applicationId/background-checks/:id
router.patch(
  "/organizations/:organizationId/applications/:applicationId/background-checks/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("background_check.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    const checkId = parseId(req.params.id);
    if (isNaN(applicationId) || isNaN(checkId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const parsed = UpdateBackgroundCheckStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const check = await updateBackgroundCheckStatus({
        organizationId: req.membership!.organizationId,
        applicationId,
        checkId,
        status: parsed.data.status,
        resultSummary: parsed.data.resultSummary,
        vendorReference: parsed.data.vendorReference,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(check);
    } catch (err) {
      if (handleBackgroundCheckError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:applicationId/background-checks/:id/evidence
router.post(
  "/organizations/:organizationId/applications/:applicationId/background-checks/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("background_check.manage"),
  uploadEvidence.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    const checkId = parseId(req.params.id);
    if (isNaN(applicationId) || isNaN(checkId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "A file is required" });
      return;
    }
    try {
      const check = await attachBackgroundCheckEvidence({
        organizationId: req.membership!.organizationId,
        applicationId,
        checkId,
        file: { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(check);
    } catch (err) {
      if (handleBackgroundCheckError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/applications/:applicationId/background-checks/:id/evidence
router.get(
  "/organizations/:organizationId/applications/:applicationId/background-checks/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("background_check.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    const checkId = parseId(req.params.id);
    if (isNaN(applicationId) || isNaN(checkId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const evidence = await readBackgroundCheckEvidence({ organizationId: req.membership!.organizationId, applicationId, checkId });
    if (!evidence) {
      res.status(404).json({ error: "Background check not found, or no evidence has been attached" });
      return;
    }
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", "attachment; filename=\"evidence\"");
    res.set("Cache-Control", "private, no-store");
    res.send(evidence.buffer);
  },
);

export default router;
