/**
 * Office Inventory, Workstream 4 — Issue, Fulfilment, Confirmation, Direct
 * Issue routes (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §16-§20,
 * §47). Every route composes `requireModuleEnabled("office_inventory")`.
 * Permissions reused unchanged from the frozen 23-key list —
 * `office_inventory.issue`, `office_inventory.issue.direct`,
 * `office_inventory.receipt.confirm.own`, `office_inventory.custody.read`
 * — zero new keys. Custody reads use `custody.read` (never `.receive` or
 * `.issue`), since real employee/department custody now exists — the
 * reservation this permission was originally deferred for (see W2/W3's own
 * reconciliation history).
 */
import { Router } from "express";
import { IssueOfficeInventoryRequestLineBody, CreateOfficeInventoryDirectIssueBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { resolveOwnEmployeeId, toIsoDate } from "../lib/leaveRequests";
import {
  issueAgainstRequestLine,
  directIssue,
  confirmReceipt,
  listRequestsAwaitingFulfilment,
  OfficeInventoryRequestLineNotFoundError,
  OfficeInventoryLineNotApprovedError,
  OfficeInventoryOverFulfilmentError,
  OfficeInventoryInvalidIssueQuantityError,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryHolderNotFoundError,
  OfficeInventoryExpectedReturnDateNotAllowedError,
  OfficeInventoryDirectIssueReasonRequiredError,
  OfficeInventoryDirectIssueDisabledError,
  OfficeInventoryMovementNotFoundError,
  OfficeInventoryAlreadyConfirmedError,
  OfficeInventoryNotEligibleToConfirmError,
} from "../lib/officeInventoryIssuing";
import { listCurrentCustody, InsufficientStockError } from "../lib/officeInventoryLedger";
import { db, employeesTable, departmentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/office-inventory/requests/awaiting-fulfilment
router.get(
  "/organizations/:organizationId/office-inventory/requests/awaiting-fulfilment",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    const entries = await listRequestsAwaitingFulfilment(req.membership!.organizationId);
    res.json(entries);
  },
);

// POST /organizations/:organizationId/office-inventory/request-lines/:lineId/issue
router.post(
  "/organizations/:organizationId/office-inventory/request-lines/:lineId/issue",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    const lineId = parseId(req.params.lineId);
    if (isNaN(lineId)) {
      res.status(400).json({ error: "Invalid request line ID" });
      return;
    }
    const parsed = IssueOfficeInventoryRequestLineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await issueAgainstRequestLine({
        organizationId: req.membership!.organizationId,
        lineId,
        storeId: parsed.data.storeId,
        quantity: parsed.data.quantity,
        expectedReturnDate: parsed.data.expectedReturnDate ? toIsoDate(parsed.data.expectedReturnDate) : null,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryRequestLineNotFoundError || err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidIssueQuantityError || err instanceof OfficeInventoryExpectedReturnDateNotAllowedError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryLineNotApprovedError || err instanceof OfficeInventoryOverFulfilmentError || err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/direct-issue
router.post(
  "/organizations/:organizationId/office-inventory/direct-issue",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.issue.direct"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryDirectIssueBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await directIssue({
        organizationId: req.membership!.organizationId,
        storeId: parsed.data.storeId,
        itemId: parsed.data.itemId,
        quantity: parsed.data.quantity,
        holderType: parsed.data.holderType,
        holderId: parsed.data.holderId,
        reason: parsed.data.reason,
        expectedReturnDate: parsed.data.expectedReturnDate ? toIsoDate(parsed.data.expectedReturnDate) : null,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryStoreNotFoundError || err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryHolderNotFoundError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryDirectIssueReasonRequiredError || err instanceof OfficeInventoryExpectedReturnDateNotAllowedError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryDirectIssueDisabledError) {
        res.status(403).json({ error: err.message });
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

// POST /organizations/:organizationId/office-inventory/movements/:movementId/confirm
router.post(
  "/organizations/:organizationId/office-inventory/movements/:movementId/confirm",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.receipt.confirm.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const movementId = parseId(req.params.movementId);
    if (isNaN(movementId)) {
      res.status(400).json({ error: "Invalid movement ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const actorEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    try {
      const confirmed = await confirmReceipt({
        organizationId,
        movementId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
        actorEmployeeId,
      });
      res.json(confirmed);
    } catch (err) {
      if (err instanceof OfficeInventoryMovementNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNotEligibleToConfirmError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryAlreadyConfirmedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/custody/employees/:employeeId
router.get(
  "/organizations/:organizationId/office-inventory/custody/employees/:employeeId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.custody.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = parseId(req.params.employeeId);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)));
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const custody = await listCurrentCustody(organizationId, "employee", employeeId);
    res.json(custody);
  },
);

// GET /organizations/:organizationId/office-inventory/custody/departments/:departmentId
router.get(
  "/organizations/:organizationId/office-inventory/custody/departments/:departmentId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.custody.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const [department] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.organizationId, organizationId)));
    if (!department) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    const custody = await listCurrentCustody(organizationId, "department", departmentId);
    res.json(custody);
  },
);

export default router;
