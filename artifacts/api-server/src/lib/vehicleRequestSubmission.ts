/**
 * VR-02B — Vehicle Request submission (Employee Self-Service).
 *
 * AUTHORIZATION IS EXPLICIT (owner correction, 2026-09-21). Submitting is not
 * something every employee holds: an organization grants
 *   - `vehicle_request.write.own`        — submit a request for yourself, and/or
 *   - `vehicle_request.write.department` — submit one representing YOUR OWN
 *                                           canonical department,
 * to the specific people it chooses, through its own organization roles. The
 * two keys are independent. Job title, Head-of-Department status and department
 * membership authorize nothing here; `vehicle_request.approve` and
 * `vehicle_request.read.all` never imply submission.
 *
 * NOTHING IDENTITY-BEARING COMES FROM THE CLIENT. The organization is the
 * caller's resolved membership; the requester is the caller's own linked
 * employee (`resolveOwnEmployeeId`); the requesting department is DERIVED from
 * that employee and snapshotted onto the row, never re-derived later; the human
 * submitter is always the authenticated membership. The only client-supplied
 * reference is the vehicle, and it is proved to belong to this organization.
 *
 * TRANSACTION SHAPE — the Office Inventory precedent (`insertRequest`):
 *   A. every practicable fail-closed check, read-only, before any number is
 *      consumed;
 *   B. allocate the reference through `lockAndIncrementSequence`, which locks
 *      the organization's counter row and commits on its own — never MAX()+1;
 *   C. one transaction that re-reads the approval stages (FOR SHARE, so a
 *      concurrent stage deletion waits) and the vehicle (FOR SHARE), then
 *      inserts the request with `totalStages` frozen;
 *   D. the audit event, after commit.
 * A failure after B leaves a gap in the sequence, never a duplicate or a
 * partial request — the same tolerance every sequence in this repo accepts.
 *
 * SCOPE. This module submits and reads. It never decides, reserves, locks for a
 * reservation, cancels, checks time-window overlap or touches vehicle status:
 * those are VR-02C and VR-03.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  vehicleRequestsTable,
  vehicleRequestApprovalStagesTable,
  vehiclesTable,
  employeesTable,
  departmentsTable,
  type VehicleRequest,
} from "@workspace/db";
import { hasPermission } from "./permissions";
import { resolveOwnEmployeeId } from "./leaveRequests";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import {
  lockAndIncrementSequence,
  resolvePeriodKey,
  formatGeneratedNumber,
  type EmployeeNumberFormatConfig as RequestNumberFormatConfig,
} from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { recordAuditEvent } from "./auditLog";
import { VEHICLE_REQUEST_PURPOSE } from "./vehicleRequestStages";

export const VEHICLE_REQUEST_WRITE_OWN = "vehicle_request.write.own";
export const VEHICLE_REQUEST_WRITE_DEPARTMENT = "vehicle_request.write.department";

/** The permission each request type requires. There is no other path to submission. */
const REQUIRED_PERMISSION = {
  employee: VEHICLE_REQUEST_WRITE_OWN,
  department: VEHICLE_REQUEST_WRITE_DEPARTMENT,
} as const;

export type VehicleRequestType = keyof typeof REQUIRED_PERMISSION;

/**
 * Owner decision (e): the employee must be CURRENTLY ACTIVE. Read literally —
 * only `active`. Probation, leave, suspension and termination all fail closed.
 * Checked at submission only; a later status change never rewrites history.
 */
const SUBMITTABLE_EMPLOYMENT_STATUSES: readonly string[] = ["active"];

const REQUEST_NUMBER_SEQUENCE_KEY = "vehicle_request_number";
/**
 * Mirrors the `vehicle_requests` namespace default, used only if a stored
 * configuration somehow omits `requestNumber`. sequenceLength is explicit
 * because the numbering engine's own fallback is 4, which would give VR-0001.
 */
const DEFAULT_REQUEST_NUMBER_CONFIG: RequestNumberFormatConfig = {
  prefix: "VR",
  separator: "-",
  sequenceLength: 5,
  startingSequence: 1,
  resetPolicy: "never",
};

export const NO_APPROVAL_STAGES_MESSAGE =
  "Vehicle Request approval workflow has not been configured. Please contact your administrator.";

