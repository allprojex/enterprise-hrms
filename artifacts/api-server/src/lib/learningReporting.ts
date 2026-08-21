/**
 * Learning Dashboard & Reporting (Phase 3D, W92):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §16/§17. Purely read-only
 * aggregation over W85-W91's existing learning_enrollments /
 * learning_courses / learning_certificates data — no second business-rules
 * engine, no persisted dashboard/report table, nothing mutated here.
 *
 * Visibility mirrors performanceReporting.ts's own dedicated-route pattern:
 * §17's own permission for both routes is "learning.reports.read", scope
 * resolved in the service layer — org-wide reach signaled by
 * learning.manage; otherwise the caller sees only enrollments where they
 * are the enrollment's own employee OR its snapshotted
 * managerEmployeeIdSnapshot (the identical own/manager-of-record/
 * organization-wide three-tier model learningAuthorization.ts already
 * establishes, resolved here at the enrollment-set level). Every Learning
 * role — including plain `employee` — holds learning.reports.read (see
 * seed-roles-permissions.ts), so "own" scope is real and always reachable,
 * never merely a theoretical tier.
 *
 * SIX OWNER DECISIONS (approved ahead of this workstream, resolving the
 * ambiguities the W92 discovery/reconciliation pass flagged) are load-
 * bearing here and cited inline at their point of use:
 *  1. enrollmentsAssignedCount — org-wide OR manager-of-record scope, no
 *     separate employee-only dashboard tier invented beyond what §16/§17
 *     already imply from holding learning.reports.read.
 *  2. overdueCount — dueDate passed AND status NOT IN
 *     (completed, failed, cancelled) — a terminal failed/cancelled
 *     enrollment is never "overdue".
 *  3. certificatesExpiringSoonCount — a fixed 30-day V1 window, status
 *     active, expiresAt in the future.
 *  4. learning_enrollment_status — exact row-level column set below.
 *  5. learning_completion_summary — per-course aggregate; completion% =
 *     completed / (enrollments not rejected, not pending, not cancelled).
 *  6. No instructor reporting tier — reporting visibility is strictly
 *     own/manager-of-record/organization-wide, never instructor-of-record
 *     (unlike learning.review.write's own action-scope, which does grant
 *     instructor-of-record reach — reporting deliberately does not).
 */
import { and, eq, or, inArray, count as sqlCount, lt, gte, isNotNull } from "drizzle-orm";
import {
  db,
  learningEnrollmentsTable,
  learningCoursesTable,
  learningCertificatesTable,
  learningCourseSessionsTable,
  employeesTable,
  departmentsTable,
  positionsTable,
} from "@workspace/db";
import { resolveLearningActorEmployeeId, hasOrgWideLearningAccess } from "./learningAuthorization";

