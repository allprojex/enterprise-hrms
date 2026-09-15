/**
 * Application Pipeline & Stage Movement (Phase 3A, W51): internal review of
 * applications already created by W49's public apply flow — this
 * workstream never creates an application, only moves an existing one
 * through the org's own configured recruitment workflow
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §4.3/§4.4/§9). No
 * candidate-session ("own") tier exists — anonymous applicants never reach
 * these routes, consistent with W50's deferral (no candidate account/
 * session mechanism exists anywhere in this codebase).
 *
 * Stage model: stages are W44's existing, org-configurable
 * `recruitment_stages` (not a new hardcoded enum) — every stage maps to one
 * of the frozen plan's eight fixed categories (applied/screening/interview/
 * assessment/offer/hired/rejected/withdrawn), and system logic keys off
 * category, never an organization's own stage label. `hired`/`rejected`/
 * `withdrawn` are terminal — no further movement except the dedicated
 * `reopen` action. A fresh W49 application has `currentStageId = null`
 * (stage assignment was explicitly deferred to this workstream); the first
 * movement's history row has `fromStageId = null`, which the schema
 * anticipates.
 */
import { and, eq, inArray, asc, desc } from "drizzle-orm";
import {
  db,
  applicationsTable,
  applicationStageHistoryTable,
  applicationAnswersTable,
  vacancyQuestionsTable,
  candidatesTable,
  candidateDocumentsTable,
  vacanciesTable,
  jobRequisitionsTable,
  recruitmentStagesTable,
  type Application,
  type ApplicationStageHistory,
  type ApplicationAnswer,
  type ApplicationScore,
  type Candidate,
  type CandidateDocument,
  type Vacancy,
  type JobRequisition,
  type RecruitmentStage,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import {
  resolveRecruitmentActorEmployeeId,
  hasOrgWideRecruitmentAccess,
  isAssignedRecruitmentActor,
} from "./recruitmentAuthorization";
import { listApplicationScores, computeScoreRollup } from "./applicationScoring";

export class ApplicationNotFoundError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundError";
  }
}

export class InvalidStageTransitionError extends Error {}

const TERMINAL_CATEGORIES: RecruitmentStage["category"][] = ["hired", "rejected", "withdrawn"];

// --- Visibility (assigned recruiter/hiring manager via the linked requisition, organization-wide) ---
//
// Same two-tier model as W47's vacancies — the frozen plan's §7 permission
// matrix marks Applications as Assigned/Org-wide (no "own" tier reachable
// here; the matrix's own "own" cell is a candidate-session path W50
// deferred). An application carries no recruiter/hiring-manager column of
// its own, so the tier is resolved two hops out: application -> vacancy ->
// requisition.

export interface ApplicationVisibilityContext {
  isOrgWide: boolean;
  actorEmployeeId: number | null;
}

