/**
 * Phase 3H, W114 — Employee/Staff Number Allocation, Release & History.
 *
 * Deliberately separate from routes/employees.ts (which retains only the
 * read-side `employeeNumber` field on the Employee DTO) — every write to a
 * staff number now happens exclusively through these three routes, gated by
 * the new, narrow `employee_number.allocate` permission (frozen plan §13),
 * never through the generic employee PATCH.
 */
import { Router } from "express";
import { AllocateEmployeeNumberBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById } from "../lib/employees";
import {
  allocateGeneratedEmployeeNumber,
  allocateManualEmployeeNumber,
  releaseEmployeeNumber,
  listEmployeeNumberAllocationsForEmployee,
  listEmployeeNumberAllocationsForNumber,
  auditEmployeeNumberAllocated,
  auditEmployeeNumberReleased,
  EmployeeNotFoundForNumberingError,
  EmployeeNumberAlreadyActiveError,
  EmployeeNumberReuseDisabledError,
  EmployeeNumberCollisionError,
  EmployeeNumberMissingTokenDataError,
  EmployeeNumberNoActiveAllocationError,
  EmployeeNumberStillActivelyEmployedError,
  InvalidManualEmployeeNumberError,
} from "../lib/numbering";
import { db, type EmployeeNumberAllocation } from "@workspace/db";

const router = Router();

function formatAllocation(a: EmployeeNumberAllocation) {
  return {
    id: a.id,
    organizationId: a.organizationId,
    employeeId: a.employeeId,
    employeeNumber: a.employeeNumber,
    allocationMethod: a.allocationMethod,
    validFrom: a.validFrom,
    validTo: a.validTo,
    allocatedByMembershipId: a.allocatedByMembershipId,
    releasedByMembershipId: a.releasedByMembershipId,
    createdAt: a.createdAt,
  };
}

// POST /organizations/:organizationId/employees/:employeeId/number/allocate
router.post(
  "/organizations/:organizationId/employees/:employeeId/number/allocate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_number.allocate"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const parsed = AllocateEmployeeNumberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    try {
      const result =
        parsed.data.mode === "manual"
          ? await allocateManualEmployeeNumber(db, {
              organizationId,
              employeeId,
              employeeNumber: parsed.data.employeeNumber ?? "",
              actorMembershipId: req.membership!.id,
            })
          : await allocateGeneratedEmployeeNumber(db, {
              organizationId,
              employeeId,
              actorMembershipId: req.membership!.id,
            });

      await auditEmployeeNumberAllocated({
        organizationId,
        employeeId,
        allocation: result.allocation,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      res.status(201).json({ employeeNumber: result.employee.employeeNumber, allocation: formatAllocation(result.allocation) });
    } catch (err) {
      if (err instanceof EmployeeNotFoundForNumberingError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (
        err instanceof EmployeeNumberAlreadyActiveError ||
        err instanceof EmployeeNumberReuseDisabledError ||
        err instanceof InvalidManualEmployeeNumberError ||
        err instanceof EmployeeNumberMissingTokenDataError
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNumberCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/number/release
router.post(
  "/organizations/:organizationId/employees/:employeeId/number/release",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_number.allocate"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    try {
      const result = await releaseEmployeeNumber(db, {
        organizationId,
        employeeId,
        actorMembershipId: req.membership!.id,
      });

      await auditEmployeeNumberReleased({
        organizationId,
        employeeId,
        allocation: result.allocation,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      res.json({ employeeNumber: result.employee.employeeNumber, allocation: formatAllocation(result.allocation) });
    } catch (err) {
      if (err instanceof EmployeeNotFoundForNumberingError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNumberStillActivelyEmployedError || err instanceof EmployeeNumberNoActiveAllocationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/number/history
// HR viewing an employee's own numbering record — employee.write, the same
// floor routes/employees.ts's own GET .../employment-history uses for the
// identical reason (org-wide HR record view, not self-service).
router.get(
  "/organizations/:organizationId/employees/:employeeId/number/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const allocations = await listEmployeeNumberAllocationsForEmployee(organizationId, employeeId);
    res.json(allocations.map(formatAllocation));
  },
);

// GET /organizations/:organizationId/employee-numbers/:employeeNumber/history
// Every employee who has ever held this exact number, in order — the
// reuse-ambiguity-safe view (frozen plan §10): a reused number must always
// show every past and present holder, clearly labeled, never silently
// collapsed to the current one.
router.get(
  "/organizations/:organizationId/employee-numbers/:employeeNumber/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeNumberRaw = Array.isArray(req.params.employeeNumber) ? req.params.employeeNumber[0] : req.params.employeeNumber;
    const organizationId = req.membership!.organizationId;
    const allocations = await listEmployeeNumberAllocationsForNumber(organizationId, employeeNumberRaw);
    res.json(allocations.map(formatAllocation));
  },
);

export default router;