export class LearningReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown learning report "${key}"`);
    this.name = "LearningReportNotFoundError";
  }
}

// --- Visibility scope (Owner Decision 1, Owner Decision 6) ---

export interface LearningReportScope {
  isOrgWide: boolean;
  ownEmployeeId: number | null;
}

export async function resolveLearningReportScope(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<LearningReportScope> {
  const isOrgWide = await hasOrgWideLearningAccess(params.membershipId, "learning.manage");
  if (isOrgWide) return { isOrgWide: true, ownEmployeeId: null };
  const ownEmployeeId = await resolveLearningActorEmployeeId(params.organizationId, params.applicationUserId);
  return { isOrgWide: false, ownEmployeeId };
}

// --- Scoped enrollment fetch (shared by dashboard + every report) ---

export interface LearningReportFilters {
  courseId?: number;
  status?: string;
  approvalStatus?: string;
  departmentId?: number;
  positionId?: number;
  managerId?: number;
  employeeId?: number;
}

type EnrollmentRow = typeof learningEnrollmentsTable.$inferSelect;

/**
 * A caller's authorized enrollment set, filters applied — filters always
 * narrow this set, never broaden it, since the scope condition and every
 * filter condition are AND-ed together. A non-org-wide caller with no
 * linked employee at all (ownEmployeeId null) gets a valid, empty scope —
 * not an error — matching performanceReporting.ts's identical precedent
 * for a caller with no linked employee. "Manager scope" is not a separate
 * permission tier — it is simply the own-employee-id also appearing as
 * some enrollment's managerEmployeeIdSnapshot; a manager with zero direct
 * reports therefore naturally sees zero rows, never organization-wide
 * data (Owner Decision 1's explicit "never fall back to organization-wide").
 */
async function fetchScopedEnrollments(organizationId: number, scope: LearningReportScope, filters: LearningReportFilters): Promise<EnrollmentRow[]> {
  const conditions = [eq(learningEnrollmentsTable.organizationId, organizationId)];
  if (!scope.isOrgWide) {
    if (scope.ownEmployeeId == null) return [];
    conditions.push(or(eq(learningEnrollmentsTable.employeeId, scope.ownEmployeeId), eq(learningEnrollmentsTable.managerEmployeeIdSnapshot, scope.ownEmployeeId))!);
  }
  if (filters.courseId != null) conditions.push(eq(learningEnrollmentsTable.courseId, filters.courseId));
  if (filters.status != null) conditions.push(eq(learningEnrollmentsTable.status, filters.status as EnrollmentRow["status"]));
  if (filters.approvalStatus != null) conditions.push(eq(learningEnrollmentsTable.approvalStatus, filters.approvalStatus as EnrollmentRow["approvalStatus"]));
  if (filters.departmentId != null) conditions.push(eq(learningEnrollmentsTable.departmentIdSnapshot, filters.departmentId));
  if (filters.positionId != null) conditions.push(eq(learningEnrollmentsTable.positionIdSnapshot, filters.positionId));
  if (filters.managerId != null) conditions.push(eq(learningEnrollmentsTable.managerEmployeeIdSnapshot, filters.managerId));
  if (filters.employeeId != null) conditions.push(eq(learningEnrollmentsTable.employeeId, filters.employeeId));

  return db.select().from(learningEnrollmentsTable).where(and(...conditions));
}

// --- Scoped report context (enrollments + name lookups resolved once, batched, reused by every report) ---

export interface LearningReportContext {
  organizationId: number;
  enrollments: EnrollmentRow[];
  employeeLabelById: Map<number, string>;
  employeeNumberById: Map<number, string | null>;
  departmentNameById: Map<number, string>;
  positionNameById: Map<number, string>;
  sessionLabelById: Map<number, string>;
}

export async function buildLearningReportContext(
  organizationId: number,
  scope: LearningReportScope,
  filters: LearningReportFilters,
): Promise<LearningReportContext> {
  const enrollments = await fetchScopedEnrollments(organizationId, scope, filters);
  if (enrollments.length === 0) {
    return {
      organizationId,
      enrollments: [],
      employeeLabelById: new Map(),
      employeeNumberById: new Map(),
      departmentNameById: new Map(),
      positionNameById: new Map(),
      sessionLabelById: new Map(),
    };
  }

  const employeeIds = [
    ...new Set([...enrollments.map((e) => e.employeeId), ...enrollments.map((e) => e.managerEmployeeIdSnapshot).filter((id): id is number => id != null)]),
  ];
  const departmentIds = [...new Set(enrollments.map((e) => e.departmentIdSnapshot).filter((id): id is number => id != null))];
  const positionIds = [...new Set(enrollments.map((e) => e.positionIdSnapshot).filter((id): id is number => id != null))];
  const sessionIds = [...new Set(enrollments.map((e) => e.sessionId).filter((id): id is number => id != null))];

  const [employees, departments, positions, sessions] = await Promise.all([
    db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, employeeNumber: employeesTable.employeeNumber }).from(employeesTable).where(inArray(employeesTable.id, employeeIds)),
    departmentIds.length ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, departmentIds)) : Promise.resolve([]),
    positionIds.length ? db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(inArray(positionsTable.id, positionIds)) : Promise.resolve([]),
    sessionIds.length ? db.select({ id: learningCourseSessionsTable.id, scheduledAt: learningCourseSessionsTable.scheduledAt }).from(learningCourseSessionsTable).where(inArray(learningCourseSessionsTable.id, sessionIds)) : Promise.resolve([]),
  ]);

  return {
    organizationId,
    enrollments,
    employeeLabelById: new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`])),
    employeeNumberById: new Map(employees.map((e) => [e.id, e.employeeNumber])),
    departmentNameById: new Map(departments.map((d) => [d.id, d.name])),
    positionNameById: new Map(positions.map((p) => [p.id, p.title])),
    sessionLabelById: new Map(sessions.map((s) => [s.id, s.scheduledAt.toISOString()])),
  };
}

