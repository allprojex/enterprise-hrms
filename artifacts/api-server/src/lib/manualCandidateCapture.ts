/**
 * WS-9 — Authorized manual candidate capture
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.6).
 *
 * Until now every candidate row in this platform originated from the public
 * careers apply endpoint — `candidates.ts`'s own schema comment said so, and
 * both apply paths gate on `vacancy.status === "published"`. An organization
 * that recruits by referral, walk-in, agency, physical notice or direct
 * sourcing had no way in at all.
 *
 * That invariant is deliberately superseded here. Two things are worth being
 * precise about:
 *
 *   1. **The public path is untouched.** Its publication gate lives in
 *      `publicCareers.ts`'s `isVacancyPubliclyEligible` and in
 *      `employeeInternalApplications.ts`'s own predicate; neither is modified,
 *      relaxed, or routed around. This module is a *second* door with its own
 *      lock, not a wider opening in the first.
 *
 *   2. **There is no second candidate model.** This reuses
 *      `findOrCreateCandidate`, the same `candidates`/`applications` tables,
 *      the same `(candidateId, vacancyId)` uniqueness, and the same
 *      already-converted linkage. A manually captured candidate is
 *      indistinguishable downstream from a portal one except for its recorded
 *      source.
 *
 * What replaces publication as the control is authorization: an authenticated,
 * permission-checked member of the organization, a vacancy that belongs to
 * that organization, a configured recruitment source, and an audit trail.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  candidatesTable,
  applicationsTable,
  vacanciesTable,
  recruitmentStagesTable,
  masterDataItemsTable,
  type Application,
  type Candidate,
} from "@workspace/db";
import { generateToken } from "./auth";
import { isUniqueViolation } from "./dbErrors";
import { findOrCreateCandidate } from "./candidateApplications";

export class ManualCaptureError extends Error {}

export class DuplicateApplicationError extends Error {
  constructor() {
    super("This candidate already has an application for this vacancy");
    this.name = "DuplicateApplicationError";
  }
}

/** The Master Data domain that makes recruitment sources organization-configurable (§25.5). */
export const RECRUITMENT_SOURCE_DOMAIN = "recruitment_source";

/**
 * Validates a source code against the organization's own Master Data.
 *
 * Related to `assertComponentTypeKnown`'s shape, but deliberately NOT identical:
 * that helper post-checks a single row's owner, which is safe for payroll's
 * mostly system-seeded codes but wrong here. See the comment on the query.
 */
export async function assertRecruitmentSourceValid(organizationId: number, code: string): Promise<void> {
  const trimmed = code?.trim();
  if (!trimmed) throw new ManualCaptureError("A recruitment source is required");

  // The organization filter is part of the QUERY, not a post-check on a single
  // arbitrary row. `recruitment_source` is an organization-defined domain, so
  // the same code legitimately exists in many organizations at once; selecting
  // one row and then testing its owner would return an arbitrary tenant's row
  // and wrongly deny a valid source. Matching either this organization's own
  // item or a platform-wide (null-org) one is the correct predicate.
  const rows = await db
    .select({ organizationId: masterDataItemsTable.organizationId })
    .from(masterDataItemsTable)
    .where(
      and(
        eq(masterDataItemsTable.domain, RECRUITMENT_SOURCE_DOMAIN),
        eq(masterDataItemsTable.code, trimmed),
        eq(masterDataItemsTable.status, "active"),
        or(isNull(masterDataItemsTable.organizationId), eq(masterDataItemsTable.organizationId, organizationId)),
      ),
    )
    .limit(1);

  // Uniform message whether the code belongs to another tenant or does not
  // exist — a caller learns nothing about other organizations' configuration.
  if (rows.length === 0) {
    throw new ManualCaptureError(`"${trimmed}" is not an available recruitment source for this organization`);
  }
}

export interface ManualCaptureParams {
  organizationId: number;
  vacancyId: number;
  sourceCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  /** When the candidate actually reached the organization — may predate today for a walk-in logged later. */
  capturedAt?: Date | null;
  actorMembershipId: number;
}

export interface ManualCaptureResult {
  candidate: Candidate;
  application: Application;
  reusedExistingCandidate: boolean;
}

/**
 * Creates (or reuses) a candidate and opens an application against a vacancy
 * that need not be published.
 *
 * The vacancy must still belong to this organization and must not be in a
 * state where recruiting has ended — capturing a walk-in against a closed or
 * archived requisition would be recording something the organization is no
 * longer doing.
 */
