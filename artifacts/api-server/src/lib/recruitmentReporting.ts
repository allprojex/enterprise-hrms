/**
 * Recruitment Dashboard & Reporting (Phase 3A, W61):
 * docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §18/§23 (W61 row). Purely
 * read-only — computes metrics live from existing Recruitment tables on
 * every request; no aggregate/cache table, no stored dashboard total, no
 * recruitment-state mutation anywhere in this file. Mirrors
 * leaveDashboardMetrics.ts's (W40) read-model convention exactly: candidate
 * rows are fetched via a scoped WHERE and reduced in application code,
 * rather than introducing raw SQL aggregate functions as a new pattern.
 *
 * Visibility (§7's single "Recruitment reports" row — `recruitment.reports.read`,
 * Assigned "own workload/pipeline scope", Org-wide "✔"): org-wide reach is
 * signaled by holding `requisition.update`, the exact same org_admin/
 * hr_manager-only permission jobRequisitions.ts already established as the
 * "is this membership recruitment HR-admin" signal — reused here rather
 * than inventing a second one, since every org-wide Recruitment write
 * permission in this codebase's actual three-role model (org_admin/
 * hr_manager/employee) is seeded identically. An assigned recruiter/hiring
 * manager (a plain "employee" role holder, per every prior Recruitment
 * workstream's documented precedent) sees only their own workload/pipeline —
 * resolved by scoping every query to job_requisitions rows where
 * recruiterEmployeeId or hiringManagerEmployeeId equals their own linked
 * employee id, then following requisition -> vacancy -> application, the
 * same three-hop chain applicationPipeline.ts already uses. Holding
 * `recruitment.reports.read` alone (broadly seeded, like every other
 * Recruitment read permission) never yields organization-wide analytics.
 *
 * Privacy: no candidate name, email, phone, or other candidate-identifying
 * field appears anywhere in this file's output — every metric aggregates to
 * vacancy/requisition/stage/reason-code granularity, never a candidate row.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  jobRequisitionsTable,
  vacanciesTable,
  applicationsTable,
  applicationStageHistoryTable,
  recruitmentStagesTable,
  requisitionApprovalsTable,
  interviewsTable,
  offersTable,
  offerVersionsTable,
  employeesTable,
  type JobRequisition,
  type Vacancy,
  type Application,
  type RecruitmentStage,
} from "@workspace/db";
import { resolveRecruitmentActorEmployeeId, hasOrgWideRecruitmentAccess } from "./recruitmentAuthorization";

export class RecruitmentReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown recruitment report "${key}"`);
    this.name = "RecruitmentReportNotFoundError";
  }
}

// --- Visibility scope ---

export interface RecruitmentReportScope {
  isOrgWide: boolean;
  actorEmployeeId: number | null;
}

export async function resolveRecruitmentReportScope(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<RecruitmentReportScope> {
  const [isOrgWide, actorEmployeeId] = await Promise.all([
    hasOrgWideRecruitmentAccess(params.membershipId, "requisition.update"),
    resolveRecruitmentActorEmployeeId(params.organizationId, params.applicationUserId),
  ]);
  return { isOrgWide, actorEmployeeId };
}

// --- Scoped read context (requisitions/vacancies resolved once per request, reused by every metric) ---

export interface RecruitmentReportContext {
  organizationId: number;
  scope: RecruitmentReportScope;
  requisitions: JobRequisition[];
  vacancies: Vacancy[];
  vacancyIds: number[];
}

export async function buildRecruitmentReportContext(organizationId: number, scope: RecruitmentReportScope): Promise<RecruitmentReportContext> {
  let requisitions: JobRequisition[];
  if (scope.isOrgWide) {
    requisitions = await db.select().from(jobRequisitionsTable).where(eq(jobRequisitionsTable.organizationId, organizationId));
  } else if (scope.actorEmployeeId == null) {
    requisitions = [];
  } else {
    requisitions = await db
      .select()
      .from(jobRequisitionsTable)
      .where(
        and(
          eq(jobRequisitionsTable.organizationId, organizationId),
          or(
            eq(jobRequisitionsTable.recruiterEmployeeId, scope.actorEmployeeId),
            eq(jobRequisitionsTable.hiringManagerEmployeeId, scope.actorEmployeeId),
          ),
        ),
      );
  }

  const vacancies = requisitions.length
    ? await db
        .select()
        .from(vacanciesTable)
        .where(and(eq(vacanciesTable.organizationId, organizationId), inArray(vacanciesTable.requisitionId, requisitions.map((r) => r.id))))
    : [];

  return { organizationId, scope, requisitions, vacancies, vacancyIds: vacancies.map((v) => v.id) };
}

async function getScopedApplications(ctx: RecruitmentReportContext): Promise<Application[]> {
  if (ctx.vacancyIds.length === 0) return [];
  return db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.organizationId, ctx.organizationId), inArray(applicationsTable.vacancyId, ctx.vacancyIds)));
}

async function getOrgStages(organizationId: number): Promise<Map<number, RecruitmentStage>> {
  const stages = await db.select().from(recruitmentStagesTable).where(eq(recruitmentStagesTable.organizationId, organizationId));
  return new Map(stages.map((s) => [s.id, s]));
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

// --- Dashboard (GET .../recruitment/dashboard) ---

export interface RecruitmentStageBreakdownItem {
  stageId: number | null;
  stageName: string;
  category: RecruitmentStage["category"] | "applied";
  count: number;
}

export interface RecruitmentWorkloadItem {
  employeeId: number;
  employeeName: string;
  openRequisitionsCount: number;
}

export interface RecruitmentDashboard {
  openRequisitionsCount: number;
  openVacanciesCount: number;
  totalApplicantsCount: number;
  candidatesByStage: RecruitmentStageBreakdownItem[];
  recruiterWorkload: RecruitmentWorkloadItem[];
  hiringManagerWorkload: RecruitmentWorkloadItem[];
}

/**
 * "Open" is defined narrowly against this codebase's actual reachable
 * status set (see this file's header on job_requisitions.status never
 * reaching "filled"/"partially_filled" anywhere in the current pipeline):
 * a requisition is open once approved (actively being recruited for) and
 * until it leaves that status; a vacancy is open once published. draft/
 * pending_approval requisitions and draft/scheduled/paused/closed/archived
 * vacancies are deliberately excluded — not yet, or no longer, open.
 */
