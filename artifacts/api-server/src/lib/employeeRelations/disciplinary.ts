import { and, desc, eq } from "drizzle-orm";
import {
  db,
  disciplinaryCasesTable,
  disciplinaryCaseEventsTable,
  employeesTable,
  employeeDocumentsTable,
  type DisciplinaryCase,
  type DisciplinaryCaseEvent,
} from "@workspace/db";
import { assertBelongsToOrganization } from "../orgScopedRefs";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-12 — Structured disciplinary cases (§28.3, OD #9).
 *
 * WHAT THIS MODULE REFUSES TO DO, and why each refusal is load-bearing:
 *
 *   It never separates anybody. A disciplinary outcome — even the most serious
 *   one an organization can record — produces a recorded fact and nothing else.
 *   If employment ends it ends through WS-11's separation service as its own
 *   authorized act (§28.7, and the same boundary §27.8 froze for unsuccessful
 *   probation). There is deliberately no call to separateEmployee in this file.
 *
 *   It never touches `employee_disciplinary_records`. That legacy table is
 *   frozen as immutable history by §28.2. Not one row is read for state, and
 *   not one is written, migrated or reinterpreted here.
 *
 *   It never rewrites chronology. Events are append-only: `recordEvent` inserts,
 *   and there is no update or delete path for a case event anywhere in WS-12.
 *   In this domain the sequence of what was alleged, answered, heard and decided
 *   IS the record.
 */

export class DisciplinaryCaseNotFoundError extends Error {
  constructor() {
    super("Disciplinary case not found");
    this.name = "DisciplinaryCaseNotFoundError";
  }
}

export class EmployeeNotFoundForCaseError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundForCaseError";
  }
}

export class InvalidDisciplinaryCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDisciplinaryCaseError";
  }
}

export class CaseNotOpenError extends Error {
  constructor() {
    super("This disciplinary case is closed. Reopen it before recording further activity.");
    this.name = "CaseNotOpenError";
  }
}

export async function listCases(
  organizationId: number,
  filters: { employeeId?: number; status?: DisciplinaryCase["status"] } = {},
): Promise<DisciplinaryCase[]> {
  const predicates = [eq(disciplinaryCasesTable.organizationId, organizationId)];
  if (filters.employeeId != null) predicates.push(eq(disciplinaryCasesTable.employeeId, filters.employeeId));
  if (filters.status) predicates.push(eq(disciplinaryCasesTable.status, filters.status));

  return db
    .select()
    .from(disciplinaryCasesTable)
    .where(and(...predicates))
    .orderBy(desc(disciplinaryCasesTable.openedAt));
}

