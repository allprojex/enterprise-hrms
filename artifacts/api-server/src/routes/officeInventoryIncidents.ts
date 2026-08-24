/**
 * Office Inventory, Workstream 6 — Incidents, Write-Off & Adjustment
 * routes (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §25-§27, §47, §50).
 * Every route composes `requireModuleEnabled("office_inventory")`.
 * Permissions reused unchanged from the frozen 22-key list —
 * `office_inventory.report_issue.own`, `office_inventory.incident.review`,
 * `office_inventory.recover`, `office_inventory.writeoff`,
 * `office_inventory.adjust` — zero new keys. No generic movement-write
 * route, no arbitrary `movementType` selection, no generic status-PATCH.
 */
import { Router } from "express";
import {
  ReportOfficeInventoryIncidentBody,
  ReviewOfficeInventoryIncidentBody,
  MarkOfficeInventoryIncidentMissingBody,
  RecoverOfficeInventoryIncidentBody,
  WriteOffOfficeInventoryIncidentBody,
  CreateOfficeInventoryWriteOffBody,
  CreateOfficeInventoryAdjustmentBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import {
  reportIncident,
  listIncidents,
  getIncident,
  reviewIncident,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryHolderNotFoundError,
  OfficeInventoryNotOwnCustodyError,
  OfficeInventoryNoCustodyToReportError,
  OfficeInventoryIncidentNotFoundError,
  OfficeInventoryIncidentAlreadyResolvedError,
} from "../lib/officeInventoryIncidents";
import {
  markIncidentMissing,
  recoverFromIncident,
  writeOffFromIncident,
  writeOff,
  adjustStore,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryInvalidQuantityError,
  OfficeInventoryReasonRequiredError,
  OfficeInventoryIncidentNotOpenError,
  OfficeInventoryOverRecoveryError,
} from "../lib/officeInventoryDisposition";
import { InsufficientStockError, InsufficientCustodyError } from "../lib/officeInventoryLedger";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// POST /organizations/:organizationId/office-inventory/incidents
router.post(
  "/organizations/:organizationId/office-inventory/incidents",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.report_issue.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ReportOfficeInventoryIncidentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const actorEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    try {
      const incident = await reportIncident({
        organizationId,
        itemId: parsed.data.itemId,
        holderType: parsed.data.holderType,
        holderId: parsed.data.holderId,
        incidentType: parsed.data.incidentType,
        description: parsed.data.description,
        actorEmployeeId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(incident);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryHolderNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNotOwnCustodyError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNoCustodyToReportError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/incidents
router.get(
  "/organizations/:organizationId/office-inventory/incidents",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.incident.review"),
  async (req: MembershipRequest, res): Promise<void> => {
    const status = typeof req.query.status === "string" ? (req.query.status as "open" | "reviewed" | "dismissed") : undefined;
    const incidents = await listIncidents(req.membership!.organizationId, { status });
    res.json(incidents);
  },
);

// GET /organizations/:organizationId/office-inventory/incidents/:id
router.get(
  "/organizations/:organizationId/office-inventory/incidents/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.incident.review"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const incident = await getIncident(req.membership!.organizationId, incidentId);
    if (!incident) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    res.json(incident);
  },
);

// POST /organizations/:organizationId/office-inventory/incidents/:id/review
router.post(
  "/organizations/:organizationId/office-inventory/incidents/:id/review",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.incident.review"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const parsed = ReviewOfficeInventoryIncidentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await reviewIncident({
        organizationId: req.membership!.organizationId,
        incidentId,
        outcome: parsed.data.outcome,
        resolutionNotes: parsed.data.resolutionNotes,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof OfficeInventoryIncidentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryIncidentAlreadyResolvedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/incidents/:id/mark-missing
router.post(
  "/organizations/:organizationId/office-inventory/incidents/:id/mark-missing",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.incident.review"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const parsed = MarkOfficeInventoryIncidentMissingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await markIncidentMissing({
        organizationId: req.membership!.organizationId,
        incidentId,
        quantity: parsed.data.quantity,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryIncidentNotFoundError || err instanceof OfficeInventoryHolderNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryIncidentNotOpenError || err instanceof InsufficientCustodyError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/incidents/:id/recover
router.post(
  "/organizations/:organizationId/office-inventory/incidents/:id/recover",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.recover"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const parsed = RecoverOfficeInventoryIncidentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await recoverFromIncident({
        organizationId: req.membership!.organizationId,
        incidentId,
        quantity: parsed.data.quantity,
        destinationStoreId: parsed.data.destinationStoreId,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryIncidentNotFoundError || err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryOverRecoveryError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/incidents/:id/write-off
router.post(
  "/organizations/:organizationId/office-inventory/incidents/:id/write-off",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.writeoff"),
  async (req: MembershipRequest, res): Promise<void> => {
    const incidentId = parseId(req.params.id);
    if (isNaN(incidentId)) {
      res.status(400).json({ error: "Invalid incident ID" });
      return;
    }
    const parsed = WriteOffOfficeInventoryIncidentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await writeOffFromIncident({
        organizationId: req.membership!.organizationId,
        incidentId,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryIncidentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError || err instanceof OfficeInventoryReasonRequiredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryOverRecoveryError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/write-offs
router.post(
  "/organizations/:organizationId/office-inventory/write-offs",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.writeoff"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryWriteOffBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.sourceType === "store" && parsed.data.storeId === undefined) {
      res.status(400).json({ error: "storeId is required when sourceType is \"store\"" });
      return;
    }
    if (parsed.data.sourceType !== "store" && parsed.data.holderId === undefined) {
      res.status(400).json({ error: "holderId is required when sourceType is \"employee\" or \"department\"" });
      return;
    }
    const source =
      parsed.data.sourceType === "store"
        ? ({ type: "store", storeId: parsed.data.storeId! } as const)
        : parsed.data.sourceType === "employee"
          ? ({ type: "employee", holderId: parsed.data.holderId! } as const)
          : ({ type: "department", holderId: parsed.data.holderId! } as const);
    try {
      const result = await writeOff({
        organizationId: req.membership!.organizationId,
        itemId: parsed.data.itemId,
        source,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        incidentId: parsed.data.incidentId,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryStoreNotFoundError || err instanceof OfficeInventoryHolderNotFoundError || err instanceof OfficeInventoryIncidentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError || err instanceof OfficeInventoryReasonRequiredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof InsufficientStockError || err instanceof InsufficientCustodyError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/adjustments
router.post(
  "/organizations/:organizationId/office-inventory/adjustments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.adjust"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryAdjustmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await adjustStore({
        organizationId: req.membership!.organizationId,
        storeId: parsed.data.storeId,
        itemId: parsed.data.itemId,
        direction: parsed.data.direction,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError || err instanceof OfficeInventoryReasonRequiredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
