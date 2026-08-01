/**
 * Employee Self-Service Internal Applications (Phase 3A, W60): lets an
 * authenticated employee view internal vacancies and apply to them from
 * inside ESS (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §10/§11,
 * §23 W60). Database impact is explicitly "none" per the frozen plan's own
 * scope line — this file reuses `candidates`/`applications`/`vacancies`/
 * `employee_user_links` unchanged, adding no new table.
 *
 * Identity is always derived server-side: authenticated user -> active
 * organization membership -> `employee_user_links` (via
 * `resolveOwnEmployeeId`, the exact same W14/W33 mechanism every other ESS
 * and Recruitment-assigned-tier resolver in this codebase already reuses)
 * -> employee row. No route here ever accepts a client-supplied
 * employeeId/candidateId.
 *
 * Candidate resolution/linkage: an applying employee's `candidates` row is
 * resolved in priority order — (1) an existing row already linked via
 * `candidates.linkedInternalEmployeeId` (e.g. this employee was originally
 * hired through external recruitment and their original candidate record
 * survives per ADR "never hard-delete"); else (2) `findOrCreateCandidate`
 * (reused unchanged from candidateApplications.ts, W49) resolved by the
 * employee's own email, which is then linked going forward by setting
 * `linkedInternalEmployeeId` if it wasn't already set on some *other*
 * employee (a defensive no-op, never overwriting another employee's
 * provenance). This is the same "resolve-or-create, then permanently
 * link" shape W59's `convertApplicationToEmployee` established for the
 * reverse direction (employee -> candidate here, vs. candidate -> employee
 * there) — never touches any other field on an existing candidate row, so
 * external candidate data already on file is never overwritten. W59's own
 * conversion is never invoked from here — an internal application does
 * not change the employee record or create a second one.
 *
 * Vacancy eligibility mirrors `publicCareers.ts`'s own
 * `isVacancyPubliclyEligible` predicate exactly, with the visibility
 * condition inverted (`external`-only vacancies excluded instead of
 * `internal`-only) — `published` status, `openDate`/`closeDate` window,
 * per W47's own frozen status/visibility model. Only an `active` employee
 * may browse or apply (a deliberate, conservative reading of "the employee
 * is active" — no frozen rule distinguishes probation/on_leave/suspended
 * here, so the narrowest literal reading was chosen).
 *
 * Submission reuses the exact `applications` table and its own
 * `(candidateId, vacancyId)` unique constraint for duplicate/idempotent
 * handling (mirrors `submitPublicApplication`'s own "return the existing
 * row, no second write" rule) — internal applications enter W51's
 * existing pipeline unchanged, `source` marked `"internal_ess"` (the
 * table's own free-text, not-Master-Data-FK-validated column, same
 * convention as `candidate_documents.categoryCode`) so recruiters can
 * distinguish them, but no separate internal pipeline exists. No resume
 * upload is required (no document requirement is named anywhere in W60's
 * frozen scope) and no `candidate_consents` row is written (W60 names no
 * consent behavior at all, unlike W49's anonymous flow, which captures
 * consent because there is no other basis for processing an anonymous
 * applicant's data — an employee already has an existing employment
 * relationship). Screening answers reuse W52's existing optional
 * `application_answers` capture unchanged, since a vacancy's questions
 * apply uniformly regardless of applicant source.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  vacanciesTable,
  vacancyQuestionsTable,
  candidatesTable,
  applicationsTable,
  applicationAnswersTable,
  recruitmentStagesTable,
  jobRequisitionsTable,
  departmentsTable,
  type Vacancy,
  type Candidate,
  type Application,
  type VacancyQuestion,
  type Employee,
} from "@workspace/db";
import { generateToken } from "./auth";
import { findOrCreateCandidate } from "./candidateApplications";
import { recordAuditEvent } from "./auditLog";
import { resolveOwnEmployeeId } from "./leaveRequests";
import { getEmployeeById } from "./employees";

export class NotLinkedToEmployeeError extends Error {
  constructor() {
    super("No active employee link exists for this user in this organization");
    this.name = "NotLinkedToEmployeeError";
  }
}

export class EmployeeNotActiveError extends Error {
  constructor() {
    super("Only an active employee may browse or apply to internal vacancies");
    this.name = "EmployeeNotActiveError";
  }
}

export class VacancyNotEligibleForInternalApplyError extends Error {
  constructor() {
    super("Vacancy not found");
    this.name = "VacancyNotEligibleForInternalApplyError";
  }
}

export class EmployeeMissingEmailError extends Error {
  constructor() {
    super("Your profile has no email on file — contact HR before applying");
    this.name = "EmployeeMissingEmailError";
  }
}

/** Resolves "which employee is me" for the caller's active organization, and verifies they're active. Throws NotLinkedToEmployeeError/EmployeeNotActiveError rather than returning null — used by the one write action (submitInternalApplication), where a blocked precondition is a conventional 403, not a 200-with-flag response. */
async function resolveActiveOwnEmployee(organizationId: number, applicationUserId: number): Promise<Employee> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) throw new NotLinkedToEmployeeError();
  const employee = await getEmployeeById(organizationId, employeeId);
  if (!employee) throw new NotLinkedToEmployeeError();
  if (employee.employmentStatus !== "active") throw new EmployeeNotActiveError();
  return employee;
}