// --- Dashboard (GET .../learning/dashboard) ---

const ENROLLMENT_STATUS_ORDER = ["assigned", "in_progress", "completed", "failed", "cancelled"] as const;
const CERTIFICATE_EXPIRING_SOON_WINDOW_DAYS = 30; // Owner Decision 3 — fixed V1 window, not a caller-supplied parameter.

export interface LearningDashboardStatusItem {
  status: (typeof ENROLLMENT_STATUS_ORDER)[number];
  count: number;
}

export interface LearningDashboard {
  activeCourseCount: number;
  enrollmentsAssignedCount: number;
  /** Zero-filled, all 5 statuses, fixed order — an enrollment's live status column decides its bucket. */
  statusBreakdown: LearningDashboardStatusItem[];
  pendingApprovalCount: number;
  overdueCount: number;
  certificatesExpiringSoonCount: number;
}

/**
 * Plain tile breakdown (§16) — no rate/percentage/average tile anywhere;
 * every value here is a raw, zero-filled count. activeCourseCount is
 * organization-wide regardless of the caller's own enrollment scope
 * (course catalog existence is already "broad read" per §21's GET
 * .../learning/courses row, not sensitive enrollment data) — mirrors
 * performanceReporting.ts's identical activeCycleCount precedent exactly.
 * Every other tile is computed only over the caller's authorized
 * enrollment set.
 */
export async function getLearningDashboard(organizationId: number, scope: LearningReportScope): Promise<LearningDashboard> {
  const [activeCourseRow] = await db
    .select({ value: sqlCount() })
    .from(learningCoursesTable)
    .where(and(eq(learningCoursesTable.organizationId, organizationId), eq(learningCoursesTable.status, "active")));
  const activeCourseCount = Number(activeCourseRow?.value ?? 0);

  const enrollments = await fetchScopedEnrollments(organizationId, scope, {});

  const counts = new Map<string, number>();
  for (const status of ENROLLMENT_STATUS_ORDER) counts.set(status, 0);
  for (const e of enrollments) counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  const statusBreakdown: LearningDashboardStatusItem[] = ENROLLMENT_STATUS_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }));

  const pendingApprovalCount = enrollments.filter((e) => e.approvalStatus === "pending").length;

  // Owner Decision 2 — overdue excludes every terminal status, not merely
  // "not yet completed" as §16's own shorthand literally reads; a
  // failed/cancelled enrollment can never be "overdue" again. dueDate is
  // timestamptz — an instant comparison against the server's own clock,
  // never the browser's, and never a civil-date/timezone question the way
  // Attendance's own "today" resolution is.
  const now = new Date();
  const overdueCount = enrollments.filter((e) => e.dueDate != null && e.dueDate < now && e.status !== "completed" && e.status !== "failed" && e.status !== "cancelled").length;

  let certificatesExpiringSoonCount = 0;
  {
    const windowEnd = new Date(now.getTime() + CERTIFICATE_EXPIRING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const authorizedEmployeeIds = scope.isOrgWide ? null : await resolveAuthorizedEmployeeIds(organizationId, scope);
    if (scope.isOrgWide || (authorizedEmployeeIds && authorizedEmployeeIds.length > 0)) {
      const conditions = [
        eq(learningCertificatesTable.organizationId, organizationId),
        eq(learningCertificatesTable.status, "active"),
        isNotNull(learningCertificatesTable.expiresAt),
        gte(learningCertificatesTable.expiresAt, now),
        lt(learningCertificatesTable.expiresAt, windowEnd),
      ];
      if (!scope.isOrgWide) conditions.push(inArray(learningCertificatesTable.employeeId, authorizedEmployeeIds!));
      const [row] = await db.select({ value: sqlCount() }).from(learningCertificatesTable).where(and(...conditions));
      certificatesExpiringSoonCount = Number(row?.value ?? 0);
    }
  }

  return {
    activeCourseCount,
    // Owner Decision 1 — literal enrollment count in scope (not distinct
    // employees; §16 names this tile "enrollmentsAssignedCount", unlike
    // Performance's own "employeesAssignedCount").
    enrollmentsAssignedCount: enrollments.length,
    statusBreakdown,
    pendingApprovalCount,
    overdueCount,
    certificatesExpiringSoonCount,
  };
}