// ── errors ───────────────────────────────────────────────────────────────────
export class VehicleRequestNotAuthorizedError extends Error {
  constructor(requestType: VehicleRequestType) {
    super(
      requestType === "employee"
        ? "You are not authorized to submit a vehicle request for yourself"
        : "You are not authorized to submit a vehicle request on behalf of your department",
    );
    this.name = "VehicleRequestNotAuthorizedError";
  }
}
export class VehicleRequestNoEmployeeLinkError extends Error {
  constructor() {
    super("No employee record is linked to your account");
    this.name = "VehicleRequestNoEmployeeLinkError";
  }
}
export class VehicleRequestEmployeeNotActiveError extends Error {
  constructor() {
    super("Only a currently active employee can submit a vehicle request");
    this.name = "VehicleRequestEmployeeNotActiveError";
  }
}
export class VehicleRequestNoDepartmentError extends Error {
  constructor() {
    super(
      "You are not assigned to a department. HR/Administration must assign you to a department before a vehicle request can be submitted.",
    );
    this.name = "VehicleRequestNoDepartmentError";
  }
}
export class VehicleRequestDepartmentInactiveError extends Error {
  constructor() {
    super("Your department is not active, so a vehicle request cannot be submitted for it. Please contact HR/Administration.");
    this.name = "VehicleRequestDepartmentInactiveError";
  }
}
export class VehicleRequestVehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleRequestVehicleNotFoundError";
  }
}
export class VehicleRequestVehicleNotAvailableError extends Error {
  constructor() {
    super("This vehicle is not currently available for requests");
    this.name = "VehicleRequestVehicleNotAvailableError";
  }
}
export class VehicleRequestInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VehicleRequestInvalidInputError";
  }
}
export class VehicleRequestNoApprovalStagesError extends Error {
  constructor() {
    super(NO_APPROVAL_STAGES_MESSAGE);
    this.name = "VehicleRequestNoApprovalStagesError";
  }
}

// ── read models ──────────────────────────────────────────────────────────────
/** What a requester may see about a vehicle in order to choose it — nothing operational. */
export interface RequestableVehicle {
  id: number;
  registrationNumber: string;
  make: string | null;
  model: string | null;
  description: string | null;
}

export interface MyVehicleRequest {
  id: number;
  requestReference: string;
  requestType: VehicleRequestType;
  status: VehicleRequest["status"];
  requesterEmployeeId: number | null;
  requestingDepartmentId: number;
  requestingDepartmentName: string;
  vehicleId: number;
  vehicleRegistrationNumber: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  purpose: string;
  destination: string | null;
  plannedTimeOut: Date;
  plannedTimeIn: Date;
  totalStages: number;
  currentStageOrder: number | null;
  submittedAt: Date;
}

export interface SubmissionContext {
  canSubmitEmployeeRequest: boolean;
  canSubmitDepartmentRequest: boolean;
  department: { id: number; name: string } | null;
  approvalWorkflowConfigured: boolean;
  /** Why submission is impossible right now, if it is; null when it is possible. */
  blockedReason: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function permittedTypes(membershipId: number): Promise<{ employee: boolean; department: boolean }> {
  const [employee, department] = await Promise.all([
    hasPermission(membershipId, VEHICLE_REQUEST_WRITE_OWN),
    hasPermission(membershipId, VEHICLE_REQUEST_WRITE_DEPARTMENT),
  ]);
  return { employee, department };
}

/** True when the caller holds EITHER submission key. The two are siblings; neither implies the other. */
export async function holdsAnySubmissionPermission(membershipId: number): Promise<boolean> {
  const types = await permittedTypes(membershipId);
  return types.employee || types.department;
}

interface ResolvedRequester {
  employeeId: number;
  departmentId: number;
  departmentName: string;
}

/**
 * The caller's own employee and canonical department, or a fail-closed error.
 * Every check here is about the CALLER — nothing is read from the request.
 */
async function resolveRequester(organizationId: number, applicationUserId: number): Promise<ResolvedRequester> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId === null) throw new VehicleRequestNoEmployeeLinkError();

  const [employee] = await db
    .select({ departmentId: employeesTable.departmentId, employmentStatus: employeesTable.employmentStatus })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!employee) throw new VehicleRequestNoEmployeeLinkError();
  if (!SUBMITTABLE_EMPLOYMENT_STATUSES.includes(employee.employmentStatus)) throw new VehicleRequestEmployeeNotActiveError();
  if (employee.departmentId === null) throw new VehicleRequestNoDepartmentError();

  // departments.organization_id is proved equal to ours in the same read: a
  // department belonging to another organization is treated as no department.
  const [department] = await db
    .select({ id: departmentsTable.id, name: departmentsTable.name, status: departmentsTable.status })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, employee.departmentId), eq(departmentsTable.organizationId, organizationId)))
    .limit(1);
  if (!department) throw new VehicleRequestNoDepartmentError();
  if (department.status !== "active") throw new VehicleRequestDepartmentInactiveError();

  return { employeeId, departmentId: department.id, departmentName: department.name };
}