export interface OwnEmployeeLinkState {
  linked: boolean;
  /** Meaningful only when linked is true. */
  active: boolean;
  employee: Employee | null;
}

/** Non-throwing counterpart of resolveActiveOwnEmployee, for the two read (GET) endpoints — mirrors /me/employee's own established "linked: false" 200-OK controlled state (never a 403/error) rather than distinguishing "unlinked" from "not found" as separate failures. */
async function resolveOwnEmployeeLinkState(organizationId: number, applicationUserId: number): Promise<OwnEmployeeLinkState> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) return { linked: false, active: false, employee: null };
  const employee = await getEmployeeById(organizationId, employeeId);
  if (!employee) return { linked: false, active: false, employee: null };
  return { linked: true, active: employee.employmentStatus === "active", employee };
}

function isVacancyInternallyEligible(vacancy: Vacancy): boolean {
  if (vacancy.status !== "published") return false;
  if (vacancy.visibility === "external") return false;
  if (vacancy.openDate != null && vacancy.openDate.getTime() > Date.now()) return false;
  if (vacancy.closeDate != null && vacancy.closeDate.getTime() < Date.now()) return false;
  return true;
}

export interface InternalVacancyQuestion {
  id: number;
  questionText: string;
  questionType: VacancyQuestion["questionType"];
}

export interface InternalVacancySummary {
  publicId: string;
  title: string;
  departmentName: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  openingsCount: number;
  openDate: string | null;
  closeDate: string | null;
  jobDescription: string | null;
  responsibilities: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  // Deliberately excludes isKnockout/expectedAnswer (W52) — same rule as
  // the public DTO: an applicant must never learn which questions are
  // knockout-screened or what answer is "correct".
  questions: InternalVacancyQuestion[];
}

interface PlacementContext {
  requisitionById: Map<number, { departmentId: number | null; employmentType: string | null; workplaceType: string | null }>;
  departmentNameById: Map<number, string>;
}

async function loadPlacementContext(vacancies: Vacancy[]): Promise<PlacementContext> {
  const requisitionIds = [...new Set(vacancies.map((v) => v.requisitionId))];
  const requisitions = requisitionIds.length ? await db.select().from(jobRequisitionsTable).where(inArray(jobRequisitionsTable.id, requisitionIds)) : [];
  const requisitionById = new Map(requisitions.map((r) => [r.id, { departmentId: r.departmentId, employmentType: r.employmentType, workplaceType: r.workplaceType }]));

  const departmentIds = [...new Set(requisitions.map((r) => r.departmentId).filter((id): id is number => id != null))];
  const departments = departmentIds.length ? await db.select().from(departmentsTable).where(inArray(departmentsTable.id, departmentIds)) : [];
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  return { requisitionById, departmentNameById };
}

async function toInternalVacancySummary(vacancy: Vacancy, ctx: PlacementContext): Promise<InternalVacancySummary> {
  const placement = ctx.requisitionById.get(vacancy.requisitionId);
  const questions = await db
    .select()
    .from(vacancyQuestionsTable)
    .where(and(eq(vacancyQuestionsTable.vacancyId, vacancy.id), eq(vacancyQuestionsTable.isActive, true)));

  return {
    publicId: vacancy.publicId,
    title: vacancy.title,
    departmentName: placement?.departmentId != null ? (ctx.departmentNameById.get(placement.departmentId) ?? null) : null,
    employmentType: placement?.employmentType ?? null,
    workplaceType: placement?.workplaceType ?? null,
    openingsCount: vacancy.openingsCount,
    openDate: vacancy.openDate ? vacancy.openDate.toISOString() : null,
    closeDate: vacancy.closeDate ? vacancy.closeDate.toISOString() : null,
    jobDescription: vacancy.jobDescription,
    responsibilities: vacancy.responsibilities,
    requirements: vacancy.requirements,
    preferredQualifications: vacancy.preferredQualifications,
    questions: questions.sort((a, b) => a.displayOrder - b.displayOrder).map((q) => ({ id: q.id, questionText: q.questionText, questionType: q.questionType })),
  };
}

