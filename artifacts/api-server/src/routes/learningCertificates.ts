/**
 * Learning Certificates (Phase 3D, W90 — Certificates & Evidence):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §21's own frozen route
 * list. Issuance itself has no route here at all — it is an automatic
 * consequence of `completeEnrollment` (see routes/learningEnrollments.ts
 * / lib/learningEnrollments.ts), never a direct HR/L&D-initiated create.
 */
import { Router } from "express";
import { RevokeLearningCertificateBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { LEARNING_MODULE_KEY, resolveLearningActorEmployeeId } from "../lib/learningAuthorization";
import {
  listMyCertificates,
  listCertificates,
  revokeCertificate,
  LearningCertificateNotFoundError,
  LearningCertificateConflictError,
  InvalidLearningCertificateError,
} from "../lib/learningCertificates";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/learning/my-certificates
router.get(
  "/organizations/:organizationId/learning/my-certificates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.json([]);
      return;
    }
    res.json(await listMyCertificates(organizationId, employeeId));
  },
);

// GET /organizations/:organizationId/learning/certificates
// learning.manage only, org-wide — no manager/instructor certificate
// route exists anywhere in §21's own frozen table.
router.get(
  "/organizations/:organizationId/learning/certificates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const optionalId = (raw: unknown): number | undefined => {
      if (raw == null) return undefined;
      const parsed = parseId(raw as string);
      return isNaN(parsed) ? undefined : parsed;
    };
    const employeeId = optionalId(req.query.employeeId);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const rawPage = optionalId(req.query.page);
    const rawPageSize = optionalId(req.query.pageSize);
    const page = rawPage != null && rawPage > 0 ? rawPage : 1;
    const pageSize = rawPageSize != null && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 20;

    const result = await listCertificates({ organizationId: req.membership!.organizationId, employeeId, status, page, pageSize });
    res.json(result);
  },
);

// POST /organizations/:organizationId/learning/certificates/:id/revoke
router.post(
  "/organizations/:organizationId/learning/certificates/:id/revoke",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const certificateId = parseId(req.params.id);
    if (isNaN(certificateId)) {
      res.status(400).json({ error: "Invalid certificate ID" });
      return;
    }
    const parsed = RevokeLearningCertificateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await revokeCertificate({
        organizationId: req.membership!.organizationId,
        certificateId,
        reason: parsed.data.revokeReason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof LearningCertificateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof LearningCertificateConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidLearningCertificateError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