async function computeOpenCounts(ctx: RecruitmentReportContext): Promise<{ openRequisitionsCount: number; openVacanciesCount: number }> {
  return {
    openRequisitionsCount: ctx.requisitions.filter((r) => r.status === "approved").length,
    openVacanciesCount: ctx.vacancies.filter((v) => v.status === "published").length,
  };
}

async function computeCandidatesByStage(ctx: RecruitmentReportContext, applications: Application[], stages: Map<number, RecruitmentStage>): Promise<RecruitmentStageBreakdownItem[]> {
  const buckets = new Map<string, RecruitmentStageBreakdownItem>();
  for (const application of applications) {
    const stage = application.currentStageId != null ? stages.get(application.currentStageId) : undefined;
    // A never-triaged application (currentStageId null) reads as the
    // "applied" category, mirroring applicationPipeline.ts's toSummary
    // precedent exactly — never stored, display-only.
    const key = stage ? String(stage.id) : "unstaged";
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, {
        stageId: stage?.id ?? null,
        stageName: stage?.name ?? "Applied (unstaged)",
        category: stage?.category ?? "applied",
        count: 1,
      });
    }
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

async function computeWorkload(ctx: RecruitmentReportContext, field: "recruiterEmployeeId" | "hiringManagerEmployeeId"): Promise<RecruitmentWorkloadItem[]> {
  const counts = new Map<number, number>();
  for (const req of ctx.requisitions) {
    if (req.status !== "approved") continue;
    const employeeId = req[field];
    if (employeeId == null) continue;
    counts.set(employeeId, (counts.get(employeeId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const employeeIds = [...counts.keys()];
  const employees = await db
    .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
    .from(employeesTable)
    .where(inArray(employeesTable.id, employeeIds));
  const nameById = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

  return [...counts.entries()]
    .map(([employeeId, openRequisitionsCount]) => ({ employeeId, employeeName: nameById.get(employeeId) ?? "Unknown employee", openRequisitionsCount }))
    .sort((a, b) => b.openRequisitionsCount - a.openRequisitionsCount);
}

export async function getRecruitmentDashboard(ctx: RecruitmentReportContext): Promise<RecruitmentDashboard> {
  const [openCounts, applications, stages] = await Promise.all([computeOpenCounts(ctx), getScopedApplications(ctx), getOrgStages(ctx.organizationId)]);
  const [candidatesByStage, recruiterWorkload, hiringManagerWorkload] = await Promise.all([
    computeCandidatesByStage(ctx, applications, stages),
    computeWorkload(ctx, "recruiterEmployeeId"),
    computeWorkload(ctx, "hiringManagerEmployeeId"),
  ]);

  return {
    ...openCounts,
    totalApplicantsCount: applications.length,
    candidatesByStage,
    recruiterWorkload,
    hiringManagerWorkload,
  };
}

// --- Reports (GET .../recruitment/reports/:reportKey) ---

export interface RecruitmentReportColumn {
  key: string;
  label: string;
}

export type RecruitmentReportRow = Record<string, string | number | null>;

export interface RecruitmentReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: RecruitmentReportColumn[];
  rows: RecruitmentReportRow[];
}

async function runApplicantsByVacancy(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const applications = await getScopedApplications(ctx);
  const vacancyById = new Map(ctx.vacancies.map((v) => [v.id, v]));
  const counts = new Map<number, number>();
  for (const application of applications) counts.set(application.vacancyId, (counts.get(application.vacancyId) ?? 0) + 1);

  return {
    columns: [
      { key: "vacancy", label: "Vacancy" },
      { key: "count", label: "Applicants" },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([vacancyId, count]) => ({ vacancy: vacancyById.get(vacancyId)?.title ?? "Unknown vacancy", count })),
  };
}

async function runApplicantsBySource(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const applications = await getScopedApplications(ctx);
  const counts = new Map<string, number>();
  for (const application of applications) counts.set(application.source, (counts.get(application.source) ?? 0) + 1);

  return {
    columns: [
      { key: "source", label: "Source" },
      { key: "count", label: "Applicants" },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
  };
}

/**
 * "Open" = the requisition's single-step approval decision (§9's
 * requisition_approvals, mirrors requisitionApprovals.ts's own
 * decidedAt-on-approval precedent). "Filled" = job_requisitions.status =
 * "filled" — a status this codebase's current pipeline never actually
 * writes (see this file's header), so this report's rows are honestly
 * empty until a future fulfillment workstream starts setting it; no
 * timestamp is manufactured to compensate.
 */
async function runTimeToFill(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const filled = ctx.requisitions.filter((r) => r.status === "filled");
  const columns: RecruitmentReportColumn[] = [
    { key: "requisition", label: "Requisition" },
    { key: "daysToFill", label: "Days to Fill" },
  ];
  if (filled.length === 0) return { columns, rows: [] };

  const approvals = await db
    .select()
    .from(requisitionApprovalsTable)
    .where(and(inArray(requisitionApprovalsTable.requisitionId, filled.map((r) => r.id)), eq(requisitionApprovalsTable.decision, "approved")));
  const approvedAtByRequisition = new Map(approvals.filter((a) => a.decidedAt != null).map((a) => [a.requisitionId, a.decidedAt as Date]));

  const rows: RecruitmentReportRow[] = [];
  for (const requisition of filled) {
    const approvedAt = approvedAtByRequisition.get(requisition.id);
    if (!approvedAt) continue;
    rows.push({ requisition: requisition.title, daysToFill: Math.round(daysBetween(approvedAt, requisition.updatedAt)) });
  }
  return { columns, rows };
}

function resolveHiredStageIds(stages: Map<number, RecruitmentStage>): Set<number> {
  return new Set([...stages.values()].filter((s) => s.category === "hired").map((s) => s.id));
}

/** "Hired" entry timestamp = the latest application_stage_history row moving into a hired-category stage — application_stage_history is the only place stage transitions are recorded (applicationPipeline.ts's own documented invariant). */
async function runTimeToHire(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const columns: RecruitmentReportColumn[] = [
    { key: "vacancy", label: "Vacancy" },
    { key: "hiredCount", label: "Hired" },
    { key: "avgDaysToHire", label: "Avg. Days to Hire" },
  ];
  const applications = await getScopedApplications(ctx);
  if (applications.length === 0) return { columns, rows: [] };

  const stages = await getOrgStages(ctx.organizationId);
  const hiredStageIds = resolveHiredStageIds(stages);
  const hiredApplications = applications.filter((a) => a.currentStageId != null && hiredStageIds.has(a.currentStageId));
  if (hiredApplications.length === 0) return { columns, rows: [] };

  const history = await db
    .select()
    .from(applicationStageHistoryTable)
    .where(
      and(
        inArray(applicationStageHistoryTable.applicationId, hiredApplications.map((a) => a.id)),
        inArray(applicationStageHistoryTable.toStageId, [...hiredStageIds]),
      ),
    );
  const hiredAtByApplication = new Map<number, Date>();
  for (const row of history) {
    const existing = hiredAtByApplication.get(row.applicationId);
    if (!existing || row.movedAt > existing) hiredAtByApplication.set(row.applicationId, row.movedAt);
  }

  const vacancyById = new Map(ctx.vacancies.map((v) => [v.id, v]));
  const daysByVacancy = new Map<number, number[]>();
  for (const application of hiredApplications) {
    const hiredAt = hiredAtByApplication.get(application.id);
    if (!hiredAt) continue;
    const days = daysBetween(application.submittedAt, hiredAt);
    const list = daysByVacancy.get(application.vacancyId) ?? [];
    list.push(days);
    daysByVacancy.set(application.vacancyId, list);
  }

  return {
    columns,
    rows: [...daysByVacancy.entries()].map(([vacancyId, days]) => ({
      vacancy: vacancyById.get(vacancyId)?.title ?? "Unknown vacancy",
      hiredCount: days.length,
      avgDaysToHire: average(days),
    })),
  };
}

const NON_TERMINAL_CATEGORIES: ReadonlySet<RecruitmentStage["category"] | "applied"> = new Set(["applied", "screening", "interview", "assessment", "offer"]);

/** "Entered current stage at" = the most recent application_stage_history row for the application, falling back to submittedAt for a never-moved (currentStageId null) application. */
async function runAgeInStage(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const columns: RecruitmentReportColumn[] = [
    { key: "stage", label: "Stage" },
    { key: "count", label: "Applications" },
    { key: "avgAgeDays", label: "Avg. Age (days)" },
  ];
  const applications = await getScopedApplications(ctx);
  if (applications.length === 0) return { columns, rows: [] };

  const stages = await getOrgStages(ctx.organizationId);
  const openApplications = applications.filter((a) => {
    const category = a.currentStageId != null ? stages.get(a.currentStageId)?.category : "applied";
    return category != null && NON_TERMINAL_CATEGORIES.has(category);
  });
  if (openApplications.length === 0) return { columns, rows: [] };

  const history = await db
    .select()
    .from(applicationStageHistoryTable)
    .where(inArray(applicationStageHistoryTable.applicationId, openApplications.map((a) => a.id)));
  const lastMoveByApplication = new Map<number, Date>();
  for (const row of history) {
    const existing = lastMoveByApplication.get(row.applicationId);
    if (!existing || row.movedAt > existing) lastMoveByApplication.set(row.applicationId, row.movedAt);
  }

  const now = new Date();
  const buckets = new Map<string, { label: string; ages: number[] }>();
  for (const application of openApplications) {
    const stage = application.currentStageId != null ? stages.get(application.currentStageId) : undefined;
    const key = stage ? String(stage.id) : "unstaged";
    const label = stage?.name ?? "Applied (unstaged)";
    const enteredAt = lastMoveByApplication.get(application.id) ?? application.submittedAt;
    const bucket = buckets.get(key) ?? { label, ages: [] };
    bucket.ages.push(daysBetween(enteredAt, now));
    buckets.set(key, bucket);
  }

  return {
    columns,
    rows: [...buckets.values()].map((b) => ({ stage: b.label, count: b.ages.length, avgAgeDays: average(b.ages) })),
  };
}

const FUNNEL_CATEGORIES: readonly (RecruitmentStage["category"] | "applied")[] = ["applied", "screening", "interview", "assessment", "offer", "hired"];

/** Sequential funnel over the six non-terminal-outcome categories, each stage's "reached" count taken from distinct applications with a stage_history row of that category ("applied" is every application, by definition). rejected/withdrawn are reported separately as terminal outcomes, not part of the sequential chain. */
async function runConversionFunnel(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const columns: RecruitmentReportColumn[] = [
    { key: "stage", label: "Stage" },
    { key: "reachedCount", label: "Reached" },
    { key: "conversionFromPreviousPercent", label: "Conversion from Previous (%)" },
  ];
  const applications = await getScopedApplications(ctx);
  if (applications.length === 0) return { columns, rows: [] };

  const stages = await getOrgStages(ctx.organizationId);

  const history = await db
    .select()
    .from(applicationStageHistoryTable)
    .where(inArray(applicationStageHistoryTable.applicationId, applications.map((a) => a.id)));

  const reachedByCategory = new Map<string, Set<number>>();
  for (const row of history) {
    const stage = stages.get(row.toStageId);
    if (!stage) continue;
    const set = reachedByCategory.get(stage.category) ?? new Set<number>();
    set.add(row.applicationId);
    reachedByCategory.set(stage.category, set);
  }

  const rows: RecruitmentReportRow[] = [];
  let previousCount: number | null = null;
  for (const category of FUNNEL_CATEGORIES) {
    const reachedCount = category === "applied" ? applications.length : (reachedByCategory.get(category)?.size ?? 0);
    rows.push({
      stage: category,
      reachedCount,
      conversionFromPreviousPercent: previousCount == null ? null : percent(reachedCount, previousCount),
    });
    previousCount = reachedCount;
  }

  for (const outcome of ["rejected", "withdrawn"] as const) {
    rows.push({ stage: outcome, reachedCount: reachedByCategory.get(outcome)?.size ?? 0, conversionFromPreviousPercent: null });
  }

  return { columns, rows };
}

async function runInterviewToOfferRatio(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const columns: RecruitmentReportColumn[] = [
    { key: "applicationsInterviewedCount", label: "Applications Interviewed" },
    { key: "applicationsWithOfferCount", label: "Applications with an Offer" },
    { key: "ratioPercent", label: "Interview-to-Offer Ratio (%)" },
  ];
  const applications = await getScopedApplications(ctx);
  if (applications.length === 0) return { columns, rows: [{ applicationsInterviewedCount: 0, applicationsWithOfferCount: 0, ratioPercent: null }] };

  const applicationIds = applications.map((a) => a.id);
  const [interviewed, offered] = await Promise.all([
    db.select({ applicationId: interviewsTable.applicationId }).from(interviewsTable).where(inArray(interviewsTable.applicationId, applicationIds)),
    db.select({ applicationId: offersTable.applicationId }).from(offersTable).where(inArray(offersTable.applicationId, applicationIds)),
  ]);
  const interviewedCount = new Set(interviewed.map((i) => i.applicationId)).size;
  const offeredCount = new Set(offered.map((o) => o.applicationId)).size;

  return {
    columns,
    rows: [{ applicationsInterviewedCount: interviewedCount, applicationsWithOfferCount: offeredCount, ratioPercent: percent(offeredCount, interviewedCount) }],
  };
}

/** accepted/declined are schema-valid offer_version statuses with no candidate-facing route that ever sets them anywhere in this codebase (see offers.ts's own documented scope boundary) — this report is honestly empty/null until that flow exists, never fabricated. */
async function runOfferAcceptanceRate(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const columns: RecruitmentReportColumn[] = [
    { key: "offersAccepted", label: "Accepted" },
    { key: "offersDeclined", label: "Declined" },
    { key: "acceptanceRatePercent", label: "Acceptance Rate (%)" },
  ];
  const applications = await getScopedApplications(ctx);
  if (applications.length === 0) return { columns, rows: [{ offersAccepted: 0, offersDeclined: 0, acceptanceRatePercent: null }] };

  const offers = await db
    .select({ id: offersTable.id })
    .from(offersTable)
    .where(inArray(offersTable.applicationId, applications.map((a) => a.id)));
  if (offers.length === 0) return { columns, rows: [{ offersAccepted: 0, offersDeclined: 0, acceptanceRatePercent: null }] };

  const versions = await db
    .select({ status: offerVersionsTable.status })
    .from(offerVersionsTable)
    .where(and(inArray(offerVersionsTable.offerId, offers.map((o) => o.id)), inArray(offerVersionsTable.status, ["accepted", "declined"])));
  const accepted = versions.filter((v) => v.status === "accepted").length;
  const declined = versions.filter((v) => v.status === "declined").length;

  return { columns, rows: [{ offersAccepted: accepted, offersDeclined: declined, acceptanceRatePercent: percent(accepted, accepted + declined) }] };
}

async function runRejectionReasons(ctx: RecruitmentReportContext): Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }> {
  const applications = await getScopedApplications(ctx);
  const counts = new Map<string, number>();
  for (const application of applications) {
    if (!application.rejectionReasonCode) continue;
    counts.set(application.rejectionReasonCode, (counts.get(application.rejectionReasonCode) ?? 0) + 1);
  }

  return {
    columns: [
      { key: "reasonCode", label: "Rejection Reason" },
      { key: "count", label: "Applications" },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reasonCode, count]) => ({ reasonCode, count })),
  };
}

const RUNNERS: Record<string, (ctx: RecruitmentReportContext) => Promise<{ columns: RecruitmentReportColumn[]; rows: RecruitmentReportRow[] }>> = {
  recruitment_applicants_by_vacancy: runApplicantsByVacancy,
  recruitment_applicants_by_source: runApplicantsBySource,
  recruitment_time_to_fill: runTimeToFill,
  recruitment_time_to_hire: runTimeToHire,
  recruitment_age_in_stage: runAgeInStage,
  recruitment_conversion_funnel: runConversionFunnel,
  recruitment_interview_to_offer_ratio: runInterviewToOfferRatio,
  recruitment_offer_acceptance_rate: runOfferAcceptanceRate,
  recruitment_rejection_reasons: runRejectionReasons,
};

export function isKnownRecruitmentReportKey(key: string): boolean {
  return key in RUNNERS;
}

export async function runRecruitmentReport(params: {
  key: string;
  label: string;
  description: string;
  ctx: RecruitmentReportContext;
}): Promise<RecruitmentReportResult> {
  const runner = RUNNERS[params.key];
  if (!runner) throw new RecruitmentReportNotFoundError(params.key);

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
