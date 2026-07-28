/**
 * Exit Management (Phase 2A, W29): the off-boarding process (checklist,
 * clearance, exit interview record) attached to an existing separation
 * event (W15). Does not modify or duplicate `separateEmployee` — reuses
 * `getEmployeeById`/`EmployeeNotFoundError`/`EmployeeNotSeparatedError` from
 * lib/employees.ts rather than re-deriving separation state. Audit-logged
 * directly (recordAuditEvent), the same mechanism W15 itself uses for
 * separation — not routed through EmploymentLifecycleService/
 * employment_periods, since ADR-013 already established that separation-area
 * events live in audit_events, not employment_periods.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, employeeExitProcessesTable, type EmployeeExitProcess } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getEmployeeById, EmployeeNotFoundError, EmployeeNotSeparatedError } from "./employees";

export class EmployeeExitProcessAlreadyExistsError extends Error {
  constructor() {
    super("An exit process already exists for this employee's current separation");
    this.name = "EmployeeExitProcessAlreadyExistsError";
  }
}

export class EmployeeExitProcessNotFoundError extends Error {
  constructor() {
    super("Exit process not found");
    this.name = "EmployeeExitProcessNotFoundError";
  }
}

/** Org-scoped exit processes for one employee, most recent separation first. */
export async function listEmployeeExitProcesses(organizationId: number, employeeId: number): Promise<EmployeeExitProcess[]> {
  return db
    .select()
    .from(employeeExitProcessesTable)
    .where(and(eq(employeeExitProcessesTable.organizationId, organizationId), eq(employeeExitProcessesTable.employeeId, employeeId)))
    .orderBy(desc(employeeExitProcessesTable.separationDate));
}

/**
 * Starts the off-boarding process for the employee's current separation.
 * Requires the employee to actually be separated (reuses the same
 * "not currently separated" error rehireEmployee already throws) and
 * rejects a duplicate for the same separation cycle — an employee separated,
 * rehired, and separated again gets a fresh exit process, but only one open
 * process per separation.
 */
export async function createEmployeeExitProcess(params: {
  organizationId: number;
  employeeId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeExitProcess> {
  const employee = await getEmployeeById(params.organizationId, params.employeeId);
  if (!employee) throw new EmployeeNotFoundError();
  if (employee.employmentStatus !== "terminated" || !employee.separationDate) {
    throw new EmployeeNotSeparatedError();
  }

  const existing = await listEmployeeExitProcesses(params.organizationId, params.employeeId);
  const duplicate = existing.some((row) => row.separationDate.getTime() === employee.separationDate!.getTime());
  if (duplicate) throw new EmployeeExitProcessAlreadyExistsError();

  const [process] = await db
    .insert(employeeExitProcessesTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      separationDate: employee.separationDate,
      initiatedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_exit_process.created",
    targetType: "employee",
    targetId: String(params.employeeId),
    metadata: { exitProcessId: process.id, separationDate: process.separationDate },
  });

  return process;
}

async function findOwnExitProcess(organizationId: number, employeeId: number, exitProcessId: number) {
  const [row] = await db
    .select()
    .from(employeeExitProcessesTable)
    .where(
      and(
        eq(employeeExitProcessesTable.id, exitProcessId),
        eq(employeeExitProcessesTable.organizationId, organizationId),
        eq(employeeExitProcessesTable.employeeId, employeeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Updates checklist/clearance/exit-interview progress on an existing exit process — never creates a competing record. */
export async function updateEmployeeExitProcess(params: {
  organizationId: number;
  employeeId: number;
  exitProcessId: number;
  checklistCompleted?: boolean;
  clearanceCompleted?: boolean;
  exitInterviewCompleted?: boolean;
  exitInterviewNotes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeExitProcess> {
  const before = await findOwnExitProcess(params.organizationId, params.employeeId, params.exitProcessId);
  if (!before) throw new EmployeeExitProcessNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.checklistCompleted !== undefined) patch.checklistCompleted = params.checklistCompleted;
  if (params.clearanceCompleted !== undefined) patch.clearanceCompleted = params.clearanceCompleted;
  if (params.exitInterviewCompleted !== undefined) patch.exitInterviewCompleted = params.exitInterviewCompleted;
  if (params.exitInterviewNotes !== undefined) patch.exitInterviewNotes = params.exitInterviewNotes;

  const [updated] = await db
    .update(employeeExitProcessesTable)
    .set(patch)
    .where(eq(employeeExitProcessesTable.id, params.exitProcessId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_exit_process.updated",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: {
      checklistCompleted: before.checklistCompleted,
      clearanceCompleted: before.clearanceCompleted,
      exitInterviewCompleted: before.exitInterviewCompleted,
    },
    afterState: {
      checklistCompleted: updated.checklistCompleted,
      clearanceCompleted: updated.clearanceCompleted,
      exitInterviewCompleted: updated.exitInterviewCompleted,
    },
    metadata: { exitProcessId: updated.id },
  });

  return updated;
}
