/**
 * Asset Register (Phase 3E, W96): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
 * §20's own frozen route list — every mutating route requires
 * asset_management.manage; GET .../assets/:id alone accepts the broader
 * asset_management.read.own floor, with fine-grained own-scope reach
 * (currently holds this asset) resolved inside the handler, mirroring
 * learningEnrollments.ts's own GET .../enrollments/:id dual-floor pattern
 * exactly. No assignment/return/acknowledgement/incident/maintenance/
 * evidence route exists here — those are W97-W100.
 */
import { Router, type Response } from "express";
import {
  CreateAssetBody,
  UpdateAssetBody,
  RetireAssetBody,
  MarkAssetLostBody,
  RecoverAssetBody,
  UpdateAssetConditionBody,
  AssignAssetBody,
  ReturnAssetBody,
  AcknowledgeAssetAssignmentBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { ASSET_MANAGEMENT_MODULE_KEY, resolveAssetActorEmployeeId, hasOrgWideAssetAccess } from "../lib/assetManagementAuthorization";
import { toIsoDate } from "../lib/leaveRequests";
import {
  listAssets,
  getAsset,
  callerHasActiveAssignment,
  createAsset,
  updateAsset,
  retireAsset,
  markAssetLost,
  recoverAsset,
  updateAssetCondition,
  assignAsset,
  returnAsset,
  acknowledgeAssetAssignment,
  listAssetAssignments,
  AssetNotFoundError,
  InvalidAssetError,
  DuplicateAssetTagError,
  DuplicateAssetSerialNumberError,
  AssetLifecycleConflictError,
  AssetAssignmentNotFoundError,
  AssetAssignmentConflictError,
  CrossOrganizationReferenceError,
} from "../lib/assets";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function optionalId(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const parsed = parseId(raw as string);
  return isNaN(parsed) ? undefined : parsed;
}

function iso(d: Date | null | undefined): string | undefined | null {
  if (d === undefined) return undefined;
  if (d === null) return null;
  return toIsoDate(d);
}

function handleAssetError(err: unknown, res: Response): void {
  if (err instanceof AssetNotFoundError || err instanceof AssetAssignmentNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (
    err instanceof AssetLifecycleConflictError ||
    err instanceof DuplicateAssetTagError ||
    err instanceof DuplicateAssetSerialNumberError ||
    err instanceof AssetAssignmentConflictError
  ) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidAssetError || err instanceof CrossOrganizationReferenceError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /organizations/:organizationId/assets
router.get(
  "/organizations/:organizationId/assets",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const condition = typeof req.query.condition === "string" ? req.query.condition : undefined;
    const categoryCode = typeof req.query.categoryCode === "string" ? req.query.categoryCode : undefined;
    const branchId = optionalId(req.query.branchId);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const rawPage = optionalId(req.query.page);
    const rawPageSize = optionalId(req.query.pageSize);
    const page = rawPage != null && rawPage > 0 ? rawPage : 1;
    const pageSize = rawPageSize != null && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 20;

    const result = await listAssets({
      organizationId: req.membership!.organizationId,
      status,
      condition,
      categoryCode,
      branchId,
      search,
      page,
      pageSize,
    });
    res.json(result);
  },
);

// POST /organizations/:organizationId/assets
router.post(
  "/organizations/:organizationId/assets",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const asset = await createAsset({
        organizationId: req.membership!.organizationId,
        categoryCode: parsed.data.categoryCode,
        name: parsed.data.name,
        description: parsed.data.description,
        manufacturer: parsed.data.manufacturer,
        model: parsed.data.model,
        serialNumber: parsed.data.serialNumber,
        branchId: parsed.data.branchId,
        purchaseDate: iso(parsed.data.purchaseDate) ?? undefined,
        purchaseCost: parsed.data.purchaseCost,
        purchaseCurrency: parsed.data.purchaseCurrency,
        warrantyExpiryDate: iso(parsed.data.warrantyExpiryDate) ?? undefined,
        condition: parsed.data.condition,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(asset);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// GET /organizations/:organizationId/assets/:id
router.get(
  "/organizations/:organizationId/assets/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const asset = await getAsset(organizationId, assetId);
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const isOrgWide = await hasOrgWideAssetAccess(req.membership!.id, "asset_management.manage");
    if (!isOrgWide) {
      const callerEmployeeId = await resolveAssetActorEmployeeId(organizationId, req.userId!);
      const isOwnAssignment = await callerHasActiveAssignment(organizationId, assetId, callerEmployeeId);
      if (!isOwnAssignment) {
        res.status(403).json({ error: "Not authorized to view this asset" });
        return;
      }
    }
    res.json(asset);
  },
);

// PATCH /organizations/:organizationId/assets/:id
router.patch(
  "/organizations/:organizationId/assets/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = UpdateAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateAsset({
        organizationId: req.membership!.organizationId,
        assetId,
        categoryCode: parsed.data.categoryCode,
        name: parsed.data.name,
        description: parsed.data.description,
        manufacturer: parsed.data.manufacturer,
        model: parsed.data.model,
        serialNumber: parsed.data.serialNumber,
        branchId: parsed.data.branchId,
        purchaseDate: iso(parsed.data.purchaseDate),
        purchaseCost: parsed.data.purchaseCost,
        purchaseCurrency: parsed.data.purchaseCurrency,
        warrantyExpiryDate: iso(parsed.data.warrantyExpiryDate),
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// POST /organizations/:organizationId/assets/:id/retire
router.post(
  "/organizations/:organizationId/assets/:id/retire",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = RetireAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await retireAsset({
        organizationId: req.membership!.organizationId,
        assetId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// POST /organizations/:organizationId/assets/:id/mark-lost
router.post(
  "/organizations/:organizationId/assets/:id/mark-lost",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = MarkAssetLostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await markAssetLost({
        organizationId: req.membership!.organizationId,
        assetId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// POST /organizations/:organizationId/assets/:id/recover
router.post(
  "/organizations/:organizationId/assets/:id/recover",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = RecoverAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await recoverAsset({
        organizationId: req.membership!.organizationId,
        assetId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// POST /organizations/:organizationId/assets/:id/condition
router.post(
  "/organizations/:organizationId/assets/:id/condition",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = UpdateAssetConditionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateAssetCondition({
        organizationId: req.membership!.organizationId,
        assetId,
        condition: parsed.data.condition,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// ============================================================================
// Assignments (Phase 3E, W97): §20's own "Assignments" route group — issue/
// return/history/acknowledge. No employee/manager self-service surface, no
// report-issue, no incident/maintenance/evidence route exists here — those
// belong to W98-W100 (§24's own "Employee own assets / manager team view"
// group, a separate route group W97 does not own).
// ============================================================================

// POST /organizations/:organizationId/assets/:id/assign
router.post(
  "/organizations/:organizationId/assets/:id/assign",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = AssignAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await assignAsset({
        organizationId: req.membership!.organizationId,
        assetId,
        employeeId: parsed.data.employeeId,
        issueCondition: parsed.data.issueCondition,
        expectedReturnDate: iso(parsed.data.expectedReturnDate) ?? undefined,
        issueNotes: parsed.data.issueNotes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// POST /organizations/:organizationId/assets/:id/return
router.post(
  "/organizations/:organizationId/assets/:id/return",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = ReturnAssetBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await returnAsset({
        organizationId: req.membership!.organizationId,
        assetId,
        returnCondition: parsed.data.returnCondition,
        returnNotes: parsed.data.returnNotes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// GET /organizations/:organizationId/assets/:id/assignments
router.get(
  "/organizations/:organizationId/assets/:id/assignments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const asset = await getAsset(organizationId, assetId);
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const isOrgWide = await hasOrgWideAssetAccess(req.membership!.id, "asset_management.manage");
    const callerEmployeeId = isOrgWide ? null : await resolveAssetActorEmployeeId(organizationId, req.userId!);
    const assignments = await listAssetAssignments({
      organizationId,
      assetId,
      scope: isOrgWide ? "organization_wide" : "own",
      callerEmployeeId,
    });
    res.json(assignments);
  },
);

// POST /organizations/:organizationId/asset-assignments/:id/acknowledge
router.post(
  "/organizations/:organizationId/asset-assignments/:id/acknowledge",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.write.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assignmentId = parseId(req.params.id);
    if (isNaN(assignmentId)) {
      res.status(400).json({ error: "Invalid assignment ID" });
      return;
    }
    const parsed = AcknowledgeAssetAssignmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveAssetActorEmployeeId(organizationId, req.userId!);
    if (callerEmployeeId == null) {
      res.status(404).json({ error: "Asset assignment not found" });
      return;
    }

    try {
      const updated = await acknowledgeAssetAssignment({
        organizationId,
        assignmentId,
        employeeId: callerEmployeeId,
        acknowledgementNote: parsed.data.acknowledgementNote,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

export default router;