export async function getCase(organizationId: number, caseId: number): Promise<DisciplinaryCase | undefined> {
  const [row] = await db
    .select()
    .from(disciplinaryCasesTable)
    .where(and(eq(disciplinaryCasesTable.id, caseId), eq(disciplinaryCasesTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function listCaseEvents(organizationId: number, caseId: number): Promise<DisciplinaryCaseEvent[]> {
  return db
    .select()
    .from(disciplinaryCaseEventsTable)
    .where(
      and(
        eq(disciplinaryCaseEventsTable.organizationId, organizationId),
        eq(disciplinaryCaseEventsTable.caseId, caseId),
      ),
    )
    .orderBy(disciplinaryCaseEventsTable.occurredAt, disciplinaryCaseEventsTable.id);
}

export async function openCase(params: {
  organizationId: number;
  employeeId: number;
  categoryCode: string;
  severityCode?: string | null;
  stageCode?: string | null;
  subject: string;
  description?: string | null;
  confidentiality?: DisciplinaryCase["confidentiality"];
  responsibleMembershipId?: number | null;
  openedAt: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DisciplinaryCase> {
  // Proves the employee exists AND belongs to this organization. Trusting the
  // client's employeeId here would be the IDOR every WS-12 surface must refuse.
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!employee) throw new EmployeeNotFoundForCaseError();

  if (!params.categoryCode.trim()) throw new InvalidDisciplinaryCaseError("A category is required.");
  if (!params.subject.trim()) throw new InvalidDisciplinaryCaseError("A subject is required.");

  const [created] = await db
    .insert(disciplinaryCasesTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      categoryCode: params.categoryCode.trim(),
      severityCode: params.severityCode?.trim() || null,
      stageCode: params.stageCode?.trim() || null,
      subject: params.subject.trim(),
      description: params.description ?? null,
      confidentiality: params.confidentiality ?? "confidential",
      responsibleMembershipId: params.responsibleMembershipId ?? null,
      openedAt: params.openedAt,
      status: "open",
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordEvent({
    organizationId: params.organizationId,
    caseId: created!.id,
    eventType: "case_opened",
    occurredAt: params.openedAt,
    notes: params.subject.trim(),
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    skipCaseOpenCheck: true,
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "disciplinary_case.opened",
    targetType: "disciplinary_case",
    targetId: String(created!.id),
    afterState: { employeeId: created!.employeeId, categoryCode: created!.categoryCode, status: created!.status },
  });

  return created!;
}

/**
 * Appends one chronology event. The ONLY write path for case history.
 *
 * `skipCaseOpenCheck` exists solely for the opening event, which necessarily
 * runs before the caller can observe the case as open. Every other caller goes
 * through the closed-case guard.
 */
export async function recordEvent(params: {
  organizationId: number;
  caseId: number;
  eventType: DisciplinaryCaseEvent["eventType"];
  occurredAt: Date;
  notes?: string | null;
  details?: unknown;
  actorApplicationUserId: number;
  actorMembershipId: number;
  skipCaseOpenCheck?: boolean;
}): Promise<DisciplinaryCaseEvent> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new DisciplinaryCaseNotFoundError();
  if (!params.skipCaseOpenCheck && existing.status !== "open" && params.eventType !== "case_reopened") {
    throw new CaseNotOpenError();
  }

  const [event] = await db
    .insert(disciplinaryCaseEventsTable)
    .values({
      organizationId: params.organizationId,
      caseId: params.caseId,
      eventType: params.eventType,
      occurredAt: params.occurredAt,
      notes: params.notes ?? null,
      details: params.details ?? null,
      recordedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "disciplinary_case_event.recorded",
    targetType: "disciplinary_case_event",
    targetId: String(event!.id),
    afterState: { caseId: params.caseId, eventType: params.eventType, occurredAt: params.occurredAt },
  });

  return event!;
}

/** Moves the case to a new organization-defined stage, recording the move. */
export async function changeStage(params: {
  organizationId: number;
  caseId: number;
  stageCode: string;
  occurredAt: Date;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DisciplinaryCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new DisciplinaryCaseNotFoundError();
  if (existing.status !== "open") throw new CaseNotOpenError();
  if (!params.stageCode.trim()) throw new InvalidDisciplinaryCaseError("A stage code is required.");

  await recordEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "stage_changed",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    details: { previousStageCode: existing.stageCode, newStageCode: params.stageCode.trim() },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(disciplinaryCasesTable)
    .set({ stageCode: params.stageCode.trim() })
    .where(and(eq(disciplinaryCasesTable.id, params.caseId), eq(disciplinaryCasesTable.organizationId, params.organizationId)))
    .returning();

  return updated!;
}

/**
 * Records the outcome an authorized human decided.
 *
 * NOTE WHAT DOES NOT HAPPEN HERE. No employment status changes, no separation
 * date is set, no separation service is called, and no notification of dismissal
 * is generated. §28.3 and §28.7 are explicit that the platform records the
 * decision and stops. A test asserts the employee is untouched afterwards.
 */
export async function recordOutcome(params: {
  organizationId: number;
  caseId: number;
  outcomeCode: string;
  occurredAt: Date;
  notes?: string | null;
  /** Only where the organization's policy defines an expiry for this outcome. */
  warningExpiresAt?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DisciplinaryCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new DisciplinaryCaseNotFoundError();
  if (existing.status !== "open") throw new CaseNotOpenError();
  if (!params.outcomeCode.trim()) throw new InvalidDisciplinaryCaseError("An outcome code is required.");
  if (params.warningExpiresAt && params.warningExpiresAt.getTime() <= params.occurredAt.getTime()) {
    throw new InvalidDisciplinaryCaseError("A warning expiry must be after the outcome date.");
  }

  await recordEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "outcome_recorded",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    details: {
      outcomeCode: params.outcomeCode.trim(),
      ...(params.warningExpiresAt ? { warningExpiresAt: params.warningExpiresAt.toISOString() } : {}),
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(disciplinaryCasesTable)
    .set({
      outcomeCode: params.outcomeCode.trim(),
      outcomeRecordedAt: params.occurredAt,
      warningExpiresAt: params.warningExpiresAt ?? null,
    })
    .where(and(eq(disciplinaryCasesTable.id, params.caseId), eq(disciplinaryCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "disciplinary_case.outcome_recorded",
    targetType: "disciplinary_case",
    targetId: String(params.caseId),
    beforeState: { outcomeCode: existing.outcomeCode },
    afterState: { outcomeCode: updated!.outcomeCode, warningExpiresAt: updated!.warningExpiresAt },
  });

  return updated!;
}

export async function closeCase(params: {
  organizationId: number;
  caseId: number;
  occurredAt: Date;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DisciplinaryCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new DisciplinaryCaseNotFoundError();
  if (existing.status !== "open") throw new CaseNotOpenError();

  await recordEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "case_closed",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(disciplinaryCasesTable)
    .set({ status: "closed", closedAt: params.occurredAt, closedBy: params.actorApplicationUserId })
    .where(and(eq(disciplinaryCasesTable.id, params.caseId), eq(disciplinaryCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "disciplinary_case.closed",
    targetType: "disciplinary_case",
    targetId: String(params.caseId),
    beforeState: { status: existing.status },
    afterState: { status: updated!.status, closedAt: updated!.closedAt },
  });

  return updated!;
}

/** Reopening keeps every prior event exactly where it is — nothing is erased. */
export async function reopenCase(params: {
  organizationId: number;
  caseId: number;
  occurredAt: Date;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DisciplinaryCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new DisciplinaryCaseNotFoundError();
  if (existing.status !== "closed") throw new InvalidDisciplinaryCaseError("Only a closed case can be reopened.");
  if (!params.reason.trim()) throw new InvalidDisciplinaryCaseError("A reason is required to reopen a case.");

  await recordEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "case_reopened",
    occurredAt: params.occurredAt,
    notes: params.reason.trim(),
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(disciplinaryCasesTable)
    .set({ status: "open", closedAt: null, closedBy: null })
    .where(and(eq(disciplinaryCasesTable.id, params.caseId), eq(disciplinaryCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "disciplinary_case.reopened",
    targetType: "disciplinary_case",
    targetId: String(params.caseId),
    beforeState: { status: existing.status },
    afterState: { status: updated!.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated!;
}

/**
 * Attaches WS-5 evidence to a case.
 *
 * The document must already exist in this organization — WS-12 stores nothing
 * itself (§28.11). `assertBelongsToOrganization` is what stops a caller pointing
 * a case at another tenant's document.
 */
export async function attachEvidence(params: {
  organizationId: number;
  caseId: number;
  documentId: number;
  occurredAt: Date;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DisciplinaryCaseEvent> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new DisciplinaryCaseNotFoundError();

  await assertBelongsToOrganization(employeeDocumentsTable, params.documentId, params.organizationId, "Document");

  return recordEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "evidence_attached",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    details: { documentId: params.documentId },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    skipCaseOpenCheck: true,
  });
}
