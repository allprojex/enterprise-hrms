/**
 * WS-9 — Employment particulars
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.8–25.10).
 *
 * The written statement of main employment terms. Ghana's Labour Act, 2003
 * (Act 651) §13 requires an employer to furnish this within two months of
 * commencement, in the form set out in Schedule 1, signed by both parties.
 *
 * Two disciplines this module exists to enforce:
 *
 *   DRAFT vs ISSUED. While a draft, particulars may be re-derived freely from
 *   authoritative owners (position, Leave policy, organization). Once issued
 *   the record is frozen — every edit is refused. That is what makes a
 *   statement already furnished to a worker reproducible: if the organization
 *   changes its leave policy next year, what was furnished this year must
 *   still read as furnished.
 *
 *   NO INVENTED LAW. Nothing here computes a probation duration, a notice
 *   period, or a leave entitlement. Those are organization configuration and
 *   employment terms; the module resolves suggested text from what the
 *   platform already knows and lets a human confirm it. §25.9 forbids
 *   hard-coding any universal duration, and the reconciliation records that no
 *   numeric Ghana limit was established from primary text.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  employmentParticularsTable,
  offerVersionsTable,
  offersTable,
  applicationsTable,
  candidatesTable,
  vacanciesTable,
  jobRequisitionsTable,
  positionsTable,
  organizationsTable,
  leaveTypesTable,
  leavePoliciesTable,
  type EmploymentParticulars,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

export class EmploymentParticularsNotFoundError extends Error {
  constructor() {
    super("Employment particulars not found");
    this.name = "EmploymentParticularsNotFoundError";
  }
}

export class EmploymentParticularsIssuedError extends Error {
  constructor() {
    super("These employment particulars have been issued and can no longer be edited");
    this.name = "EmploymentParticularsIssuedError";
  }
}

/** The Schedule 1 content fields, in ordinary HR terminology. */
export interface ParticularsFields {
  employerName?: string | null;
  workerName?: string | null;
  dateOfFirstAppointment?: Date | null;
  jobTitleOrGrade?: string | null;
  payRate?: string | null;
  payMethod?: string | null;
  payInterval?: string | null;
  hoursOfWork?: string | null;
  holidayTerms?: string | null;
  sickPayTerms?: string | null;
  pensionTerms?: string | null;
  noticeByEmployer?: string | null;
  noticeByWorker?: string | null;
  disciplinaryRules?: string | null;
  grievanceProcedure?: string | null;
  overtimeTerms?: string | null;
  probationTerms?: string | null;
}

