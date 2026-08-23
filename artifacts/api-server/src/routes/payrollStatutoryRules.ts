/**
 * Payroll, Workstream 1 — Statutory-Rule Foundation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §8, §9.2, §13). Platform-global data
 * (payroll_statutory_rule_versions has no organizationId column — Ghana
 * statutory law does not vary per organization), but every route is still
 * reached via the standard requireAuth/requireMembership/requirePermission
 * chain every other route in this codebase uses — a payroll administrator's
 * authority to manage the one shared statutory ruleset is still granted
 * through a specific organization membership, exactly like every other
 * permission in this platform; no organization has been granted
 * payroll.statutory.manage/.approve by this workstream (see
 * lib/db/src/seed/seed-roles-permissions.ts), so nobody can reach these
 * routes anywhere in the platform, including WWM, until a future, separate,
 * deliberate role/permission assignment.
 */
import { Router } from "express";
import { CreatePayrollStatutoryRuleVersionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import {
  createStatutoryRuleVersion,
  validateStatutoryRuleVersion,
  approveStatutoryRuleVersion,
  getStatutoryRuleVersionDetail,
  listStatutoryRuleVersions,
  StatutoryRuleVersionNotFoundError,
  StatutoryRuleVersionNotDraftError,
  StatutoryRuleVersionNotValidatedError,
  StatutorySelfApprovalError,
  InvalidStatutoryRulePayloadError,
  StatutoryRuleVersionCollisionError,
  type StatutoryRuleType,
} from "../lib/payrollStatutoryRules";
import { recordAuditEvent } from "../lib/auditLog";
import type { Response, NextFunction } from "express";

const router = Router();

/**
 * Read access: either payroll.statutory.manage or payroll.statutory.approve
 * — an approver who never holds .manage must still be able to see the
 * drafts awaiting their approval. No existing requirePermission middleware
 * composes permissions with OR (only AND, via chaining, per the W119
 * legacy-import precedent), so this is a small, narrowly-scoped inline
 * check, mirroring leaveRequests.ts's own "coarse route gate + fine-grained
 * check" precedent.
 */
async function requireStatutoryReadAccess(req: MembershipRequest, res: Response, next: NextFunction): Promise<void> {
  const membershipId = req.membership!.id;
  const allowed =
    (await hasPermission(membershipId, "payroll.statutory.manage")) ||
    (await hasPermission(membershipId, "payroll.statutory.approve"));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

async function requireStatutoryManage(req: MembershipRequest, res: Response, next: NextFunction): Promise<void> {
  const allowed = await hasPermission(req.membership!.id, "payroll.statutory.manage");
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

async function requireStatutoryApprove(req: MembershipRequest, res: Response, next: NextFunction): Promise<void> {
  const allowed = await hasPermission(req.membership!.id, "payroll.statutory.approve");
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/payroll/statutory-rules
router.get(
  "/organizations/:organizationId/payroll/statutory-rules",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requireStatutoryReadAccess,
  async (req: MembershipRequest, res): Promise<void> => {
    const ruleTypeRaw = req.query.ruleType;
    const ruleType = typeof ruleTypeRaw === "string" ? (ruleTypeRaw as StatutoryRuleType) : undefined;
    const versions = await listStatutoryRuleVersions(ruleType);
    res.json(versions);
  },
);

// POST /organizations/:organizationId/payroll/statutory-rules
router.post(
  "/organizations/:organizationId/payroll/statutory-rules",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requireStatutoryManage,
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePayrollStatutoryRuleVersionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const version = await createStatutoryRuleVersion({
        ruleType: parsed.data.ruleType,
        effectiveFrom: parsed.data.effectiveFrom,
        sourceUrl: parsed.data.sourceUrl ?? null,
        sourceDescription: parsed.data.sourceDescription ?? null,
        sourceRetrievedAt: parsed.data.sourceRetrievedAt ?? null,
        reasonNote: parsed.data.reasonNote ?? null,
        payeBands: parsed.data.payeBands,
        pensionRates: parsed.data.pensionRates,
        pensionEarningsCeiling: parsed.data.pensionEarningsCeiling,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_statutory_rule.created",
        targetType: "payroll_statutory_rule_version",
        targetId: String(version.id),
        afterState: { ruleType: version.ruleType, effectiveFrom: version.effectiveFrom, status: version.status },
      });

      const detail = await getStatutoryRuleVersionDetail(version.id);
      res.status(201).json(detail);
    } catch (err) {
      if (err instanceof InvalidStatutoryRulePayloadError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/payroll/statutory-rules/:id
router.get(
  "/organizations/:organizationId/payroll/statutory-rules/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requireStatutoryReadAccess,
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid statutory rule version ID" });
      return;
    }
    const detail = await getStatutoryRuleVersionDetail(id);
    if (!detail) {
      res.status(404).json({ error: "Statutory rule version not found" });
      return;
    }
    res.json(detail);
  },
);

// POST /organizations/:organizationId/payroll/statutory-rules/:id/validate
router.post(
  "/organizations/:organizationId/payroll/statutory-rules/:id/validate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requireStatutoryManage,
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid statutory rule version ID" });
      return;
    }
    try {
      const version = await validateStatutoryRuleVersion(id);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_statutory_rule.validated",
        targetType: "payroll_statutory_rule_version",
        targetId: String(version.id),
        afterState: { status: version.status },
      });
      res.json(version);
    } catch (err) {
      if (err instanceof StatutoryRuleVersionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof StatutoryRuleVersionNotDraftError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/payroll/statutory-rules/:id/approve
router.post(
  "/organizations/:organizationId/payroll/statutory-rules/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requireStatutoryApprove,
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid statutory rule version ID" });
      return;
    }
    try {
      const before = await getStatutoryRuleVersionDetail(id);
      const version = await approveStatutoryRuleVersion(id, req.membership!.id);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId: req.membership!.organizationId,
        eventType: "payroll_statutory_rule.approved",
        targetType: "payroll_statutory_rule_version",
        targetId: String(version.id),
        beforeState: { status: before?.version.status },
        afterState: { status: version.status, effectiveFrom: version.effectiveFrom },
      });
      res.json(version);
    } catch (err) {
      if (err instanceof StatutoryRuleVersionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (
        err instanceof StatutoryRuleVersionNotValidatedError ||
        err instanceof StatutorySelfApprovalError ||
        err instanceof StatutoryRuleVersionCollisionError
      ) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
