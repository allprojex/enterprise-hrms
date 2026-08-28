import { and, eq, desc, isNull, inArray } from "drizzle-orm";
import {
  db,
  employmentAssignmentsTable,
  employeesTable,
  positionsTable,
  departmentsTable,
  type EmploymentAssignment,
} from "@workspace/db";
import { recordEmploymentPeriodEvent } from "../employmentLifecycleService";
import { isUniqueViolation } from "../dbErrors";

/**
 * WS-11 — acting appointments and secondments
 * (see §27.12–27.14, OD #2/#6).
 *
 * THE RULE THIS FILE MOST EXISTS TO HOLD (§27.12): nothing here writes
 * `employees.positionId`, `employees.departmentId` or `employees.employmentStatus`.
 * A temporary assignment sits BESIDE the substantive appointment; it never
 * replaces it. That is why ending an acting appointment "restores" nothing —
 * there is nothing to restore, because nothing was overwritten.
 */

export class EmploymentAssignmentNotFoundError extends Error {
  constructor() {
    super("Assignment not found.");
    this.name = "EmploymentAssignmentNotFoundError";
  }
}
export class EmployeeNotFoundForAssignmentError extends Error {
  constructor() {
    super("Employee not found in this organization.");
    this.name = "EmployeeNotFoundForAssignmentError";
  }
}
export class InvalidAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssignmentError";
  }
}
export class AssignmentAlreadyOpenError extends Error {
  constructor(
    message: string,
    readonly existingAssignmentId: number,
  ) {
    super(message);
    this.name = "AssignmentAlreadyOpenError";
  }
}
export class AssignmentAlreadyEndedError extends Error {
  constructor() {
    super("This assignment has already ended.");
    this.name = "AssignmentAlreadyEndedError";
  }
}
export class AssignmentTypeNotEnabledError extends Error {
  constructor(kind: string) {
    super(`This organization does not use ${kind}.`);
    this.name = "AssignmentTypeNotEnabledError";
  }
}

type AssignmentType = EmploymentAssignment["assignmentType"];

const EVENT_FOR_START: Record<AssignmentType, "acting_start" | "secondment_start"> = {
  acting: "acting_start",
  secondment: "secondment_start",
};
const EVENT_FOR_END: Record<AssignmentType, "acting_end" | "secondment_end"> = {
  acting: "acting_end",
  secondment: "secondment_end",
};

async function assertEmployeeInOrganization(organizationId: number, employeeId: number): Promise<void> {
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!employee) throw new EmployeeNotFoundForAssignmentError();
}

export async function getAssignment(organizationId: number, assignmentId: number): Promise<EmploymentAssignment | null> {
  const [row] = await db
    .select()
    .from(employmentAssignmentsTable)
    .where(
      and(eq(employmentAssignmentsTable.id, assignmentId), eq(employmentAssignmentsTable.organizationId, organizationId)),
    )
    .limit(1);
  return row ?? null;
}

export async function listAssignments(
  organizationId: number,
  employeeId: number,
  assignmentType?: AssignmentType,
): Promise<EmploymentAssignment[]> {
  const conditions = [
    eq(employmentAssignmentsTable.organizationId, organizationId),
    eq(employmentAssignmentsTable.employeeId, employeeId),
  ];
  if (assignmentType) conditions.push(eq(employmentAssignmentsTable.assignmentType, assignmentType));
  return db
    .select()
    .from(employmentAssignmentsTable)
    .where(and(...conditions))
    .orderBy(desc(employmentAssignmentsTable.startDate), desc(employmentAssignmentsTable.id));
}

