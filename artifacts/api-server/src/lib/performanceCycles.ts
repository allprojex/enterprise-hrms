/**
 * Performance Cycles & Review Assignment (Phase 3C, W75): cycle CRUD +
 * lifecycle, and the "generate reviews" bulk-assignment action that
 * creates performance_reviews rows over W73's schema
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.5/§8.6/§10, §27).
 *
 * CYCLE LIFECYCLE: draft -> open -> closed -> archived (§10.5). A cycle is
 * freely editable while `draft`; once `open`/`closed`/`archived` its own
 * fields are frozen — only the forward status transitions themselves
 * (open->closed, closed->archived, or draft->archived to abandon an
 * unused draft) remain available, via the same update function with a
 * status-only patch. `open` can never be set directly through the update
 * route — it is exclusively a side effect of generateReviews (below).
 *
 * RECONCILIATION NOTE (rows 0+1 of §10.1, combined into one HR action):
 * §10.1 describes review assignment as two conceptually separate rows —
 * row 0 ("cycle `open` action -> `draft` rows created") and row 1
 * ("`draft` -> `self_assessment`", actor "HR (cycle-level 'open reviews'
 * action, or automatic at the cycle's self-assessment window start)").
 * §27's own frozen route list names exactly one mutation for this —
 * `POST .../cycles/:id/generate-reviews` — and no separate "open reviews"
 * endpoint exists anywhere in the frozen API surface; §10.5 also rules out
 * any cron/background-job-driven automatic transition in v1 ("HR triggers
 * this manually"). Reconciled here as ONE atomic HR action: generateReviews
 * both flips the cycle to `open` AND creates each review directly in
 * `self_assessment` status (never leaving an externally-observable `draft`
 * review row behind) — satisfying row 0's "draft rows created" as an
 * internal step of the same transaction and row 1's "cycle-level action"
 * in the same call, without inventing an endpoint the frozen plan doesn't
 * list or relying on infrastructure (cron) the frozen plan says isn't
 * available. Flagged here per this codebase's established
 * reconciliation-note convention rather than silently guessed.
 *
 * RECONCILIATION NOTE (goal snapshot): §10.1 row 0's own prose says
 * "goals/competencies snapshotted from template" — but per §8.4/§12,
 * templates own only COMPETENCIES (performance_template_competencies);
 * there is no performance_template_goals table anywhere in the frozen
 * 9-table schema, and §12 is explicit that "Goals are not reusable across
 * cycles as live objects... no goal-templating engine in v1." This
 * workstream's own brief independently confirms the same reading ("Do NOT
 * implement goal authoring/acceptance in W75... leave [the goal section]
 * empty... Do not create placeholder business goals"). Only COMPETENCIES
 * are snapshotted at assignment time here; no goal rows are created by
 * this workstream — W76 owns goal management entirely.
 *
 * ELIGIBILITY: "all_active" reads literally — employmentStatus === 'active'
 * only (not probation/on_leave/suspended/terminated), mirroring W60's own
 * "narrowest literal reading, no frozen rule distinguishes the other
 * statuses" precedent for internal-application eligibility. "manual" scope
 * requires an explicit employeeIds list in the request (still floor-
 * validated to active + same-org) since there is no criterion to
 * auto-resolve from.
 *
 * REVIEWER RESOLUTION: always employees.reportingManagerId, snapshotted
 * server-side at assignment time (§9) — never client-supplied, and the
 * frozen plan names no HR-override-reviewer mechanism for W75, so none is
 * built (an employee with no manager gets reviewerEmployeeId: null, per
 * the schema's own nullable column — visible only via performance.manage/
 * own tiers until a reviewer is otherwise established, a later
 * workstream's concern).
 */