/**
 * The set of employeeIds a non-org-wide caller may see certificates for:
 * themselves, plus every employee whose enrollment snapshots them as
 * manager-of-record — resolved once via a single lightweight enrollment
 * query, never a per-certificate lookup. Certificates carry no
 * managerEmployeeIdSnapshot of their own (§8.5), so their own visibility
 * is derived transitively through the issuing enrollment.
 */
async function resolveAuthorizedEmployeeIds(organizationId: number, scope: LearningReportScope): Promise<number[]> {
  if (scope.ownEmployeeId == null) return [];
  const managed = await db
    .select({ employeeId: learningEnrollmentsTable.employeeId })
    .from(learningEnrollmentsTable)
    .where(and(eq(learningEnrollmentsTable.organizationId, organizationId), eq(learningEnrollmentsTable.managerEmployeeIdSnapshot, scope.ownEmployeeId)));
  return [...new Set([scope.ownEmployeeId, ...managed.map((m) => m.employeeId)])];
}

// --- Reports (GET .../learning/reports/:reportKey) ---

export interface LearningReportColumn {
  key: string;
  label: string;
}

export type LearningReportRow = Record<string, string | number | null>;

export interface LearningReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: LearningReportColumn[];
  rows: LearningReportRow[];
}

function employeeLabel(ctx: LearningReportContext, employeeId: number | null): string {
  if (employeeId == null) return "—";
  return ctx.employeeLabelById.get(employeeId) ?? "Unknown employee";
}
function employeeNumberLabel(ctx: LearningReportContext, employeeId: number | null): string | null {
  if (employeeId == null) return null;
  return ctx.employeeNumberById.get(employeeId) ?? null;
}
function departmentLabel(ctx: LearningReportContext, departmentId: number | null): string {
  if (departmentId == null) return "—";
  return ctx.departmentNameById.get(departmentId) ?? "—";
}
function positionLabel(ctx: LearningReportContext, positionId: number | null): string {
  if (positionId == null) return "—";
  return ctx.positionNameById.get(positionId) ?? "—";
}
function sessionLabel(ctx: LearningReportContext, sessionId: number | null): string {
  if (sessionId == null) return "—";
  return ctx.sessionLabelById.get(sessionId) ?? "—";
}
function isoOrNull(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

/**
 * One row per in-scope enrollment — REPORT 1 (§17, Owner Decision 4).
 * Every historical dimension read from the enrollment's own snapshot
 * columns, never the live course/employee row. No unrelated sensitive HR
 * field (no disciplinary/exit/compensation data) is exposed.
 */
function runEnrollmentStatus(ctx: LearningReportContext): { columns: LearningReportColumn[]; rows: LearningReportRow[] } {
  const columns: LearningReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "employeeNumber", label: "Employee #" },
    { key: "course", label: "Course" },
    { key: "category", label: "Category" },
    { key: "deliveryMode", label: "Delivery Mode" },
    { key: "session", label: "Session" },
    { key: "mandatoryAtAssignment", label: "Mandatory" },
    { key: "originType", label: "Origin" },
    { key: "approvalStatus", label: "Approval Status" },
    { key: "status", label: "Status" },
    { key: "department", label: "Department" },
    { key: "position", label: "Position" },
    { key: "managerOfRecord", label: "Manager of Record" },
    { key: "assignedAt", label: "Assigned" },
    { key: "dueDate", label: "Due Date" },
    { key: "completedAt", label: "Completed" },
    { key: "passed", label: "Passed" },
    { key: "score", label: "Score" },
    { key: "cancelReason", label: "Cancel Reason" },
  ];
  const rows: LearningReportRow[] = ctx.enrollments.map((e) => ({
    employee: employeeLabel(ctx, e.employeeId),
    employeeNumber: employeeNumberLabel(ctx, e.employeeId),
    course: e.courseTitleSnapshot,
    category: e.categorySnapshot,
    deliveryMode: e.deliveryModeSnapshot,
    session: sessionLabel(ctx, e.sessionId),
    mandatoryAtAssignment: e.mandatoryAtAssignment ? "Yes" : "No",
    originType: e.originType,
    approvalStatus: e.approvalStatus,
    status: e.status,
    department: departmentLabel(ctx, e.departmentIdSnapshot),
    position: positionLabel(ctx, e.positionIdSnapshot),
    managerOfRecord: employeeLabel(ctx, e.managerEmployeeIdSnapshot),
    assignedAt: isoOrNull(e.createdAt),
    dueDate: isoOrNull(e.dueDate),
    completedAt: isoOrNull(e.completedAt),
    passed: e.hasAssessmentSnapshot ? (e.passed == null ? null : e.passed ? "Yes" : "No") : null,
    score: e.score,
    cancelReason: e.cancelReason,
  }));
  return { columns, rows };
}

