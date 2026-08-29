import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  serviceRequestTypesTable,
  serviceRequestsTable,
  serviceRequestEventsTable,
  employeesTable,
  departmentsTable,
  customFormsTable,
  organizationMembershipsTable,
  customFormSubmissionsTable,
  generatedDocumentsTable,
  employeeDocumentsTable,
  type ServiceRequestType,
  type ServiceRequest,
  type ServiceRequestEvent,
} from "@workspace/db";
import { assertBelongsToOrganization } from "../orgScopedRefs";
import { recordAuditEvent } from "../auditLog";
import { listStages, getStage, membershipSatisfiesStage } from "./approvalStages";
import { SelfApprovalForbiddenError, NotAnApproverError } from "./dataChange";

/**
 * WS-13 — HR Service Requests (§29.12–29.14, OD #10).
 *
 * A SHARED FOUNDATION FOR SUITABLE REQUESTS, NOT A PROCESS DESIGNER. §29.5 and
 * OD #10 are explicit: Leave, Recruitment, Onboarding, Employment Lifecycle,
 * Employee Relations, Payroll, Assets, Office Inventory and Identity & Access
 * keep their own workflows. A service request may REFER somebody to one; it can
 * never become an alternate source of truth for it. Nothing in this file writes
 * to any of those modules.
 *
 * WS-13 GENERATES NO DOCUMENTS (§29.13). An employment-letter request is
 * fulfilled by generating through WS-5 and pointing `generatedDocumentId` at the
 * result. That also keeps it distinct from WS-11.1's deferred lifecycle-letter
 * automation: a request FOR a letter is a person asking, not an event firing.
 *
 * APPROVAL AND FULFILMENT ARE SEPARATE STATES. A request being approved does not
 * mean the service has been performed — folding them together would make
 * "approved but not yet done" unrepresentable.
 */

export class ServiceRequestNotFoundError extends Error {
  constructor() {
    super("Service request not found");
    this.name = "ServiceRequestNotFoundError";
  }
}

export class ServiceRequestTypeNotFoundError extends Error {
  constructor() {
    super("Service request type not found");
    this.name = "ServiceRequestTypeNotFoundError";
  }
}

export class InvalidServiceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidServiceRequestError";
  }
}

export class ServiceRequestNotActionableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceRequestNotActionableError";
  }
}

const TERMINAL: ReadonlyArray<ServiceRequest["status"]> = ["closed", "cancelled", "withdrawn"];

// ---------------------------------------------------------------------------
// Types (organization configuration — §29.12)
// ---------------------------------------------------------------------------

export async function listTypes(
  organizationId: number,
  filters: { activeOnly?: boolean; employeeVisibleOnly?: boolean } = {},
): Promise<ServiceRequestType[]> {
  const predicates = [eq(serviceRequestTypesTable.organizationId, organizationId)];
  if (filters.activeOnly) predicates.push(eq(serviceRequestTypesTable.active, true));
  if (filters.employeeVisibleOnly) predicates.push(eq(serviceRequestTypesTable.employeeVisible, true));
  return db
    .select()
    .from(serviceRequestTypesTable)
    .where(and(...predicates))
    .orderBy(serviceRequestTypesTable.name);
}

export async function getType(organizationId: number, typeId: number): Promise<ServiceRequestType | undefined> {
  const [row] = await db
    .select()
    .from(serviceRequestTypesTable)
    .where(
      and(eq(serviceRequestTypesTable.id, typeId), eq(serviceRequestTypesTable.organizationId, organizationId)),
    )
    .limit(1);
  return row;
}

