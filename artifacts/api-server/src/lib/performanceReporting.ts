/**
 * Performance Dashboard & Reporting (Phase 3C, W81):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §20/§21/§27. Purely
 * read-only aggregation over W73-W80's existing performance_reviews /
 * performance_review_goals data — no second scoring engine, no persisted
 * dashboard/report table, and nothing mutated by any function here.
 *
 * Visibility mirrors attendanceReporting.ts's own dedicated-route pattern:
 * §27's own permission line for both routes is "performance.reports.read",
 * with scope "resolved in service layer... own/reviewer-of-record vs.
 * org-wide signaled by holding performance.manage" (line 142 of the frozen
 * plan). Org-wide reach is signaled by performance.manage; otherwise the
 * caller sees only reviews where they are the review's own employee OR its
 * snapshotted reviewerEmployeeId — the identical own/reviewer/org-wide
 * three-tier model performanceAuthorization.ts already establishes,
 * resolved here at the review-set level rather than per single review.
 *
 * EFFECTIVE SCORE (W79): every score-bearing row exposes
 * computedOverallScore (manager) and hrOverrideScore separately, alongside
 * a derived effectiveScore = hrOverrideScore ?? computedOverallScore.
 * Neither manager score nor a HR override is ever hidden or overwritten by
 * the other. Scores are never recalculated here — always read directly
 * from the review's own already-persisted columns (W78/W79's own work).
 *
 * RATING DISTRIBUTION DEFERRED: §20/§21 name a "rating distribution (score
 * bands)" dashboard tile and a performance_rating_distribution report key,
 * but the frozen plan defines no actual band/bin boundaries anywhere for
 * the 0-100 normalized score, and no existing report in this codebase
 * (recruitment or attendance reports) has ever used numeric banding —
 * there is no precedent to reuse either. Per the W81 master brief's own explicit STOP
 * condition ("rating distribution semantics are undefined"), this specific
 * tile/report is deliberately NOT implemented this workstream rather than
 * guessed at — flagged in the W81 completion report for a follow-up
 * decision, exactly mirroring attendanceReporting.ts's own precedent of
 * omitting an undefined rate/percentage rather than inventing one.
 */
import { and, eq, or, inArray, count as sqlCount } from "drizzle-orm";
import {
  db,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceCyclesTable,
  employeesTable,
  departmentsTable,
  positionsTable,
} from "@workspace/db";
import { resolvePerformanceActorEmployeeId, hasOrgWidePerformanceAccess } from "./performanceAuthorization";

