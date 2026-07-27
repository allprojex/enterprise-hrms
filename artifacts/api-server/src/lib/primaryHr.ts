import { and, eq, isNull } from "drizzle-orm";
import { db, primaryHrAssignmentsTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class PrimaryHrAlreadyAssignedError extends Error {
  constructor(organizationId: number) {
    super(`Organization ${organizationId} already has an active Primary HR`);
    this.name = "PrimaryHrAlreadyAssignedError";
  }
}

export async function getActivePrimaryHr(organizationId: number) {
  const rows = await db
    .select()
    .from(primaryHrAssignmentsTable)
    .where(
      and(eq(primaryHrAssignmentsTable.organizationId, organizationId), isNull(primaryHrAssignmentsTable.revokedAt)),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Appoints a membership as Primary HR. Relies on the database's partial
 * unique index (organizationId WHERE revokedAt IS NULL) as the actual source
 * of truth rather than a racy select-then-insert — a concurrent appoint
 * attempt fails at the constraint and is surfaced as
 * PrimaryHrAlreadyAssignedError. Use transferPrimaryHr to replace an
 * existing Primary HR.
 */
export async function appointPrimaryHr(params: {
  organizationId: number;
  membershipId: number;
  assignedBy: number;
}) {
  let assignment;
  try {
    [assignment] = await db
      .insert(primaryHrAssignmentsTable)
      .values({
        organizationId: params.organizationId,
        membershipId: params.membershipId,
        assignedBy: params.assignedBy,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PrimaryHrAlreadyAssignedError(params.organizationId);
    }
    throw err;
  }

  await recordAuditEvent({
    actorApplicationUserId: params.assignedBy,
    actorMembershipId: params.membershipId,
    organizationId: params.organizationId,
    eventType: "primary_hr.appointed",
    targetType: "primary_hr_assignment",
    targetId: String(assignment.id),
    afterState: assignment,
  });

  return assignment;
}

/** Atomically revokes the current active assignment (if any) and appoints a new one. */
export async function transferPrimaryHr(params: {
  organizationId: number;
  newMembershipId: number;
  actedBy: number;
}) {
  const assignment = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(primaryHrAssignmentsTable)
      .where(
        and(
          eq(primaryHrAssignmentsTable.organizationId, params.organizationId),
          isNull(primaryHrAssignmentsTable.revokedAt),
        ),
      )
      .limit(1);

    if (current) {
      await tx
        .update(primaryHrAssignmentsTable)
        .set({ revokedAt: new Date(), revokedBy: params.actedBy })
        .where(eq(primaryHrAssignmentsTable.id, current.id));
    }

    const [inserted] = await tx
      .insert(primaryHrAssignmentsTable)
      .values({
        organizationId: params.organizationId,
        membershipId: params.newMembershipId,
        assignedBy: params.actedBy,
      })
      .returning();

    return inserted;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actedBy,
    organizationId: params.organizationId,
    eventType: "primary_hr.transferred",
    targetType: "primary_hr_assignment",
    targetId: String(assignment.id),
    afterState: assignment,
  });

  return assignment;
}