export interface InternalVacanciesResult {
  linked: boolean;
  active: boolean;
  items: InternalVacancySummary[];
}

/** Lists internally-eligible vacancies for the caller's own organization. Every field is deliberately restricted — no recruiter, hiring-manager, requisition, approval, or audit detail is ever included. Unlinked/inactive is a controlled 200-OK state (linked/active: false, items: []), never a 403. */
export async function listInternalVacancies(organizationId: number, applicationUserId: number): Promise<InternalVacanciesResult> {
  const linkState = await resolveOwnEmployeeLinkState(organizationId, applicationUserId);
  if (!linkState.linked || !linkState.active) {
    return { linked: linkState.linked, active: linkState.active, items: [] };
  }

  const rows = await db.select().from(vacanciesTable).where(eq(vacanciesTable.organizationId, organizationId));
  const eligible = rows.filter(isVacancyInternallyEligible);
  const ctx = await loadPlacementContext(eligible);
  const items = await Promise.all(eligible.map((v) => toInternalVacancySummary(v, ctx)));
  return { linked: true, active: true, items };
}

async function findEligibleVacancyForInternalApply(organizationId: number, vacancyPublicId: string): Promise<Vacancy | null> {
  const [vacancy] = await db
    .select()
    .from(vacanciesTable)
    .where(and(eq(vacanciesTable.organizationId, organizationId), eq(vacanciesTable.publicId, vacancyPublicId)))
    .limit(1);
  if (!vacancy || !isVacancyInternallyEligible(vacancy)) return null;
  return vacancy;
}

/** Resolves (or creates) the applying employee's candidate row and permanently links it, without ever overwriting another employee's existing link or any other candidate field. */
async function resolveOrCreateInternalCandidate(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  params: { organizationId: number; employee: Employee },
): Promise<Candidate> {
  const [alreadyLinked] = await tx
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.organizationId, params.organizationId), eq(candidatesTable.linkedInternalEmployeeId, params.employee.id)))
    .limit(1);
  if (alreadyLinked) return alreadyLinked;

  const email = params.employee.workEmail ?? params.employee.personalEmail;
  if (!email) throw new EmployeeMissingEmailError();

  const candidate = await findOrCreateCandidate(tx, {
    organizationId: params.organizationId,
    firstName: params.employee.firstName,
    lastName: params.employee.lastName,
    email,
    phone: params.employee.phoneNumber,
  });

  if (candidate.linkedInternalEmployeeId == null) {
    const [linked] = await tx
      .update(candidatesTable)
      .set({ linkedInternalEmployeeId: params.employee.id })
      .where(eq(candidatesTable.id, candidate.id))
      .returning();
    return linked;
  }

  // Already linked to a *different* employee (e.g. a shared/reused inbox) —
  // never overwritten; proceed with the resolved candidate row as-is.
  return candidate;
}

export interface InternalApplicationAnswerInput {
  vacancyQuestionId: number;
  answerText: string;
}

const KNOCKOUT_SCORABLE_TYPES: VacancyQuestion["questionType"][] = ["yes_no", "multiple_choice"];

function computeKnockoutFailed(question: VacancyQuestion, answerText: string): boolean {
  if (!question.isKnockout || question.expectedAnswer == null) return false;
  if (!KNOCKOUT_SCORABLE_TYPES.includes(question.questionType)) return false;
  return answerText.trim().toLowerCase() !== question.expectedAnswer.trim().toLowerCase();
}

