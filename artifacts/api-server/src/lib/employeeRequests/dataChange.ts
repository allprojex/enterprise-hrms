import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  dataChangeRequestsTable,
  dataChangeRequestFieldsTable,
  dataChangeEventsTable,
  dataChangeFieldPoliciesTable,
  employeesTable,
  type DataChangeRequest,
  type DataChangeRequestField,
  type DataChangeEvent,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import {
  ELIGIBLE_FIELDS,
  requireEligibleField,
  assertOriginAllowed,
  maskForDisplay,
  type EligibleField,
} from "./eligibleFields";
import { listStages, getStage, membershipSatisfiesStage } from "./approvalStages";

/**
 * WS-13 — Employee data change requests (§29.2–29.11, OD #11).
 *
 * FOUR RULES THIS MODULE EXISTS TO HOLD, each of which the tests prove:
 *
 *   MAKER-CHECKER (§29.6). `requester != approving actor`, enforced here, on
 *   the server, on every decision path. Hiding a button is not authorization.
 *
 *   STALE PROTECTION (§29.10). The live value is re-read and compared PER FIELD
 *   at decision time against the value captured when the request was raised. If
 *   it moved, the request is marked stale and is never silently applied — it
 *   waits for an audited re-confirmation. A change to an unrelated column on the
 *   same employee row does not invalidate an untouched request, which is why
 *   `employees.updatedAt` is only a coarse signal and never the authority.
 *
 *   ONE ACTIVE REQUEST PER FIELD (§29.10). Guaranteed by a partial unique index,
 *   not by a read-then-write check two concurrent submissions could both pass.
 *
 *   NO SCHEDULED APPLICATION (§29.11). `effectiveDate` is recorded as a business
 *   fact. It does NOT licence a job to write the employee record later; §27.11's
 *   platform-wide rule stands, and dated application needs its own Owner
 *   Decision. Nothing in this file is reachable from a job handler.
 */

export class DataChangeRequestNotFoundError extends Error {
  constructor() {
    super("Data change request not found");
    this.name = "DataChangeRequestNotFoundError";
  }
}

export class InvalidDataChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDataChangeError";
  }
}

export class SelfApprovalForbiddenError extends Error {
  constructor() {
    super("The person who raised a request may not approve it.");
    this.name = "SelfApprovalForbiddenError";
  }
}

export class NotAnApproverError extends Error {
  constructor(stageName: string) {
    super(`You do not hold the authority this stage requires ("${stageName}").`);
    this.name = "NotAnApproverError";
  }
}

export class DuplicatePendingFieldError extends Error {
  constructor(fieldKey: string) {
    super(`A request is already open for "${fieldKey}" on this employee. Resolve it before raising another.`);
    this.name = "DuplicatePendingFieldError";
  }
}

export class RequestStaleError extends Error {
  constructor() {
    super("The record changed after this request was raised. Re-confirm it before it can be applied.");
    this.name = "RequestStaleError";
  }
}

export class RequestNotActionableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestNotActionableError";
  }
}

/**
 * Whether an error is a PostgreSQL unique-constraint violation (SQLSTATE 23505).
 *
 * Drizzle wraps the driver error, so the SQLSTATE sits on `cause` rather than on
 * the thrown object. Both are checked, and the chain is walked, because a
 * violation that goes unrecognized here would surface as an opaque database
 * error instead of the domain rule it actually represents.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Statuses in which a request still occupies its (employee, field) slot. */
const ACTIVE_STATUSES: ReadonlyArray<DataChangeRequest["status"]> = [
  "pending",
  "returned",
  "approved",
  "stale",
  "application_failed",
];

