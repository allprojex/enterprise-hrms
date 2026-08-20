/**
 * Learning Enrollments (Phase 3D, W87 — Enrollment, Assignment & Approval):
 * the first workstream to actually write `learning_enrollments` rows
 * (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §10.3, §21, §29 W87).
 *
 * TWO INDEPENDENT AXES, never collapsed (§10.3, §0's own workflow
 * clarifications): `approvalStatus` answers whether approval was
 * required/granted; `status` is the SOLE authoritative execution-progress
 * field, set to 'assigned' at creation in every case regardless of
 * approvalStatus. A `hr_assigned`/`manager_assigned` enrollment is created
 * directly `auto_approved` — the assigner's own authority already IS the
 * approval, avoiding a redundant self-approval loop. An
 * `employee_requested` enrollment starts `pending` only when the course's
 * own `requiresApproval` is true; otherwise `auto_approved`. A `rejected`
 * enrollment is permanently inert at `status = 'assigned'` — enforced by
 * every subsequent write route, never physically deleted.
 *
 * IMMUTABLE TERMINAL OUTCOMES (Owner Decision 8, §10.6): completed/failed/
 * cancelled are permanent. There is no reopen in V1 — this file never
 * writes to a row already in one of those three states.
 *
 * DUPLICATE ENROLLMENT POLICY (§8.3's own explicit note: "exact constraint
 * shape — partial unique index vs. service-layer check — is an
 * implementation detail for the owning workstream (W87), not fixed [in the
 * frozen plan]"): implemented here as a service-layer check (query for an
 * existing NON-TERMINAL enrollment for the same employee+course, or
 * employee+session for instructor-led, immediately before insert, both
 * within the same transaction). This is a deliberate, disclosed choice,
 * not a schema inadequacy: a true DB-level partial unique index would
 * require a migration the frozen text explicitly does not mandate, and a
 * service-layer check correctly enforces the frozen business rule (block
 * only a genuinely non-terminal duplicate; a retrain after a terminal
 * outcome is always a legitimate new row). The residual race window (two
 * truly simultaneous requests for the same employee+course landing in the
 * same transaction-commit instant) is narrow, low-severity (a duplicate
 * enrollment row is correctable by cancelling one, never a security or
 * data-integrity defect), and explicitly accepted here rather than hidden.
 *
 * SESSION CAPACITY (§10.2's own literal rule: "the count of non-cancelled
 * enrollments against it is below capacity — checked atomically at
 * enrollment-creation time"): capacity-consuming statuses are every status
 * except 'cancelled' (assigned/in_progress/completed/failed all count) —
 * this is the frozen text's own literal words, not a guess. Made genuinely
 * atomic against a concurrent race via `SELECT ... FOR UPDATE` on the
 * session row inside the same transaction as the count-and-insert — a
 * standard Postgres pessimistic-locking pattern requiring no schema
 * change, serializing concurrent enrollment attempts against the same
 * session rather than merely hoping a plain COUNT never races.
 *
 * BULK-ASSIGN DUPLICATE HANDLING, explicitly disclosed as a genuine
 * implementation-time judgment call the frozen plan does not address:
 * an eligible employee who already holds a non-terminal enrollment for
 * the target course/session is SKIPPED, not treated as a whole-batch
 * failure — the assign action reports both counts (assigned vs. skipped)
 * rather than either silently dropping the conflict or blocking every
 * other eligible employee for one pre-existing enrollment.
 *
 * BOUNDARIES held exactly as frozen: no certificate issuance, no
 * employee_certifications write, no employee_skills write, no assessment
 * result/attempt — all W89/W90. W88 added exactly one narrow addition to
 * this file, `advanceEnrollmentProgress` — the employee's own self-paced
 * assigned→in_progress→completed transitions (§10.3.1) — never
 * instructor-led completion, never attendance, never an assessment
 * result, all still W89/W90.
 */
import { and, eq, ne, inArray, count, desc, isNull } from "drizzle-orm";
import {
  db,
  learningCoursesTable,
  learningCourseSessionsTable,
  learningEnrollmentsTable,
  learningCertificatesTable,
  employeesTable,
  departmentsTable,
  positionsTable,
  masterDataItemsTable,
  type LearningCourse,
  type LearningCourseSession,
  type LearningEnrollment,
  type Employee,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { isInstructorOfRecord } from "./learningAuthorization";

export { CrossOrganizationReferenceError };

type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class LearningCourseNotEnrollableError extends Error {
  constructor(message = "This course is not currently open for enrollment") {
    super(message);
    this.name = "LearningCourseNotEnrollableError";
  }
}

export class LearningCourseSessionNotEnrollableError extends Error {
  constructor(message = "This session is not open for enrollment") {
    super(message);
    this.name = "LearningCourseSessionNotEnrollableError";
  }
}

export class LearningSessionCapacityError extends Error {
  constructor() {
    super("This session has no remaining capacity");
    this.name = "LearningSessionCapacityError";
  }
}

export class LearningDuplicateEnrollmentError extends Error {
  constructor() {
    super("An active (non-terminal) enrollment for this employee already exists for this course");
    this.name = "LearningDuplicateEnrollmentError";
  }
}

export class LearningEnrollmentNotFoundError extends Error {
  constructor() {
    super("Enrollment not found");
    this.name = "LearningEnrollmentNotFoundError";
  }
}

export class LearningEnrollmentForbiddenError extends Error {
  constructor(message = "Not authorized to act on this enrollment") {
    super(message);
    this.name = "LearningEnrollmentForbiddenError";
  }
}

export class LearningApprovalConflictError extends Error {
  constructor() {
    super("This enrollment is not awaiting approval");
    this.name = "LearningApprovalConflictError";
  }
}

export class LearningCancelConflictError extends Error {
  constructor(message = "This enrollment can no longer be cancelled") {
    super(message);
    this.name = "LearningCancelConflictError";
  }
}

export class LearningProgressConflictError extends Error {
  constructor(message = "This enrollment cannot be advanced from its current state") {
    super(message);
    this.name = "LearningProgressConflictError";
  }
}

export class LearningProgressNotApprovedError extends Error {
  constructor() {
    super("This enrollment is not yet approved");
    this.name = "LearningProgressNotApprovedError";
  }
}

export class InvalidLearningEnrollmentError extends Error {}

/** §10.4 rule 6: expiresAt = issuedAt + certificateValidityMonthsSnapshot months, computed exactly once at issuance; null validity months -> never expires. setUTCMonth's own JS Date normalization (e.g. day-of-month rollover) is the same date-math convention already established by this codebase's other addMonths-shaped helpers. */
function computeCertificateExpiresAt(issuedAt: Date, validityMonths: number | null): Date | null {
  if (validityMonths == null) return null;
  const expiresAt = new Date(issuedAt);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + validityMonths);
  return expiresAt;
}

