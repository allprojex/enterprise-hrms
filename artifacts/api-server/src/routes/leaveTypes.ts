import { Router } from "express";
import {
  CreateLeaveTypeBody,
  UpdateLeaveTypeBody,
  CreateLeavePolicyBody,
  UpdateLeavePolicyBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { isUniqueViolation } from "../lib/dbErrors";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  archiveLeaveType,
  reactivateLeaveType,
  LeaveTypeNotFoundError,
} from "../lib/leaveTypes";
import {
  listLeavePolicies,
  createLeavePolicy,
  updateLeavePolicy,
  archiveLeavePolicy,
  reactivateLeavePolicy,
  LeavePolicyNotFoundError,
  InvalidLeavePolicyError,
  type LeavePolicyFields,
} from "../lib/leavePolicies";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// Converts the generated Zod body (numbers) into the numeric-column-as-string
// shape leave_policies expects (drizzle's `numeric` columns are string in/out).
function toPolicyFields(data: Record<string, unknown>): Partial<LeavePolicyFields> {
  const fields: Partial<LeavePolicyFields> = { ...(data as Partial<LeavePolicyFields>) };
  for (const key of [
    "annualEntitlementDays",
    "accrualRate",
    "maxCarryForwardDays",
    "minRequestDurationDays",
    "maxRequestDurationDays",
  ] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === "number") (fields as Record<string, unknown>)[key] = value.toString();
  }
  return fields;
}

// GET /organizations/:organizationId/leave-types
router.get(
  "/organizations/:organizationId/leave-types",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypes = await listLeaveTypes(req.membership!.organizationId);
    res.json(leaveTypes);
  },
);

// POST /organizations/:organizationId/leave-types
router.post(
  "/organizations/:organizationId/leave-types",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateLeaveTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const leaveType = await createLeaveType({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        code: parsed.data.code,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(leaveType);
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A leave type with this code already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/leave-types/:id
router.patch(
  "/organizations/:organizationId/leave-types/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.id);
    if (isNaN(leaveTypeId)) {
      res.status(400).json({ error: "Invalid leave type ID" });
      return;
    }

    const parsed = UpdateLeaveTypeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateLeaveType({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        name: parsed.data.name,
        code: parsed.data.code,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof LeaveTypeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A leave type with this code already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/leave-types/:id/archive
router.post(
  "/organizations/:organizationId/leave-types/:id/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.id);
    if (isNaN(leaveTypeId)) {
      res.status(400).json({ error: "Invalid leave type ID" });
      return;
    }
    try {
      const updated = await archiveLeaveType({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof LeaveTypeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/leave-types/:id/reactivate
router.post(
  "/organizations/:organizationId/leave-types/:id/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.id);
    if (isNaN(leaveTypeId)) {
      res.status(400).json({ error: "Invalid leave type ID" });
      return;
    }
    try {
      const updated = await reactivateLeaveType({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof LeaveTypeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/leave-types/:leaveTypeId/policies
router.get(
  "/organizations/:organizationId/leave-types/:leaveTypeId/policies",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.leaveTypeId);
    if (isNaN(leaveTypeId)) {
      res.status(400).json({ error: "Invalid leave type ID" });
      return;
    }
    const policies = await listLeavePolicies(req.membership!.organizationId, leaveTypeId);
    res.json(policies);
  },
);

// POST /organizations/:organizationId/leave-types/:leaveTypeId/policies
router.post(
  "/organizations/:organizationId/leave-types/:leaveTypeId/policies",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.leaveTypeId);
    if (isNaN(leaveTypeId)) {
      res.status(400).json({ error: "Invalid leave type ID" });
      return;
    }

    const parsed = CreateLeavePolicyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const policy = await createLeavePolicy({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        fields: toPolicyFields(parsed.data) as LeavePolicyFields,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(policy);
    } catch (err) {
      if (err instanceof InvalidLeavePolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId
router.patch(
  "/organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.leaveTypeId);
    const policyId = parseId(req.params.policyId);
    if (isNaN(leaveTypeId) || isNaN(policyId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const parsed = UpdateLeavePolicyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const policy = await updateLeavePolicy({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        leavePolicyId: policyId,
        fields: toPolicyFields(parsed.data),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(policy);
    } catch (err) {
      if (err instanceof LeavePolicyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidLeavePolicyError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId/archive
router.post(
  "/organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.leaveTypeId);
    const policyId = parseId(req.params.policyId);
    if (isNaN(leaveTypeId) || isNaN(policyId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const policy = await archiveLeavePolicy({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        leavePolicyId: policyId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(policy);
    } catch (err) {
      if (err instanceof LeavePolicyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId/reactivate
router.post(
  "/organizations/:organizationId/leave-types/:leaveTypeId/policies/:policyId/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("leave"),
  requirePermission("leave_type.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const leaveTypeId = parseId(req.params.leaveTypeId);
    const policyId = parseId(req.params.policyId);
    if (isNaN(leaveTypeId) || isNaN(policyId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const policy = await reactivateLeavePolicy({
        organizationId: req.membership!.organizationId,
        leaveTypeId,
        leavePolicyId: policyId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(policy);
    } catch (err) {
      if (err instanceof LeavePolicyNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