import { and, eq, inArray, count, desc } from "drizzle-orm";
import {
  db,
  performanceCyclesTable,
  performanceReviewsTable,
  performanceReviewTemplatesTable,
  performanceTemplateCompetenciesTable,
  performanceReviewCompetenciesTable,
  performanceRatingScalesTable,
  employeesTable,
  departmentsTable,
  positionsTable,
  type PerformanceCycle,
  type PerformanceReview,
  type PerformanceReviewCompetency,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { getNamespaceConfig } from "../services/organizationConfig";

export class PerformanceCycleNotFoundError extends Error {
  constructor() {
    super("Performance cycle not found");
    this.name = "PerformanceCycleNotFoundError";
  }
}

export class PerformanceReviewNotFoundError extends Error {
  constructor() {
    super("Performance review not found");
    this.name = "PerformanceReviewNotFoundError";
  }
}

export class InvalidPerformanceCycleError extends Error {}

export class PerformanceCycleNotEditableError extends Error {
  constructor() {
    super("This cycle is no longer in draft status and its configuration can no longer be edited");
    this.name = "PerformanceCycleNotEditableError";
  }
}

export class InvalidPerformanceCycleTransitionError extends Error {}

export class PerformanceCycleNotDraftError extends Error {
  constructor() {
    super("This cycle has already been opened (or is closed/archived) — reviews can only be generated once, while the cycle is in draft status");
    this.name = "PerformanceCycleNotDraftError";
  }
}

export class InvalidPerformanceReviewAssignmentError extends Error {}

type ApplicabilityScope = "all_active" | "department" | "position" | "manual";
type CycleStatus = "draft" | "open" | "closed" | "archived";

const VALID_STATUS_TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  draft: ["archived"], // "open" is exclusively a side effect of generateReviews, never a direct PATCH.
  open: ["closed"],
  closed: ["archived"],
  archived: [],
};

