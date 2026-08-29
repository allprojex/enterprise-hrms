import { and, desc, eq } from "drizzle-orm";
import {
  db,
  grievanceCasesTable,
  grievanceCaseEventsTable,
  employeesTable,
  employeeDocumentsTable,
  departmentsTable,
  type GrievanceCase,
  type GrievanceCaseEvent,
} from "@workspace/db";
import { assertBelongsToOrganization } from "../orgScopedRefs";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-12 — Grievance cases (§28.4, §28.5, OD #9).
 *
 * A SEPARATE MODULE FROM DISCIPLINARY, for the reason §28.4 gives: the employee
 * is the complainant here, not the respondent, and the two have opposed
 * visibility needs. The most consequential expression of that is `toEssView`
 * at the bottom of this file.
 */

export class GrievanceCaseNotFoundError extends Error {
  constructor() {
    super("Grievance case not found");
    this.name = "GrievanceCaseNotFoundError";
  }
}

export class EmployeeNotFoundForGrievanceError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundForGrievanceError";
  }
}

export class InvalidGrievanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGrievanceError";
  }
}

export class GrievanceNotActionableError extends Error {
  constructor() {
    super("This grievance is closed or withdrawn and cannot be acted on.");
    this.name = "GrievanceNotActionableError";
  }
}

const TERMINAL_STATUSES: ReadonlySet<GrievanceCase["status"]> = new Set(["closed", "withdrawn"]);

export async function listCases(
  organizationId: number,
  filters: { complainantEmployeeId?: number; status?: GrievanceCase["status"] } = {},
): Promise<GrievanceCase[]> {
  const predicates = [eq(grievanceCasesTable.organizationId, organizationId)];
  if (filters.complainantEmployeeId != null) {
    predicates.push(eq(grievanceCasesTable.complainantEmployeeId, filters.complainantEmployeeId));
  }
  if (filters.status) predicates.push(eq(grievanceCasesTable.status, filters.status));

  return db
    .select()
    .from(grievanceCasesTable)
    .where(and(...predicates))
    .orderBy(desc(grievanceCasesTable.submittedAt));
}

