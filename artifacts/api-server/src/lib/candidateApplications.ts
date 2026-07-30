/**
 * Public application submission (Phase 3A, W49 — Public Careers Portal;
 * answer capture added in W52 — Screening Questions & Scoring).
 * "Applications (submission only)" per the frozen plan's own W49 scope note
 * — creating a candidate/application/consent/document is this workstream's
 * job; pipeline movement (W51) and scoring (W52, see applicationScoring.ts)
 * are separate workstreams. `duplicateCandidatePolicy` (W44) is read but
 * not yet enforced here for the same reason — with no terminal application
 * state reachable in this workstream, there is nothing yet for either
 * setting to meaningfully act on; both are wired through unchanged for a
 * later workstream to start honoring.
 *
 * Answer capture (W52): submitted alongside the original apply fields, not
 * a separate endpoint — the frozen plan's own API impact line for W52 is
 * explicit that "answers [are] captured at W49's apply endpoint." Knockout
 * evaluation happens here, at submission time, against
 * `vacancyQuestions.expectedAnswer` (§12) — but only for yes_no/
 * multiple_choice questions, and a failed knockout only flags the answer
 * row for recruiter review; it never auto-rejects the application (§12 is
 * explicit that automatic rejection on a possibly-miskeyed expected answer
 * is a real failure mode worth a human check).
 */
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  candidateConsentsTable,
  candidateDocumentsTable,
  applicationsTable,
  applicationAnswersTable,
  vacanciesTable,
  vacancyQuestionsTable,
  type Candidate,
  type Application,
  type VacancyQuestion,
} from "@workspace/db";
import { generateToken } from "./auth";
import { validateDocumentUpload, InvalidDocumentError } from "./documentValidation";
import { writeOrgFile } from "./fileStorage";
import { getEmailProvider } from "./email";
import { getRecruitmentSettings } from "./recruitmentSettings";
import { logger } from "./logger";

export { InvalidDocumentError };

export class ApplicationLimitExceededError extends Error {
  constructor() {
    super("You've reached the maximum number of open applications with this organization");
    this.name = "ApplicationLimitExceededError";
  }
}

// A simple version marker, not a content-management system — there is no
// dedicated privacy-notice authoring surface anywhere in this codebase yet.
// Bumping this string is how a future change would be recorded as a new
// version against new consents; existing consent rows are never
// reinterpreted against a later version (Historical Consistency).
const PRIVACY_NOTICE_VERSION = "v1";

function buildConsentText(organizationName: string): string {
  return `By submitting this application, you consent to ${organizationName} processing the personal data you provide (including your uploaded documents) for the purpose of evaluating this and related job applications.`;
}