/**
 * Per-course aggregate — REPORT 2 (§17, Owner Decision 5). Grouped by the
 * stable courseId (never a text title, since a course rename must not
 * split one course into two aggregate rows); the displayed course/category
 * label uses the most-recently-created enrollment's own snapshot in each
 * group, preserving snapshot display semantics while still giving a single
 * coherent label per group, per the owner decision's own "preserve
 * snapshot display semantics" instruction.
 *
 * completionPercentage = completedCount / denominator, where denominator
 * excludes rejected and pending-approval enrollments (never "active
 * assigned training") and excludes cancelled enrollments, but INCLUDES
 * failed (training was undertaken) and still-in-progress/assigned
 * enrollments (already part of the approved training population, simply
 * not yet finished). Null, never divide-by-zero, when denominator is 0.
 */
function runCompletionSummary(ctx: LearningReportContext): { columns: LearningReportColumn[]; rows: LearningReportRow[] } {
  const columns: LearningReportColumn[] = [
    { key: "course", label: "Course" },
    { key: "category", label: "Category" },
    { key: "assignedCount", label: "Assigned" },
    { key: "inProgressCount", label: "In Progress" },
    { key: "completedCount", label: "Completed" },
    { key: "failedCount", label: "Failed" },
    { key: "cancelledCount", label: "Cancelled" },
    { key: "completionPercentage", label: "Completion %" },
  ];

  const groups = new Map<number, EnrollmentRow[]>();
  for (const e of ctx.enrollments) {
    const list = groups.get(e.courseId) ?? [];
    list.push(e);
    groups.set(e.courseId, list);
  }

  const rows: LearningReportRow[] = [...groups.entries()].map(([, group]) => {
    const mostRecent = group.reduce((latest, e) => (e.createdAt > latest.createdAt ? e : latest));
    const completedCount = group.filter((e) => e.status === "completed").length;
    const failedCount = group.filter((e) => e.status === "failed").length;
    const cancelledCount = group.filter((e) => e.status === "cancelled").length;
    const inProgressCount = group.filter((e) => e.status === "in_progress").length;
    const denominator = group.filter((e) => e.approvalStatus !== "pending" && e.approvalStatus !== "rejected" && e.status !== "cancelled").length;

    return {
      course: mostRecent.courseTitleSnapshot,
      category: mostRecent.categorySnapshot,
      assignedCount: group.length,
      inProgressCount,
      completedCount,
      failedCount,
      cancelledCount,
      completionPercentage: denominator === 0 ? null : Math.round((completedCount / denominator) * 10000) / 100,
    };
  });
  return { columns, rows };
}