export class PerformanceReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown performance report "${key}"`);
    this.name = "PerformanceReportNotFoundError";
  }
}

// --- Visibility scope ---

export interface PerformanceReportScope {
  isOrgWide: boolean;
  ownEmployeeId: number | null;
}

export async function resolvePerformanceReportScope(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<PerformanceReportScope> {
  const isOrgWide = await hasOrgWidePerformanceAccess(params.membershipId, "performance.manage");
  if (isOrgWide) return { isOrgWide: true, ownEmployeeId: null };
  const ownEmployeeId = await resolvePerformanceActorEmployeeId(params.organizationId, params.applicationUserId);
  return { isOrgWide: false, ownEmployeeId };
}

// --- Scoped review fetch (shared by dashboard + every report) ---

export interface PerformanceReportFilters {
  cycleId?: number;
  status?: string;
  departmentId?: number;
  positionId?: number;
  reviewerId?: number;
  employeeId?: number;
}

type ReviewRow = typeof performanceReviewsTable.$inferSelect;

/**
 * A caller's authorized review set, filters applied — filters always
 * narrow this set, never broaden it, since the scope condition and every
 * filter condition are AND-ed together. A non-org-wide caller with no
 * linked employee at all (ownEmployeeId null) gets a valid, empty scope —
 * not an error — matching attendanceReporting.ts's identical precedent for
 * a manager with zero direct reports.
 */
async function fetchScopedReviews(organizationId: number, scope: PerformanceReportScope, filters: PerformanceReportFilters): Promise<ReviewRow[]> {
  const conditions = [eq(performanceReviewsTable.organizationId, organizationId)];
  if (!scope.isOrgWide) {
    if (scope.ownEmployeeId == null) return [];
    conditions.push(or(eq(performanceReviewsTable.employeeId, scope.ownEmployeeId), eq(performanceReviewsTable.reviewerEmployeeId, scope.ownEmployeeId))!);
  }
  if (filters.cycleId != null) conditions.push(eq(performanceReviewsTable.cycleId, filters.cycleId));
  if (filters.status != null) conditions.push(eq(performanceReviewsTable.status, filters.status as ReviewRow["status"]));
  if (filters.departmentId != null) conditions.push(eq(performanceReviewsTable.departmentIdSnapshot, filters.departmentId));
  if (filters.positionId != null) conditions.push(eq(performanceReviewsTable.positionIdSnapshot, filters.positionId));
  if (filters.reviewerId != null) conditions.push(eq(performanceReviewsTable.reviewerEmployeeId, filters.reviewerId));
  if (filters.employeeId != null) conditions.push(eq(performanceReviewsTable.employeeId, filters.employeeId));

  return db.select().from(performanceReviewsTable).where(and(...conditions));
}

// --- Scoped report context (reviews + name lookups resolved once, batched, reused by every report) ---

export interface PerformanceReportContext {
  organizationId: number;
  reviews: ReviewRow[];
  employeeLabelById: Map<number, string>;
  cycleNameById: Map<number, string>;
  departmentNameById: Map<number, string>;
  positionNameById: Map<number, string>;
}

export async function buildPerformanceReportContext(
  organizationId: number,
  scope: PerformanceReportScope,
  filters: PerformanceReportFilters,
): Promise<PerformanceReportContext> {
  const reviews = await fetchScopedReviews(organizationId, scope, filters);
  if (reviews.length === 0) {
    return { organizationId, reviews: [], employeeLabelById: new Map(), cycleNameById: new Map(), departmentNameById: new Map(), positionNameById: new Map() };
  }

  const employeeIds = [...new Set([...reviews.map((r) => r.employeeId), ...reviews.map((r) => r.reviewerEmployeeId).filter((id): id is number => id != null)])];
  const cycleIds = [...new Set(reviews.map((r) => r.cycleId))];
  const departmentIds = [...new Set(reviews.map((r) => r.departmentIdSnapshot).filter((id): id is number => id != null))];
  const positionIds = [...new Set(reviews.map((r) => r.positionIdSnapshot).filter((id): id is number => id != null))];

  const [employees, cycles, departments, positions] = await Promise.all([
    db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(inArray(employeesTable.id, employeeIds)),
    db.select({ id: performanceCyclesTable.id, name: performanceCyclesTable.name }).from(performanceCyclesTable).where(inArray(performanceCyclesTable.id, cycleIds)),
    departmentIds.length ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, departmentIds)) : Promise.resolve([]),
    positionIds.length ? db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(inArray(positionsTable.id, positionIds)) : Promise.resolve([]),
  ]);

  return {
    organizationId,
    reviews,
    employeeLabelById: new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`])),
    cycleNameById: new Map(cycles.map((c) => [c.id, c.name])),
    departmentNameById: new Map(departments.map((d) => [d.id, d.name])),
    positionNameById: new Map(positions.map((p) => [p.id, p.title])),
  };
}

// --- Dashboard (GET .../performance/dashboard) ---

const REVIEW_STATUS_ORDER = ["draft", "self_assessment", "manager_review", "hr_review", "finalized", "acknowledged"] as const;

export interface PerformanceDashboardStatusItem {
  status: (typeof REVIEW_STATUS_ORDER)[number];
  count: number;
}

export interface PerformanceDashboard {
  cycleId: number | null;
  activeCycleCount: number;
  employeesAssignedCount: number;
  /** Zero-filled, all 6 statuses, fixed order — a review's live status column decides its bucket, so a reopened review counts only under its current status, never a prior one. */
  statusBreakdown: PerformanceDashboardStatusItem[];
  selfAssessmentPendingCount: number;
  selfAssessmentSubmittedCount: number;
  managerReviewPendingCount: number;
  managerReviewSubmittedCount: number;
  proposedGoalsAwaitingDecisionCount: number;
  finalizedCount: number;
  acknowledgedCount: number;
}

/**
 * Plain tile breakdown (§20) — no rate/percentage/average tile anywhere;
 * every value here is a raw, zero-filled count. activeCycleCount is
 * organization-wide regardless of the caller's own review scope (whether a
 * cycle is open is not sensitive review data); every other tile is
 * computed only over the caller's authorized, optionally cycle-filtered
 * review set.
 */