async function countApprovalStages(organizationId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vehicleRequestApprovalStagesTable)
    .where(
      and(
        eq(vehicleRequestApprovalStagesTable.organizationId, organizationId),
        eq(vehicleRequestApprovalStagesTable.purpose, VEHICLE_REQUEST_PURPOSE),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The vehicle must be ours and have VR-01 status exactly `available`. That is
 * the WHOLE availability rule in VR-02B — no time window, no overlap with other
 * requests, no reservation. A foreign id is reported as not found, never
 * confirmed to exist.
 */
async function assertRequestableVehicle(organizationId: number, vehicleId: number): Promise<void> {
  try {
    await assertBelongsToOrganization(vehiclesTable, vehicleId, organizationId, "Vehicle");
  } catch (err) {
    if (err instanceof CrossOrganizationReferenceError) throw new VehicleRequestVehicleNotFoundError();
    throw err;
  }
  const [vehicle] = await db
    .select({ status: vehiclesTable.status })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.organizationId, organizationId)))
    .limit(1);
  if (!vehicle) throw new VehicleRequestVehicleNotFoundError();
  if (vehicle.status !== "available") throw new VehicleRequestVehicleNotAvailableError();
}

function validateFields(input: SubmitVehicleRequestInput, now: Date): { purpose: string; destination: string | null } {
  const purpose = input.purpose.trim();
  if (purpose.length === 0) throw new VehicleRequestInvalidInputError("Purpose is required");
  const destinationRaw = input.destination?.trim() ?? "";
  const destination = destinationRaw.length > 0 ? destinationRaw : null;

  const out = input.plannedTimeOut;
  const back = input.plannedTimeIn;
  if (!(out instanceof Date) || Number.isNaN(out.getTime())) {
    throw new VehicleRequestInvalidInputError("Planned Time Out is required");
  }
  if (!(back instanceof Date) || Number.isNaN(back.getTime())) {
    throw new VehicleRequestInvalidInputError("Expected Time In is required");
  }
  // Absolute instants on both sides: the API accepts only offset-bearing
  // timestamps (see the route), and the columns are timestamptz.
  if (out.getTime() < now.getTime()) {
    throw new VehicleRequestInvalidInputError("Planned Time Out cannot be in the past");
  }
  if (!(back.getTime() > out.getTime())) {
    throw new VehicleRequestInvalidInputError("Expected Time In must be later than Planned Time Out");
  }
  return { purpose, destination };
}