async function findOwnCycle(organizationId: number, cycleId: number): Promise<PerformanceCycle | null> {
  const [row] = await db
    .select()
    .from(performanceCyclesTable)
    .where(and(eq(performanceCyclesTable.id, cycleId), eq(performanceCyclesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listCycles(organizationId: number): Promise<PerformanceCycle[]> {
  return db.select().from(performanceCyclesTable).where(eq(performanceCyclesTable.organizationId, organizationId));
}

export async function getCycleById(organizationId: number, cycleId: number): Promise<PerformanceCycle | null> {
  return findOwnCycle(organizationId, cycleId);
}

function parseDate(value: string | undefined | null, label: string): Date | null {
  if (value == null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new InvalidPerformanceCycleError(`${label} is not a valid date`);
  return d;
}

/** Structural date-window validation only — no cross-window sequencing rule is invented beyond "every window falls within the cycle's own start/end" (§27's own "no impossible overlap/order" instruction, read narrowly rather than inventing an unfrozen ordering policy). */
function validateDates(input: {
  startDate: string;
  endDate: string;
  selfAssessmentWindowStart?: string;
  selfAssessmentWindowEnd?: string;
  managerReviewWindowStart?: string;
  managerReviewWindowEnd?: string;
  hrFinalizationWindowStart?: string;
  hrFinalizationWindowEnd?: string;
}): void {
  const start = parseDate(input.startDate, "startDate")!;
  const end = parseDate(input.endDate, "endDate")!;
  if (start > end) throw new InvalidPerformanceCycleError("startDate must be on or before endDate");

  const windows: [string, string | undefined, string | undefined][] = [
    ["selfAssessmentWindow", input.selfAssessmentWindowStart, input.selfAssessmentWindowEnd],
    ["managerReviewWindow", input.managerReviewWindowStart, input.managerReviewWindowEnd],
    ["hrFinalizationWindow", input.hrFinalizationWindowStart, input.hrFinalizationWindowEnd],
  ];
  for (const [label, rawStart, rawEnd] of windows) {
    const windowStart = parseDate(rawStart, `${label}Start`);
    const windowEnd = parseDate(rawEnd, `${label}End`);
    if (windowStart && windowEnd && windowStart > windowEnd) {
      throw new InvalidPerformanceCycleError(`${label}Start must be on or before ${label}End`);
    }
    if (windowStart && (windowStart < start || windowStart > end)) {
      throw new InvalidPerformanceCycleError(`${label}Start must fall within the cycle's startDate/endDate range`);
    }
    if (windowEnd && (windowEnd < start || windowEnd > end)) {
      throw new InvalidPerformanceCycleError(`${label}End must fall within the cycle's startDate/endDate range`);
    }
  }
}

async function validateApplicability(
  organizationId: number,
  scope: ApplicabilityScope,
  departmentIds: number[] | undefined,
  positionIds: number[] | undefined,
): Promise<void> {
  if (scope === "department") {
    if (!departmentIds || departmentIds.length === 0) {
      throw new InvalidPerformanceCycleError("applicabilityDepartmentIds is required and must be non-empty when applicabilityScope is 'department'");
    }
    await Promise.all(departmentIds.map((id) => assertBelongsToOrganization(departmentsTable, id, organizationId, "Department")));
  }
  if (scope === "position") {
    if (!positionIds || positionIds.length === 0) {
      throw new InvalidPerformanceCycleError("applicabilityPositionIds is required and must be non-empty when applicabilityScope is 'position'");
    }
    await Promise.all(positionIds.map((id) => assertBelongsToOrganization(positionsTable, id, organizationId, "Position")));
  }
}

async function assertTemplateAndScaleUsable(organizationId: number, templateId: number, ratingScaleId: number): Promise<void> {
  const [[template], [scale]] = await Promise.all([
    db
      .select()
      .from(performanceReviewTemplatesTable)
      .where(and(eq(performanceReviewTemplatesTable.id, templateId), eq(performanceReviewTemplatesTable.organizationId, organizationId)))
      .limit(1),
    db
      .select()
      .from(performanceRatingScalesTable)
      .where(and(eq(performanceRatingScalesTable.id, ratingScaleId), eq(performanceRatingScalesTable.organizationId, organizationId)))
      .limit(1),
  ]);
  if (!template) throw new CrossOrganizationReferenceError("Review template");
  if (template.status !== "active") {
    throw new InvalidPerformanceCycleError("The selected review template must be 'active' (not draft or archived) to be used by a cycle");
  }
  if (!scale) throw new CrossOrganizationReferenceError("Rating scale");
  if (scale.status !== "active") {
    throw new InvalidPerformanceCycleError("The selected rating scale must be 'active' (not archived) to be used by a cycle");
  }
}

export interface CreatePerformanceCycleParams {
  organizationId: number;
  name: string;
  cycleType: "annual" | "semiannual" | "quarterly" | "monthly" | "probation" | "ad_hoc";
  startDate: string;
  endDate: string;
  selfAssessmentWindowStart?: string;
  selfAssessmentWindowEnd?: string;
  managerReviewWindowStart?: string;
  managerReviewWindowEnd?: string;
  hrFinalizationWindowStart?: string;
  hrFinalizationWindowEnd?: string;
  templateId: number;
  ratingScaleId: number;
  applicabilityScope: ApplicabilityScope;
  applicabilityDepartmentIds?: number[];
  applicabilityPositionIds?: number[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function createCycle(params: CreatePerformanceCycleParams): Promise<PerformanceCycle> {
  validateDates(params);
  await assertTemplateAndScaleUsable(params.organizationId, params.templateId, params.ratingScaleId);
  await validateApplicability(params.organizationId, params.applicabilityScope, params.applicabilityDepartmentIds, params.applicabilityPositionIds);

  const [cycle] = await db
    .insert(performanceCyclesTable)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      cycleType: params.cycleType,
      startDate: params.startDate,
      endDate: params.endDate,
      selfAssessmentWindowStart: params.selfAssessmentWindowStart ?? null,
      selfAssessmentWindowEnd: params.selfAssessmentWindowEnd ?? null,
      managerReviewWindowStart: params.managerReviewWindowStart ?? null,
      managerReviewWindowEnd: params.managerReviewWindowEnd ?? null,
      hrFinalizationWindowStart: params.hrFinalizationWindowStart ?? null,
      hrFinalizationWindowEnd: params.hrFinalizationWindowEnd ?? null,
      templateId: params.templateId,
      ratingScaleId: params.ratingScaleId,
      applicabilityScope: params.applicabilityScope,
      applicabilityDepartmentIds: params.applicabilityDepartmentIds ?? null,
      applicabilityPositionIds: params.applicabilityPositionIds ?? null,
      status: "draft",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_cycle.created",
    targetType: "performance_cycle",
    targetId: String(cycle.id),
    afterState: { name: cycle.name, status: cycle.status, startDate: cycle.startDate, endDate: cycle.endDate },
  });

  return cycle;
}

export interface UpdatePerformanceCycleParams {
  organizationId: number;
  cycleId: number;
  name?: string;
  cycleType?: "annual" | "semiannual" | "quarterly" | "monthly" | "probation" | "ad_hoc";
  startDate?: string;
  endDate?: string;
  selfAssessmentWindowStart?: string;
  selfAssessmentWindowEnd?: string;
  managerReviewWindowStart?: string;
  managerReviewWindowEnd?: string;
  hrFinalizationWindowStart?: string;
  hrFinalizationWindowEnd?: string;
  templateId?: number;
  ratingScaleId?: number;
  applicabilityScope?: ApplicabilityScope;
  applicabilityDepartmentIds?: number[];
  applicabilityPositionIds?: number[];
  status?: "closed" | "archived";
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function updateCycle(params: UpdatePerformanceCycleParams): Promise<PerformanceCycle> {
  const before = await findOwnCycle(params.organizationId, params.cycleId);
  if (!before) throw new PerformanceCycleNotFoundError();

  const fieldKeys: (keyof UpdatePerformanceCycleParams)[] = [
    "name", "cycleType", "startDate", "endDate",
    "selfAssessmentWindowStart", "selfAssessmentWindowEnd",
    "managerReviewWindowStart", "managerReviewWindowEnd",
    "hrFinalizationWindowStart", "hrFinalizationWindowEnd",
    "templateId", "ratingScaleId", "applicabilityScope",
    "applicabilityDepartmentIds", "applicabilityPositionIds",
  ];
  const editingFields = fieldKeys.some((k) => params[k] !== undefined);

  if (editingFields && before.status !== "draft") {
    throw new PerformanceCycleNotEditableError();
  }

  if (params.status !== undefined) {
    const allowed = VALID_STATUS_TRANSITIONS[before.status as CycleStatus] ?? [];
    if (!allowed.includes(params.status)) {
      throw new InvalidPerformanceCycleTransitionError(`Cannot transition a '${before.status}' cycle to '${params.status}'`);
    }
  }

  if (editingFields) {
    const merged = {
      startDate: params.startDate ?? before.startDate,
      endDate: params.endDate ?? before.endDate,
      selfAssessmentWindowStart: params.selfAssessmentWindowStart ?? before.selfAssessmentWindowStart ?? undefined,
      selfAssessmentWindowEnd: params.selfAssessmentWindowEnd ?? before.selfAssessmentWindowEnd ?? undefined,
      managerReviewWindowStart: params.managerReviewWindowStart ?? before.managerReviewWindowStart ?? undefined,
      managerReviewWindowEnd: params.managerReviewWindowEnd ?? before.managerReviewWindowEnd ?? undefined,
      hrFinalizationWindowStart: params.hrFinalizationWindowStart ?? before.hrFinalizationWindowStart ?? undefined,
      hrFinalizationWindowEnd: params.hrFinalizationWindowEnd ?? before.hrFinalizationWindowEnd ?? undefined,
    };
    validateDates(merged);

    const nextTemplateId = params.templateId ?? before.templateId;
    const nextRatingScaleId = params.ratingScaleId ?? before.ratingScaleId;
    if (params.templateId !== undefined || params.ratingScaleId !== undefined) {
      await assertTemplateAndScaleUsable(params.organizationId, nextTemplateId, nextRatingScaleId);
    }

    const nextScope = params.applicabilityScope ?? (before.applicabilityScope as ApplicabilityScope);
    if (params.applicabilityScope !== undefined || params.applicabilityDepartmentIds !== undefined || params.applicabilityPositionIds !== undefined) {
      await validateApplicability(
        params.organizationId,
        nextScope,
        params.applicabilityDepartmentIds ?? (before.applicabilityDepartmentIds as number[] | null) ?? undefined,
        params.applicabilityPositionIds ?? (before.applicabilityPositionIds as number[] | null) ?? undefined,
      );
    }
  }

  const patch: Record<string, unknown> = {};
  for (const key of fieldKeys) {
    if (params[key] !== undefined) patch[key] = params[key];
  }
  if (params.status !== undefined) patch.status = params.status;

  const [updated] = await db.update(performanceCyclesTable).set(patch).where(eq(performanceCyclesTable.id, params.cycleId)).returning();

  const eventType = params.status === "closed" ? "performance_cycle.closed" : params.status === "archived" ? "performance_cycle.archived" : "performance_cycle.updated";
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType,
    targetType: "performance_cycle",
    targetId: String(params.cycleId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

async function resolveEligibleEmployees(params: {
  organizationId: number;
  scope: ApplicabilityScope;
  departmentIds: number[] | null;
  positionIds: number[] | null;
  manualEmployeeIds: number[] | undefined;
}): Promise<(typeof employeesTable.$inferSelect)[]> {
  if (params.scope === "manual") {
    const ids = Array.from(new Set(params.manualEmployeeIds ?? []));
    if (ids.length === 0) {
      throw new InvalidPerformanceReviewAssignmentError("employeeIds is required and must be non-empty when the cycle's applicabilityScope is 'manual'");
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
      throw new InvalidPerformanceReviewAssignmentError(
        `Employee id(s) ${inactive.map((r) => r.id).join(", ")} are not active and cannot be assigned a review`,
      );
    }
    return rows;
  }

  const conditions = [eq(employeesTable.organizationId, params.organizationId), eq(employeesTable.employmentStatus, "active")];
  if (params.scope === "department" && params.departmentIds && params.departmentIds.length > 0) {
    conditions.push(inArray(employeesTable.departmentId, params.departmentIds));
  }
  if (params.scope === "position" && params.positionIds && params.positionIds.length > 0) {
    conditions.push(inArray(employeesTable.positionId, params.positionIds));
  }
  return db.select().from(employeesTable).where(and(...conditions));
}

export interface GenerateReviewsParams {
  organizationId: number;
  cycleId: number;
  employeeIds?: number[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export interface GenerateReviewsResult {
  cycle: PerformanceCycle;
  reviewsCreated: number;
  reviews: PerformanceReview[];
}

/**
 * Opens the cycle and creates one performance_reviews row per eligible
 * employee, each directly in `self_assessment` status with its
 * competencies snapshotted from the template (see file header
 * reconciliation notes). A single callable action, one time per cycle —
 * the `status = 'draft'` guard on the cycle-open UPDATE is what makes a
 * concurrent double-call safe (§10.3): the loser affects zero rows and
 * gets a clean 409, never a duplicate generation.
 */
export async function generateReviews(params: GenerateReviewsParams): Promise<GenerateReviewsResult> {
  const cycle = await findOwnCycle(params.organizationId, params.cycleId);
  if (!cycle) throw new PerformanceCycleNotFoundError();
  if (cycle.status !== "draft") throw new PerformanceCycleNotDraftError();

  const scope = cycle.applicabilityScope as ApplicabilityScope;
  const eligibleEmployees = await resolveEligibleEmployees({
    organizationId: params.organizationId,
    scope,
    departmentIds: cycle.applicabilityDepartmentIds as number[] | null,
    positionIds: cycle.applicabilityPositionIds as number[] | null,
    manualEmployeeIds: params.employeeIds,
  });

  const [template, performanceConfig] = await Promise.all([
    db
      .select()
      .from(performanceReviewTemplatesTable)
      .where(eq(performanceReviewTemplatesTable.id, cycle.templateId))
      .limit(1)
      .then((rows) => rows[0]),
    getNamespaceConfig(params.organizationId, "performance"),
  ]);
  if (!template) throw new PerformanceCycleNotFoundError(); // structurally unreachable (FK + create-time validation), defensive only

  const templateCompetencies = await db
    .select()
    .from(performanceTemplateCompetenciesTable)
    .where(eq(performanceTemplateCompetenciesTable.templateId, cycle.templateId))
    .orderBy(performanceTemplateCompetenciesTable.sortOrder);

  const scoringPrecision = (performanceConfig.data.scoringPrecision as number | undefined) ?? 0;
  const acknowledgementRequired = (performanceConfig.data.acknowledgementRequired as boolean | undefined) ?? true;

  const { updatedCycle, createdReviews, createdCompetencyCount } = await db.transaction(async (tx) => {
    const [openedCycle] = await tx
      .update(performanceCyclesTable)
      .set({ status: "open" })
      .where(and(eq(performanceCyclesTable.id, params.cycleId), eq(performanceCyclesTable.organizationId, params.organizationId), eq(performanceCyclesTable.status, "draft")))
      .returning();
    if (!openedCycle) throw new PerformanceCycleNotDraftError();

    const reviews: PerformanceReview[] = [];
    let competencyCount = 0;
    for (const employee of eligibleEmployees) {
      const [review] = await tx
        .insert(performanceReviewsTable)
        .values({
          organizationId: params.organizationId,
          cycleId: params.cycleId,
          templateId: cycle.templateId,
          ratingScaleId: cycle.ratingScaleId,
          employeeId: employee.id,
          reviewerEmployeeId: employee.reportingManagerId ?? null,
          departmentIdSnapshot: employee.departmentId ?? null,
          positionIdSnapshot: employee.positionId ?? null,
          goalsWeight: template.goalsWeight,
          competenciesWeight: template.competenciesWeight,
          scoringPrecisionSnapshot: scoringPrecision,
          acknowledgementRequiredSnapshot: acknowledgementRequired,
          status: "self_assessment",
        })
        .returning();
      reviews.push(review);

      if (templateCompetencies.length > 0) {
        await tx.insert(performanceReviewCompetenciesTable).values(
          templateCompetencies.map((c) => ({
            organizationId: params.organizationId,
            reviewId: review.id,
            label: c.label,
            description: c.description,
            weight: c.weight,
            sortOrder: c.sortOrder,
          })),
        );
        competencyCount += templateCompetencies.length;
      }
    }

    return { updatedCycle: openedCycle, createdReviews: reviews, createdCompetencyCount: competencyCount };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_cycle.opened",
    targetType: "performance_cycle",
    targetId: String(params.cycleId),
    metadata: { reviewsCreated: createdReviews.length, competenciesSnapshotted: createdCompetencyCount },
  });
  for (const review of createdReviews) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "performance_review.assigned",
      targetType: "performance_review",
      targetId: String(review.id),
      metadata: { cycleId: params.cycleId, employeeId: review.employeeId, reviewerEmployeeId: review.reviewerEmployeeId },
    });
  }

  return { cycle: updatedCycle, reviewsCreated: createdReviews.length, reviews: createdReviews };
}

export interface ListReviewsFilters {
  organizationId: number;
  cycleId?: number;
  employeeId?: number;
  status?: string;
  /**
   * W80 additions — all three filter on the review's own SNAPSHOT columns
   * (departmentIdSnapshot/positionIdSnapshot/reviewerEmployeeId), never a
   * live department/position/manager lookup, per §9's own historical-
   * integrity discipline: a transfer after assignment must not change
   * which reviews a department/position/reviewer filter surfaces.
   */
  departmentId?: number;
  positionId?: number;
  reviewerId?: number;
  page: number;
  pageSize: number;
}

export interface ListReviewsResult {
  items: PerformanceReview[];
  total: number;
  page: number;
  pageSize: number;
}

/** Org-wide, paginated, filterable list (§27's own "org-wide list, filterable" line) — matches employees.ts's own established {items,total,page,pageSize} pagination convention. */
export async function listReviews(filters: ListReviewsFilters): Promise<ListReviewsResult> {
  const conditions = [eq(performanceReviewsTable.organizationId, filters.organizationId)];
  if (filters.cycleId != null) conditions.push(eq(performanceReviewsTable.cycleId, filters.cycleId));
  if (filters.employeeId != null) conditions.push(eq(performanceReviewsTable.employeeId, filters.employeeId));
  if (filters.status != null) conditions.push(eq(performanceReviewsTable.status, filters.status as never));
  if (filters.departmentId != null) conditions.push(eq(performanceReviewsTable.departmentIdSnapshot, filters.departmentId));
  if (filters.positionId != null) conditions.push(eq(performanceReviewsTable.positionIdSnapshot, filters.positionId));
  if (filters.reviewerId != null) conditions.push(eq(performanceReviewsTable.reviewerEmployeeId, filters.reviewerId));
  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(performanceReviewsTable).where(where);
  const total = totalRow?.value ?? 0;

  const items = await db
    .select()
    .from(performanceReviewsTable)
    .where(where)
    .orderBy(desc(performanceReviewsTable.createdAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getReviewWithCompetencies(
  organizationId: number,
  reviewId: number,
): Promise<{ review: PerformanceReview; competencies: PerformanceReviewCompetency[] } | null> {
  const [review] = await db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.id, reviewId), eq(performanceReviewsTable.organizationId, organizationId)))
    .limit(1);
  if (!review) return null;
  const competencies = await db
    .select()
    .from(performanceReviewCompetenciesTable)
    .where(eq(performanceReviewCompetenciesTable.reviewId, reviewId))
    .orderBy(performanceReviewCompetenciesTable.sortOrder);
  return { review, competencies };
}