export async function getPerformanceDashboard(organizationId: number, scope: PerformanceReportScope, cycleId: number | undefined): Promise<PerformanceDashboard> {
  const [activeCycleRow] = await db
    .select({ value: sqlCount() })
    .from(performanceCyclesTable)
    .where(and(eq(performanceCyclesTable.organizationId, organizationId), eq(performanceCyclesTable.status, "open")));
  const activeCycleCount = Number(activeCycleRow?.value ?? 0);

  const reviews = await fetchScopedReviews(organizationId, scope, { cycleId });

  const counts = new Map<string, number>();
  for (const status of REVIEW_STATUS_ORDER) counts.set(status, 0);
  for (const r of reviews) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const statusBreakdown: PerformanceDashboardStatusItem[] = REVIEW_STATUS_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }));
  const sumOf = (statuses: string[]) => statuses.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);

  let proposedGoalsAwaitingDecisionCount = 0;
  if (reviews.length > 0) {
    const [goalRow] = await db
      .select({ value: sqlCount() })
      .from(performanceReviewGoalsTable)
      .where(and(inArray(performanceReviewGoalsTable.reviewId, reviews.map((r) => r.id)), eq(performanceReviewGoalsTable.approvalStatus, "proposed")));
    proposedGoalsAwaitingDecisionCount = Number(goalRow?.value ?? 0);
  }

  return {
    cycleId: cycleId ?? null,
    activeCycleCount,
    employeesAssignedCount: new Set(reviews.map((r) => r.employeeId)).size,
    statusBreakdown,
    selfAssessmentPendingCount: counts.get("self_assessment") ?? 0,
    selfAssessmentSubmittedCount: sumOf(["manager_review", "hr_review", "finalized", "acknowledged"]),
    managerReviewPendingCount: counts.get("manager_review") ?? 0,
    managerReviewSubmittedCount: sumOf(["hr_review", "finalized", "acknowledged"]),
    proposedGoalsAwaitingDecisionCount,
    finalizedCount: counts.get("finalized") ?? 0,
    acknowledgedCount: counts.get("acknowledged") ?? 0,
  };
}

// --- Reports (GET .../performance/reports/:reportKey) ---

export interface PerformanceReportColumn {
  key: string;
  label: string;
}

export type PerformanceReportRow = Record<string, string | number | null>;

export interface PerformanceReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: PerformanceReportColumn[];
  rows: PerformanceReportRow[];
}

function employeeLabel(ctx: PerformanceReportContext, employeeId: number | null): string {
  if (employeeId == null) return "—";
  return ctx.employeeLabelById.get(employeeId) ?? "Unknown employee";
}
function cycleLabel(ctx: PerformanceReportContext, cycleId: number): string {
  return ctx.cycleNameById.get(cycleId) ?? `Cycle #${cycleId}`;
}
function departmentLabel(ctx: PerformanceReportContext, departmentId: number | null): string {
  if (departmentId == null) return "—";
  return ctx.departmentNameById.get(departmentId) ?? "—";
}
function positionLabel(ctx: PerformanceReportContext, positionId: number | null): string {
  if (positionId == null) return "—";
  return ctx.positionNameById.get(positionId) ?? "—";
}
function isoOrNull(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

/** One row per in-scope review — REPORT 1 (§21). No unrelated employee-sensitive fields. */
function runReviewStatus(ctx: PerformanceReportContext): { columns: PerformanceReportColumn[]; rows: PerformanceReportRow[] } {
  const columns: PerformanceReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "cycle", label: "Cycle" },
    { key: "status", label: "Status" },
    { key: "reviewer", label: "Reviewer" },
    { key: "department", label: "Department" },
    { key: "position", label: "Position" },
    { key: "revisionNumber", label: "Revision" },
    { key: "selfAssessmentSubmittedAt", label: "Self-Assessment Submitted" },
    { key: "managerReviewSubmittedAt", label: "Manager Review Submitted" },
    { key: "hrFinalizedAt", label: "HR Finalized" },
    { key: "acknowledgedAt", label: "Acknowledged" },
  ];
  const rows: PerformanceReportRow[] = ctx.reviews.map((r) => ({
    employee: employeeLabel(ctx, r.employeeId),
    cycle: cycleLabel(ctx, r.cycleId),
    status: r.status,
    reviewer: employeeLabel(ctx, r.reviewerEmployeeId),
    department: departmentLabel(ctx, r.departmentIdSnapshot),
    position: positionLabel(ctx, r.positionIdSnapshot),
    revisionNumber: r.revisionNumber,
    selfAssessmentSubmittedAt: isoOrNull(r.selfAssessmentSubmittedAt),
    managerReviewSubmittedAt: isoOrNull(r.managerReviewSubmittedAt),
    hrFinalizedAt: isoOrNull(r.hrFinalizedAt),
    acknowledgedAt: isoOrNull(r.acknowledgedAt),
  }));
  return { columns, rows };
}