async function allocateRequestReference(organizationId: number, now: Date): Promise<string> {
  const config = await getNamespaceConfig(organizationId, "vehicle_requests");
  const numberConfig = {
    ...DEFAULT_REQUEST_NUMBER_CONFIG,
    ...((config.data.requestNumber as RequestNumberFormatConfig | undefined) ?? {}),
  };
  const periodKey = resolvePeriodKey(numberConfig.resetPolicy, now);
  const sequenceValue = await lockAndIncrementSequence({
    organizationId,
    sequenceKey: REQUEST_NUMBER_SEQUENCE_KEY,
    periodKey,
    startingSequence: numberConfig.startingSequence ?? 1,
  });
  return formatGeneratedNumber(numberConfig, sequenceValue, {
    branchCode: null,
    departmentCode: null,
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
}

// ── public API ───────────────────────────────────────────────────────────────
export interface SubmitVehicleRequestInput {
  requestType: VehicleRequestType;
  vehicleId: number;
  purpose: string;
  destination?: string | null;
  plannedTimeOut: Date;
  plannedTimeIn: Date;
}

export interface SubmissionActor {
  organizationId: number;
  membershipId: number;
  applicationUserId: number;
}

export async function submitVehicleRequest(
  actor: SubmissionActor,
  input: SubmitVehicleRequestInput,
  now: Date = new Date(),
): Promise<VehicleRequest> {
  const { organizationId, membershipId, applicationUserId } = actor;

  // ── A. fail-closed validation, read-only, before any number is consumed ──
  if (!(input.requestType in REQUIRED_PERMISSION)) {
    throw new VehicleRequestInvalidInputError("Request type must be employee or department");
  }
  if (!(await hasPermission(membershipId, REQUIRED_PERMISSION[input.requestType]))) {
    throw new VehicleRequestNotAuthorizedError(input.requestType);
  }
  // Both modes need the caller's own employee: an employee request names them
  // as the requester, and a department request represents THEIR department.
  const requester = await resolveRequester(organizationId, applicationUserId);
  await assertRequestableVehicle(organizationId, input.vehicleId);
  const { purpose, destination } = validateFields(input, now);
  if ((await countApprovalStages(organizationId)) === 0) throw new VehicleRequestNoApprovalStagesError();

  // ── B. allocate the reference (own committed transaction, row-locked) ──
  const requestReference = await allocateRequestReference(organizationId, now);

  // ── C. re-read what the insert depends on, then insert ──
  const request = await db.transaction(async (tx) => {
    const stages = await tx
      .select({ stageOrder: vehicleRequestApprovalStagesTable.stageOrder })
      .from(vehicleRequestApprovalStagesTable)
      .where(
        and(
          eq(vehicleRequestApprovalStagesTable.organizationId, organizationId),
          eq(vehicleRequestApprovalStagesTable.purpose, VEHICLE_REQUEST_PURPOSE),
        ),
      )
      .orderBy(asc(vehicleRequestApprovalStagesTable.stageOrder))
      .for("share");
    if (stages.length === 0) throw new VehicleRequestNoApprovalStagesError();

    const [vehicle] = await tx
      .select({ status: vehiclesTable.status })
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.id, input.vehicleId), eq(vehiclesTable.organizationId, organizationId)))
      .for("share");
    if (!vehicle) throw new VehicleRequestVehicleNotFoundError();
    if (vehicle.status !== "available") throw new VehicleRequestVehicleNotAvailableError();

    const [inserted] = await tx
      .insert(vehicleRequestsTable)
      .values({
        organizationId,
        requestReference,
        requestType: input.requestType,
        submittedByMembershipId: membershipId,
        requesterEmployeeId: input.requestType === "employee" ? requester.employeeId : null,
        requestingDepartmentId: requester.departmentId,
        vehicleId: input.vehicleId,
        purpose,
        destination,
        plannedTimeOut: input.plannedTimeOut,
        plannedTimeIn: input.plannedTimeIn,
        status: "pending",
        totalStages: stages.length,
        currentStageOrder: stages[0]!.stageOrder,
      })
      .returning();
    return inserted!;
  });

  // ── D. audit, after commit ──
  await recordAuditEvent({
    actorApplicationUserId: applicationUserId,
    actorMembershipId: membershipId,
    organizationId,
    eventType: "vehicle_request.submitted",
    targetType: "vehicle_request",
    targetId: String(request.id),
    afterState: {
      requestReference: request.requestReference,
      requestType: request.requestType,
      submittedByMembershipId: request.submittedByMembershipId,
      requesterEmployeeId: request.requesterEmployeeId,
      requestingDepartmentId: request.requestingDepartmentId,
      vehicleId: request.vehicleId,
      plannedTimeOut: request.plannedTimeOut,
      plannedTimeIn: request.plannedTimeIn,
      status: request.status,
      totalStages: request.totalStages,
    },
  });

  return request;
}

/**
 * "My" requests: every request this membership SUBMITTED, in this organization.
 *
 * Deliberately NOT `requester_employee_id = me`: a department request has no
 * requester employee, and must still be visible to the person who submitted it.
 * Never widened by department membership (a colleague's request from the same
 * department is not "mine") and never by `vehicle_request.read.all` —
 * organization-wide oversight is VR-02D. Needs no permission key, so losing a
 * submission grant later never hides your own history.
 */
