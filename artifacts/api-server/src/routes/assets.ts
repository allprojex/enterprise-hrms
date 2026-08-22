/**
 * Asset Register (Phase 3E, W96-W100): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
 * §20's own frozen route list — every mutating route requires
 * asset_management.manage (maintenance: exclusively, no exception, §15);
 * GET .../assets/:id and the evidence routes accept the broader
 * asset_management.read.own floor, with fine-grained own-scope reach
 * (currently holds this asset) resolved inside the handler, mirroring
 * learningEnrollments.ts's own GET .../enrollments/:id dual-floor pattern
 * exactly (see lib/assets.ts's own W100 file-header for the full evidence
 * visibility-tier reconciliation).
 */
import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
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
  ReportAssetIssueBody,
  ReviewAssetIncidentBody,
  DismissAssetIncidentBody,
  CreateAssetMaintenanceBody,
  UpdateAssetMaintenanceBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { ASSET_MANAGEMENT_MODULE_KEY, resolveAssetActorEmployeeId, hasOrgWideAssetAccess } from "../lib/assetManagementAuthorization";
import { toIsoDate } from "../lib/leaveRequests";
import { readOrgFile } from "../lib/fileStorage";
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
  reportAssetIssue,
  listMyAssetAssignments,
  listTeamAssetAssignments,
  listAssetIncidents,
  reviewAssetIncident,
  dismissAssetIncident,
  createAssetMaintenance,
  listAssetMaintenance,
  updateAssetMaintenance,
  listAssetEvidence,
  getAssetEvidenceForDownload,
  addAssetEvidence,
  AssetNotFoundError,
  InvalidAssetError,
  DuplicateAssetTagError,
  DuplicateAssetSerialNumberError,
  AssetLifecycleConflictError,
  AssetAssignmentNotFoundError,
  AssetAssignmentConflictError,
  AssetNotCurrentlyAssignedToCallerError,
  AssetIncidentNotFoundError,
  AssetIncidentConflictError,
  AssetMaintenanceNotFoundError,
  AssetMaintenanceConflictError,
  InvalidDocumentError,
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
  if (
    err instanceof AssetNotFoundError ||
    err instanceof AssetAssignmentNotFoundError ||
    err instanceof AssetIncidentNotFoundError ||
    err instanceof AssetMaintenanceNotFoundError
  ) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (
    err instanceof AssetLifecycleConflictError ||
    err instanceof DuplicateAssetTagError ||
    err instanceof DuplicateAssetSerialNumberError ||
    err instanceof AssetAssignmentConflictError ||
    err instanceof AssetIncidentConflictError ||
    err instanceof AssetMaintenanceConflictError
  ) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidAssetError || err instanceof CrossOrganizationReferenceError || err instanceof InvalidDocumentError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof AssetNotCurrentlyAssignedToCallerError) {
    res.status(403).json({ error: err.message });
    return;
  }
  throw err;
}