/** The open assignment of a given type, if any. Null is an ordinary answer. */
export async function getOpenAssignment(
  organizationId: number,
  employeeId: number,
  assignmentType: AssignmentType,
): Promise<EmploymentAssignment | null> {
  const [row] = await db
    .select()
    .from(employmentAssignmentsTable)
    .where(
      and(
        eq(employmentAssignmentsTable.organizationId, organizationId),
        eq(employmentAssignmentsTable.employeeId, employeeId),
        eq(employmentAssignmentsTable.assignmentType, assignmentType),
        isNull(employmentAssignmentsTable.actualEndDate),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Batch variant for list surfaces — avoids an N+1 across an employee list. */
export async function getOpenAssignmentsForEmployees(
  organizationId: number,
  employeeIds: number[],
): Promise<Map<number, EmploymentAssignment[]>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(employmentAssignmentsTable)
    .where(
      and(
        eq(employmentAssignmentsTable.organizationId, organizationId),
        inArray(employmentAssignmentsTable.employeeId, employeeIds),
        isNull(employmentAssignmentsTable.actualEndDate),
      ),
    );
  const map = new Map<number, EmploymentAssignment[]>();
  for (const row of rows) {
    const list = map.get(row.employeeId) ?? [];
    list.push(row);
    map.set(row.employeeId, list);
  }
  return map;
}

export async function startAssignment(params: {
  organizationId: number;
  employeeId: number;
  assignmentType: AssignmentType;
  actingPositionId?: number | null;
  actingDepartmentId?: number | null;
  destinationDescription?: string | null;
  destinationType?: EmploymentAssignment["destinationType"];
  startDate: Date;
  expectedEndDate?: Date | null;
  reason?: string | null;
  enabled: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmploymentAssignment> {
  if (!params.enabled) {
    throw new AssignmentTypeNotEnabledError(params.assignmentType === "acting" ? "acting appointments" : "secondments");
  }
  await assertEmployeeInOrganization(params.organizationId, params.employeeId);

  if (params.expectedEndDate && params.expectedEndDate.getTime() <= params.startDate.getTime()) {
    throw new InvalidAssignmentError("The expected end must be after the start date.");
  }

  if (params.assignmentType === "acting") {
    if (!params.actingPositionId) throw new InvalidAssignmentError("An acting appointment needs a position.");
    // Cross-tenant guard: a position id from another organization must never be
    // storable, even by a caller with valid rights here.
    const [position] = await db
      .select({ id: positionsTable.id })
      .from(positionsTable)
      .where(and(eq(positionsTable.id, params.actingPositionId), eq(positionsTable.organizationId, params.organizationId)))
      .limit(1);
    if (!position) throw new InvalidAssignmentError("That position does not belong to this organization.");

    if (params.actingDepartmentId) {
      const [department] = await db
        .select({ id: departmentsTable.id })
        .from(departmentsTable)
        .where(
          and(
            eq(departmentsTable.id, params.actingDepartmentId),
            eq(departmentsTable.organizationId, params.organizationId),
          ),
        )
        .limit(1);
      if (!department) throw new InvalidAssignmentError("That department does not belong to this organization.");
    }
  } else {
    if (!params.destinationDescription?.trim()) {
      throw new InvalidAssignmentError("A secondment needs a destination.");
    }
    // V1 is descriptive only (§27.13) — there is deliberately no destination
    // organization reference to validate, because cross-tenant secondment is
    // out of scope.
  }

  let created: EmploymentAssignment;
  try {
    const [row] = await db
      .insert(employmentAssignmentsTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        assignmentType: params.assignmentType,
        actingPositionId: params.assignmentType === "acting" ? (params.actingPositionId ?? null) : null,
        actingDepartmentId: params.assignmentType === "acting" ? (params.actingDepartmentId ?? null) : null,
        destinationDescription:
          params.assignmentType === "secondment" ? (params.destinationDescription?.trim() ?? null) : null,
        destinationType: params.assignmentType === "secondment" ? (params.destinationType ?? null) : null,
        startDate: params.startDate,
        expectedEndDate: params.expectedEndDate ?? null,
        reason: params.reason ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();
    created = row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await getOpenAssignment(params.organizationId, params.employeeId, params.assignmentType);
      throw new AssignmentAlreadyOpenError(
        params.assignmentType === "acting"
          ? "This employee already has an open acting appointment."
          : "This employee already has an open secondment.",
        existing?.id ?? 0,
      );
    }
    throw err;
  }

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    eventType: EVENT_FOR_START[params.assignmentType],
    effectiveDate: params.startDate,
    // The substantive appointment is unchanged — recorded explicitly so the
    // history states that this did NOT move anyone's position.
    previousState: null,
    newState: {
      assignmentId: created.id,
      assignmentType: created.assignmentType,
      ...(created.actingPositionId ? { actingPositionId: created.actingPositionId } : {}),
      ...(created.destinationDescription ? { destinationDescription: created.destinationDescription } : {}),
      startDate: created.startDate,
      expectedEndDate: created.expectedEndDate,
      substantivePositionUnchanged: true,
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return created;
}

/**
 * Ends an open assignment.
 *
 * Note what is absent: no restoration step. The substantive position was never
 * overwritten, so ending an acting appointment simply closes the temporary
 * record (§27.12).
 */
export async function endAssignment(params: {
  organizationId: number;
  assignmentId: number;
  actualEndDate: Date;
  endReason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmploymentAssignment> {
  const existing = await getAssignment(params.organizationId, params.assignmentId);
  if (!existing) throw new EmploymentAssignmentNotFoundError();
  if (existing.actualEndDate) throw new AssignmentAlreadyEndedError();
  if (params.actualEndDate.getTime() < existing.startDate.getTime()) {
    throw new InvalidAssignmentError("The end date cannot be before the start date.");
  }

  const [ended] = await db
    .update(employmentAssignmentsTable)
    .set({
      actualEndDate: params.actualEndDate,
      endReason: params.endReason ?? null,
      endedBy: params.actorApplicationUserId,
    })
    .where(
      and(
        eq(employmentAssignmentsTable.id, params.assignmentId),
        isNull(employmentAssignmentsTable.actualEndDate),
      ),
    )
    .returning();
  if (!ended) throw new AssignmentAlreadyEndedError();

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: existing.employeeId,
    eventType: EVENT_FOR_END[existing.assignmentType],
    effectiveDate: params.actualEndDate,
    previousState: { assignmentId: existing.id, startDate: existing.startDate, expectedEndDate: existing.expectedEndDate },
    newState: {
      assignmentId: ended.id,
      assignmentType: ended.assignmentType,
      actualEndDate: ended.actualEndDate,
      ...(params.endReason ? { endReason: params.endReason } : {}),
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return ended;
}

/**
 * Open assignments whose expected end has passed, for the HR action queue.
 *
 * A READ only. §27.11 forbids a job ending an assignment on its own — the
 * platform surfaces the fact and an authorized person acts.
 */
export async function findOverdueAssignments(
  organizationId: number,
  asOf: Date = new Date(),
): Promise<EmploymentAssignment[]> {
  const rows = await db
    .select()
    .from(employmentAssignmentsTable)
    .where(
      and(
        eq(employmentAssignmentsTable.organizationId, organizationId),
        isNull(employmentAssignmentsTable.actualEndDate),
      ),
    );
  return rows.filter((row) => row.expectedEndDate != null && row.expectedEndDate.getTime() < asOf.getTime());
}