/**
 * Issued certificates within the caller's authorized employee set —
 * REPORT 3 (§17). "Expired" is always computed live from expiresAt, never
 * a stored value (W90's own §10.4 rule 9), matching the dashboard's own
 * certificatesExpiringSoonCount computation exactly.
 */
async function runCertificateExpiry(ctx: LearningReportContext, scope: LearningReportScope, organizationId: number, filters: { employeeId?: number; status?: string }): Promise<{ columns: LearningReportColumn[]; rows: LearningReportRow[] }> {
  const columns: LearningReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "employeeNumber", label: "Employee #" },
    { key: "course", label: "Course" },
    { key: "certificateNumber", label: "Certificate #" },
    { key: "issuedAt", label: "Issued" },
    { key: "expiresAt", label: "Expires" },
    { key: "computedStatus", label: "Status" },
    { key: "revokeReason", label: "Revoke Reason" },
  ];

  const conditions = [eq(learningCertificatesTable.organizationId, organizationId)];
  if (!scope.isOrgWide) {
    const authorizedEmployeeIds = await resolveAuthorizedEmployeeIds(organizationId, scope);
    if (authorizedEmployeeIds.length === 0) return { columns, rows: [] };
    conditions.push(inArray(learningCertificatesTable.employeeId, authorizedEmployeeIds));
  }
  if (filters.employeeId != null) conditions.push(eq(learningCertificatesTable.employeeId, filters.employeeId));
  if (filters.status != null) conditions.push(eq(learningCertificatesTable.status, filters.status as "active" | "revoked"));

  const certificates = await db.select().from(learningCertificatesTable).where(and(...conditions));
  if (certificates.length === 0) return { columns, rows: [] };

  const employeeIds = [...new Set(certificates.map((c) => c.employeeId))];
  const employees = await db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, employeeNumber: employeesTable.employeeNumber }).from(employeesTable).where(inArray(employeesTable.id, employeeIds));
  const labelById = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const numberById = new Map(employees.map((e) => [e.id, e.employeeNumber]));

  const now = new Date();
  const rows: LearningReportRow[] = certificates.map((c) => {
    const computedStatus = c.status === "revoked" ? "revoked" : c.expiresAt != null && c.expiresAt < now ? "expired" : "active";
    return {
      employee: labelById.get(c.employeeId) ?? "Unknown employee",
      employeeNumber: numberById.get(c.employeeId) ?? null,
      course: c.courseTitleSnapshot,
      certificateNumber: c.certificateNumber,
      issuedAt: isoOrNull(c.issuedAt),
      expiresAt: isoOrNull(c.expiresAt),
      computedStatus,
      revokeReason: c.revokeReason,
    };
  });
  return { columns, rows };
}

const ROW_LEVEL_RUNNERS: Record<string, (ctx: LearningReportContext) => { columns: LearningReportColumn[]; rows: LearningReportRow[] }> = {
  learning_enrollment_status: runEnrollmentStatus,
  learning_completion_summary: runCompletionSummary,
};

export function isKnownLearningReportKey(key: string): boolean {
  return key in ROW_LEVEL_RUNNERS || key === "learning_certificate_expiry";
}

export async function runLearningReport(params: {
  key: string;
  label: string;
  description: string;
  organizationId: number;
  scope: LearningReportScope;
  ctx: LearningReportContext;
  certificateFilters: { employeeId?: number; status?: string };
}): Promise<LearningReportResult> {
  if (params.key === "learning_certificate_expiry") {
    const { columns, rows } = await runCertificateExpiry(params.ctx, params.scope, params.organizationId, params.certificateFilters);
    return { key: params.key, label: params.label, description: params.description, generatedAt: new Date(), columns, rows };
  }

  const runner = ROW_LEVEL_RUNNERS[params.key];
  if (!runner) throw new LearningReportNotFoundError(params.key);

  const { columns, rows } = runner(params.ctx);
  return { key: params.key, label: params.label, description: params.description, generatedAt: new Date(), columns, rows };
}