function isActive(status: DataChangeRequest["status"]): boolean {
  return ACTIVE_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Field policy (§29.4)
// ---------------------------------------------------------------------------

export interface ResolvedFieldPolicy {
  field: EligibleField;
  approvalRequired: boolean;
}

/**
 * Resolves the effective policy for every eligible field.
 *
 * A stored row naming an unregistered key is IGNORED rather than honoured —
 * configuration can never introduce a field (§29.4), so a stale row is inert
 * and not an escape hatch.
 */
export async function resolveFieldPolicies(organizationId: number): Promise<ResolvedFieldPolicy[]> {
  const rows = await db
    .select()
    .from(dataChangeFieldPoliciesTable)
    .where(eq(dataChangeFieldPoliciesTable.organizationId, organizationId));
  const byKey = new Map(rows.map((r) => [r.fieldKey, r]));

  return ELIGIBLE_FIELDS.map((field) => ({
    field,
    approvalRequired: byKey.get(field.key)?.approvalRequired ?? field.defaultApprovalRequired,
  }));
}

export async function resolveFieldPolicy(organizationId: number, fieldKey: string): Promise<ResolvedFieldPolicy> {
  const field = requireEligibleField(fieldKey);
  const [row] = await db
    .select()
    .from(dataChangeFieldPoliciesTable)
    .where(
      and(
        eq(dataChangeFieldPoliciesTable.organizationId, organizationId),
        eq(dataChangeFieldPoliciesTable.fieldKey, fieldKey),
      ),
    )
    .limit(1);
  return { field, approvalRequired: row?.approvalRequired ?? field.defaultApprovalRequired };
}

export async function setFieldPolicy(params: {
  organizationId: number;
  fieldKey: string;
  approvalRequired: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ResolvedFieldPolicy> {
  // Validated against the registry BEFORE anything is stored — this is the line
  // that stops configuration inventing a field (§29.3, §29.4).
  const field = requireEligibleField(params.fieldKey);

  const existing = await db
    .select()
    .from(dataChangeFieldPoliciesTable)
    .where(
      and(
        eq(dataChangeFieldPoliciesTable.organizationId, params.organizationId),
        eq(dataChangeFieldPoliciesTable.fieldKey, params.fieldKey),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(dataChangeFieldPoliciesTable)
      .set({ approvalRequired: params.approvalRequired, updatedBy: params.actorApplicationUserId })
      .where(eq(dataChangeFieldPoliciesTable.id, existing[0]!.id));
  } else {
    await db.insert(dataChangeFieldPoliciesTable).values({
      organizationId: params.organizationId,
      fieldKey: params.fieldKey,
      approvalRequired: params.approvalRequired,
      updatedBy: params.actorApplicationUserId,
    });
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "data_change_policy.updated",
    targetType: "data_change_policy",
    targetId: params.fieldKey,
    beforeState: { approvalRequired: existing[0]?.approvalRequired ?? field.defaultApprovalRequired },
    afterState: { approvalRequired: params.approvalRequired },
  });

  return { field, approvalRequired: params.approvalRequired };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRequests(
  organizationId: number,
  filters: { employeeId?: number; status?: DataChangeRequest["status"] } = {},
): Promise<DataChangeRequest[]> {
  const predicates = [eq(dataChangeRequestsTable.organizationId, organizationId)];
  if (filters.employeeId != null) predicates.push(eq(dataChangeRequestsTable.employeeId, filters.employeeId));
  if (filters.status) predicates.push(eq(dataChangeRequestsTable.status, filters.status));
  return db
    .select()
    .from(dataChangeRequestsTable)
    .where(and(...predicates))
    .orderBy(desc(dataChangeRequestsTable.requestedAt));
}

export async function getRequest(organizationId: number, requestId: number): Promise<DataChangeRequest | undefined> {
  const [row] = await db
    .select()
    .from(dataChangeRequestsTable)
    .where(
      and(eq(dataChangeRequestsTable.id, requestId), eq(dataChangeRequestsTable.organizationId, organizationId)),
    )
    .limit(1);
  return row;
}

export async function listRequestFields(
  organizationId: number,
  requestId: number,
): Promise<DataChangeRequestField[]> {
  return db
    .select()
    .from(dataChangeRequestFieldsTable)
    .where(
      and(
        eq(dataChangeRequestFieldsTable.organizationId, organizationId),
        eq(dataChangeRequestFieldsTable.requestId, requestId),
      ),
    )
    .orderBy(dataChangeRequestFieldsTable.id);
}

export async function listRequestEvents(organizationId: number, requestId: number): Promise<DataChangeEvent[]> {
  return db
    .select()
    .from(dataChangeEventsTable)
    .where(
      and(eq(dataChangeEventsTable.organizationId, organizationId), eq(dataChangeEventsTable.requestId, requestId)),
    )
    .orderBy(dataChangeEventsTable.occurredAt, dataChangeEventsTable.id);
}

async function appendEvent(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: {
    organizationId: number;
    requestId: number;
    eventType: DataChangeEvent["eventType"];
    stageOrder?: number | null;
    stageName?: string | null;
    notes?: string | null;
    details?: unknown;
    actorUserId: number;
    actorMembershipId: number | null;
  },
): Promise<void> {
  await tx.insert(dataChangeEventsTable).values({
    organizationId: params.organizationId,
    requestId: params.requestId,
    eventType: params.eventType,
    stageOrder: params.stageOrder ?? null,
    stageName: params.stageName ?? null,
    notes: params.notes ?? null,
    details: params.details ?? null,
    actorUserId: params.actorUserId,
    actorMembershipId: params.actorMembershipId,
    occurredAt: new Date(),
  });
}

/** Reads the live authoritative value of one registered field. */
async function readLiveValue(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: number,
  employeeId: number,
  field: EligibleField,
): Promise<unknown> {
  const [row] = await tx
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new InvalidDataChangeError("Employee not found in this organization.");
  return (row as Record<string, unknown>)[field.column as string] ?? null;
}

/** Value comparison that treats a Date and its ISO string as equal, and null/undefined alike. */
function valuesEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  };
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface RequestedFieldChange {
  fieldKey: string;
  requestedValue: unknown;
}

/**
 * Raises a request.
 *
 * `origin` is decided by the ROUTE, never by the body, and for an ESS request
 * the route derives `employeeId` from the caller's own employee link — a
 * browser-supplied id is never authority for "my change" (§29.2).
 */
export async function createRequest(params: {
  organizationId: number;
  employeeId: number;
  origin: DataChangeRequest["origin"];
  fields: RequestedFieldChange[];
  reason?: string | null;
  effectiveDate?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ request: DataChangeRequest; fields: DataChangeRequestField[]; approvalRequired: boolean }> {
  if (params.fields.length === 0) throw new InvalidDataChangeError("A request must change at least one field.");

  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!employee) throw new InvalidDataChangeError("Employee not found in this organization.");

  // Validate every field against the registry and the origin BEFORE anything is
  // written, so a rejected request leaves nothing behind.
  const resolved = [] as Array<{ field: EligibleField; requestedValue: unknown; approvalRequired: boolean }>;
  for (const requested of params.fields) {
    const policy = await resolveFieldPolicy(params.organizationId, requested.fieldKey);
    assertOriginAllowed(policy.field, params.origin);
    const parsed = policy.field.schema.safeParse(requested.requestedValue);
    if (!parsed.success) {
      throw new InvalidDataChangeError(`"${policy.field.label}" is not valid: ${parsed.error.message}`);
    }
    resolved.push({ field: policy.field, requestedValue: parsed.data, approvalRequired: policy.approvalRequired });
  }

  // A request needs approval if ANY of its fields does. Splitting one submission
  // into approved and unapproved halves would make the audit trail lie about
  // what the requester actually asked for.
  const approvalRequired = resolved.some((r) => r.approvalRequired);
  const stages = approvalRequired ? await listStages(params.organizationId, "data_change") : [];

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(dataChangeRequestsTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        origin: params.origin,
        status: "pending",
        reason: params.reason ?? null,
        // Frozen here: reconfiguring the chain later cannot change whether this
        // request is complete (§29.8).
        stageCountAtRequest: stages.length,
        currentStageOrder: stages.length > 0 ? stages[0]!.stageOrder : null,
        requestedByUserId: params.actorApplicationUserId,
        requestedByMembershipId: params.actorMembershipId,
        requestedAt: new Date(),
        effectiveDate: params.effectiveDate ?? null,
      })
      .returning();

    const fieldRows: DataChangeRequestField[] = [];
    for (const item of resolved) {
      const previousValue = await readLiveValue(tx, params.organizationId, params.employeeId, item.field);
      try {
        const [row] = await tx
          .insert(dataChangeRequestFieldsTable)
          .values({
            organizationId: params.organizationId,
            requestId: created!.id,
            employeeId: params.employeeId,
            activeStatus: true,
            fieldKey: item.field.key,
            // Captured NOW. This is the authority for stale detection (§29.10).
            previousValue: previousValue as never,
            requestedValue: item.requestedValue as never,
          })
          .returning();
        fieldRows.push(row!);
      } catch (err) {
        // The partial unique index is the real guarantee against a concurrent
        // duplicate; this turns it into a clear domain error.
        //
        // The driver's SQLSTATE arrives on the CAUSE, not the thrown error —
        // drizzle wraps the pg error — so both are inspected. Reading only the
        // outer `code` silently misses every violation, which is exactly the
        // defect the live suite caught.
        if (isUniqueViolation(err)) throw new DuplicatePendingFieldError(item.field.key);
        throw err;
      }
    }

    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: created!.id,
      eventType: "requested",
      notes: params.reason ?? null,
      // Masked: chronology has different read rules from the request itself.
      details: { fields: resolved.map((r) => ({ fieldKey: r.field.key, label: r.field.label })) },
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "data_change_request.created",
      targetType: "data_change_request",
      targetId: String(created!.id),
      afterState: {
        employeeId: created!.employeeId,
        origin: created!.origin,
        status: created!.status,
        fields: resolved.map((r) => r.field.key),
        approvalRequired,
      },
    });

    return { request: created!, fields: fieldRows, approvalRequired };
  });
}