export async function getCase(organizationId: number, caseId: number): Promise<GrievanceCase | undefined> {
  const [row] = await db
    .select()
    .from(grievanceCasesTable)
    .where(and(eq(grievanceCasesTable.id, caseId), eq(grievanceCasesTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function listCaseEvents(
  organizationId: number,
  caseId: number,
  options: { onlyVisibleToComplainant?: boolean } = {},
): Promise<GrievanceCaseEvent[]> {
  const predicates = [
    eq(grievanceCaseEventsTable.organizationId, organizationId),
    eq(grievanceCaseEventsTable.caseId, caseId),
  ];
  // The ESS path passes true. Filtering in SQL rather than after the fact means
  // a confidential note is never loaded into a response object at all.
  if (options.onlyVisibleToComplainant) predicates.push(eq(grievanceCaseEventsTable.visibleToComplainant, true));

  return db
    .select()
    .from(grievanceCaseEventsTable)
    .where(and(...predicates))
    .orderBy(grievanceCaseEventsTable.occurredAt, grievanceCaseEventsTable.id);
}

export async function submitGrievance(params: {
  organizationId: number;
  complainantEmployeeId: number;
  categoryCode: string;
  respondentType?: GrievanceCase["respondentType"];
  respondentEmployeeId?: number | null;
  respondentDepartmentId?: number | null;
  subject: string;
  description: string;
  confidentiality?: GrievanceCase["confidentiality"];
  submittedAt: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<GrievanceCase> {
  const [complainant] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.id, params.complainantEmployeeId),
        eq(employeesTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!complainant) throw new EmployeeNotFoundForGrievanceError();

  if (!params.categoryCode.trim()) throw new InvalidGrievanceError("A category is required.");
  if (!params.subject.trim()) throw new InvalidGrievanceError("A subject is required.");
  if (!params.description.trim()) throw new InvalidGrievanceError("A description is required.");

  const respondentType = params.respondentType ?? "unspecified";
  // Each respondent reference is proved to belong to this organization before it
  // is stored — a cross-tenant employee or department id must never be linkable.
  if (respondentType === "employee") {
    if (params.respondentEmployeeId == null) {
      throw new InvalidGrievanceError("An employee respondent requires respondentEmployeeId.");
    }
    await assertBelongsToOrganization(
      employeesTable,
      params.respondentEmployeeId,
      params.organizationId,
      "Respondent employee",
    );
  }
  if (respondentType === "department") {
    if (params.respondentDepartmentId == null) {
      throw new InvalidGrievanceError("A department respondent requires respondentDepartmentId.");
    }
    await assertBelongsToOrganization(
      departmentsTable,
      params.respondentDepartmentId,
      params.organizationId,
      "Respondent department",
    );
  }

  const [created] = await db
    .insert(grievanceCasesTable)
    .values({
      organizationId: params.organizationId,
      complainantEmployeeId: params.complainantEmployeeId,
      categoryCode: params.categoryCode.trim(),
      respondentType,
      respondentEmployeeId: respondentType === "employee" ? params.respondentEmployeeId! : null,
      respondentDepartmentId: respondentType === "department" ? params.respondentDepartmentId! : null,
      subject: params.subject.trim(),
      description: params.description.trim(),
      confidentiality: params.confidentiality ?? "confidential",
      status: "submitted",
      submittedAt: params.submittedAt,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  // The submission itself IS visible to the complainant: they wrote it, and
  // §28.5 lists their own submission among what they may see.
  await appendEvent({
    organizationId: params.organizationId,
    caseId: created!.id,
    eventType: "submitted",
    occurredAt: params.submittedAt,
    notes: params.subject.trim(),
    visibleToComplainant: true,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    allowTerminal: true,
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case.submitted",
    targetType: "grievance_case",
    targetId: String(created!.id),
    afterState: {
      complainantEmployeeId: created!.complainantEmployeeId,
      categoryCode: created!.categoryCode,
      status: created!.status,
    },
  });

  return created!;
}

/**
 * Appends one chronology event. Append-only, like the disciplinary chronology.
 *
 * `visibleToComplainant` defaults to FALSE at the database and is only ever true
 * when a caller says so deliberately (§28.5).
 */
export async function appendEvent(params: {
  organizationId: number;
  caseId: number;
  eventType: GrievanceCaseEvent["eventType"];
  occurredAt: Date;
  notes?: string | null;
  details?: unknown;
  visibleToComplainant?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
  allowTerminal?: boolean;
}): Promise<GrievanceCaseEvent> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  if (!params.allowTerminal && TERMINAL_STATUSES.has(existing.status) && params.eventType !== "reopened") {
    throw new GrievanceNotActionableError();
  }

  const [event] = await db
    .insert(grievanceCaseEventsTable)
    .values({
      organizationId: params.organizationId,
      caseId: params.caseId,
      eventType: params.eventType,
      occurredAt: params.occurredAt,
      notes: params.notes ?? null,
      details: params.details ?? null,
      visibleToComplainant: params.visibleToComplainant ?? false,
      recordedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case_event.recorded",
    targetType: "grievance_case_event",
    targetId: String(event!.id),
    afterState: {
      caseId: params.caseId,
      eventType: params.eventType,
      visibleToComplainant: event!.visibleToComplainant,
    },
  });

  return event!;
}

export async function acknowledge(params: {
  organizationId: number;
  caseId: number;
  occurredAt: Date;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<GrievanceCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  if (TERMINAL_STATUSES.has(existing.status)) throw new GrievanceNotActionableError();
  if (existing.acknowledgedAt) throw new InvalidGrievanceError("This grievance has already been acknowledged.");

  // Acknowledgement is explicitly employee-visible (§28.5): telling someone
  // their complaint was received is the minimum the process owes them.
  await appendEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "acknowledged",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    visibleToComplainant: true,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(grievanceCasesTable)
    .set({ status: existing.status === "submitted" ? "acknowledged" : existing.status, acknowledgedAt: params.occurredAt })
    .where(and(eq(grievanceCasesTable.id, params.caseId), eq(grievanceCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case.acknowledged",
    targetType: "grievance_case",
    targetId: String(params.caseId),
    afterState: { status: updated!.status, acknowledgedAt: updated!.acknowledgedAt },
  });

  return updated!;
}

export async function assign(params: {
  organizationId: number;
  caseId: number;
  assignedMembershipId: number;
  occurredAt: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<GrievanceCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  if (TERMINAL_STATUSES.has(existing.status)) throw new GrievanceNotActionableError();

  // Who is investigating is internal. The complainant is not told which
  // individual holds their file, which is ordinary practice and §28.5's default.
  await appendEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: existing.assignedMembershipId ? "reassigned" : "assigned",
    occurredAt: params.occurredAt,
    details: {
      previousMembershipId: existing.assignedMembershipId,
      newMembershipId: params.assignedMembershipId,
    },
    visibleToComplainant: false,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(grievanceCasesTable)
    .set({
      assignedMembershipId: params.assignedMembershipId,
      status: existing.status === "submitted" || existing.status === "acknowledged" ? "under_review" : existing.status,
    })
    .where(and(eq(grievanceCasesTable.id, params.caseId), eq(grievanceCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case.assigned",
    targetType: "grievance_case",
    targetId: String(params.caseId),
    beforeState: { assignedMembershipId: existing.assignedMembershipId },
    afterState: { assignedMembershipId: updated!.assignedMembershipId, status: updated!.status },
  });

  return updated!;
}

/**
 * Records the resolution COMMUNICATED to the complainant.
 *
 * `resolutionSummary` is deliberately the one substantive free-text field an
 * employee may read, and the resolution event is marked visible. Investigator
 * reasoning stays in non-visible events where it belongs.
 */
export async function resolve(params: {
  organizationId: number;
  caseId: number;
  resolutionSummary: string;
  occurredAt: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<GrievanceCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  if (TERMINAL_STATUSES.has(existing.status)) throw new GrievanceNotActionableError();
  if (!params.resolutionSummary.trim()) throw new InvalidGrievanceError("A resolution summary is required.");

  await appendEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "resolution_recorded",
    occurredAt: params.occurredAt,
    notes: params.resolutionSummary.trim(),
    visibleToComplainant: true,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(grievanceCasesTable)
    .set({ status: "resolved", resolutionSummary: params.resolutionSummary.trim(), resolvedAt: params.occurredAt })
    .where(and(eq(grievanceCasesTable.id, params.caseId), eq(grievanceCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case.resolved",
    targetType: "grievance_case",
    targetId: String(params.caseId),
    beforeState: { status: existing.status },
    afterState: { status: updated!.status, resolvedAt: updated!.resolvedAt },
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
}): Promise<GrievanceCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  if (TERMINAL_STATUSES.has(existing.status)) throw new GrievanceNotActionableError();

  await appendEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "closed",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    visibleToComplainant: true,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(grievanceCasesTable)
    .set({ status: "closed", closedAt: params.occurredAt, closedBy: params.actorApplicationUserId })
    .where(and(eq(grievanceCasesTable.id, params.caseId), eq(grievanceCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case.closed",
    targetType: "grievance_case",
    targetId: String(params.caseId),
    beforeState: { status: existing.status },
    afterState: { status: updated!.status },
  });

  return updated!;
}

/** The complainant's own withdrawal. Never deletes the record. */
export async function withdraw(params: {
  organizationId: number;
  caseId: number;
  occurredAt: Date;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<GrievanceCase> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  if (TERMINAL_STATUSES.has(existing.status)) throw new GrievanceNotActionableError();

  await appendEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "withdrawn",
    occurredAt: params.occurredAt,
    notes: params.reason ?? null,
    visibleToComplainant: true,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const [updated] = await db
    .update(grievanceCasesTable)
    .set({ status: "withdrawn", closedAt: params.occurredAt, closedBy: params.actorApplicationUserId })
    .where(and(eq(grievanceCasesTable.id, params.caseId), eq(grievanceCasesTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "grievance_case.withdrawn",
    targetType: "grievance_case",
    targetId: String(params.caseId),
    beforeState: { status: existing.status },
    afterState: { status: updated!.status },
  });

  return updated!;
}

export async function attachEvidence(params: {
  organizationId: number;
  caseId: number;
  documentId: number;
  occurredAt: Date;
  notes?: string | null;
  visibleToComplainant?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<GrievanceCaseEvent> {
  const existing = await getCase(params.organizationId, params.caseId);
  if (!existing) throw new GrievanceCaseNotFoundError();
  await assertBelongsToOrganization(employeeDocumentsTable, params.documentId, params.organizationId, "Document");

  return appendEvent({
    organizationId: params.organizationId,
    caseId: params.caseId,
    eventType: "evidence_attached",
    occurredAt: params.occurredAt,
    notes: params.notes ?? null,
    details: { documentId: params.documentId },
    visibleToComplainant: params.visibleToComplainant ?? false,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    allowTerminal: true,
  });
}

// ---------------------------------------------------------------------------
// §28.5 — the Employee Self-Service view
// ---------------------------------------------------------------------------

/**
 * What a complainant may see of their OWN grievance.
 *
 * THIS IS AN ALLOW-LIST, AND IT IS BUILT BY CONSTRUCTION RATHER THAN BY
 * DELETION. Every field below is named explicitly; the full `GrievanceCase` is
 * never spread into it. That matters more than it looks: if somebody later adds
 * an `internalRiskAssessment` column to `grievance_cases`, a
 * `{ ...grievanceCase }` view would start leaking it to the complainant the day
 * it shipped, silently. This view would not — the new field simply would not
 * appear until a human deliberately added it here.
 *
 * §28.5 forbids exposing: confidential HR notes, investigator working notes,
 * internal deliberations, restricted evidence, information about another
 * employee the complainant is not authorized to receive, draft findings, and
 * protected audit information. Accordingly this view omits `confidentiality`,
 * `assignedMembershipId`, `createdBy`, `closedBy`, and every event not
 * explicitly marked visible.
 *
 * The RESPONDENT is also omitted. A complainant naming somebody already knows
 * whom they named; echoing back a stored respondent id would additionally
 * confirm how HR classified the complaint, which is internal.
 */
export interface GrievanceEssView {
  id: number;
  categoryCode: string;
  subject: string;
  description: string;
  status: GrievanceCase["status"];
  submittedAt: Date;
  acknowledgedAt: Date | null;
  resolutionSummary: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  updates: Array<{
    id: number;
    eventType: GrievanceCaseEvent["eventType"];
    occurredAt: Date;
    notes: string | null;
  }>;
}

export function toEssView(grievance: GrievanceCase, visibleEvents: GrievanceCaseEvent[]): GrievanceEssView {
  return {
    id: grievance.id,
    categoryCode: grievance.categoryCode,
    subject: grievance.subject,
    description: grievance.description,
    status: grievance.status,
    submittedAt: grievance.submittedAt,
    acknowledgedAt: grievance.acknowledgedAt,
    resolutionSummary: grievance.resolutionSummary,
    resolvedAt: grievance.resolvedAt,
    closedAt: grievance.closedAt,
    updates: visibleEvents
      // Belt and braces: the SQL filter above already excludes these, and this
      // second pass means a caller who forgets the filter still cannot leak one.
      .filter((event) => event.visibleToComplainant)
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        notes: event.notes,
        // `details` is deliberately NOT surfaced: it carries membership ids and
        // internal transition metadata.
      })),
  };
}