/** One row per in-scope review — REPORT 2 (§21). Manager score / HR override / effective score always kept distinct, per W79's own semantics; never recalculated here, always read from the review's own persisted columns. */
function runScores(ctx: PerformanceReportContext): { columns: PerformanceReportColumn[]; rows: PerformanceReportRow[] } {
  const columns: PerformanceReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "cycle", label: "Cycle" },
    { key: "managerScore", label: "Manager Score" },
    { key: "hrOverrideScore", label: "HR Override" },
    { key: "effectiveScore", label: "Effective Score" },
    { key: "status", label: "Status" },
    { key: "revisionNumber", label: "Revision" },
  ];
  const rows: PerformanceReportRow[] = ctx.reviews.map((r) => ({
    employee: employeeLabel(ctx, r.employeeId),
    cycle: cycleLabel(ctx, r.cycleId),
    managerScore: r.computedOverallScore,
    hrOverrideScore: r.hrOverrideScore,
    effectiveScore: r.hrOverrideScore ?? r.computedOverallScore,
    status: r.status,
    revisionNumber: r.revisionNumber,
  }));
  return { columns, rows };
}

/** One row per accepted goal across in-scope reviews — REPORT 3 (§21). Rejected/still-proposed goals are never included, per §21's own "official accepted goals only" scope; originType/approvalStatus exposed per §21's own amendment. */
async function runGoalResults(ctx: PerformanceReportContext): Promise<{ columns: PerformanceReportColumn[]; rows: PerformanceReportRow[] }> {
  const columns: PerformanceReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "cycle", label: "Cycle" },
    { key: "goal", label: "Goal" },
    { key: "measurementType", label: "Measurement Type" },
    { key: "target", label: "Target" },
    { key: "actualResult", label: "Actual Result" },
    { key: "computedScore", label: "Computed Score" },
    { key: "weight", label: "Weight" },
    { key: "notApplicable", label: "N/A" },
    { key: "originType", label: "Origin" },
    { key: "approvalStatus", label: "Approval Status" },
    { key: "reviewStatus", label: "Review Status" },
  ];
  if (ctx.reviews.length === 0) return { columns, rows: [] };

  const reviewById = new Map(ctx.reviews.map((r) => [r.id, r]));
  const goals = await db
    .select()
    .from(performanceReviewGoalsTable)
    .where(and(inArray(performanceReviewGoalsTable.reviewId, ctx.reviews.map((r) => r.id)), eq(performanceReviewGoalsTable.approvalStatus, "accepted")));

  const rows: PerformanceReportRow[] = goals.map((g) => {
    const review = reviewById.get(g.reviewId)!;
    return {
      employee: employeeLabel(ctx, review.employeeId),
      cycle: cycleLabel(ctx, review.cycleId),
      goal: g.title,
      measurementType: g.measurementType,
      target: g.target,
      actualResult: g.actualResult,
      computedScore: g.computedScore,
      weight: g.weight,
      notApplicable: g.notApplicable ? "Yes" : "No",
      originType: g.originType,
      approvalStatus: g.approvalStatus,
      reviewStatus: review.status,
    };
  });
  return { columns, rows };
}

const RUNNERS: Record<string, (ctx: PerformanceReportContext) => Promise<{ columns: PerformanceReportColumn[]; rows: PerformanceReportRow[] }> | { columns: PerformanceReportColumn[]; rows: PerformanceReportRow[] }> = {
  performance_review_status: runReviewStatus,
  performance_scores: runScores,
  performance_goal_results: runGoalResults,
};

export function isKnownPerformanceReportKey(key: string): boolean {
  return key in RUNNERS;
}

export async function runPerformanceReport(params: { key: string; label: string; description: string; ctx: PerformanceReportContext }): Promise<PerformanceReportResult> {
  const runner = RUNNERS[params.key];
  if (!runner) throw new PerformanceReportNotFoundError(params.key);

  const { columns, rows } = await runner(params.ctx);
  return {
    key: params.key,
    label: params.label,
    description: params.description,
    generatedAt: new Date(),
    columns,
    rows,
  };
}
