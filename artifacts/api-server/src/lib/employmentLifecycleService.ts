/**
 * Employment Lifecycle Service (Phase 2A, W22: Employment Period History).
 * ADR-013 anticipated this ("rehiring must create a new employment period
 * while preserving historical records") but W15 (Employee Separation)
 * deliberately deferred it, using audit_events instead, since Foundation
 * scope needed only a before/after diff. Every Phase 2A workstream that
 * records a dated employment event (transfer W25, promotion W26,
 * confirmation W27) attaches it here instead of overloading audit_events as
 * the domain's system of record. No user-facing feature by itself — mirrors
 * the W5/W12 precedent of shipping a capability ahead of its first consumer.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, employmentPeriodsTable, employeesTable, type EmploymentPeriod } from "@workspace/db";
import { assertBelongsToOrganization } from "./orgScopedRefs";
import { recordAuditEvent } from "./auditLog";

/**
 * Records a dated employment event for an employee — the shared write path
 * every Phase 2A lifecycle workstream (transfer/promotion/confirmation) will
 * call into, rather than each inventing its own history table. Validates the
 * employee belongs to the organization (tenant isolation) and audit-logs the
 * event alongside the domain-specific row, same as restructureDepartment/
 * restructurePosition (ADR-012).
 */
export async function recordEmploymentPeriodEvent(params: {
  organizationId: number;
  employeeId: number;
  eventType: string;
  effectiveDate: Date;
  previousState?: unknown;
  newState: unknown;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmploymentPeriod> {
  await assertBelongsToOrganization(employeesTable, params.employeeId, params.organizationId, "Employee");

  const [period] = await db
    .insert(employmentPeriodsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      eventType: params.eventType,
      effectiveDate: params.effectiveDate,
      previousState: params.previousState ?? null,
      newState: params.newState,
      recordedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: `employment_period.${params.eventType}`,
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: params.previousState ?? null,
    afterState: params.newState,
  });

  return period;
}

/** Org-scoped employment history for one employee, most recent first. */
export async function listEmploymentPeriods(organizationId: number, employeeId: number): Promise<EmploymentPeriod[]> {
  return db
    .select()
    .from(employmentPeriodsTable)
    .where(and(eq(employmentPeriodsTable.organizationId, organizationId), eq(employmentPeriodsTable.employeeId, employeeId)))
    .orderBy(desc(employmentPeriodsTable.effectiveDate));
}