export async function getParticularsByOfferVersion(
  organizationId: number,
  offerVersionId: number,
): Promise<EmploymentParticulars | null> {
  const [row] = await db
    .select()
    .from(employmentParticularsTable)
    .where(
      and(
        eq(employmentParticularsTable.organizationId, organizationId),
        eq(employmentParticularsTable.offerVersionId, offerVersionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Suggests particulars from what the platform already knows authoritatively —
 * organization name, candidate name, position title, the offer's own proposed
 * start date and workplace terms, and the organization's leave configuration.
 *
 * These are SUGGESTIONS for a human to review, not derived law. Fields the
 * platform cannot know (notice, disciplinary rules, grievance procedure,
 * probation) are returned empty rather than guessed — an invented notice
 * period in a statutory statement would be worse than a blank one.
 */
export async function suggestParticulars(
  organizationId: number,
  offerVersionId: number,
): Promise<{ fields: ParticularsFields; derivedFrom: Record<string, unknown> }> {
  const [row] = await db
    .select({
      version: offerVersionsTable,
      candidateFirst: candidatesTable.firstName,
      candidateLast: candidatesTable.lastName,
      orgName: organizationsTable.name,
      positionTitle: positionsTable.title,
      positionId: positionsTable.id,
    })
    .from(offerVersionsTable)
    .innerJoin(offersTable, eq(offersTable.id, offerVersionsTable.offerId))
    .innerJoin(applicationsTable, eq(applicationsTable.id, offersTable.applicationId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .innerJoin(organizationsTable, eq(organizationsTable.id, offerVersionsTable.organizationId))
    .leftJoin(vacanciesTable, eq(vacanciesTable.id, applicationsTable.vacancyId))
    .leftJoin(jobRequisitionsTable, eq(jobRequisitionsTable.id, vacanciesTable.requisitionId))
    .leftJoin(positionsTable, eq(positionsTable.id, jobRequisitionsTable.positionId))
    .where(and(eq(offerVersionsTable.id, offerVersionId), eq(offerVersionsTable.organizationId, organizationId)))
    .limit(1);

  if (!row) throw new EmploymentParticularsNotFoundError();

  // Leave configuration is READ to suggest holiday terms — never duplicated,
  // and never turned into an entitlement calculation here. The Leave module
  // remains the only owner of entitlement logic.
  const leaveTypes = await db
    .select({ name: leaveTypesTable.name, id: leaveTypesTable.id })
    .from(leaveTypesTable)
    .where(and(eq(leaveTypesTable.organizationId, organizationId), eq(leaveTypesTable.status, "active")));

  const policies = await db
    .select({ leaveTypeId: leavePoliciesTable.leaveTypeId, entitlementDays: leavePoliciesTable.annualEntitlementDays })
    .from(leavePoliciesTable)
    .where(eq(leavePoliciesTable.organizationId, organizationId));

  const holidaySummary =
    leaveTypes.length > 0
      ? leaveTypes
          .map((t) => {
            const p = policies.find((x) => x.leaveTypeId === t.id);
            return p?.entitlementDays != null ? `${t.name}: ${p.entitlementDays} days` : t.name;
          })
          .join("; ")
      : null;

  const compensation = row.version.compensationSummary as Record<string, unknown> | null;

  return {
    fields: {
      employerName: row.orgName,
      workerName: [row.candidateFirst, row.candidateLast].filter(Boolean).join(" "),
      dateOfFirstAppointment: row.version.proposedStartDate ? new Date(row.version.proposedStartDate) : null,
      jobTitleOrGrade: row.positionTitle ?? null,
      // Compensation is free-form jsonb by design (no Payroll FK), so only a
      // plainly-labelled value is lifted; anything richer is left to a human.
      payRate: typeof compensation?.amount === "string" || typeof compensation?.amount === "number" ? String(compensation.amount) : null,
      payMethod: typeof compensation?.method === "string" ? compensation.method : null,
      payInterval: typeof compensation?.interval === "string" ? compensation.interval : null,
      hoursOfWork: null,
      holidayTerms: holidaySummary,
      sickPayTerms: null,
      pensionTerms: null,
      // Deliberately blank — see this function's own doc comment.
      noticeByEmployer: null,
      noticeByWorker: null,
      disciplinaryRules: null,
      grievanceProcedure: null,
      overtimeTerms: null,
      probationTerms: null,
    },
    derivedFrom: {
      offerVersionId,
      positionId: row.positionId ?? null,
      leaveTypeIds: leaveTypes.map((t) => t.id),
      organizationId,
      derivedAt: new Date().toISOString(),
    },
  };
}

/** Creates or updates the draft particulars for an offer version. Refused once issued. */
export async function saveParticulars(params: {
  organizationId: number;
  offerVersionId: number;
  fields: ParticularsFields;
  derivedFrom?: Record<string, unknown> | null;
  actorMembershipId: number | null;
}): Promise<EmploymentParticulars> {
  const [version] = await db
    .select({ id: offerVersionsTable.id })
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.id, params.offerVersionId), eq(offerVersionsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!version) throw new EmploymentParticularsNotFoundError();

  const existing = await getParticularsByOfferVersion(params.organizationId, params.offerVersionId);
  if (existing?.issuedAt) throw new EmploymentParticularsIssuedError();

  if (existing) {
    const [updated] = await db
      .update(employmentParticularsTable)
      .set({ ...params.fields, derivedFrom: params.derivedFrom ?? existing.derivedFrom })
      .where(eq(employmentParticularsTable.id, existing.id))
      .returning();
    return updated;
  }

  try {
    const [created] = await db
      .insert(employmentParticularsTable)
      .values({
        organizationId: params.organizationId,
        offerVersionId: params.offerVersionId,
        ...params.fields,
        derivedFrom: params.derivedFrom ?? null,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new EmploymentParticularsIssuedError();
    throw err;
  }
}

/**
 * Freezes the particulars. After this the record is immutable, which is the
 * property that makes an already-furnished statement reproducible.
 */
export async function issueParticulars(params: {
  organizationId: number;
  offerVersionId: number;
  actorMembershipId: number | null;
}): Promise<EmploymentParticulars> {
  const existing = await getParticularsByOfferVersion(params.organizationId, params.offerVersionId);
  if (!existing) throw new EmploymentParticularsNotFoundError();
  if (existing.issuedAt) return existing; // Idempotent — issuing twice is not an error.

  const [issued] = await db
    .update(employmentParticularsTable)
    .set({ issuedAt: new Date(), issuedByMembershipId: params.actorMembershipId })
    .where(eq(employmentParticularsTable.id, existing.id))
    .returning();
  return issued;
}

/**
 * Builds the merge context WS-5's generator consumes. Every value comes from
 * the frozen snapshot, never from live configuration — generating the same
 * document twice must produce the same content.
 */
export function buildParticularsMergeContext(particulars: EmploymentParticulars): Record<string, string> {
  // WS-5's MergeContext is a FLAT map of dotted keys, and every key must be
  // registered in that module's MERGE_FIELDS allow-list — an unregistered
  // token is deliberately left unrendered rather than resolved. The
  // `particulars.*` keys used here were added there for exactly this purpose.
  return {
    "particulars.employerName": particulars.employerName ?? "",
    "particulars.workerName": particulars.workerName ?? "",
    "particulars.dateOfFirstAppointment": particulars.dateOfFirstAppointment
      ? new Date(particulars.dateOfFirstAppointment).toISOString().slice(0, 10)
      : "",
    "particulars.jobTitleOrGrade": particulars.jobTitleOrGrade ?? "",
    "particulars.payRate": particulars.payRate ?? "",
    "particulars.payMethod": particulars.payMethod ?? "",
    "particulars.payInterval": particulars.payInterval ?? "",
    "particulars.hoursOfWork": particulars.hoursOfWork ?? "",
    "particulars.holidayTerms": particulars.holidayTerms ?? "",
    "particulars.sickPayTerms": particulars.sickPayTerms ?? "",
    "particulars.pensionTerms": particulars.pensionTerms ?? "",
    "particulars.noticeByEmployer": particulars.noticeByEmployer ?? "",
    "particulars.noticeByWorker": particulars.noticeByWorker ?? "",
    "particulars.disciplinaryRules": particulars.disciplinaryRules ?? "",
    "particulars.grievanceProcedure": particulars.grievanceProcedure ?? "",
    "particulars.overtimeTerms": particulars.overtimeTerms ?? "",
    "particulars.probationTerms": particulars.probationTerms ?? "",
  };
}