// Same 10MB ceiling as every other document upload on this platform —
// validateDocumentUpload enforces the same limit again from the actual file
// bytes; this is just multer's own outer bound, identical to
// learningEnrollmentEvidence.ts's/performanceReviewEvidence.ts's own setup.
const uploadEvidence = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function handleEvidenceUpload(req: MembershipRequest, res: Response, next: NextFunction): void {
  uploadEvidence.single("file")(req as never, res as never, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 10MB size limit" : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
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

// GET /organizations/:organizationId/assets/my-assets (Phase 3E, W98)
// Registered BEFORE the dynamic :id route below — Express matches route
// patterns in registration order, and "my-assets"/"team-assets" would
// otherwise be swallowed by the :id param route (and rejected there as an
// invalid numeric ID) if registered after it.
router.get(
  "/organizations/:organizationId/assets/my-assets",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveAssetActorEmployeeId(organizationId, req.userId!);
    const assignments = await listMyAssetAssignments(organizationId, callerEmployeeId);
    res.json(assignments);
  },
);

// GET /organizations/:organizationId/assets/team-assets (Phase 3E, W98,
// Decision 3): current custody only, for current direct reports only — the
// live reportingManagerId relationship, never a snapshot, never an
// organization-wide fallback. Read-only; no manager mutation route exists
// anywhere in this file.
router.get(
  "/organizations/:organizationId/assets/team-assets",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveAssetActorEmployeeId(organizationId, req.userId!);
    const assignments = await listTeamAssetAssignments(organizationId, callerEmployeeId);
    res.json(assignments);
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

// POST /organizations/:organizationId/assets/:id/report-issue (Phase 3E,
// W98, Decision 2): report-only — never mutates asset/custody state. Only
// on an asset with an active assignment belonging to the caller. Identity
// is always server-resolved, never client-supplied.
router.post(
  "/organizations/:organizationId/assets/:id/report-issue",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.write.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset ID" });
      return;
    }
    const parsed = ReportAssetIssueBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveAssetActorEmployeeId(organizationId, req.userId!);
    if (callerEmployeeId == null) {
      res.status(403).json({ error: "You may only report an issue on an asset currently assigned to you" });
      return;
    }

    try {
      const incident = await reportAssetIssue({
        organizationId,
        assetId,
        employeeId: callerEmployeeId,
        incidentType: parsed.data.incidentType,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(incident);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// ============================================================================
// Incident handling (Phase 3E, W99, HR/Asset-Officer): §20's own frozen
// "Incident handling" route group — org-wide list, review, dismiss. No
// GET .../asset-incidents/:id detail route exists — the frozen §20 contract
// names none, and the list route's own rows already carry every field a
// detail view would need. Every route here is asset_management.manage-only
// — no employee/manager incident-review authority exists anywhere.
// ============================================================================

// GET /organizations/:organizationId/asset-incidents
router.get(
  "/organizations/:organizationId/asset-incidents",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const incidents = await listAssetIncidents({
      organizationId: req.membership!.organizationId,
      status,
    });
    res.json(incidents);
  },
);

// POST /organizations/:organizationId/asset-incidents/:id/review
router.post(
  "/organizations/:organizationId/asset-incidents/:id/review",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const parsed = ReviewAssetIncidentBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await reviewAssetIncident({
        organizationId: req.membership!.organizationId,
        incidentId,
        resolutionNotes: parsed.data.resolutionNotes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// POST /organizations/:organizationId/asset-incidents/:id/dismiss
router.post(
  "/organizations/:organizationId/asset-incidents/:id/dismiss",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const parsed = DismissAssetIncidentBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await dismissAssetIncident({
        organizationId: req.membership!.organizationId,
        incidentId,
        resolutionNotes: parsed.data.resolutionNotes,
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
// Maintenance (Phase 3E, W100): §20's own frozen "Maintenance" route group —
// asset_management.manage only, no exception, never reachable through
// read.own/write.own/reports.read/manager-of-record (§15). See
// lib/assets.ts's own W100 file header for the full lifecycle/derivation
// design.
// ============================================================================

// GET/POST /organizations/:organizationId/assets/:id/maintenance
router.get(
  "/organizations/:organizationId/assets/:id/maintenance",
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
    const organizationId = req.membership!.organizationId;
    const asset = await getAsset(organizationId, assetId);
    if (!asset) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }
    res.json(await listAssetMaintenance(organizationId, assetId));
  },
);

router.post(
  "/organizations/:organizationId/assets/:id/maintenance",
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
    const parsed = CreateAssetMaintenanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const maintenance = await createAssetMaintenance({
        organizationId: req.membership!.organizationId,
        assetId,
        maintenanceType: parsed.data.maintenanceType,
        description: parsed.data.description,
        providerText: parsed.data.providerText,
        cost: parsed.data.cost,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(maintenance);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// PATCH /organizations/:organizationId/asset-maintenance/:id — the single
// frozen route for every maintenance lifecycle transition (§20), dispatched
// by the request body's own `action` (start/complete/cancel), never a raw
// target status.
router.patch(
  "/organizations/:organizationId/asset-maintenance/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const maintenanceId = parseId(req.params.id);
    if (isNaN(maintenanceId)) {
      res.status(400).json({ error: "Invalid maintenance ID" });
      return;
    }
    const parsed = UpdateAssetMaintenanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateAssetMaintenance({
        organizationId: req.membership!.organizationId,
        maintenanceId,
        action: parsed.data.action,
        cost: parsed.data.cost,
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

// ============================================================================
// Documents/evidence (Phase 3E, W100): §20's own frozen "Documents/evidence"
// route group — "same visibility tier as the asset itself" for every route
// here (GET list, POST upload, GET download): organization-wide
// (asset_management.manage) OR own-scope (the caller currently holds this
// specific asset), the exact dual-floor GET .../assets/:id already resolves.
// The permission-middleware floor is asset_management.read.own, matching
// GET .../assets/:id's own floor — never asset_management.write.own (§15's
// permanent invariant: exactly acknowledge + report-issue, untouched here).
// See lib/assets.ts's own W100 file header for the full reconciliation.
// ============================================================================

// GET/POST /organizations/:organizationId/assets/:id/evidence
router.get(
  "/organizations/:organizationId/assets/:id/evidence",
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
        res.status(403).json({ error: "Not authorized to view this asset's evidence" });
        return;
      }
    }

    res.json(await listAssetEvidence(organizationId, assetId));
  },
);

router.post(
  "/organizations/:organizationId/assets/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.read.own"),
  handleEvidenceUpload,
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    if (isNaN(assetId) || !req.file) {
      res.status(400).json({ error: "Invalid request" });
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
        res.status(403).json({ error: "Not authorized to add evidence to this asset" });
        return;
      }
    }

    try {
      const evidence = await addAssetEvidence({
        organizationId,
        assetId,
        file: { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer, originalname: req.file.originalname },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(evidence);
    } catch (err) {
      handleAssetError(err, res);
    }
  },
);

// GET /organizations/:organizationId/assets/:id/evidence/:evidenceId/download
// Authorization-checked before any storage read: authenticate -> membership
// -> module -> resolve asset -> prove the caller's own/org-wide visibility
// -> confirm the evidence row belongs to this exact asset/org -> only then
// read the file. No public URL is ever generated; the file streams through
// this authenticated route on every request.
router.get(
  "/organizations/:organizationId/assets/:id/evidence/:evidenceId/download",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assetId = parseId(req.params.id);
    const evidenceId = parseId(req.params.evidenceId);
    if (isNaN(assetId) || isNaN(evidenceId)) {
      res.status(400).json({ error: "Invalid request" });
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
        res.status(403).json({ error: "Not authorized to access this asset's evidence" });
        return;
      }
    }

    const row = await getAssetEvidenceForDownload(organizationId, assetId, evidenceId);
    if (!row) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }

    const buffer = await readOrgFile(organizationId, row.storageKey);
    res.set("Content-Type", row.mimeType || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(buffer);
  },
);

export default router;