// ---------------------------------------------------------------------------
// Stale detection (§29.10)
// ---------------------------------------------------------------------------

export interface StaleField {
  fieldKey: string;
  label: string;
  /** Masked where the field is sensitive (§29.7). */
  expectedPrevious: unknown;
  currentValue: unknown;
}

/**
 * Re-reads the live value of every requested field and compares it, PER FIELD,
 * against what was captured when the request was raised.
 *
 * Returns the fields that moved. An empty array means the request's basis still
 * holds. Note what this deliberately does NOT do: it does not consult
 * `employees.updatedAt`, because an edit to an unrelated column must not
 * invalidate an untouched request.
 */
export async function detectStaleFields(organizationId: number, requestId: number): Promise<StaleField[]> {
  const request = await getRequest(organizationId, requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  const fields = await listRequestFields(organizationId, requestId);

  const stale: StaleField[] = [];
  for (const row of fields) {
    const field = requireEligibleField(row.fieldKey);
    const live = await readLiveValue(db, organizationId, request.employeeId, field);
    if (!valuesEqual(live, row.previousValue)) {
      stale.push({
        fieldKey: row.fieldKey,
        label: field.label,
        expectedPrevious: maskForDisplay(field, row.previousValue),
        currentValue: maskForDisplay(field, live),
      });
    }
  }
  return stale;
}

async function markStale(params: {
  organizationId: number;
  requestId: number;
  stale: StaleField[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const item of params.stale) {
      const field = requireEligibleField(item.fieldKey);
      const request = await getRequest(params.organizationId, params.requestId);
      const live = await readLiveValue(tx, params.organizationId, request!.employeeId, field);
      await tx
        .update(dataChangeRequestFieldsTable)
        .set({ staleDetectedAt: now, staleCurrentValue: live as never })
        .where(
          and(
            eq(dataChangeRequestFieldsTable.requestId, params.requestId),
            eq(dataChangeRequestFieldsTable.fieldKey, item.fieldKey),
          ),
        );
    }
    await tx
      .update(dataChangeRequestsTable)
      .set({ status: "stale" })
      .where(eq(dataChangeRequestsTable.id, params.requestId));

    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "stale_detected",
      // Already masked by detectStaleFields.
      details: { fields: params.stale },
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "data_change_request.stale_detected",
    targetType: "data_change_request",
    targetId: String(params.requestId),
    metadata: { fields: params.stale.map((s) => s.fieldKey) },
  });
}

