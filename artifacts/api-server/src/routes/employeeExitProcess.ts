import { Router } from "express";
import { UpdateEmployeeExitProcessBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById, EmployeeNotFoundError, EmployeeNotSeparatedError } from "../lib/employees";
import {
  listEmployeeExitProcesses,
  createEmployeeExitProcess,
  updateEmployeeExitProcess,
  EmployeeExitProcessAlreadyExistsError,
  EmployeeExitProcessNotFoundError,
} from "../lib/employeeExitProcess";

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

// GET /organizations/:organizationId/employees/:employeeId/exit-process
//
// Authorization fix (2026-09-15): an exit process is an HR record (exit
// interview notes, separation basis, clearance flags and actors). It was gated
// by employee.read — the directory grant every role holds — so any employee
// could read any colleague's. It now requires employee.write, the same key its
// own POST/PATCH below use, so reading an exit process needs the authority
// that runs one. There is no self-service or manager consumer of this route
// (the employee-detail Exit Management card is the only caller), so no self
// or reporting-line tier is added.
router.get(
  "/organizations/:organizationId/employees/:employeeId/exit-process",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const processes = await listEmployeeExitProcesses(req.membership!.organizationId, employeeId);
    res.json(processes);
  },
);

// POST /organizations/:organizationId/employees/:employeeId/exit-process
router.post(
  "/organizations/:organizationId/employees/:employeeId/exit-process",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    try {
      const process = await createEmployeeExitProcess({
        organizationId: req.membership!.organizationId,
        employeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(process);
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNotSeparatedError || err instanceof EmployeeExitProcessAlreadyExistsError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/employees/:employeeId/exit-process/:exitProcessId
router.patch(
  "/organizations/:organizationId/employees/:employeeId/exit-process/:exitProcessId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const exitProcessId = parseId(req.params.exitProcessId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(exitProcessId)) {
      res.status(400).json({ error: "Invalid exit process ID" });
      return;
    }

    const parsed = UpdateEmployeeExitProcessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const process = await updateEmployeeExitProcess({
        organizationId: req.membership!.organizationId,
        employeeId,
        exitProcessId,
        checklistCompleted: parsed.data.checklistCompleted,
        clearanceCompleted: parsed.data.clearanceCompleted,
        exitInterviewCompleted: parsed.data.exitInterviewCompleted,
        exitInterviewNotes: parsed.data.exitInterviewNotes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(process);
    } catch (err) {
      if (err instanceof EmployeeExitProcessNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