/** Creates (or idempotently returns) the employee's own application against the given vacancy. Never trusts a client-supplied employeeId/candidateId/vacancy status — everything is re-derived and re-validated server-side. */
export async function submitInternalApplication(params: {
  organizationId: number;
  applicationUserId: number;
  actorMembershipId: number;
  vacancyPublicId: string;
  answers?: InternalApplicationAnswerInput[];
}): Promise<{ application: Application; isNew: boolean }> {
  const employee = await resolveActiveOwnEmployee(params.organizationId, params.applicationUserId);

  const vacancy = await findEligibleVacancyForInternalApply(params.organizationId, params.vacancyPublicId);
  if (!vacancy) throw new VacancyNotEligibleForInternalApplyError();

  const result = await db.transaction(async (tx) => {
    const candidate = await resolveOrCreateInternalCandidate(tx, { organizationId: params.organizationId, employee });

    const [existingApplication] = await tx
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.candidateId, candidate.id), eq(applicationsTable.vacancyId, vacancy.id)))
      .limit(1);
    if (existingApplication) {
      return { application: existingApplication, isNew: false };
    }

    const [application] = await tx
      .insert(applicationsTable)
      .values({
        organizationId: params.organizationId,
        candidateId: candidate.id,
        vacancyId: vacancy.id,
        publicId: generateToken(),
        source: "internal_ess",
      })
      .returning();

    if (params.answers?.length) {
      const questionIds = params.answers.map((a) => a.vacancyQuestionId);
      const questions = await tx
        .select()
        .from(vacancyQuestionsTable)
        .where(and(eq(vacancyQuestionsTable.vacancyId, vacancy.id), inArray(vacancyQuestionsTable.id, questionIds)));
      const questionById = new Map(questions.map((q) => [q.id, q]));

      const validAnswers = params.answers.filter((a) => questionById.has(a.vacancyQuestionId));
      if (validAnswers.length) {
        await tx.insert(applicationAnswersTable).values(
          validAnswers.map((a) => {
            const question = questionById.get(a.vacancyQuestionId)!;
            return {
              organizationId: params.organizationId,
              applicationId: application.id,
              vacancyQuestionId: a.vacancyQuestionId,
              answerText: a.answerText,
              knockoutFailed: computeKnockoutFailed(question, a.answerText),
            };
          }),
        );
      }
    }

    return { application, isNew: true };
  });

  if (result.isNew) {
    await recordAuditEvent({
      actorApplicationUserId: params.applicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "internal_application.submitted",
      targetType: "application",
      targetId: String(result.application.id),
      afterState: { vacancyId: vacancy.id, source: "internal_ess" },
    });
  }

  return result;
}

export interface OwnInternalApplicationSummary {
  id: number;
  vacancyTitle: string;
  currentStageCategory: string;
  submittedAt: string;
}

export interface OwnInternalApplicationsResult {
  linked: boolean;
  active: boolean;
  items: OwnInternalApplicationSummary[];
}

/** Lists only the caller's own internal applications — never another employee's. Resolved via the same linkedInternalEmployeeId established at submission time; an employee who has never applied internally simply has none. Same controlled 200-OK unlinked/inactive state as listInternalVacancies, for a uniform ESS experience. */
export async function listOwnInternalApplications(organizationId: number, applicationUserId: number): Promise<OwnInternalApplicationsResult> {
  const linkState = await resolveOwnEmployeeLinkState(organizationId, applicationUserId);
  if (!linkState.linked || !linkState.active || !linkState.employee) {
    return { linked: linkState.linked, active: linkState.active, items: [] };
  }
  const employee = linkState.employee;

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.organizationId, organizationId), eq(candidatesTable.linkedInternalEmployeeId, employee.id)))
    .limit(1);
  if (!candidate) return { linked: true, active: true, items: [] };

  const applications = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.organizationId, organizationId), eq(applicationsTable.candidateId, candidate.id)));
  if (!applications.length) return { linked: true, active: true, items: [] };

  const vacancyIds = [...new Set(applications.map((a) => a.vacancyId))];
  const vacancies = await db.select().from(vacanciesTable).where(inArray(vacanciesTable.id, vacancyIds));
  const vacancyById = new Map(vacancies.map((v) => [v.id, v]));

  const stageIds = applications.map((a) => a.currentStageId).filter((id): id is number => id != null);
  const stages = stageIds.length ? await db.select().from(recruitmentStagesTable).where(inArray(recruitmentStagesTable.id, stageIds)) : [];
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const items = applications.map((a) => ({
    id: a.id,
    vacancyTitle: vacancyById.get(a.vacancyId)?.title ?? "Unknown vacancy",
    currentStageCategory: (a.currentStageId != null ? stageById.get(a.currentStageId)?.category : undefined) ?? "applied",
    submittedAt: a.submittedAt.toISOString(),
  }));
  return { linked: true, active: true, items };
}
