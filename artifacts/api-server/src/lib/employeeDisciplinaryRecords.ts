/**
 * Disciplinary Records (Phase 2A, W28): recording warnings/disciplinary
 * actions per employee. Append-only, like audit_events — there is
 * deliberately no update or remove path here, so a new action never
 * replaces or edits a prior record; history is preserved by construction.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, employeeDisciplinaryRecordsTable, type EmployeeDisciplinaryRecord } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

/** Org-scoped disciplinary records for one employee, most recent action first. */
export async function listEmployeeDisciplinaryRecords(
  organizationId: number,
  employeeId: number,
): Promise<EmployeeDisciplinaryRecord[]> {
  return db
    .select()
    .from(employeeDisciplinaryRecordsTable)
    .where(
      and(
        eq(employeeDisciplinaryRecordsTable.organizationId, organizationId),
        eq(employeeDisciplinaryRecordsTable.employeeId, employeeId),
      ),
    )
    .orderBy(desc(employeeDisciplinaryRecordsTable.actionDate));
}

export async function addEmployeeDisciplinaryRecord(params: {
  organizationId: number;
  employeeId: number;
  actionType: string;
  description: string;
  actionDate: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeDisciplinaryRecord> {
  const [record] = await db
    .insert(employeeDisciplinaryRecordsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      actionType: params.actionType,
      description: params.description,
      actionDate: params.actionDate,
      recordedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_disciplinary_record.added",
    targetType: "employee",
    targetId: String(params.employeeId),
    metadata: { recordId: record.id, actionType: record.actionType },
  });

  return record;
}