export async function createType(params: {
  organizationId: number;
  code: string;
  name: string;
  description?: string | null;
  employeeVisible?: boolean;
  approvalRequired?: boolean;
  fulfilmentKind?: ServiceRequestType["fulfilmentKind"];
  formId?: number | null;
  responsibleDepartmentId?: number | null;
  targetDays?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequestType> {
  if (!params.code.trim()) throw new InvalidServiceRequestError("A stable code is required.");
  if (!params.name.trim()) throw new InvalidServiceRequestError("A name is required.");

  // Every client-supplied reference is proved to be this organization's own
  // before it is stored — a cross-tenant form or department must never be linkable.
  if (params.formId != null) {
    await assertBelongsToOrganization(customFormsTable, params.formId, params.organizationId, "Form");
  }
  if (params.responsibleDepartmentId != null) {
    await assertBelongsToOrganization(
      departmentsTable,
      params.responsibleDepartmentId,
      params.organizationId,
      "Department",
    );
  }

  const [created] = await db
    .insert(serviceRequestTypesTable)
    .values({
      organizationId: params.organizationId,
      code: params.code.trim(),
      name: params.name.trim(),
      description: params.description ?? null,
      employeeVisible: params.employeeVisible ?? true,
      approvalRequired: params.approvalRequired ?? false,
      fulfilmentKind: params.fulfilmentKind ?? "acknowledgement",
      formId: params.formId ?? null,
      responsibleDepartmentId: params.responsibleDepartmentId ?? null,
      targetDays: params.targetDays ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request_type.created",
    targetType: "service_request_type",
    targetId: String(created!.id),
    afterState: { code: created!.code, name: created!.name, approvalRequired: created!.approvalRequired },
  });

  return created!;
}

export async function updateType(params: {
  organizationId: number;
  typeId: number;
  name?: string;
  description?: string | null;
  active?: boolean;
  employeeVisible?: boolean;
  approvalRequired?: boolean;
  fulfilmentKind?: ServiceRequestType["fulfilmentKind"];
  formId?: number | null;
  responsibleDepartmentId?: number | null;
  targetDays?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequestType> {
  const before = await getType(params.organizationId, params.typeId);
  if (!before) throw new ServiceRequestTypeNotFoundError();

  if (params.formId != null) {
    await assertBelongsToOrganization(customFormsTable, params.formId, params.organizationId, "Form");
  }
  if (params.responsibleDepartmentId != null) {
    await assertBelongsToOrganization(
      departmentsTable,
      params.responsibleDepartmentId,
      params.organizationId,
      "Department",
    );
  }

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) {
    if (!params.name.trim()) throw new InvalidServiceRequestError("A name is required.");
    patch.name = params.name.trim();
  }
  if (params.description !== undefined) patch.description = params.description;
  if (params.active !== undefined) patch.active = params.active;
  if (params.employeeVisible !== undefined) patch.employeeVisible = params.employeeVisible;
  if (params.approvalRequired !== undefined) patch.approvalRequired = params.approvalRequired;
  if (params.fulfilmentKind !== undefined) patch.fulfilmentKind = params.fulfilmentKind;
  if (params.formId !== undefined) patch.formId = params.formId;
  if (params.responsibleDepartmentId !== undefined) patch.responsibleDepartmentId = params.responsibleDepartmentId;
  if (params.targetDays !== undefined) patch.targetDays = params.targetDays;

  const [updated] = await db
    .update(serviceRequestTypesTable)
    .set(patch)
    .where(
      and(
        eq(serviceRequestTypesTable.id, params.typeId),
        eq(serviceRequestTypesTable.organizationId, params.organizationId),
      ),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request_type.updated",
    targetType: "service_request_type",
    targetId: String(params.typeId),
    beforeState: { name: before.name, active: before.active, approvalRequired: before.approvalRequired },
    afterState: { name: updated!.name, active: updated!.active, approvalRequired: updated!.approvalRequired },
  });

  return updated!;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function listRequests(
  organizationId: number,
  filters: { employeeId?: number; status?: ServiceRequest["status"]; assignedMembershipId?: number } = {},
): Promise<ServiceRequest[]> {
  const predicates = [eq(serviceRequestsTable.organizationId, organizationId)];
  if (filters.employeeId != null) predicates.push(eq(serviceRequestsTable.employeeId, filters.employeeId));
  if (filters.status) predicates.push(eq(serviceRequestsTable.status, filters.status));
  if (filters.assignedMembershipId != null) {
    predicates.push(eq(serviceRequestsTable.assignedMembershipId, filters.assignedMembershipId));
  }
  return db
    .select()
    .from(serviceRequestsTable)
    .where(and(...predicates))
    .orderBy(desc(serviceRequestsTable.submittedAt));
}

export async function getRequest(organizationId: number, requestId: number): Promise<ServiceRequest | undefined> {
  const [row] = await db
    .select()
    .from(serviceRequestsTable)
    .where(and(eq(serviceRequestsTable.id, requestId), eq(serviceRequestsTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function listEvents(
  organizationId: number,
  requestId: number,
  options: { onlyVisibleToEmployee?: boolean } = {},
): Promise<ServiceRequestEvent[]> {
  const predicates = [
    eq(serviceRequestEventsTable.organizationId, organizationId),
    eq(serviceRequestEventsTable.requestId, requestId),
  ];
  // Filtering in SQL means an internal note is never loaded into an ESS
  // response object at all — the §28.5 pattern.
  if (options.onlyVisibleToEmployee) predicates.push(eq(serviceRequestEventsTable.visibleToEmployee, true));
  return db
    .select()
    .from(serviceRequestEventsTable)
    .where(and(...predicates))
    .orderBy(serviceRequestEventsTable.occurredAt, serviceRequestEventsTable.id);
}

async function appendEvent(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    organizationId: number;
    requestId: number;
    eventType: ServiceRequestEvent["eventType"];
    stageOrder?: number | null;
    stageName?: string | null;
    notes?: string | null;
    details?: unknown;
    visibleToEmployee?: boolean;
    actorUserId: number;
    actorMembershipId: number | null;
  },
): Promise<void> {
  await tx.insert(serviceRequestEventsTable).values({
    organizationId: params.organizationId,
    requestId: params.requestId,
    eventType: params.eventType,
    stageOrder: params.stageOrder ?? null,
    stageName: params.stageName ?? null,
    notes: params.notes ?? null,
    details: params.details ?? null,
    visibleToEmployee: params.visibleToEmployee ?? false,
    actorUserId: params.actorUserId,
    actorMembershipId: params.actorMembershipId,
    occurredAt: new Date(),
  });
}

export async function submitRequest(params: {
  organizationId: number;
  typeId: number;
  employeeId: number;
  subject: string;
  details?: string | null;
  formSubmissionId?: number | null;
  evidenceDocumentId?: number | null;
  /** True when raised through ESS: the type must be employee-visible. */
  viaSelfService: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const type = await getType(params.organizationId, params.typeId);
  if (!type) throw new ServiceRequestTypeNotFoundError();
  if (!type.active) throw new InvalidServiceRequestError("That request type is not active.");
  if (params.viaSelfService && !type.employeeVisible) {
    throw new InvalidServiceRequestError("That request type is not available in self-service.");
  }
  if (!params.subject.trim()) throw new InvalidServiceRequestError("A subject is required.");

  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!employee) throw new InvalidServiceRequestError("Employee not found in this organization.");

  if (params.formSubmissionId != null) {
    await assertBelongsToOrganization(
      customFormSubmissionsTable,
      params.formSubmissionId,
      params.organizationId,
      "Form submission",
    );
  }
  if (params.evidenceDocumentId != null) {
    await assertBelongsToOrganization(
      employeeDocumentsTable,
      params.evidenceDocumentId,
      params.organizationId,
      "Evidence document",
    );
  }

  const stages = type.approvalRequired ? await listStages(params.organizationId, "service_request") : [];

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(serviceRequestsTable)
      .values({
        organizationId: params.organizationId,
        typeId: params.typeId,
        employeeId: params.employeeId,
        subject: params.subject.trim(),
        details: params.details ?? null,
        status: "submitted",
        approvalStatus: type.approvalRequired ? "pending" : "not_required",
        // Frozen at request time, as §29.8 requires.
        stageCountAtRequest: stages.length,
        currentStageOrder: stages.length > 0 ? stages[0]!.stageOrder : null,
        assignedMembershipId: null,
        formSubmissionId: params.formSubmissionId ?? null,
        evidenceDocumentId: params.evidenceDocumentId ?? null,
        submittedAt: new Date(),
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: row!.id,
      eventType: "submitted",
      notes: params.subject.trim(),
      // The employee wrote it; they may see it.
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.submitted",
    targetType: "service_request",
    targetId: String(created.id),
    afterState: {
      typeId: created.typeId,
      employeeId: created.employeeId,
      status: created.status,
      approvalStatus: created.approvalStatus,
    },
  });

  return created;
}

export async function acknowledge(params: {
  organizationId: number;
  requestId: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is closed.");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({ status: request.status === "submitted" ? "acknowledged" : request.status, acknowledgedAt: new Date() })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "acknowledged",
      notes: params.notes ?? null,
      // Telling somebody their request was received is the minimum owed to them.
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.acknowledged",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status, acknowledgedAt: updated.acknowledgedAt },
  });

  return updated;
}

/**
 * Assignment, which §29.9 is careful to distinguish from delegation: it routes
 * work to a desk, it does not transfer approval authority to anybody.
 */
export async function assign(params: {
  organizationId: number;
  requestId: number;
  assignedMembershipId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is closed.");

  await assertBelongsToOrganization(
    organizationMembershipsTable,
    params.assignedMembershipId,
    params.organizationId,
    "Assignee",
  );

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({
        assignedMembershipId: params.assignedMembershipId,
        status: request.status === "submitted" || request.status === "acknowledged" ? "in_progress" : request.status,
      })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: request.assignedMembershipId ? "reassigned" : "assigned",
      details: { previous: request.assignedMembershipId, next: params.assignedMembershipId },
      // Who is handling it internally is not employee-facing.
      visibleToEmployee: false,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.assigned",
    targetType: "service_request",
    targetId: String(params.requestId),
    beforeState: { assignedMembershipId: request.assignedMembershipId },
    afterState: { assignedMembershipId: updated.assignedMembershipId, status: updated.status },
  });

  return updated;
}

async function assertMayDecide(params: {
  organizationId: number;
  request: ServiceRequest;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ stageOrder: number | null; stageName: string | null }> {
  // MAKER-CHECKER (§29.6) — the same rule as data change, by both user and
  // membership, so a second membership is not a loophole.
  if (params.request.createdBy === params.actorApplicationUserId) throw new SelfApprovalForbiddenError();

  if (params.request.stageCountAtRequest === 0 || params.request.currentStageOrder == null) {
    return { stageOrder: null, stageName: null };
  }
  const stage = await getStage(params.organizationId, "service_request", params.request.currentStageOrder);
  if (!stage) {
    throw new ServiceRequestNotActionableError(
      "This request's approval stage no longer exists. Restore the stage configuration, or reject the request.",
    );
  }
  const ok = await membershipSatisfiesStage({
    organizationId: params.organizationId,
    stage,
    membershipId: params.actorMembershipId,
    subjectEmployeeId: params.request.employeeId,
  });
  if (!ok) throw new NotAnApproverError(stage.name);
  return { stageOrder: stage.stageOrder, stageName: stage.name };
}

export async function approve(params: {
  organizationId: number;
  requestId: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (request.approvalStatus !== "pending") {
    throw new ServiceRequestNotActionableError("This request is not awaiting approval.");
  }

  const { stageOrder, stageName } = await assertMayDecide({
    organizationId: params.organizationId,
    request,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });
  const isFinal = stageOrder == null || stageOrder >= request.stageCountAtRequest;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set(
        isFinal
          ? { approvalStatus: "approved", currentStageOrder: null }
          : { currentStageOrder: (stageOrder ?? 0) + 1 },
      )
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: isFinal ? "approved" : "stage_approved",
      stageOrder,
      stageName,
      notes: params.notes ?? null,
      visibleToEmployee: isFinal,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: isFinal ? "service_request.approved" : "service_request.stage_approved",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { approvalStatus: updated.approvalStatus, currentStageOrder: updated.currentStageOrder },
    metadata: { stageOrder, stageName },
  });

  return updated;
}

export async function reject(params: {
  organizationId: number;
  requestId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (request.approvalStatus !== "pending") {
    throw new ServiceRequestNotActionableError("This request is not awaiting approval.");
  }
  if (!params.reason.trim()) throw new InvalidServiceRequestError("A reason is required to reject a request.");

  await assertMayDecide({
    organizationId: params.organizationId,
    request,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({ approvalStatus: "rejected", currentStageOrder: null, status: "closed", closedAt: new Date() })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "rejected",
      notes: params.reason.trim(),
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.rejected",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { approvalStatus: updated.approvalStatus, status: updated.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated;
}

/** Asks the employee for more information. Not terminal. */
export async function requestInformation(params: {
  organizationId: number;
  requestId: number;
  message: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is closed.");
  if (!params.message.trim()) throw new InvalidServiceRequestError("A message is required.");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({ status: "awaiting_employee" })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "information_requested",
      notes: params.message.trim(),
      // Directed AT the employee, so necessarily visible to them.
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.information_requested",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
  });

  return updated;
}

/** The employee's own reply to an information request. */
export async function respond(params: {
  organizationId: number;
  requestId: number;
  message: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is closed.");
  if (!params.message.trim()) throw new InvalidServiceRequestError("A message is required.");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({ status: "in_progress" })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "employee_responded",
      notes: params.message.trim(),
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.employee_responded",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
  });

  return updated;
}

/**
 * Records fulfilment, optionally attaching the WS-5 document that satisfies it.
 *
 * WS-13 does not GENERATE the document (§29.13) — HR does that through WS-5 and
 * points this at the result. A request whose type expects a document is not
 * fulfilled without one, so "fulfilled" cannot quietly mean "nothing happened".
 */
export async function fulfil(params: {
  organizationId: number;
  requestId: number;
  resolutionSummary: string;
  generatedDocumentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is closed.");
  if (request.approvalStatus === "pending") {
    throw new ServiceRequestNotActionableError("This request is still awaiting approval.");
  }
  if (request.approvalStatus === "rejected") {
    throw new ServiceRequestNotActionableError("A rejected request cannot be fulfilled.");
  }
  if (!params.resolutionSummary.trim()) throw new InvalidServiceRequestError("A resolution summary is required.");

  const type = await getType(params.organizationId, request.typeId);
  if (type?.fulfilmentKind === "document" && params.generatedDocumentId == null && request.generatedDocumentId == null) {
    throw new InvalidServiceRequestError(
      "This request type is fulfilled with a document. Generate it through Documents & Records and attach it.",
    );
  }
  if (params.generatedDocumentId != null) {
    await assertBelongsToOrganization(
      generatedDocumentsTable,
      params.generatedDocumentId,
      params.organizationId,
      "Generated document",
    );
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({
        status: "fulfilled",
        fulfilledAt: now,
        fulfilledBy: params.actorApplicationUserId,
        resolutionSummary: params.resolutionSummary.trim(),
        generatedDocumentId: params.generatedDocumentId ?? request.generatedDocumentId,
      })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "fulfilled",
      notes: params.resolutionSummary.trim(),
      details: { generatedDocumentId: params.generatedDocumentId ?? request.generatedDocumentId },
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.fulfilled",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status, generatedDocumentId: updated.generatedDocumentId },
  });

  return updated;
}

export async function close(params: {
  organizationId: number;
  requestId: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is already closed.");

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "closed",
      notes: params.notes ?? null,
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.closed",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
  });

  return updated;
}

/** The employee's own withdrawal. Never deletes the record. */
export async function withdraw(params: {
  organizationId: number;
  requestId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ServiceRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new ServiceRequestNotFoundError();
  if (TERMINAL.includes(request.status)) throw new ServiceRequestNotActionableError("This request is already closed.");
  if (request.status === "fulfilled") {
    throw new ServiceRequestNotActionableError("This request has already been fulfilled.");
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(serviceRequestsTable)
      .set({ status: "withdrawn", closedAt: new Date() })
      .where(eq(serviceRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "withdrawn",
      visibleToEmployee: true,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "service_request.withdrawn",
    targetType: "service_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// DTOs and read models
// ---------------------------------------------------------------------------

/**
 * The employee-facing view (§29.17). An allow-list built by construction: no
 * assignee, no stage configuration, no internal notes, no event `details`.
 */
export interface ServiceRequestEssView {
  id: number;
  typeId: number;
  subject: string;
  details: string | null;
  status: ServiceRequest["status"];
  approvalStatus: ServiceRequest["approvalStatus"];
  submittedAt: Date;
  acknowledgedAt: Date | null;
  fulfilledAt: Date | null;
  resolutionSummary: string | null;
  generatedDocumentId: number | null;
  updates: Array<{ id: number; eventType: ServiceRequestEvent["eventType"]; occurredAt: Date; notes: string | null }>;
}

export function toEssView(request: ServiceRequest, visibleEvents: ServiceRequestEvent[]): ServiceRequestEssView {
  return {
    id: request.id,
    typeId: request.typeId,
    subject: request.subject,
    details: request.details,
    status: request.status,
    approvalStatus: request.approvalStatus,
    submittedAt: request.submittedAt,
    acknowledgedAt: request.acknowledgedAt,
    fulfilledAt: request.fulfilledAt,
    resolutionSummary: request.resolutionSummary,
    generatedDocumentId: request.generatedDocumentId,
    updates: visibleEvents
      // Belt and braces: the SQL filter already excludes these.
      .filter((e) => e.visibleToEmployee)
      .map((e) => ({ id: e.id, eventType: e.eventType, occurredAt: e.occurredAt, notes: e.notes })),
  };
}

/** Read model with derived age and overdue — never stored (§29.21, §29.22). */
export async function openRequests(
  organizationId: number,
  asOf: Date = new Date(),
): Promise<
  Array<{
    id: number;
    typeId: number;
    employeeId: number;
    status: string;
    approvalStatus: string;
    submittedAt: Date;
    ageDays: number;
    overdue: boolean;
  }>
> {
  const rows = await db
    .select({
      id: serviceRequestsTable.id,
      typeId: serviceRequestsTable.typeId,
      employeeId: serviceRequestsTable.employeeId,
      status: serviceRequestsTable.status,
      approvalStatus: serviceRequestsTable.approvalStatus,
      submittedAt: serviceRequestsTable.submittedAt,
      targetDays: serviceRequestTypesTable.targetDays,
    })
    .from(serviceRequestsTable)
    .innerJoin(serviceRequestTypesTable, eq(serviceRequestTypesTable.id, serviceRequestsTable.typeId))
    .where(
      and(
        eq(serviceRequestsTable.organizationId, organizationId),
        inArray(serviceRequestsTable.status, ["submitted", "acknowledged", "in_progress", "awaiting_employee"]),
      ),
    )
    .orderBy(serviceRequestsTable.submittedAt);

  const DAY = 24 * 60 * 60 * 1000;
  return rows.map((r) => {
    const ageDays = Math.max(0, Math.floor((asOf.getTime() - r.submittedAt.getTime()) / DAY));
    return {
      id: r.id,
      typeId: r.typeId,
      employeeId: r.employeeId,
      status: r.status,
      approvalStatus: r.approvalStatus,
      submittedAt: r.submittedAt,
      ageDays,
      // Derived against the configured target. There is no escalation engine
      // and nothing reassigns or auto-decides (§29.22).
      overdue: r.targetDays != null && ageDays > r.targetDays,
    };
  });
}