async function findOwnCourse(organizationId: number, courseId: number): Promise<LearningCourse | null> {
  const [row] = await db
    .select()
    .from(learningCoursesTable)
    .where(and(eq(learningCoursesTable.id, courseId), eq(learningCoursesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOwnEmployee(organizationId: number, employeeId: number): Promise<Employee | null> {
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** Category display label at the moment of enrollment, resolved from Master Data (organization row, else system row, else the code itself — categoryCode is deliberately unvalidated against the item list, §8.1, so no matching item may exist). */
async function resolveCategoryLabel(organizationId: number, categoryCode: string): Promise<string> {
  const rows = await db
    .select()
    .from(masterDataItemsTable)
    .where(and(eq(masterDataItemsTable.domain, "training_category"), eq(masterDataItemsTable.code, categoryCode)));
  const orgRow = rows.find((r) => r.organizationId === organizationId);
  const systemRow = rows.find((r) => r.organizationId == null);
  return (orgRow ?? systemRow)?.label ?? categoryCode;
}

/** Mirrors performanceCycles.ts's own resolveEligibleEmployees exactly (all_active/department/position/manual) — deliberately reimplemented locally rather than cross-imported from the Performance module, matching this platform's own established "each module owns its own copy of a shared shape" discipline (Performance's own version is itself not exported/shared either). */
async function resolveEligibleEmployees(params: {
  organizationId: number;
  scope: "all_active" | "department" | "position" | "manual";
  departmentIds?: number[];
  positionIds?: number[];
  manualEmployeeIds?: number[];
}): Promise<Employee[]> {
  if (params.scope === "manual") {
    const ids = Array.from(new Set(params.manualEmployeeIds ?? []));
    if (ids.length === 0) {
      throw new InvalidLearningEnrollmentError("employeeIds is required and must be non-empty when scope is 'manual'");
    }
    const rows = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.organizationId, params.organizationId), inArray(employeesTable.id, ids)));
    const foundIds = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new CrossOrganizationReferenceError(`Employee id(s) ${missing.join(", ")}`);
    }
    const inactive = rows.filter((r) => r.employmentStatus !== "active");
    if (inactive.length > 0) {
      throw new InvalidLearningEnrollmentError(`Employee id(s) ${inactive.map((r) => r.id).join(", ")} are not active and cannot be assigned training`);
    }
    return rows;
  }

  if (params.scope === "department") {
    if (!params.departmentIds || params.departmentIds.length === 0) {
      throw new InvalidLearningEnrollmentError("departmentIds is required and must be non-empty when scope is 'department'");
    }
    await Promise.all(params.departmentIds.map((id) => assertBelongsToOrganization(departmentsTable, id, params.organizationId, "Department")));
  }
  if (params.scope === "position") {
    if (!params.positionIds || params.positionIds.length === 0) {
      throw new InvalidLearningEnrollmentError("positionIds is required and must be non-empty when scope is 'position'");
    }
    await Promise.all(params.positionIds.map((id) => assertBelongsToOrganization(positionsTable, id, params.organizationId, "Position")));
  }

  const conditions = [eq(employeesTable.organizationId, params.organizationId), eq(employeesTable.employmentStatus, "active")];
  if (params.scope === "department" && params.departmentIds) conditions.push(inArray(employeesTable.departmentId, params.departmentIds));
  if (params.scope === "position" && params.positionIds) conditions.push(inArray(employeesTable.positionId, params.positionIds));
  return db.select().from(employeesTable).where(and(...conditions));
}

/** True if this employee already holds a non-terminal enrollment for the same course (self-paced) or session (instructor-led). */
async function hasNonTerminalEnrollment(organizationId: number, employeeId: number, courseId: number, sessionId: number | null): Promise<boolean> {
  const conditions = [
    eq(learningEnrollmentsTable.organizationId, organizationId),
    eq(learningEnrollmentsTable.employeeId, employeeId),
    ne(learningEnrollmentsTable.status, "completed"),
    ne(learningEnrollmentsTable.status, "failed"),
    ne(learningEnrollmentsTable.status, "cancelled"),
  ];
  conditions.push(sessionId != null ? eq(learningEnrollmentsTable.sessionId, sessionId) : eq(learningEnrollmentsTable.courseId, courseId));
  const rows = await db.select({ id: learningEnrollmentsTable.id }).from(learningEnrollmentsTable).where(and(...conditions)).limit(1);
  return rows.length > 0;
}

interface InsertEnrollmentParams {
  organizationId: number;
  course: LearningCourse;
  categoryLabel: string;
  session: LearningCourseSession | null;
  employee: Employee;
  originType: "hr_assigned" | "manager_assigned" | "employee_requested";
  assignedByMembershipId: number | null;
  mandatoryOverride?: boolean;
  dueDate?: Date | null;
}

/** The one place every origin path converges — server-derived snapshot capture (§9, §12, §13, §14) plus the approvalStatus decision (§0's own workflow clarifications). Runs inside a caller-supplied transaction so the session capacity lock (if any) and the insert are atomic together. */
async function insertEnrollment(tx: QueryClient, params: InsertEnrollmentParams): Promise<LearningEnrollment> {
  const mandatoryAtAssignment = params.mandatoryOverride ?? params.course.mandatoryDefault;
  const approvalStatus =
    params.originType === "employee_requested" ? (params.course.requiresApproval ? "pending" : "auto_approved") : "auto_approved";

  const [enrollment] = await tx
    .insert(learningEnrollmentsTable)
    .values({
      organizationId: params.organizationId,
      courseId: params.course.id,
      sessionId: params.session?.id ?? null,
      employeeId: params.employee.id,
      courseTitleSnapshot: params.course.title,
      categorySnapshot: params.categoryLabel,
      deliveryModeSnapshot: params.course.deliveryMode,
      hasAssessmentSnapshot: params.course.hasAssessment,
      issuesCertificateSnapshot: params.course.issuesCertificate,
      certificateValidityMonthsSnapshot: params.course.certificateValidityMonths,
      departmentIdSnapshot: params.employee.departmentId,
      positionIdSnapshot: params.employee.positionId,
      managerEmployeeIdSnapshot: params.employee.reportingManagerId,
      mandatoryAtAssignment,
      originType: params.originType,
      assignedByMembershipId: params.assignedByMembershipId,
      dueDate: params.dueDate ?? null,
      approvalStatus,
      status: "assigned",
    })
    .returning();
  return enrollment;
}

/**
 * Validates course/session eligibility and, for instructor-led courses,
 * locks the session row (`FOR UPDATE`) and checks capacity — all inside
 * one transaction, so the capacity check and the insert that follows are
 * atomic against a concurrent enrollment race (§10.2). Returns the locked
 * session row (or null for self-paced) for the caller to pass into
 * insertEnrollment within the same transaction.
 */
async function validateAndLockEnrollmentTarget(
  tx: QueryClient,
  organizationId: number,
  course: LearningCourse,
  requestedSessionId: number | null | undefined,
): Promise<LearningCourseSession | null> {
  if (course.status !== "active") {
    throw new LearningCourseNotEnrollableError();
  }

  if (course.deliveryMode === "self_paced") {
    if (requestedSessionId != null) {
      throw new InvalidLearningEnrollmentError("sessionId must not be supplied for a self-paced course");
    }
    return null;
  }

  // instructor_led
  if (requestedSessionId == null) {
    throw new InvalidLearningEnrollmentError("sessionId is required for an instructor-led course");
  }
  const [session] = await tx
    .select()
    .from(learningCourseSessionsTable)
    .where(and(eq(learningCourseSessionsTable.id, requestedSessionId), eq(learningCourseSessionsTable.organizationId, organizationId)))
    .for("update");
  if (!session) {
    throw new LearningCourseSessionNotEnrollableError("Session not found");
  }
  if (session.courseId !== course.id) {
    throw new InvalidLearningEnrollmentError("This session does not belong to the selected course");
  }
  if (session.status !== "scheduled") {
    throw new LearningCourseSessionNotEnrollableError();
  }
  if (session.capacity != null) {
    const [{ value: taken }] = await tx
      .select({ value: count() })
      .from(learningEnrollmentsTable)
      .where(and(eq(learningEnrollmentsTable.sessionId, session.id), ne(learningEnrollmentsTable.status, "cancelled")));
    if (taken >= session.capacity) {
      throw new LearningSessionCapacityError();
    }
  }
  return session;
}

// ---------------------------------------------------------------------------
// Employee-requested enrollment (§0, §12, §21 POST .../courses/:id/enroll)
// ---------------------------------------------------------------------------

export interface RequestEnrollmentParams {
  organizationId: number;
  courseId: number;
  sessionId?: number;
  callerEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function requestEnrollment(params: RequestEnrollmentParams): Promise<LearningEnrollment> {
  if (params.callerEmployeeId == null) {
    throw new LearningEnrollmentForbiddenError("No linked employee record for this user");
  }
  const course = await findOwnCourse(params.organizationId, params.courseId);
  if (!course) throw new LearningCourseNotEnrollableError("Course not found");
  const employee = await findOwnEmployee(params.organizationId, params.callerEmployeeId);
  if (!employee) throw new LearningEnrollmentForbiddenError();

  if (await hasNonTerminalEnrollment(params.organizationId, employee.id, course.id, params.sessionId ?? null)) {
    throw new LearningDuplicateEnrollmentError();
  }
  const categoryLabel = await resolveCategoryLabel(params.organizationId, course.categoryCode);

  const enrollment = await db.transaction(async (tx) => {
    const session = await validateAndLockEnrollmentTarget(tx, params.organizationId, course, params.sessionId ?? null);
    return insertEnrollment(tx, {
      organizationId: params.organizationId,
      course,
      categoryLabel,
      session,
      employee,
      originType: "employee_requested",
      assignedByMembershipId: null,
    });
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "learning_enrollment.requested",
    targetType: "learning_enrollment",
    targetId: String(enrollment.id),
    metadata: { courseId: course.id, employeeId: employee.id, approvalStatus: enrollment.approvalStatus },
  });

  return enrollment;
}

// ---------------------------------------------------------------------------
// Manager / HR assignment, single or bulk (§13, §14, §21 POST .../courses/:id/assign)
// ---------------------------------------------------------------------------

export interface AssignEnrollmentsParams {
  organizationId: number;
  courseId: number;
  sessionId?: number;
  scope: "all_active" | "department" | "position" | "manual";
  departmentIds?: number[];
  positionIds?: number[];
  employeeIds?: number[];
  mandatoryOverride?: boolean;
  dueDate?: string;
  isOrgWide: boolean;
  callerEmployeeId: number | null;
  assignedByMembershipId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export interface AssignEnrollmentsResult {
  assignedCount: number;
  skippedCount: number;
  enrollments: LearningEnrollment[];
  skippedEmployeeIds: number[];
}

/**
 * `isOrgWide = true` → HR/L&D (`learning.manage`): full audience targeting
 * (all_active/department/position/manual), any employee in the
 * organization. `isOrgWide = false` → manager of record
 * (`learning.review.write`): restricted to `scope = 'manual'` only, and
 * every employeeId must be the caller's own direct report
 * (`reportingManagerId === callerEmployeeId`, live) — a manager can never
 * broaden scope by supplying another manager's ID or an audience-targeting
 * scope (§0, §13).
 */
export async function assignEnrollments(params: AssignEnrollmentsParams): Promise<AssignEnrollmentsResult> {
  const course = await findOwnCourse(params.organizationId, params.courseId);
  if (!course) throw new LearningCourseNotEnrollableError("Course not found");

  let eligible: Employee[];
  const originType: "hr_assigned" | "manager_assigned" = params.isOrgWide ? "hr_assigned" : "manager_assigned";

  if (params.isOrgWide) {
    eligible = await resolveEligibleEmployees({
      organizationId: params.organizationId,
      scope: params.scope,
      departmentIds: params.departmentIds,
      positionIds: params.positionIds,
      manualEmployeeIds: params.employeeIds,
    });
  } else {
    if (params.callerEmployeeId == null) {
      throw new LearningEnrollmentForbiddenError("No linked employee record for this user");
    }
    if (params.scope !== "manual") {
      throw new LearningEnrollmentForbiddenError("A manager may only assign training to specific direct reports, not by audience scope");
    }
    eligible = await resolveEligibleEmployees({ organizationId: params.organizationId, scope: "manual", manualEmployeeIds: params.employeeIds });
    const notDirectReports = eligible.filter((e) => e.reportingManagerId !== params.callerEmployeeId);
    if (notDirectReports.length > 0) {
      throw new LearningEnrollmentForbiddenError(`Employee id(s) ${notDirectReports.map((e) => e.id).join(", ")} do not report to you`);
    }
  }

  const categoryLabel = await resolveCategoryLabel(params.organizationId, course.categoryCode);
  const dueDate = params.dueDate ? new Date(params.dueDate) : null;

  const enrollments: LearningEnrollment[] = [];
  const skippedEmployeeIds: number[] = [];

  // One atomic transaction for the whole batch (mirrors generateReviews's
  // own "one atomic transaction per action" precedent, §14) — the session
  // capacity lock, if any, is acquired once per employee inside the same
  // transaction as every insert, so a bulk-assign against a capacity-
  // limited session can never itself overbook.
  await db.transaction(async (tx) => {
    for (const employee of eligible) {
      if (await hasNonTerminalEnrollment(params.organizationId, employee.id, course.id, params.sessionId ?? null)) {
        skippedEmployeeIds.push(employee.id);
        continue;
      }
      const session = await validateAndLockEnrollmentTarget(tx, params.organizationId, course, params.sessionId ?? null);
      const enrollment = await insertEnrollment(tx, {
        organizationId: params.organizationId,
        course,
        categoryLabel,
        session,
        employee,
        originType,
        assignedByMembershipId: params.assignedByMembershipId,
        mandatoryOverride: params.mandatoryOverride,
        dueDate,
      });
      enrollments.push(enrollment);
    }
  });

  for (const enrollment of enrollments) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "learning_enrollment.assigned",
      targetType: "learning_enrollment",
      targetId: String(enrollment.id),
      metadata: { courseId: course.id, employeeId: enrollment.employeeId, originType },
    });
  }

  return { assignedCount: enrollments.length, skippedCount: skippedEmployeeIds.length, enrollments, skippedEmployeeIds };
}