const STATUS_CHECK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — long enough to cover a typical hiring cycle without keeping a link valid indefinitely.

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx` — same pattern requisitionApprovals.ts's QueryClient
// established for W47.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function buildStatusCheckEmail(params: { firstName: string; vacancyTitle: string; organizationName: string; statusUrl: string }) {
  const html = `<p>Hi ${params.firstName},</p><p>Thanks for applying to <strong>${params.vacancyTitle}</strong> at ${params.organizationName}. You can check your application status here:</p><p><a href="${params.statusUrl}">${params.statusUrl}</a></p><p>This link is valid for 90 days.</p>`;
  const text = `Hi ${params.firstName},\n\nThanks for applying to ${params.vacancyTitle} at ${params.organizationName}. You can check your application status here:\n${params.statusUrl}\n\nThis link is valid for 90 days.`;
  return { html, text };
}

async function findOrCreateCandidate(
  tx: QueryClient,
  params: { organizationId: number; firstName: string; lastName: string; email: string; phone?: string | null },
): Promise<Candidate> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const [existing] = await tx
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.organizationId, params.organizationId), eq(candidatesTable.email, normalizedEmail)))
    .limit(1);
  if (existing) return existing;

  const [created] = await tx
    .insert(candidatesTable)
    .values({
      organizationId: params.organizationId,
      firstName: params.firstName,
      lastName: params.lastName,
      email: normalizedEmail,
      phone: params.phone ?? null,
    })
    .returning();
  return created;
}

export interface SubmitPublicApplicationAnswerInput {
  vacancyQuestionId: number;
  answerText: string;
}

export interface SubmitPublicApplicationParams {
  organizationId: number;
  organizationSlug: string;
  organizationName: string;
  vacancyId: number;
  vacancyPublicId: string;
  vacancyTitle: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  resumeFile: { mimetype: string; size: number; buffer: Buffer; originalname: string };
  answers?: SubmitPublicApplicationAnswerInput[];
}

// Knockout auto-scoring only ever applies to these two question types
// (§12) — free-text and numeric answers have no single canonical
// "expected answer" comparison, so they're never flagged.
const KNOCKOUT_SCORABLE_TYPES: VacancyQuestion["questionType"][] = ["yes_no", "multiple_choice"];

function computeKnockoutFailed(question: VacancyQuestion, answerText: string): boolean {
  if (!question.isKnockout || question.expectedAnswer == null) return false;
  if (!KNOCKOUT_SCORABLE_TYPES.includes(question.questionType)) return false;
  return answerText.trim().toLowerCase() !== question.expectedAnswer.trim().toLowerCase();
}

/**
 * Creates (or reuses) a candidate and files a new application against the
 * given vacancy, atomically. A repeat submission from the same email
 * against the same vacancy is idempotent — the existing application is
 * returned as-is (`isNew: false`), with no second consent/document write,
 * per §6's duplicate-submission rule.
 */
export async function submitPublicApplication(params: SubmitPublicApplicationParams): Promise<{ application: Application; isNew: boolean }> {
  const extension = validateDocumentUpload(params.resumeFile);
  const settings = await getRecruitmentSettings(params.organizationId);

  const result = await db.transaction(async (tx) => {
    const candidate = await findOrCreateCandidate(tx, params);

    const [existingApplication] = await tx
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.candidateId, candidate.id), eq(applicationsTable.vacancyId, params.vacancyId)))
      .limit(1);
    if (existingApplication) {
      return { application: existingApplication, isNew: false, candidate };
    }

    if (settings.applicationLimitPerCandidate != null) {
      // Scoped WHERE, counted in application code — mirrors this
      // codebase's established convention (e.g. leaveCalendar.ts,
      // jobRequisitions.ts) over introducing a raw SQL aggregate as a new
      // pattern (the same reasoning W40's dashboard metrics documented).
      const existingApplications = await tx.select().from(applicationsTable).where(eq(applicationsTable.candidateId, candidate.id));
      if (existingApplications.length >= settings.applicationLimitPerCandidate) {
        throw new ApplicationLimitExceededError();
      }
    }

    const statusCheckToken = generateToken();
    const [application] = await tx
      .insert(applicationsTable)
      .values({
        organizationId: params.organizationId,
        candidateId: candidate.id,
        vacancyId: params.vacancyId,
        publicId: generateToken(),
        statusCheckToken,
        statusCheckTokenExpiresAt: new Date(Date.now() + STATUS_CHECK_TTL_MS),
      })
      .returning();

    await tx.insert(candidateConsentsTable).values({
      organizationId: params.organizationId,
      candidateId: candidate.id,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      consentText: buildConsentText(params.organizationName),
    });

    const storageKey = await writeOrgFile(params.organizationId, "candidate-documents", extension, params.resumeFile.buffer);
    await tx.insert(candidateDocumentsTable).values({
      organizationId: params.organizationId,
      candidateId: candidate.id,
      applicationId: application.id,
      categoryCode: "resume",
      fileName: params.resumeFile.originalname,
      mimeType: params.resumeFile.mimetype,
      fileSize: params.resumeFile.size,
      storageKey,
    });

    if (params.answers?.length) {
      const questionIds = params.answers.map((a) => a.vacancyQuestionId);
      const questions = await tx
        .select()
        .from(vacancyQuestionsTable)
        .where(and(eq(vacancyQuestionsTable.vacancyId, params.vacancyId), inArray(vacancyQuestionsTable.id, questionIds)));
      const questionById = new Map(questions.map((q) => [q.id, q]));

      // Silently ignores any vacancyQuestionId that doesn't belong to this
      // vacancy — no error surfaced, since answers are optional and a
      // mismatched id carries no security implication (never trusted for
      // anything beyond this vacancy's own question set).
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

    return { application, isNew: true, candidate };
  });

  if (result.isNew && result.application.statusCheckToken) {
    const appBaseUrl = process.env.APP_BASE_URL;
    if (appBaseUrl) {
      const statusUrl = `${appBaseUrl.replace(/\/$/, "")}/careers/${params.organizationSlug}/status/${result.application.statusCheckToken}`;
      const { html, text } = buildStatusCheckEmail({
        firstName: result.candidate.firstName,
        vacancyTitle: params.vacancyTitle,
        organizationName: params.organizationName,
        statusUrl,
      });
      try {
        await getEmailProvider().send({ to: result.candidate.email, subject: `Your application to ${params.organizationName}`, html, text });
      } catch (err) {
        logger.error({ err, applicationId: result.application.id }, "Failed to send application status-check email");
      }
    } else {
      logger.error("APP_BASE_URL is not set -- cannot build an application status-check link");
    }
  }

  return { application: result.application, isNew: result.isNew };
}

export type ApplicationStatusResult = { found: true; vacancyTitle: string; submittedAt: Date } | { found: false };

/**
 * Anonymous status check by the emailed token — never by a bare email
 * lookup (that would let anyone probe arbitrary emails, per §6). Scoped to
 * the organization resolved from the URL's own slug — a token that exists
 * but belongs to a different organization is indistinguishable from an
 * unknown one, closing off any cross-tenant status disclosure through a
 * guessed or mismatched org slug. Expired or unknown tokens are likewise
 * indistinguishable ("not found").
 */
export async function getApplicationStatusByToken(organizationId: number, token: string): Promise<ApplicationStatusResult> {
  const [row] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.organizationId, organizationId), eq(applicationsTable.statusCheckToken, token)))
    .limit(1);
  if (!row) return { found: false };
  if (row.statusCheckTokenExpiresAt && row.statusCheckTokenExpiresAt.getTime() < Date.now()) return { found: false };

  const [vacancy] = await db.select().from(vacanciesTable).where(eq(vacanciesTable.id, row.vacancyId)).limit(1);
  return { found: true, vacancyTitle: vacancy?.title ?? "your application", submittedAt: row.submittedAt };
}