export async function resolveApplicationVisibilityContext(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<ApplicationVisibilityContext> {
  // Org-wide reach is signaled by holding either administrative permission
  // for this resource — `application.pipeline.move` (stage transitions,
  // W51) or `application.manage` (scoring, W52) — not just one of them.
  // Both are seeded together to org_admin/hr_manager/super_admin in
  // practice, but a caller legitimately holding only one (e.g. a scoped
  // integration role) must still see the application they're permitted to
  // act on, not just be allowed to act on it blind.
  const [isOrgWideByMove, isOrgWideByManage] = await Promise.all([
    hasOrgWideRecruitmentAccess(params.membershipId, "application.pipeline.move"),
    hasOrgWideRecruitmentAccess(params.membershipId, "application.manage"),
  ]);
  const actorEmployeeId = await resolveRecruitmentActorEmployeeId(params.organizationId, params.applicationUserId);
  return { isOrgWide: isOrgWideByMove || isOrgWideByManage, actorEmployeeId };
}

function isVisible(requisition: JobRequisition | undefined, ctx: ApplicationVisibilityContext): boolean {
  if (ctx.isOrgWide) return true;
  if (!requisition) return false;
  if (isAssignedRecruitmentActor(ctx.actorEmployeeId, requisition.recruiterEmployeeId)) return true;
  if (isAssignedRecruitmentActor(ctx.actorEmployeeId, requisition.hiringManagerEmployeeId)) return true;
  return false;
}

// --- Shared lookups ---

async function findApplicationInOrg(organizationId: number, applicationId: number): Promise<Application | null> {
  const [row] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findVacancyInOrg(organizationId: number, vacancyId: number): Promise<Vacancy | null> {
  const [row] = await db
    .select()
    .from(vacanciesTable)
    .where(and(eq(vacanciesTable.id, vacancyId), eq(vacanciesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findRequisitionInOrg(organizationId: number, requisitionId: number): Promise<JobRequisition | null> {
  const [row] = await db
    .select()
    .from(jobRequisitionsTable)
    .where(and(eq(jobRequisitionsTable.id, requisitionId), eq(jobRequisitionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findStageInOrg(organizationId: number, stageId: number): Promise<RecruitmentStage | null> {
  const [row] = await db
    .select()
    .from(recruitmentStagesTable)
    .where(and(eq(recruitmentStagesTable.id, stageId), eq(recruitmentStagesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** The workflow's active stages matching `category`, lowest displayOrder first — null if none configured. */
async function resolveStageForCategory(
  organizationId: number,
  workflowId: number,
  category: RecruitmentStage["category"],
): Promise<RecruitmentStage | null> {
  const rows = await db
    .select()
    .from(recruitmentStagesTable)
    .where(
      and(
        eq(recruitmentStagesTable.organizationId, organizationId),
        eq(recruitmentStagesTable.workflowId, workflowId),
        eq(recruitmentStagesTable.category, category),
        eq(recruitmentStagesTable.isActive, true),
      ),
    )
    .orderBy(asc(recruitmentStagesTable.displayOrder));
  return rows[0] ?? null;
}

// --- Reads ---

export interface ApplicationSummary {
  id: number;
  vacancyId: number;
  vacancyTitle: string;
  candidateId: number;
  candidateName: string;
  candidateEmail: string;
  currentStageId: number | null;
  currentStageName: string | null;
  currentStageCategory: RecruitmentStage["category"] | "applied";
  submittedAt: Date;
}

function toSummary(application: Application, vacancy: Vacancy | undefined, candidate: Candidate | undefined, stage: RecruitmentStage | undefined): ApplicationSummary {
  return {
    id: application.id,
    vacancyId: application.vacancyId,
    vacancyTitle: vacancy?.title ?? "Unknown vacancy",
    candidateId: application.candidateId,
    candidateName: candidate ? `${candidate.firstName} ${candidate.lastName}` : "Unknown candidate",
    candidateEmail: candidate?.email ?? "",
    currentStageId: application.currentStageId,
    currentStageName: stage?.name ?? null,
    // A never-triaged application (currentStageId null) reads as the
    // "applied" category for display purposes only — never stored.
    currentStageCategory: stage?.category ?? "applied",
    submittedAt: application.submittedAt,
  };
}

export interface ListApplicationsParams {
  organizationId: number;
  visibility: ApplicationVisibilityContext;
  vacancyId?: number;
  stageCategory?: string;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listApplications(params: ListApplicationsParams): Promise<{ items: ApplicationSummary[]; total: number }> {
  const conditions = [eq(applicationsTable.organizationId, params.organizationId)];
  if (params.vacancyId != null) conditions.push(eq(applicationsTable.vacancyId, params.vacancyId));

  const rows = await db
    .select()
    .from(applicationsTable)
    .where(and(...conditions))
    .orderBy(desc(applicationsTable.submittedAt));

  const vacancyIds = [...new Set(rows.map((r) => r.vacancyId))];
  const vacancies = vacancyIds.length ? await db.select().from(vacanciesTable).where(inArray(vacanciesTable.id, vacancyIds)) : [];
  const vacancyById = new Map(vacancies.map((v) => [v.id, v]));

  const requisitionIds = [...new Set(vacancies.map((v) => v.requisitionId))];
  const requisitions = requisitionIds.length ? await db.select().from(jobRequisitionsTable).where(inArray(jobRequisitionsTable.id, requisitionIds)) : [];
  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));

  const candidateIds = [...new Set(rows.map((r) => r.candidateId))];
  const candidates = candidateIds.length ? await db.select().from(candidatesTable).where(inArray(candidatesTable.id, candidateIds)) : [];
  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  const stageIds = [...new Set(rows.map((r) => r.currentStageId).filter((id): id is number => id != null))];
  const stages = stageIds.length ? await db.select().from(recruitmentStagesTable).where(inArray(recruitmentStagesTable.id, stageIds)) : [];
  const stageById = new Map(stages.map((s) => [s.id, s]));

  let visible = rows.filter((r) => {
    const vacancy = vacancyById.get(r.vacancyId);
    const requisition = vacancy ? requisitionById.get(vacancy.requisitionId) : undefined;
    return isVisible(requisition, params.visibility);
  });

  if (params.stageCategory) {
    visible = visible.filter((r) => {
      const stage = r.currentStageId != null ? stageById.get(r.currentStageId) : undefined;
      const category = stage?.category ?? "applied";
      return category === params.stageCategory;
    });
  }
  if (params.search) {
    const term = params.search.toLowerCase();
    visible = visible.filter((r) => {
      const candidate = candidateById.get(r.candidateId);
      if (!candidate) return false;
      return (
        candidate.email.toLowerCase().includes(term) ||
        `${candidate.firstName} ${candidate.lastName}`.toLowerCase().includes(term)
      );
    });
  }

  const total = visible.length;
  const start = (params.page - 1) * params.pageSize;
  const page = visible.slice(start, start + params.pageSize);
  return {
    items: page.map((r) => toSummary(r, vacancyById.get(r.vacancyId), candidateById.get(r.candidateId), r.currentStageId != null ? stageById.get(r.currentStageId) : undefined)),
    total,
  };
}

export interface ApplicationAnswerWithQuestion {
  id: number;
  vacancyQuestionId: number;
  questionText: string;
  answerText: string;
  knockoutFailed: boolean;
  createdAt: ApplicationAnswer["createdAt"];
}

export interface ApplicationDetail extends ApplicationSummary {
  candidatePhone: string | null;
  rejectionReasonCode: string | null;
  withdrawalReasonCode: string | null;
  documents: Pick<CandidateDocument, "id" | "categoryCode" | "fileName" | "mimeType" | "fileSize">[];
  history: ApplicationStageHistory[];
  answers: ApplicationAnswerWithQuestion[];
  // Immutable log of every score entry, newest first, plus the single
  // computed rollup value (§12) — never applications.score, which stays
  // permanently null/unused (see applicationScoring.ts).
  scores: ApplicationScore[];
  scoreRollup: number | null;
}

async function loadApplicationDetail(application: Application): Promise<ApplicationDetail> {
  const [vacancy, candidate, stage, documents, history, answerRows, scores] = await Promise.all([
    findVacancyInOrg(application.organizationId, application.vacancyId),
    db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, application.candidateId))
      .limit(1)
      .then((r) => r[0]),
    application.currentStageId != null ? findStageInOrg(application.organizationId, application.currentStageId) : Promise.resolve(null),
    db.select().from(candidateDocumentsTable).where(and(eq(candidateDocumentsTable.applicationId, application.id), eq(candidateDocumentsTable.isActive, true))),
    db.select().from(applicationStageHistoryTable).where(eq(applicationStageHistoryTable.applicationId, application.id)).orderBy(asc(applicationStageHistoryTable.movedAt)),
    db.select().from(applicationAnswersTable).where(eq(applicationAnswersTable.applicationId, application.id)),
    listApplicationScores(application.organizationId, application.id),
  ]);

  const questionIds = [...new Set(answerRows.map((a) => a.vacancyQuestionId))];
  const questions = questionIds.length ? await db.select().from(vacancyQuestionsTable).where(inArray(vacancyQuestionsTable.id, questionIds)) : [];
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const answers: ApplicationAnswerWithQuestion[] = answerRows.map((a) => ({
    id: a.id,
    vacancyQuestionId: a.vacancyQuestionId,
    questionText: questionById.get(a.vacancyQuestionId)?.questionText ?? "Unknown question",
    answerText: a.answerText,
    knockoutFailed: a.knockoutFailed,
    createdAt: a.createdAt,
  }));

  return {
    ...toSummary(application, vacancy ?? undefined, candidate, stage ?? undefined),
    candidatePhone: candidate?.phone ?? null,
    rejectionReasonCode: application.rejectionReasonCode,
    withdrawalReasonCode: application.withdrawalReasonCode,
    documents: documents.map((d) => ({ id: d.id, categoryCode: d.categoryCode, fileName: d.fileName, mimeType: d.mimeType, fileSize: d.fileSize })),
    history,
    answers,
    scores,
    scoreRollup: computeScoreRollup(scores),
  };
}

/** Returns null both when the application doesn't exist and when it exists but isn't visible to this caller — never distinguishing the two. */
export async function getVisibleApplicationById(
  organizationId: number,
  applicationId: number,
  visibility: ApplicationVisibilityContext,
): Promise<ApplicationDetail | null> {
  const application = await findApplicationInOrg(organizationId, applicationId);
  if (!application) return null;
  const vacancy = await findVacancyInOrg(organizationId, application.vacancyId);
  const requisition = vacancy ? await findRequisitionInOrg(organizationId, vacancy.requisitionId) : null;
  if (!isVisible(requisition ?? undefined, visibility)) return null;
  return loadApplicationDetail(application);
}

/**
 * Same visibility contract as getVisibleApplicationById, without loading the
 * detail DTO — for routes that expose data hanging off an application (hire
 * authorization, application-scoped custom field values) and only need the
 * yes/no answer. False both when the application doesn't exist and when it
 * isn't visible.
 */
export async function isApplicationVisible(
  organizationId: number,
  applicationId: number,
  visibility: ApplicationVisibilityContext,
): Promise<boolean> {
  const application = await findApplicationInOrg(organizationId, applicationId);
  if (!application) return false;
  const vacancy = await findVacancyInOrg(organizationId, application.vacancyId);
  const requisition = vacancy ? await findRequisitionInOrg(organizationId, vacancy.requisitionId) : null;
  return isVisible(requisition ?? undefined, visibility);
}

// --- Writes ---

interface MoveContext {
  application: Application;
  vacancy: Vacancy;
  currentStage: RecruitmentStage | null;
}

async function loadMoveContext(organizationId: number, applicationId: number): Promise<MoveContext> {
  const application = await findApplicationInOrg(organizationId, applicationId);
  if (!application) throw new ApplicationNotFoundError();
  const vacancy = await findVacancyInOrg(organizationId, application.vacancyId);
  if (!vacancy) throw new ApplicationNotFoundError();
  const currentStage = application.currentStageId != null ? await findStageInOrg(organizationId, application.currentStageId) : null;
  return { application, vacancy, currentStage };
}

function assertNotTerminal(currentStage: RecruitmentStage | null): void {
  if (currentStage && TERMINAL_CATEGORIES.includes(currentStage.category)) {
    throw new InvalidStageTransitionError("This application is in a terminal stage — reopen it before moving it further");
  }
}

async function applyMove(params: {
  organizationId: number;
  applicationId: number;
  fromStageId: number | null;
  toStage: RecruitmentStage;
  reason: string | null | undefined;
  fieldUpdates?: Partial<Pick<Application, "rejectionReasonCode" | "withdrawalReasonCode">>;
  actorApplicationUserId: number;
  actorMembershipId: number;
  eventType: string;
}): Promise<Application> {
  const updated = await db.transaction(async (tx) => {
    await tx.insert(applicationStageHistoryTable).values({
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      fromStageId: params.fromStageId,
      toStageId: params.toStage.id,
      movedByMembershipId: params.actorMembershipId,
      reason: params.reason ?? null,
    });

    const [row] = await tx
      .update(applicationsTable)
      .set({ currentStageId: params.toStage.id, ...params.fieldUpdates })
      .where(eq(applicationsTable.id, params.applicationId))
      .returning();
    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "application",
    targetId: String(params.applicationId),
    beforeState: { stageId: params.fromStageId },
    afterState: { stageId: params.toStage.id, category: params.toStage.category },
  });

  return updated;
}

/**
 * Moves an application to any active, non-terminal stage within its own
 * vacancy's workflow — server-side validated against that workflow's own
 * stage list, never a client-supplied "next stage" trusted as-is (§10).
 * Terminal categories (hired/rejected/withdrawn) are reachable only through
 * their own dedicated actions below, never through this generic action.
 */
export async function moveApplicationStage(params: {
  organizationId: number;
  applicationId: number;
  toStageId: number;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Application> {
  const { application, vacancy, currentStage } = await loadMoveContext(params.organizationId, params.applicationId);
  assertNotTerminal(currentStage);

  if (vacancy.workflowId == null) {
    throw new InvalidStageTransitionError("This vacancy has no configured recruitment workflow");
  }
  const toStage = await findStageInOrg(params.organizationId, params.toStageId);
  if (!toStage || toStage.workflowId !== vacancy.workflowId || !toStage.isActive) {
    throw new InvalidStageTransitionError("The target stage does not belong to this vacancy's workflow");
  }
  if (TERMINAL_CATEGORIES.includes(toStage.category)) {
    throw new InvalidStageTransitionError("Use reject, withdraw, or reopen to move into or out of a terminal stage");
  }

  return applyMove({
    organizationId: params.organizationId,
    applicationId: application.id,
    fromStageId: application.currentStageId,
    toStage,
    reason: params.comment,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "application.stage_changed",
  });
}

async function decideTerminal(params: {
  organizationId: number;
  applicationId: number;
  category: "rejected" | "withdrawn";
  reasonCode?: string | null;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Application> {
  const { application, vacancy, currentStage } = await loadMoveContext(params.organizationId, params.applicationId);
  assertNotTerminal(currentStage);

  if (vacancy.workflowId == null) {
    throw new InvalidStageTransitionError("This vacancy has no configured recruitment workflow");
  }
  const toStage = await resolveStageForCategory(params.organizationId, vacancy.workflowId, params.category);
  if (!toStage) {
    throw new InvalidStageTransitionError(`No ${params.category}-category stage is configured for this workflow`);
  }

  return applyMove({
    organizationId: params.organizationId,
    applicationId: application.id,
    fromStageId: application.currentStageId,
    toStage,
    reason: params.comment,
    fieldUpdates: params.category === "rejected" ? { rejectionReasonCode: params.reasonCode ?? null } : { withdrawalReasonCode: params.reasonCode ?? null },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: params.category === "rejected" ? "application.rejected" : "application.withdrawn",
  });
}

export async function rejectApplication(params: {
  organizationId: number;
  applicationId: number;
  reasonCode?: string | null;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Application> {
  return decideTerminal({ ...params, category: "rejected" });
}

export async function withdrawApplication(params: {
  organizationId: number;
  applicationId: number;
  reasonCode?: string | null;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Application> {
  return decideTerminal({ ...params, category: "withdrawn" });
}

/** Reopens a terminal (hired/rejected/withdrawn) application back to the workflow's "applied"-category stage, clearing any rejection/withdrawal reason. */
export async function reopenApplication(params: {
  organizationId: number;
  applicationId: number;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Application> {
  const { application, vacancy, currentStage } = await loadMoveContext(params.organizationId, params.applicationId);
  if (!currentStage || !TERMINAL_CATEGORIES.includes(currentStage.category)) {
    throw new InvalidStageTransitionError("Only an application in a terminal stage can be reopened");
  }
  if (vacancy.workflowId == null) {
    throw new InvalidStageTransitionError("This vacancy has no configured recruitment workflow");
  }
  const toStage = await resolveStageForCategory(params.organizationId, vacancy.workflowId, "applied");
  if (!toStage) {
    throw new InvalidStageTransitionError("No applied-category stage is configured for this workflow");
  }

  return applyMove({
    organizationId: params.organizationId,
    applicationId: application.id,
    fromStageId: application.currentStageId,
    toStage,
    reason: params.comment,
    fieldUpdates: { rejectionReasonCode: null, withdrawalReasonCode: null },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "application.reopened",
  });
}