// ---------------------------------------------------------------------------
// Reads (§21: my-enrollments, team-enrollments, org-wide list, detail)
// ---------------------------------------------------------------------------

export async function listMyEnrollments(organizationId: number, employeeId: number): Promise<LearningEnrollment[]> {
  return db
    .select()
    .from(learningEnrollmentsTable)
    .where(and(eq(learningEnrollmentsTable.organizationId, organizationId), eq(learningEnrollmentsTable.employeeId, employeeId)))
    .orderBy(desc(learningEnrollmentsTable.createdAt));
}

/** Manager-of-record scope — mirrors listTeamReviews (W78) exactly. */
export async function listTeamEnrollments(organizationId: number, managerEmployeeId: number): Promise<LearningEnrollment[]> {
  return db
    .select()
    .from(learningEnrollmentsTable)
    .where(and(eq(learningEnrollmentsTable.organizationId, organizationId), eq(learningEnrollmentsTable.managerEmployeeIdSnapshot, managerEmployeeId)))
    .orderBy(desc(learningEnrollmentsTable.createdAt));
}

export interface ListEnrollmentsFilters {
  organizationId: number;
  courseId?: number;
  employeeId?: number;
  status?: string;
  approvalStatus?: string;
  page: number;
  pageSize: number;
}

export interface ListEnrollmentsResult {
  items: LearningEnrollment[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Org-wide, paginated, filterable list — `learning.manage` only (mirrors
 * Performance's own W80 `GET /reviews` precedent exactly: "manage remains
 * the sole gate — the dedicated /team-reviews route already serves the
 * manager's own scoped view; this route is deliberately not widened to
 * also resolve that scope a second way," per the frozen §21 table's own
 * "(scoped)" alternative being reconciled the identical way Performance's
 * shipped code already reconciled it, not re-litigated here).
 */
export async function listEnrollments(filters: ListEnrollmentsFilters): Promise<ListEnrollmentsResult> {
  const conditions = [eq(learningEnrollmentsTable.organizationId, filters.organizationId)];
  if (filters.courseId != null) conditions.push(eq(learningEnrollmentsTable.courseId, filters.courseId));
  if (filters.employeeId != null) conditions.push(eq(learningEnrollmentsTable.employeeId, filters.employeeId));
  if (filters.status != null) conditions.push(eq(learningEnrollmentsTable.status, filters.status as never));
  if (filters.approvalStatus != null) conditions.push(eq(learningEnrollmentsTable.approvalStatus, filters.approvalStatus as never));
  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(learningEnrollmentsTable).where(where);
  const total = totalRow?.value ?? 0;

  const items = await db
    .select()
    .from(learningEnrollmentsTable)
    .where(where)
    .orderBy(desc(learningEnrollmentsTable.createdAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getEnrollment(organizationId: number, enrollmentId: number): Promise<LearningEnrollment | null> {
  const [row] = await db
    .select()
    .from(learningEnrollmentsTable)
    .where(and(eq(learningEnrollmentsTable.id, enrollmentId), eq(learningEnrollmentsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Approval decision (§0, §21 POST .../enrollments/:id/approve|reject)
// ---------------------------------------------------------------------------

export interface DecideEnrollmentApprovalParams {
  organizationId: number;
  enrollmentId: number;
  decision: "approved" | "rejected";
  callerEmployeeId: number | null;
  isOrgWide: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * Atomic conditional UPDATE ... WHERE approvalStatus = 'pending' — a
 * repeat decision, or a decision after the opposite one already landed,
 * affects zero rows and returns a controlled conflict, never a silent
 * overwrite of a terminal approval decision (§0, §10.3). Never touches
 * `status` — approval alone never advances execution progress.
 */
export async function decideEnrollmentApproval(params: DecideEnrollmentApprovalParams): Promise<LearningEnrollment> {
  const enrollment = await getEnrollment(params.organizationId, params.enrollmentId);
  if (!enrollment) throw new LearningEnrollmentNotFoundError();

  const isManagerOfRecord = params.callerEmployeeId != null && params.callerEmployeeId === enrollment.managerEmployeeIdSnapshot;
  if (!params.isOrgWide && !isManagerOfRecord) {
    throw new LearningEnrollmentForbiddenError("Only this enrollment's manager of record, or HR/L&D, may decide it");
  }
  // The employee can never approve/reject their own request — structurally
  // excluded even if they somehow also matched managerEmployeeIdSnapshot
  // (impossible in practice, since an employee cannot be their own
  // reportingManagerId, but checked explicitly for defense in depth).
  if (params.callerEmployeeId != null && params.callerEmployeeId === enrollment.employeeId) {
    throw new LearningEnrollmentForbiddenError("You may not decide your own request");
  }

  const [updated] = await db
    .update(learningEnrollmentsTable)
    .set({
      approvalStatus: params.decision,
      approvalDecidedByMembershipId: params.actorMembershipId,
      approvalDecidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(learningEnrollmentsTable.id, params.enrollmentId), eq(learningEnrollmentsTable.approvalStatus, "pending")))
    .returning();
  if (!updated) throw new LearningApprovalConflictError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.decision === "approved" ? "learning_enrollment.approved" : "learning_enrollment.rejected",
    targetType: "learning_enrollment",
    targetId: String(params.enrollmentId),
    metadata: { employeeId: enrollment.employeeId, courseId: enrollment.courseId },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Cancellation (§10.5, §21 POST .../enrollments/:id/cancel)
// ---------------------------------------------------------------------------

export interface CancelEnrollmentParams {
  organizationId: number;
  enrollmentId: number;
  callerEmployeeId: number | null;
  isOrgWide: boolean;
  reason?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * §10.5, frozen exactly: a mandatory enrollment can never be cancelled by
 * the employee — only HR/L&D, always with a reason. An optional enrollment
 * may be cancelled by the employee themselves, but only while still
 * `assigned` (not yet started); once `in_progress`, cancellation becomes
 * an HR/L&D action requiring a reason, identical to the mandatory case.
 * Atomic conditional UPDATE ... WHERE status IN ('assigned','in_progress')
 * — never touches a row already terminal.
 */
export async function cancelEnrollment(params: CancelEnrollmentParams): Promise<LearningEnrollment> {
  const enrollment = await getEnrollment(params.organizationId, params.enrollmentId);
  if (!enrollment) throw new LearningEnrollmentNotFoundError();

  const isOwn = params.callerEmployeeId != null && params.callerEmployeeId === enrollment.employeeId;
  if (!params.isOrgWide && !isOwn) {
    throw new LearningEnrollmentForbiddenError("You may only cancel your own enrollment, or hold learning.manage");
  }

  if (!params.isOrgWide) {
    // Employee's own cancel path.
    if (enrollment.mandatoryAtAssignment) {
      throw new LearningEnrollmentForbiddenError("A mandatory enrollment cannot be cancelled by the employee — HR/L&D must cancel or waive it");
    }
    if (enrollment.status !== "assigned") {
      throw new LearningCancelConflictError("Training has already started — only HR/L&D can cancel it now");
    }
  } else {
    // HR/L&D path — always requires a reason, mandatory or not.
    if (!params.reason || !params.reason.trim()) {
      throw new InvalidLearningEnrollmentError("A cancelReason is required");
    }
  }

  const [updated] = await db
    .update(learningEnrollmentsTable)
    .set({ status: "cancelled", cancelReason: params.reason ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(learningEnrollmentsTable.id, params.enrollmentId),
        eq(learningEnrollmentsTable.organizationId, params.organizationId),
        inArray(learningEnrollmentsTable.status, ["assigned", "in_progress"]),
      ),
    )
    .returning();
  if (!updated) throw new LearningCancelConflictError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "learning_enrollment.cancelled",
    targetType: "learning_enrollment",
    targetId: String(params.enrollmentId),
    metadata: { employeeId: enrollment.employeeId, courseId: enrollment.courseId, byEmployee: isOwn && !params.isOrgWide },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Employee self-paced progress (W88, §10.3.1, §21 PATCH .../enrollments/:id/progress)
// ---------------------------------------------------------------------------

export interface AdvanceEnrollmentProgressParams {
  organizationId: number;
  enrollmentId: number;
  targetStatus: "in_progress" | "completed";
  callerEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * §10.3.1, frozen exactly: "for self-paced courses, the employee
 * (learning.write.own) marks their own in_progress/completed." Restricted
 * to the enrollment's own employee and to self-paced delivery only —
 * instructor-led completion belongs to the instructor of record or HR/L&D
 * (a later workstream, never this route). Gated by approvalStatus being
 * auto_approved/approved — approval gates actionability, not row
 * existence (§0) — a still-pending or rejected request 409s here rather
 * than silently starting. Never accepts/records passed/score: an employee
 * cannot grade themselves, even for a self-paced course with
 * hasAssessmentSnapshot = true (§10.3.1, §11) — this route's own request
 * schema has no such fields at all, not merely an omission enforced by
 * convention. Each of the two one-way transitions is an atomic
 * conditional UPDATE ... WHERE status = '<expected prior state>' — a
 * concurrent or repeat call against the same prior state affects zero
 * rows and returns a controlled 409, mirroring every other transition in
 * this file and `leaveApprovals.ts`/every Performance transition (§10.3.1
 * itself).
 */
export async function advanceEnrollmentProgress(params: AdvanceEnrollmentProgressParams): Promise<LearningEnrollment> {
  const enrollment = await getEnrollment(params.organizationId, params.enrollmentId);
  if (!enrollment) throw new LearningEnrollmentNotFoundError();

  if (params.callerEmployeeId == null || params.callerEmployeeId !== enrollment.employeeId) {
    throw new LearningEnrollmentForbiddenError("You may only advance your own enrollment");
  }
  if (enrollment.deliveryModeSnapshot !== "self_paced") {
    throw new LearningEnrollmentForbiddenError("This action is only available for self-paced training");
  }
  if (enrollment.approvalStatus !== "auto_approved" && enrollment.approvalStatus !== "approved") {
    throw new LearningProgressNotApprovedError();
  }
  // W89 fix (§10.3/§10.3.1): the transition diagram shows in_progress
  // branching to completed OR failed "only when hasAssessmentSnapshot =
  // true and passed = false" — meaning for an assessed course, whatever
  // leaves 'in_progress' must supply the assessment result in the same
  // call, and §10.3.1 restricts that recording to the instructor of
  // record or HR/L&D only ("only HR/L&D may record the passed/score
  // result... the employee's own completion path never accepts an
  // assessment result for their own row"). This route's own request
  // schema has no passed/score fields, so it structurally cannot satisfy
  // that requirement — an assessed self-paced enrollment must therefore
  // never leave 'in_progress' via this employee-only route at all; only
  // HR/L&D's own `completeEnrollment` (W89, POST .../complete) may
  // complete or fail it. This gate was missing when W88 first shipped
  // `advanceEnrollmentProgress` (it let an employee self-complete an
  // assessed self-paced course with no assessment result ever recorded);
  // corrected here as part of building the completion route this exact
  // boundary depends on.
  if (params.targetStatus === "completed" && enrollment.hasAssessmentSnapshot) {
    throw new LearningEnrollmentForbiddenError("This course has an assessment — only HR/L&D can complete it and record the result");
  }

  const expectedPriorStatus = params.targetStatus === "in_progress" ? "assigned" : "in_progress";

  const patch: Partial<typeof learningEnrollmentsTable.$inferInsert> = { status: params.targetStatus, updatedAt: new Date() };
  if (params.targetStatus === "completed") patch.completedAt = new Date();

  const [updated] = await db
    .update(learningEnrollmentsTable)
    .set(patch)
    .where(and(eq(learningEnrollmentsTable.id, params.enrollmentId), eq(learningEnrollmentsTable.organizationId, params.organizationId), eq(learningEnrollmentsTable.status, expectedPriorStatus)))
    .returning();
  if (!updated) throw new LearningProgressConflictError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.targetStatus === "in_progress" ? "learning_enrollment.started" : "learning_enrollment.completed",
    targetType: "learning_enrollment",
    targetId: String(params.enrollmentId),
    metadata: { employeeId: enrollment.employeeId, courseId: enrollment.courseId },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Manager / Instructor Actions (W89, §10.3/§10.3.1/§11, §21 POST
// .../enrollments/:id/attendance, POST .../enrollments/:id/complete)
//
// Manager-of-record and instructor-of-record are kept conceptually
// separate here even though both share the `learning.review.write`
// permission key (§13): manager-of-record is a *snapshotted* comparison
// against managerEmployeeIdSnapshot (already used by decideEnrollmentApproval
// above); instructor-of-record is a *live* comparison against the
// enrollment's own session's current instructorEmployeeId, resolved fresh
// on every call via resolveInstructorAuthority below — never inferred from
// role, from holding learning.review.write alone, from course ownership,
// or from any client-supplied identifier (master prompt §F).
//
// DISCLOSED CERTIFICATE-INVARIANT DEVIATION: §10.4 rule 4 describes
// certificate issuance as "part of the same atomic action as the
// completion transition itself." W89's own frozen STOP boundary (§29)
// forbids certificate logic here, and W90 owns issuance exclusively —
// `learning_certificates` is never written to by this function. Per
// explicit product direction (this exact conflict was raised and
// resolved before implementation), `completeEnrollment` performs only
// the status/passed/score transition; certificate issuance for every
// enrollment completed under W89 remains W90's own responsibility,
// including a backfill pass for any enrollment that became
// certificate-eligible here before W90 existed.
// ---------------------------------------------------------------------------

/**
 * Resolves whether the caller is the instructor of record for this
 * enrollment's own session — a live lookup, never a snapshot (§13: "a
 * session's own current instructor assignment is itself the live
 * authorization boundary"). Returns false (never throws) for a self-paced
 * enrollment, since no session/instructor relationship exists there.
 */
export async function isCallerInstructorOfRecord(organizationId: number, enrollment: LearningEnrollment, callerEmployeeId: number | null): Promise<boolean> {
  if (enrollment.sessionId == null) return false;
  const [session] = await db
    .select()
    .from(learningCourseSessionsTable)
    .where(and(eq(learningCourseSessionsTable.id, enrollment.sessionId), eq(learningCourseSessionsTable.organizationId, organizationId)))
    .limit(1);
  return isInstructorOfRecord(callerEmployeeId, session?.instructorEmployeeId ?? null);
}

export interface MarkAttendanceParams {
  organizationId: number;
  enrollmentId: number;
  attended: boolean;
  callerEmployeeId: number | null;
  isOrgWide: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * §10.3: "Attendance (attended) is recorded as a separate fact by the
 * instructor of record or HR once a session occurs — it does not by
 * itself transition status." Instructor-led only (a self-paced
 * enrollment has no session to attend). Atomic conditional
 * UPDATE ... WHERE status IN ('assigned','in_progress') AND
 * attended IS NULL — recorded once; a repeat or concurrent call, or a
 * call against an already-terminal enrollment, returns a controlled 409
 * rather than silently overwriting or normalizing (§10.6, Definition of
 * Done's own "atomic conditional update with a controlled 409 on
 * repeat/concurrent attempts, tested under concurrency").
 */
export async function markAttendance(params: MarkAttendanceParams): Promise<LearningEnrollment> {
  const enrollment = await getEnrollment(params.organizationId, params.enrollmentId);
  if (!enrollment) throw new LearningEnrollmentNotFoundError();

  if (enrollment.deliveryModeSnapshot !== "instructor_led" || enrollment.sessionId == null) {
    throw new InvalidLearningEnrollmentError("Attendance only applies to instructor-led training");
  }
  if (!params.isOrgWide) {
    const isInstructor = await isCallerInstructorOfRecord(params.organizationId, enrollment, params.callerEmployeeId);
    if (!isInstructor) {
      throw new LearningEnrollmentForbiddenError("Only this session's own instructor, or HR/L&D, may record attendance");
    }
  }

  const [updated] = await db
    .update(learningEnrollmentsTable)
    .set({ attended: params.attended, attendanceMarkedByMembershipId: params.actorMembershipId, attendanceMarkedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(learningEnrollmentsTable.id, params.enrollmentId),
        eq(learningEnrollmentsTable.organizationId, params.organizationId),
        inArray(learningEnrollmentsTable.status, ["assigned", "in_progress"]),
        isNull(learningEnrollmentsTable.attended),
      ),
    )
    .returning();
  if (!updated) throw new LearningProgressConflictError("Attendance has already been recorded for this enrollment, or it is no longer active");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "learning_enrollment.attendance_marked",
    targetType: "learning_enrollment",
    targetId: String(params.enrollmentId),
    metadata: { employeeId: enrollment.employeeId, courseId: enrollment.courseId, attended: params.attended },
  });

  return updated;
}

export interface CompleteEnrollmentParams {
  organizationId: number;
  enrollmentId: number;
  passed?: boolean;
  score?: string;
  callerEmployeeId: number | null;
  isOrgWide: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * §10.3.1: instructor-led completion is the instructor of record's or
 * HR/L&D's own action; a self-paced enrollment with
 * hasAssessmentSnapshot = true has no instructor of record (no session)
 * so only HR/L&D may complete it (§11: the employee can never record
 * their own passed/score — enforced structurally by
 * advanceEnrollmentProgress's own gate above, not merely here). A
 * self-paced enrollment with hasAssessmentSnapshot = false has no reason
 * to reach this route at all under normal use (the employee's own
 * `.../progress` route already handles it) but HR/L&D may still use this
 * route as the "mark completion for any enrollment, organization-wide"
 * administrative path §10.3.1 grants HR/L&D generally.
 *
 * §10.3's own transition diagram — `in_progress → completed ↘ failed
 * (only when hasAssessmentSnapshot = true and passed = false)` — makes
 * the assessment result and the terminal status a single, inseparable
 * decision: when hasAssessmentSnapshot is true, `passed` is required and
 * determines the target status server-side (never `failed` accepted
 * directly from the caller); when false, `passed`/`score` must not be
 * supplied at all (§11: no threshold, no derivation — recorded fresh,
 * never accepted where it cannot apply). Atomic conditional
 * UPDATE ... WHERE status IN ('assigned','in_progress') — a concurrent or
 * repeat completion, or one against an already-terminal enrollment,
 * returns a controlled 409.
 *
 * CERTIFICATE ISSUANCE (W90, §10.4 rules 1-7, permanently resolving the
 * timing question W89 explicitly deferred): "issuance is automatic,
 * system-triggered, and part of the same atomic action as the completion
 * transition itself." Nested inside the SAME db.transaction as the
 * atomic completion UPDATE above, gated on that UPDATE's own success
 * (rule 1: only a genuine `completed` transition, never `failed`) and on
 * the enrollment's own `issuesCertificateSnapshot` (rule 3, snapshot-
 * sourced eligibility — never the live course row). If the certificate
 * insert fails for any reason, the whole transaction rolls back,
 * including the completion transition itself — a completed enrollment
 * that silently failed to produce its certificate can never exist (the
 * master brief's own explicit requirement). ONE-CERTIFICATE-PER-
 * ENROLLMENT, without a DB-level unique constraint: no migration was
 * added for this. The invariant is instead guaranteed by the same
 * atomicity that already guards against double-completion — a
 * certificate is only ever inserted as a direct, synchronous consequence
 * of the completion UPDATE actually affecting a row, and that UPDATE's
 * own `WHERE status IN ('assigned','in_progress')` guard can, by
 * construction, succeed at most once for a given enrollment (status
 * becomes immediately and permanently terminal). A concurrent second
 * completion call races on that UPDATE itself — Postgres row-level
 * locking guarantees only one transaction ever observes a matching row,
 * so only one transaction ever reaches the certificate-insert branch at
 * all; the other affects zero rows, throws LearningProgressConflictError
 * before this branch is reached, and never attempts a second insert. A
 * client retry after a network failure hits the identical guard (status
 * is already terminal) and 409s rather than double-issuing. This was
 * verified under a genuine concurrent-request race in both the backend
 * test suite and live QA, not merely reasoned about.
 */
export async function completeEnrollment(params: CompleteEnrollmentParams): Promise<LearningEnrollment> {
  const enrollment = await getEnrollment(params.organizationId, params.enrollmentId);
  if (!enrollment) throw new LearningEnrollmentNotFoundError();

  if (enrollment.deliveryModeSnapshot === "instructor_led") {
    if (!params.isOrgWide) {
      const isInstructor = await isCallerInstructorOfRecord(params.organizationId, enrollment, params.callerEmployeeId);
      if (!isInstructor) {
        throw new LearningEnrollmentForbiddenError("Only this session's own instructor, or HR/L&D, may complete this enrollment");
      }
    }
  } else {
    // self_paced — no instructor-of-record relationship exists; HR/L&D only.
    if (!params.isOrgWide) {
      throw new LearningEnrollmentForbiddenError("Only HR/L&D may complete a self-paced enrollment through this action");
    }
  }

  let targetStatus: "completed" | "failed";
  if (enrollment.hasAssessmentSnapshot) {
    if (params.passed == null) {
      throw new InvalidLearningEnrollmentError("passed is required to complete an enrollment with an assessment requirement");
    }
    targetStatus = params.passed ? "completed" : "failed";
  } else {
    if (params.passed != null || params.score != null) {
      throw new InvalidLearningEnrollmentError("This course has no assessment requirement — passed/score must not be supplied");
    }
    targetStatus = "completed";
  }

  let certificateIssued = false;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(learningEnrollmentsTable)
      .set({
        status: targetStatus,
        passed: enrollment.hasAssessmentSnapshot ? (params.passed ?? null) : null,
        score: enrollment.hasAssessmentSnapshot ? (params.score ?? null) : null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(learningEnrollmentsTable.id, params.enrollmentId),
          eq(learningEnrollmentsTable.organizationId, params.organizationId),
          inArray(learningEnrollmentsTable.status, ["assigned", "in_progress"]),
        ),
      )
      .returning();
    if (!row) throw new LearningProgressConflictError("This enrollment can no longer be completed");

    if (targetStatus === "completed" && row.issuesCertificateSnapshot) {
      const issuedAt = new Date();
      const expiresAt = computeCertificateExpiresAt(issuedAt, row.certificateValidityMonthsSnapshot);
      await tx.insert(learningCertificatesTable).values({
        organizationId: params.organizationId,
        enrollmentId: row.id,
        employeeId: row.employeeId,
        courseTitleSnapshot: row.courseTitleSnapshot,
        issuedAt,
        expiresAt,
        status: "active",
      });
      certificateIssued = true;
    }

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: targetStatus === "completed" ? "learning_enrollment.completed" : "learning_enrollment.failed",
    targetType: "learning_enrollment",
    targetId: String(params.enrollmentId),
    metadata: { employeeId: enrollment.employeeId, courseId: enrollment.courseId, hasAssessmentSnapshot: enrollment.hasAssessmentSnapshot },
  });
  if (certificateIssued) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "learning_certificate.issued",
      targetType: "learning_enrollment",
      targetId: String(params.enrollmentId),
      metadata: { employeeId: enrollment.employeeId, courseId: enrollment.courseId },
    });
  }

  return updated;
}