function myRequestsQuery(organizationId: number, membershipId: number) {
  return db
    .select({
      id: vehicleRequestsTable.id,
      requestReference: vehicleRequestsTable.requestReference,
      requestType: vehicleRequestsTable.requestType,
      status: vehicleRequestsTable.status,
      requesterEmployeeId: vehicleRequestsTable.requesterEmployeeId,
      requestingDepartmentId: vehicleRequestsTable.requestingDepartmentId,
      requestingDepartmentName: departmentsTable.name,
      vehicleId: vehicleRequestsTable.vehicleId,
      vehicleRegistrationNumber: vehiclesTable.registrationNumber,
      vehicleMake: vehiclesTable.make,
      vehicleModel: vehiclesTable.model,
      purpose: vehicleRequestsTable.purpose,
      destination: vehicleRequestsTable.destination,
      plannedTimeOut: vehicleRequestsTable.plannedTimeOut,
      plannedTimeIn: vehicleRequestsTable.plannedTimeIn,
      totalStages: vehicleRequestsTable.totalStages,
      currentStageOrder: vehicleRequestsTable.currentStageOrder,
      submittedAt: vehicleRequestsTable.submittedAt,
    })
    .from(vehicleRequestsTable)
    .innerJoin(departmentsTable, eq(departmentsTable.id, vehicleRequestsTable.requestingDepartmentId))
    .innerJoin(vehiclesTable, eq(vehiclesTable.id, vehicleRequestsTable.vehicleId))
    .where(
      and(
        eq(vehicleRequestsTable.organizationId, organizationId),
        eq(vehicleRequestsTable.submittedByMembershipId, membershipId),
      ),
    )
    .$dynamic();
}

export async function listMyVehicleRequests(organizationId: number, membershipId: number): Promise<MyVehicleRequest[]> {
  return myRequestsQuery(organizationId, membershipId).orderBy(
    desc(vehicleRequestsTable.submittedAt),
    desc(vehicleRequestsTable.id),
  ) as Promise<MyVehicleRequest[]>;
}

/** One of MY requests, or null — a request submitted by anyone else is indistinguishable from one that does not exist. */
export async function getMyVehicleRequest(
  organizationId: number,
  membershipId: number,
  requestId: number,
): Promise<MyVehicleRequest | null> {
  const rows = (await myRequestsQuery(organizationId, membershipId)
    .where(
      and(
        eq(vehicleRequestsTable.organizationId, organizationId),
        eq(vehicleRequestsTable.submittedByMembershipId, membershipId),
        eq(vehicleRequestsTable.id, requestId),
      ),
    )
    .limit(1)) as MyVehicleRequest[];
  return rows[0] ?? null;
}

/**
 * Vehicles a requester may choose: this organization's, VR-01 status exactly
 * `available`. No time-window availability, no overlap with pending or approved
 * requests, no reservation logic — VR-02C. Submission re-validates the choice
 * server-side and never trusts this list.
 */
export async function listRequestableVehicles(organizationId: number): Promise<RequestableVehicle[]> {
  return db
    .select({
      id: vehiclesTable.id,
      registrationNumber: vehiclesTable.registrationNumber,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      description: vehiclesTable.description,
    })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.organizationId, organizationId), eq(vehiclesTable.status, "available")))
    .orderBy(asc(vehiclesTable.registrationNumber));
}

/**
 * What the ESS page needs to explain itself: which request types the caller may
 * submit, their canonical department, and — when submission is impossible —
 * why. Grants nothing; submission re-checks every term.
 */
export async function getSubmissionContext(actor: SubmissionActor): Promise<SubmissionContext> {
  const types = await permittedTypes(actor.membershipId);
  const approvalWorkflowConfigured = (await countApprovalStages(actor.organizationId)) > 0;

  let department: SubmissionContext["department"] = null;
  let blockedReason: string | null = null;
  if (!types.employee && !types.department) {
    blockedReason = "You have not been authorized to submit vehicle requests.";
  } else {
    try {
      const requester = await resolveRequester(actor.organizationId, actor.applicationUserId);
      department = { id: requester.departmentId, name: requester.departmentName };
    } catch (err) {
      if (
        err instanceof VehicleRequestNoEmployeeLinkError ||
        err instanceof VehicleRequestEmployeeNotActiveError ||
        err instanceof VehicleRequestNoDepartmentError ||
        err instanceof VehicleRequestDepartmentInactiveError
      ) {
        blockedReason = err.message;
      } else {
        throw err;
      }
    }
    if (blockedReason === null && !approvalWorkflowConfigured) blockedReason = NO_APPROVAL_STAGES_MESSAGE;
  }

  return {
    canSubmitEmployeeRequest: types.employee,
    canSubmitDepartmentRequest: types.department,
    department,
    approvalWorkflowConfigured,
    blockedReason,
  };
}