export async function captureCandidateManually(params: ManualCaptureParams): Promise<ManualCaptureResult> {
  const email = params.email?.trim().toLowerCase();
  if (!email) throw new ManualCaptureError("An email address is required");
  if (!params.firstName?.trim() || !params.lastName?.trim()) {
    throw new ManualCaptureError("First and last name are required");
  }

  await assertRecruitmentSourceValid(params.organizationId, params.sourceCode);

  const [vacancy] = await db
    .select()
    .from(vacanciesTable)
    .where(and(eq(vacanciesTable.id, params.vacancyId), eq(vacanciesTable.organizationId, params.organizationId)))
    .limit(1);
  // Identical error whether the vacancy belongs to another organization or
  // does not exist.
  if (!vacancy) throw new ManualCaptureError("Vacancy not found in this organization");

  // Publication is NOT required here — that is the point. What is required is
  // that the vacancy is still open for recruiting.
  if (["closed", "archived"].includes(vacancy.status)) {
    throw new ManualCaptureError(`This vacancy is ${vacancy.status} and is no longer accepting candidates`);
  }

  // Entry point of the organization's own configured pipeline — the same
  // stage a portal application would land on. No parallel pipeline.
  //
  // `workflowId` is nullable on vacancies, so a vacancy without a workflow
  // simply yields no starting stage; the application is still created with a
  // null stage, exactly as the schema already permits, rather than being
  // refused for a configuration gap that is not the recruiter's fault.
  const firstStage =
    vacancy.workflowId == null
      ? undefined
      : (
          await db
            .select()
            .from(recruitmentStagesTable)
            .where(
              and(
                eq(recruitmentStagesTable.organizationId, params.organizationId),
                eq(recruitmentStagesTable.workflowId, vacancy.workflowId),
                eq(recruitmentStagesTable.category, "applied"),
              ),
            )
            .limit(1)
        )[0];

  return db.transaction(async (tx) => {
    const before = await tx
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(and(eq(candidatesTable.organizationId, params.organizationId), eq(candidatesTable.email, email)))
      .limit(1);
    const reusedExistingCandidate = before.length > 0;

    const candidate = await findOrCreateCandidate(tx, {
      organizationId: params.organizationId,
      firstName: params.firstName.trim(),
      lastName: params.lastName.trim(),
      email,
      phone: params.phone ?? null,
    });

    // `findOrCreateCandidate` predates configurable sources and always takes
    // the column default; stamp the real source onto a newly created row
    // without disturbing an existing candidate's recorded origin.
    if (!reusedExistingCandidate) {
      await tx
        .update(candidatesTable)
        .set({ source: params.sourceCode.trim(), sourceCode: params.sourceCode.trim() })
        .where(eq(candidatesTable.id, candidate.id));
    }

    try {
      const [application] = await tx
        .insert(applicationsTable)
        .values({
          organizationId: params.organizationId,
          candidateId: candidate.id,
          vacancyId: params.vacancyId,
          currentStageId: firstStage?.id ?? null,
          publicId: generateToken(),
          source: params.sourceCode.trim(),
          sourceCode: params.sourceCode.trim(),
          submittedAt: params.capturedAt ?? new Date(),
        })
        .returning();

      return { candidate, application, reusedExistingCandidate };
    } catch (err) {
      // The pre-existing (candidateId, vacancyId) unique index is the same
      // duplicate protection the public path relies on.
      if (isUniqueViolation(err)) throw new DuplicateApplicationError();
      throw err;
    }
  });
}

/** The organization's configured recruitment sources, for selection UI. */
export async function listRecruitmentSources(organizationId: number) {
  const rows = await db
    .select({
      code: masterDataItemsTable.code,
      label: masterDataItemsTable.label,
      organizationId: masterDataItemsTable.organizationId,
      sortOrder: masterDataItemsTable.sortOrder,
    })
    .from(masterDataItemsTable)
    .where(and(eq(masterDataItemsTable.domain, RECRUITMENT_SOURCE_DOMAIN), eq(masterDataItemsTable.status, "active")));
  return rows
    .filter((r) => r.organizationId === null || r.organizationId === organizationId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((r) => ({ code: r.code, label: r.label }));
}
