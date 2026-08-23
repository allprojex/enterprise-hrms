/**
 * Office Inventory, Workstream 1 — Department Head Foundation
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §5). Deliberately a general,
 * non-Inventory-specific authority primitive (§5.1) — Department Headship is
 * an organizational-authority relationship, not something owned by any one
 * module, even though this workstream is its only consumer today.
 *
 * Effective-dated, half-open [validFrom, validTo) interval — the identical
 * pattern already proven by numbering.ts's own employee-number-allocation
 * history: assigning a new Head closes the previously-open row (if any) in
 * the same transaction, never deletes or overwrites it. A department may
 * legitimately have zero open rows (vacant) — never auto-filled, never
 * silently routed to a fallback approver. Concurrency: the owning
 * `departments` row is locked `FOR UPDATE` before reading/closing/opening a
 * `department_heads` row, so two simultaneous assignment attempts for the
 * same department serialize rather than race — both succeed in turn (this is
 * an ordinary "set who is Head now" operation, not an exclusive claim on an
 * empty slot), and the partial unique index (`department_heads_dept_open_unique`)
 * is the database-level backstop guaranteeing exactly one row is ever open
 * at once, even if the row lock were somehow bypassed.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, departmentsTable, departmentHeadsTable, type DepartmentHead } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class DepartmentNotFoundError extends Error {
  constructor() {
    super("Department not found");
  }
}
export class DepartmentHeadNotFoundError extends Error {
  constructor() {
    super("This department has no current Head to revoke");
  }
}

export interface AssignDepartmentHeadParams {
  organizationId: number;
  departmentId: number;
  headMembershipId: number;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

/**
 * Sets the current Department Head, closing whatever was previously open (if
 * anything) in the same transaction. Works uniformly whether the department
 * was vacant or already had a Head — "replacement" and "first assignment"
 * are the same operation.
 */
export async function assignDepartmentHead(params: AssignDepartmentHeadParams): Promise<DepartmentHead> {
  const { record, previous } = await db.transaction(async (tx) => {
    const [department] = await tx
      .select()
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, params.departmentId), eq(departmentsTable.organizationId, params.organizationId)))
      .for("update");
    if (!department) throw new DepartmentNotFoundError();

    const [openRow] = await tx
      .select()
      .from(departmentHeadsTable)
      .where(and(eq(departmentHeadsTable.organizationId, params.organizationId), eq(departmentHeadsTable.departmentId, params.departmentId), isNull(departmentHeadsTable.validTo)))
      .for("update");

    const now = new Date();
    if (openRow) {
      await tx.update(departmentHeadsTable).set({ validTo: now, revokedByMembershipId: params.actorMembershipId }).where(eq(departmentHeadsTable.id, openRow.id));
    }

    const [created] = await tx
      .insert(departmentHeadsTable)
      .values({
        organizationId: params.organizationId,
        departmentId: params.departmentId,
        headMembershipId: params.headMembershipId,
        validFrom: now,
        assignedByMembershipId: params.actorMembershipId,
      })
      .returning();

    return { record: created, previous: openRow ?? null };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "department_head.assigned",
    targetType: "department",
    targetId: String(params.departmentId),
    beforeState: previous ? { headMembershipId: previous.headMembershipId } : null,
    afterState: { headMembershipId: record.headMembershipId, departmentHeadId: record.id },
  });

  return record;
}

export interface RevokeDepartmentHeadParams {
  organizationId: number;
  departmentId: number;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

/** Closes the current open row without opening a new one — the department becomes vacant, never auto-filled. */
export async function revokeDepartmentHead(params: RevokeDepartmentHeadParams): Promise<DepartmentHead> {
  const revoked = await db.transaction(async (tx) => {
    const [department] = await tx
      .select()
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, params.departmentId), eq(departmentsTable.organizationId, params.organizationId)))
      .for("update");
    if (!department) throw new DepartmentNotFoundError();

    const [openRow] = await tx
      .select()
      .from(departmentHeadsTable)
      .where(and(eq(departmentHeadsTable.organizationId, params.organizationId), eq(departmentHeadsTable.departmentId, params.departmentId), isNull(departmentHeadsTable.validTo)))
      .for("update");
    if (!openRow) throw new DepartmentHeadNotFoundError();

    const [updated] = await tx
      .update(departmentHeadsTable)
      .set({ validTo: new Date(), revokedByMembershipId: params.actorMembershipId })
      .where(eq(departmentHeadsTable.id, openRow.id))
      .returning();
    return updated;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "department_head.revoked",
    targetType: "department",
    targetId: String(params.departmentId),
    beforeState: { headMembershipId: revoked.headMembershipId, departmentHeadId: revoked.id },
  });

  return revoked;
}

/** The currently-open row for a department, or null if vacant. */
export async function getCurrentDepartmentHead(organizationId: number, departmentId: number): Promise<DepartmentHead | null> {
  const [row] = await db
    .select()
    .from(departmentHeadsTable)
    .where(and(eq(departmentHeadsTable.organizationId, organizationId), eq(departmentHeadsTable.departmentId, departmentId), isNull(departmentHeadsTable.validTo)));
  return row ?? null;
}

/** Full assignment history for a department, oldest first. */
export async function listDepartmentHeadHistory(organizationId: number, departmentId: number): Promise<DepartmentHead[]> {
  return db
    .select()
    .from(departmentHeadsTable)
    .where(and(eq(departmentHeadsTable.organizationId, organizationId), eq(departmentHeadsTable.departmentId, departmentId)))
    .orderBy(departmentHeadsTable.validFrom);
}

/**
 * "Who was the Department Head for Department X on Date Y?" — the pure
 * half-open-interval range-pick, identical in shape to numbering.ts's own
 * `pickAllocationAsOf`. Returns null if the department was vacant at that
 * date (never resolved from `reportingManagerId` or any other substitute).
 */
export function pickDepartmentHeadAsOf(history: DepartmentHead[], asOfDate: Date): DepartmentHead | null {
  const at = asOfDate.getTime();
  for (const row of history) {
    const from = row.validFrom.getTime();
    const to = row.validTo ? row.validTo.getTime() : Infinity;
    if (at >= from && at < to) return row;
  }
  return null;
}

/** Single-department convenience wrapper around pickDepartmentHeadAsOf. */
export async function resolveDepartmentHeadAsOf(organizationId: number, departmentId: number, asOfDate: Date = new Date()): Promise<DepartmentHead | null> {
  const history = await listDepartmentHeadHistory(organizationId, departmentId);
  return pickDepartmentHeadAsOf(history, asOfDate);
}
