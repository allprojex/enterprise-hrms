import { Router } from "express";
import { AddEmployeeDisciplinaryRecordBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById } from "../lib/employees";
import { listEmployeeDisciplinaryRecords, addEmployeeDisciplinaryRecord } from "../lib/employeeDisciplinaryRecords";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

async function requireEmployee(req: MembershipRequest, res: import("express").Response, employeeId: number) {
  if (isNaN(employeeId)) {
    res.status(400).json({ error: "Invalid employee ID" });
    return null;
  }
  const employee = await getEmployeeById(req.membership!.organizationId, employeeId);
  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return null;
  }
  return employee;
}

// GET /organizations/:organizationId/employees/:employeeId/disciplinary-records
// Gated by employee.disciplinary.read, a narrower permission than
// employee.read (Architecture Decision 5) — same precedent as employee.notes.read.
router.get(
  "/organizations/:organizationId/employees/:employeeId/disciplinary-records",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.disciplinary.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const records = await listEmployeeDisciplinaryRecords(req.membership!.organizationId, employeeId);
    res.json(records);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/disciplinary-records
// Reuses employee.write, same as notes — no dedicated write permission.
router.post(
  "/organizations/:organizationId/employees/:employeeId/disciplinary-records",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const parsed = AddEmployeeDisciplinaryRecordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const record = await addEmployeeDisciplinaryRecord({
      organizationId: req.membership!.organizationId,
      employeeId,
      actionType: parsed.data.actionType,
      description: parsed.data.description,
      actionDate: parsed.data.actionDate,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(201).json(record);
  },
);

export default router;