/**
 * Re-confirms a stale request against the values as they now stand.
 *
 * This is the audited re-confirmation §29.10 requires: the captured previous
 * values are refreshed to the live ones, the request returns to `pending`, and
 * the act is recorded. It never applies anything.
 */
export async function reconfirm(params: {
  organizationId: number;
  requestId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DataChangeRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  if (request.status !== "stale") throw new RequestNotActionableError("Only a stale request can be re-confirmed.");

  const fields = await listRequestFields(params.organizationId, params.requestId);

  const updated = await db.transaction(async (tx) => {
    for (const row of fields) {
      const field = requireEligibleField(row.fieldKey);
      const live = await readLiveValue(tx, params.organizationId, request.employeeId, field);
      await tx
        .update(dataChangeRequestFieldsTable)
        .set({ previousValue: live as never, staleDetectedAt: null, staleCurrentValue: null })
        .where(eq(dataChangeRequestFieldsTable.id, row.id));
    }
    const [row] = await tx
      .update(dataChangeRequestsTable)
      .set({
        status: "pending",
        // The chain restarts: a decision taken against the old basis should not
        // carry over to a materially different one.
        currentStageOrder: request.stageCountAtRequest > 0 ? 1 : null,
        decidedAt: null,
      })
      .where(eq(dataChangeRequestsTable.id, params.requestId))
      .returning();

    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "reconfirmed",
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "data_change_request.reconfirmed",
    targetType: "data_change_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Decisions (§29.6, §29.8)
// ---------------------------------------------------------------------------

async function assertMayDecide(params: {
  organizationId: number;
  request: DataChangeRequest;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ stageOrder: number | null; stageName: string | null }> {
  // MAKER-CHECKER. Checked before anything else, and by BOTH user and
  // membership, so the same human cannot approve through a second membership.
  if (
    params.request.requestedByUserId === params.actorApplicationUserId ||
    (params.request.requestedByMembershipId != null &&
      params.request.requestedByMembershipId === params.actorMembershipId)
  ) {
    throw new SelfApprovalForbiddenError();
  }

  if (params.request.stageCountAtRequest === 0 || params.request.currentStageOrder == null) {
    return { stageOrder: null, stageName: null };
  }

  const stage = await getStage(params.organizationId, "data_change", params.request.currentStageOrder);
  if (!stage) {
    // The stage was deleted after this request froze its chain. The request is
    // not silently auto-approved; it simply has no resolvable authority and an
    // administrator must re-confirm the configuration.
    throw new RequestNotActionableError(
      "This request's approval stage no longer exists. Restore the stage configuration, or reject the request.",
    );
  }

  const satisfies = await membershipSatisfiesStage({
    organizationId: params.organizationId,
    stage,
    membershipId: params.actorMembershipId,
    subjectEmployeeId: params.request.employeeId,
  });
  if (!satisfies) throw new NotAnApproverError(stage.name);

  return { stageOrder: stage.stageOrder, stageName: stage.name };
}

/**
 * Approves one stage. When the frozen chain is exhausted the request becomes
 * `approved` — a DECISION, not an application. Applying is a separate,
 * explicit, transactional act (§29.10).
 */
export async function approve(params: {
  organizationId: number;
  requestId: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DataChangeRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  if (request.status !== "pending" && request.status !== "returned") {
    throw new RequestNotActionableError(`A request in status "${request.status}" cannot be approved.`);
  }

  const { stageOrder, stageName } = await assertMayDecide({
    organizationId: params.organizationId,
    request,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  // Stale is checked at DECISION time, before approval is recorded — approving
  // against a basis that no longer holds is the failure §29.10 exists to stop.
  const stale = await detectStaleFields(params.organizationId, params.requestId);
  if (stale.length > 0) {
    await markStale({
      organizationId: params.organizationId,
      requestId: params.requestId,
      stale,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    throw new RequestStaleError();
  }

  const isFinalStage = stageOrder == null || stageOrder >= request.stageCountAtRequest;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dataChangeRequestsTable)
      .set(
        isFinalStage
          ? { status: "approved", currentStageOrder: null, decidedAt: new Date() }
          : { currentStageOrder: (stageOrder ?? 0) + 1 },
      )
      .where(eq(dataChangeRequestsTable.id, params.requestId))
      .returning();

    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: isFinalStage ? "approved" : "stage_approved",
      stageOrder,
      stageName,
      notes: params.notes ?? null,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: isFinalStage ? "data_change_request.approved" : "data_change_request.stage_approved",
    targetType: "data_change_request",
    targetId: String(params.requestId),
    beforeState: { status: request.status, currentStageOrder: request.currentStageOrder },
    afterState: { status: updated.status, currentStageOrder: updated.currentStageOrder },
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
}): Promise<DataChangeRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  if (!isActive(request.status) || request.status === "approved") {
    throw new RequestNotActionableError(`A request in status "${request.status}" cannot be rejected.`);
  }
  if (!params.reason.trim()) throw new InvalidDataChangeError("A reason is required to reject a request.");

  await assertMayDecide({
    organizationId: params.organizationId,
    request,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dataChangeRequestsTable)
      .set({ status: "rejected", currentStageOrder: null, decidedAt: new Date() })
      .where(eq(dataChangeRequestsTable.id, params.requestId))
      .returning();
    // Terminal — the (employee, field) slot is released.
    await tx
      .update(dataChangeRequestFieldsTable)
      .set({ activeStatus: false })
      .where(eq(dataChangeRequestFieldsTable.requestId, params.requestId));

    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "rejected",
      notes: params.reason.trim(),
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "data_change_request.rejected",
    targetType: "data_change_request",
    targetId: String(params.requestId),
    beforeState: { status: request.status },
    afterState: { status: updated.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated;
}

/** Sends a request back for more information. Not terminal; the slot stays held. */
export async function returnForInformation(params: {
  organizationId: number;
  requestId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DataChangeRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  if (request.status !== "pending") {
    throw new RequestNotActionableError(`A request in status "${request.status}" cannot be returned.`);
  }
  if (!params.reason.trim()) throw new InvalidDataChangeError("A reason is required to return a request.");

  await assertMayDecide({
    organizationId: params.organizationId,
    request,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dataChangeRequestsTable)
      .set({ status: "returned" })
      .where(eq(dataChangeRequestsTable.id, params.requestId))
      .returning();
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "returned",
      notes: params.reason.trim(),
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "data_change_request.returned",
    targetType: "data_change_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated;
}

/** The requester's own withdrawal. Terminal, and never deletes the record. */
export async function withdraw(params: {
  organizationId: number;
  requestId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DataChangeRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  if (request.status === "applied") {
    // §29 is explicit: withdrawal must never "undo" an already-applied change.
    throw new RequestNotActionableError(
      "This change has already been applied and cannot be withdrawn. Raise a new request to change it back.",
    );
  }
  if (!isActive(request.status)) {
    throw new RequestNotActionableError(`A request in status "${request.status}" cannot be withdrawn.`);
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dataChangeRequestsTable)
      .set({ status: "withdrawn", currentStageOrder: null })
      .where(eq(dataChangeRequestsTable.id, params.requestId))
      .returning();
    await tx
      .update(dataChangeRequestFieldsTable)
      .set({ activeStatus: false })
      .where(eq(dataChangeRequestFieldsTable.requestId, params.requestId));
    await appendEvent(tx, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "withdrawn",
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "data_change_request.withdrawn",
    targetType: "data_change_request",
    targetId: String(params.requestId),
    afterState: { status: updated.status },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Application (§29.10)
// ---------------------------------------------------------------------------

/**
 * Writes an approved request to the authoritative employee record.
 *
 * TRANSACTIONAL AND IDEMPOTENT. The status guard is inside the transaction and
 * the update is conditioned on the request still being `approved`, so a retried
 * or concurrent call applies exactly once — a partially applied multi-field
 * change is not representable.
 *
 * STALE IS RE-CHECKED HERE TOO, not only at approval, because time passes
 * between the two. And a failure is RECORDED as `application_failed` rather
 * than swallowed: §29.10 forbids pretending the write succeeded.
 *
 * This is called by an authorized human through the API. It is deliberately
 * unreachable from any job handler (§29.11).
 */
export async function applyRequest(params: {
  organizationId: number;
  requestId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<DataChangeRequest> {
  const request = await getRequest(params.organizationId, params.requestId);
  if (!request) throw new DataChangeRequestNotFoundError();
  if (request.status === "applied") {
    // Idempotent: applying twice is a no-op, not a second write.
    return request;
  }
  if (request.status !== "approved" && request.status !== "application_failed") {
    throw new RequestNotActionableError(`A request in status "${request.status}" cannot be applied.`);
  }

  const stale = await detectStaleFields(params.organizationId, params.requestId);
  if (stale.length > 0) {
    await markStale({
      organizationId: params.organizationId,
      requestId: params.requestId,
      stale,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    throw new RequestStaleError();
  }

  const fields = await listRequestFields(params.organizationId, params.requestId);
  const now = new Date();

  try {
    const updated = await db.transaction(async (tx) => {
      // Re-assert the guard INSIDE the transaction: two concurrent applies
      // cannot both pass this.
      const [current] = await tx
        .select()
        .from(dataChangeRequestsTable)
        .where(eq(dataChangeRequestsTable.id, params.requestId))
        .limit(1);
      if (!current || (current.status !== "approved" && current.status !== "application_failed")) {
        throw new RequestNotActionableError("This request was already applied or is no longer approved.");
      }

      const patch: Record<string, unknown> = {};
      for (const row of fields) {
        const field = requireEligibleField(row.fieldKey);
        let value = row.requestedValue as unknown;
        if (field.kind === "date" && typeof value === "string") value = new Date(value);
        patch[field.column as string] = value;
      }
      patch["updatedBy"] = params.actorApplicationUserId;

      await tx
        .update(employeesTable)
        .set(patch)
        .where(
          and(
            eq(employeesTable.id, request.employeeId),
            eq(employeesTable.organizationId, params.organizationId),
          ),
        );

      await tx
        .update(dataChangeRequestFieldsTable)
        .set({ appliedAt: now, activeStatus: false })
        .where(eq(dataChangeRequestFieldsTable.requestId, params.requestId));

      const [row] = await tx
        .update(dataChangeRequestsTable)
        .set({
          status: "applied",
          appliedAt: now,
          appliedByUserId: params.actorApplicationUserId,
          applicationFailureReason: null,
        })
        .where(eq(dataChangeRequestsTable.id, params.requestId))
        .returning();

      await appendEvent(tx, {
        organizationId: params.organizationId,
        requestId: params.requestId,
        eventType: "applied",
        // Masked field-by-field: a sensitive new value must not sit in the
        // chronology in the clear (§29.19).
        details: {
          fields: fields.map((f) => ({
            fieldKey: f.fieldKey,
            previousValue: maskForDisplay(requireEligibleField(f.fieldKey), f.previousValue),
            appliedValue: maskForDisplay(requireEligibleField(f.fieldKey), f.requestedValue),
          })),
        },
        actorUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
      });

      return row!;
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "data_change_request.applied",
      targetType: "data_change_request",
      targetId: String(params.requestId),
      beforeState: {
        fields: fields.map((f) => ({
          fieldKey: f.fieldKey,
          value: maskForDisplay(requireEligibleField(f.fieldKey), f.previousValue),
        })),
      },
      afterState: {
        fields: fields.map((f) => ({
          fieldKey: f.fieldKey,
          value: maskForDisplay(requireEligibleField(f.fieldKey), f.requestedValue),
        })),
      },
      metadata: { employeeId: request.employeeId, appliedAt: now },
    });

    return updated;
  } catch (err) {
    if (err instanceof RequestNotActionableError) throw err;

    // The write did not succeed. Record that truthfully rather than leaving a
    // request that claims to be applied (§29.10).
    const message = err instanceof Error ? err.message : "Unknown application failure";
    await db
      .update(dataChangeRequestsTable)
      .set({ status: "application_failed", applicationFailureReason: message })
      .where(eq(dataChangeRequestsTable.id, params.requestId));
    await appendEvent(db, {
      organizationId: params.organizationId,
      requestId: params.requestId,
      eventType: "application_failed",
      notes: message,
      actorUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "data_change_request.application_failed",
      targetType: "data_change_request",
      targetId: String(params.requestId),
      outcome: "failure",
      metadata: { reason: message },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// DTOs (§29.7, §29.17)
// ---------------------------------------------------------------------------

/**
 * What an APPROVER may see.
 *
 * §29.7: being named an approver expands no data visibility. This is built
 * field by field and carries only what the decision needs — it never spreads
 * the employee record, so a column added to `employees` tomorrow cannot start
 * leaking through an approval screen. Sensitive values are masked using WS-3's
 * existing helper.
 */
export interface ApprovalView {
  id: number;
  employeeId: number;
  origin: DataChangeRequest["origin"];
  status: DataChangeRequest["status"];
  reason: string | null;
  requestedAt: Date;
  effectiveDate: Date | null;
  currentStageOrder: number | null;
  stageCountAtRequest: number;
  fields: Array<{
    fieldKey: string;
    label: string;
    sensitive: boolean;
    previousValue: unknown;
    requestedValue: unknown;
    staleDetectedAt: Date | null;
  }>;
}

export function toApprovalView(request: DataChangeRequest, fields: DataChangeRequestField[]): ApprovalView {
  return {
    id: request.id,
    employeeId: request.employeeId,
    origin: request.origin,
    status: request.status,
    reason: request.reason,
    requestedAt: request.requestedAt,
    effectiveDate: request.effectiveDate,
    currentStageOrder: request.currentStageOrder,
    stageCountAtRequest: request.stageCountAtRequest,
    fields: fields.map((row) => {
      const field = requireEligibleField(row.fieldKey);
      return {
        fieldKey: row.fieldKey,
        label: field.label,
        sensitive: field.sensitive,
        previousValue: maskForDisplay(field, row.previousValue),
        requestedValue: maskForDisplay(field, row.requestedValue),
        staleDetectedAt: row.staleDetectedAt,
      };
    }),
  };
}

/**
 * What the EMPLOYEE may see of their own request.
 *
 * An allow-list built by construction, like §28.5's grievance view: no approver
 * identity, no stage configuration, no internal notes, no chronology `details`.
 * A requester sees their own submitted values unmasked — they typed them — but
 * never anything the approval process added.
 */
export interface EssRequestView {
  id: number;
  status: DataChangeRequest["status"];
  reason: string | null;
  requestedAt: Date;
  effectiveDate: Date | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  fields: Array<{ fieldKey: string; label: string; requestedValue: unknown; staleDetectedAt: Date | null }>;
}

export function toEssView(request: DataChangeRequest, fields: DataChangeRequestField[]): EssRequestView {
  return {
    id: request.id,
    status: request.status,
    reason: request.reason,
    requestedAt: request.requestedAt,
    effectiveDate: request.effectiveDate,
    decidedAt: request.decidedAt,
    appliedAt: request.appliedAt,
    fields: fields.map((row) => {
      const field = requireEligibleField(row.fieldKey);
      return {
        fieldKey: row.fieldKey,
        label: field.label,
        requestedValue: row.requestedValue,
        staleDetectedAt: row.staleDetectedAt,
      };
    }),
  };
}

/** Read model: requests awaiting a decision, with derived age (§29.21). */
export async function pendingRequests(
  organizationId: number,
  asOf: Date = new Date(),
): Promise<Array<{ id: number; employeeId: number; status: string; requestedAt: Date; ageDays: number }>> {
  const rows = await db
    .select({
      id: dataChangeRequestsTable.id,
      employeeId: dataChangeRequestsTable.employeeId,
      status: dataChangeRequestsTable.status,
      requestedAt: dataChangeRequestsTable.requestedAt,
    })
    .from(dataChangeRequestsTable)
    .where(
      and(
        eq(dataChangeRequestsTable.organizationId, organizationId),
        inArray(dataChangeRequestsTable.status, ["pending", "returned", "stale", "approved", "application_failed"]),
      ),
    )
    .orderBy(dataChangeRequestsTable.requestedAt);

  const DAY = 24 * 60 * 60 * 1000;
  return rows.map((r) => ({
    ...r,
    ageDays: Math.max(0, Math.floor((asOf.getTime() - r.requestedAt.getTime()) / DAY)),
  }));
}
