/**
 * Employee Conversion (Phase 3A, W59): the controlled hand-off from
 * Recruitment to HR (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
 * §13). Recruitment selects a candidate; this file creates an employee —
 * two different responsibilities, kept in two different files. The actual
 * employee-creation act reuses `createEmployee` from `lib/employees.ts`
 * unchanged (extracted from `routes/employees.ts`'s own POST handler this
 * same workstream, so there remains exactly ONE authoritative
 * employee-creation pathway in the system) — this file never inserts into
 * `employeesTable` directly.
 *
 * Eligibility is exactly §13's own two-check formula, nothing more: the
 * application must be in a `hired`-category stage (§4.3's stage
 * categories, resolved via `recruitment_stages.category`, not an
 * org-configurable stage *name*), and every non-waived
 * `pre_employment_requirements` row for the application must be
 * `satisfied` (mirrors `lib/preEmploymentRequirements.ts`'s own
 * `readyForConversion` computation exactly). §13 names no offer-status
 * check as a gating condition — an offer is used only as an optional
 * *data source* for the employee mapping below, never as an eligibility
 * gate, since W57 built no candidate-facing acceptance flow at all.
 *
 * An internal candidate (already an employee, `candidates.linkedInternalEmployeeId`
 * set) converting via a *new* internal application does not create a
 * second employee record — the existing employeeId is reused and only the
 * provenance link is inserted, per §13's own text. The first time a
 * candidate converts, `candidates.linkedInternalEmployeeId` is set to the
 * newly created employee's id in the same transaction — not itself
 * described by §13's prose, but required for that same guarantee to hold
 * for a *future* application from the same person (a different
 * applicationId isn't caught by `candidate_employee_links`' own unique
 * constraint), so the field must actually get populated somewhere.
 * `candidate_employee_links.employeeId` is ALSO unique, though ("one
 * recruitment provenance per employee," §9) — so once a candidate has
 * converted once through this flow, a second application from the same
 * (now-linked) candidate correctly 409s as already-converted, rather than
 * inserting a second link row for the same employee. The reuse branch
 * only ever succeeds, in practice, for a candidate whose
 * `linkedInternalEmployeeId` was set by some means other than a prior
 * conversion through this same function (e.g. an existing employee who
 * separately has a candidate record) — a real employee with no
 * `candidate_employee_links` row of their own yet.
 *
 * Data mapping — only what §13/the task's own examples name (Name,
 * Contact, Position, Department, Branch, Employment type, Start date,
 * Offer information) and what the source tables actually contain; nothing
 * invented. `candidates` has no emergency-contacts field at all in this
 * frozen model (unlike `employees.emergencyContacts`), so nothing is
 * mapped there. `residentialAddress` is mapped from `candidates.address`
 * since §9 itself says the two mirror the same jsonb shape.
 * `nationalIdentifierType`/`Value` is NOT mapped to `employees.nationalId`/
 * `passportNumber` — the candidate-side field is a generic type+value pair
 * with no frozen rule for which employee column a given type resolves to,
 * so mapping it would mean inventing that rule.
 *
 * Duplicate/concurrent-conversion protection is the same "no pre-check,
 * just catch the DB race" discipline this phase already established
 * (offers.ts's createOffer, W58's createPreEmploymentRequirement) —
 * `candidate_employee_links`'s own `(applicationId)` and `(employeeId)`
 * unique constraints are the structural guarantee, translated to a typed
 * `AlreadyConvertedError` on violation (mirrors `DuplicateLedgerEntryError`'s
 * precedent, per §13's own text), making a retried request genuinely
 * idempotent rather than double-processing.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  applicationsTable,
  recruitmentStagesTable,
  candidatesTable,
  vacanciesTable,
  jobRequisitionsTable,
  offersTable,
  offerVersionsTable,
  preEmploymentRequirementsTable,
  candidateEmployeeLinksTable,
  type Application,
  type Candidate,
  type CandidateEmployeeLink,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { createEmployee } from "./employees";
import { isUniqueViolation } from "./dbErrors";
import { logger } from "./logger";
import { startOnboarding, NoApplicableTemplateError } from "./onboarding/instances";

export class ApplicationNotFoundForConversionError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundForConversionError";
  }
}

export class ApplicationNotHiredError extends Error {
  constructor() {
    super("The application must be in a hired-category stage before conversion");
    this.name = "ApplicationNotHiredError";
  }
}

export class PreEmploymentRequirementsNotSatisfiedError extends Error {
  constructor() {
    super("Every non-waived pre-employment requirement must be satisfied before conversion");
    this.name = "PreEmploymentRequirementsNotSatisfiedError";
  }
}

/** WS-9 (§25.4) — the organization has not authorized employing this candidate. */
export class HireNotAuthorizedError extends Error {
  constructor() {
    super("This hire has not been authorized — complete the hire-approval stages before converting");
    this.name = "HireNotAuthorizedError";
  }
}

/** WS-9 (§25.4) — the current offer is not in an accepted state. */
export class OfferNotAcceptedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "OfferNotAcceptedError";
  }
}

export class AlreadyConvertedError extends Error {
  constructor() {
    super("This application has already been converted to an employee");
    this.name = "AlreadyConvertedError";
  }
}

async function findApplicationInOrg(organizationId: number, applicationId: number): Promise<Application | null> {
  const [row] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findCandidateInOrg(organizationId: number, candidateId: number): Promise<Candidate | null> {
  const [row] = await db
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.id, candidateId), eq(candidatesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** §13's own eligibility formula, exactly — nothing else gates conversion. */
async function assertEligible(organizationId: number, application: Application): Promise<void> {
  if (application.currentStageId == null) throw new ApplicationNotHiredError();
  const [stage] = await db
    .select()
    .from(recruitmentStagesTable)
    .where(and(eq(recruitmentStagesTable.id, application.currentStageId), eq(recruitmentStagesTable.organizationId, organizationId)))
    .limit(1);
  if (!stage || stage.category !== "hired") throw new ApplicationNotHiredError();

  const requirements = await db
    .select()
    .from(preEmploymentRequirementsTable)
    .where(and(eq(preEmploymentRequirementsTable.organizationId, organizationId), eq(preEmploymentRequirementsTable.applicationId, application.id)));
  const allResolved = requirements.every((r) => r.status === "waived" || r.status === "satisfied");
  if (!allResolved) throw new PreEmploymentRequirementsNotSatisfiedError();

  await assertRecruitmentLifecycleSatisfied(organizationId, application);
}

/**
 * WS-9 (MASTER_OWNER_REVIEW §25.4) — the Recruitment lifecycle gate.
 *
 * Before WS-9 an application could be converted whether or not any offer was
 * ever issued, approved or accepted: "selected" and "authorized to employ"
 * were one gate. This adds the missing four conditions.
 *
 * SCOPE. This runs only on the Recruitment conversion path. Direct employee
 * creation, legacy import, WS-7 bulk migration, existing employees and rehire
 * all call `createEmployee()` by other routes and are untouched — an
 * organization that did not recruit through this system is not required to
 * manufacture an offer in order to employ someone.
 *
 * PROSPECTIVE ENFORCEMENT. Existing Recruitment records predate the accept /
 * decline statuses entirely, because no code path could write them. Applying
 * the gate to that history would strand real, legitimately-hired candidates
 * behind an acceptance that was never possible to record. So the gate engages
 * only where the organization has actually adopted the new lifecycle:
 *
 *   - hire authorization is required only if the organization has configured
 *     hire-approval stages at all;
 *   - offer acceptance is required only if an offer exists for the application.
 *
 * An organization that configures stages and issues offers gets the full gate.
 * One that has not yet adopted either keeps working exactly as before. What is
 * never permitted, in any configuration, is converting against an offer that
 * was declined, withdrawn, superseded or expired — that is a correctness rule,
 * not an adoption question.
 */
async function assertRecruitmentLifecycleSatisfied(organizationId: number, application: Application): Promise<void> {
  const { listApprovalStages } = await import("./recruitmentApprovalStages");
  const { isHireAuthorized } = await import("./hireAuthorization");
  const { getOfferVersionState } = await import("./offerResponses");

  const hireStages = await listApprovalStages(organizationId, "hire");
  if (hireStages.length > 0 && !(await isHireAuthorized(organizationId, application.id))) {
    throw new HireNotAuthorizedError();
  }

  const currentVersion = await findCurrentOfferVersion(organizationId, application.id);
  if (!currentVersion) return; // No offer was issued through this system.

  const state = await getOfferVersionState(organizationId, currentVersion.id);
  if (!state) return;

  if (state.version.status === "withdrawn") throw new OfferNotAcceptedError("This offer was withdrawn");
  if (state.version.status === "declined") throw new OfferNotAcceptedError("This offer was declined");
  if (state.version.status === "superseded") throw new OfferNotAcceptedError("This offer version has been superseded");
  if (state.isExpired && state.version.status !== "accepted") throw new OfferNotAcceptedError("This offer expired");
  if (state.version.status !== "accepted") {
    throw new OfferNotAcceptedError(`This offer has not been accepted (current status: ${state.version.status})`);
  }
}

/** Optional data source only — never an eligibility gate (see module header). Returns null if no offer/version exists. */
async function findCurrentOfferVersion(organizationId: number, applicationId: number) {
  const [offer] = await db
    .select()
    .from(offersTable)
    .where(and(eq(offersTable.organizationId, organizationId), eq(offersTable.applicationId, applicationId)))
    .limit(1);
  if (!offer || offer.currentVersionId == null) return null;
  const [version] = await db
    .select()
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.id, offer.currentVersionId), eq(offerVersionsTable.organizationId, organizationId)))
    .limit(1);
  return version ?? null;
}

/** Position/department/branch source only — resolved via application -> vacancy -> requisition, the same three-hop chain every other Recruitment resource this phase reuses. Returns null fields if any hop is missing. */
async function findRequisitionPlacement(organizationId: number, vacancyId: number) {
  const [vacancy] = await db
    .select()
    .from(vacanciesTable)
    .where(and(eq(vacanciesTable.id, vacancyId), eq(vacanciesTable.organizationId, organizationId)))
    .limit(1);
  if (!vacancy) return { departmentId: null, branchId: null, positionId: null };
  const [requisition] = await db
    .select()
    .from(jobRequisitionsTable)
    .where(and(eq(jobRequisitionsTable.id, vacancy.requisitionId), eq(jobRequisitionsTable.organizationId, organizationId)))
    .limit(1);
  return {
    departmentId: requisition?.departmentId ?? null,
    branchId: requisition?.branchId ?? null,
    positionId: requisition?.positionId ?? null,
  };
}

export interface ConversionResult {
  link: CandidateEmployeeLink;
  employeeId: number;
  /** True only when an existing employee (an internal candidate) was reused rather than a new one created. */
  reusedExistingEmployee: boolean;
  /**
   * WS-10 — the onboarding started for this hire, or null when the
   * organization has configured no applicable template (or onboarding could
   * not be started; the conversion itself still succeeded).
   */
  onboardingInstanceId: number | null;
}

export async function convertApplicationToEmployee(params: {
  organizationId: number;
  applicationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ConversionResult> {
  const application = await findApplicationInOrg(params.organizationId, params.applicationId);
  if (!application) throw new ApplicationNotFoundForConversionError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_conversion.started",
    targetType: "application",
    targetId: String(params.applicationId),
  });

  try {
    await assertEligible(params.organizationId, application);

    const candidate = await findCandidateInOrg(params.organizationId, application.candidateId);
    if (!candidate) throw new ApplicationNotFoundForConversionError();

    const reusedExistingEmployee = candidate.linkedInternalEmployeeId != null;

    const { link, employeeId } = await db.transaction(async (tx) => {
      let employeeId: number;

      if (candidate.linkedInternalEmployeeId != null) {
        employeeId = candidate.linkedInternalEmployeeId;
      } else {
        const offerVersion = await findCurrentOfferVersion(params.organizationId, params.applicationId);
        const placement = await findRequisitionPlacement(params.organizationId, application.vacancyId);

        const employee = await createEmployee(tx, {
          organizationId: params.organizationId,
          actorApplicationUserId: params.actorApplicationUserId,
          actorMembershipId: params.actorMembershipId,
          fields: {
            firstName: candidate.firstName,
            lastName: candidate.lastName,
            personalEmail: candidate.email,
            phoneNumber: candidate.phone,
            nationality: candidate.nationality,
            residentialAddress: candidate.address,
            departmentId: placement.departmentId,
            branchId: placement.branchId,
            positionId: placement.positionId,
            employmentType: offerVersion?.employmentType ?? null,
            hireDate: offerVersion?.proposedStartDate ? new Date(offerVersion.proposedStartDate) : null,
            workLocation: offerVersion?.location ?? null,
          },
        });
        employeeId = employee.id;

        // Marks this candidate as internal going forward — without this, a
        // *future* application from the same real person (a different
        // applicationId, so not caught by candidate_employee_links'
        // (applicationId) unique constraint) would fall into this same
        // "not yet linked" branch again and create a second employee for
        // the same person, exactly the duplicate §13 says must never
        // happen. Only set on first conversion; the already-linked branch
        // above never re-touches this column.
        await tx.update(candidatesTable).set({ linkedInternalEmployeeId: employeeId }).where(eq(candidatesTable.id, candidate.id));
      }

      const [insertedLink] = await tx
        .insert(candidateEmployeeLinksTable)
        .values({
          organizationId: params.organizationId,
          candidateId: candidate.id,
          applicationId: application.id,
          employeeId,
          convertedByMembershipId: params.actorMembershipId,
        })
        .returning();

      return { link: insertedLink, employeeId };
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "employee_conversion.completed",
      targetType: "application",
      targetId: String(params.applicationId),
      afterState: { employeeId, reusedExistingEmployee },
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "employee_conversion.employee_linked",
      targetType: "employee",
      targetId: String(employeeId),
      afterState: { applicationId: application.id, candidateId: candidate.id },
    });

    // WS-10 (§26.34) — start formal onboarding, if this organization has
    // configured a template that applies.
    //
    // Deliberately OUTSIDE the transaction above and deliberately non-fatal: a
    // conversion that has already committed must not be reported as failed
    // because a downstream checklist could not be raised, and re-running the
    // conversion would hit AlreadyConvertedError anyway. The handoff is itself
    // idempotent (an open instance per employee is unique at the database), so
    // a retry through the explicit start-onboarding action is safe.
    let onboardingInstanceId: number | null = null;
    try {
      const started = await startOnboarding({
        organizationId: params.organizationId,
        employeeId,
        candidateId: candidate.id,
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
        reuseExisting: true,
      });
      onboardingInstanceId = started.instance.id;
    } catch (err) {
      // No applicable template is the ordinary case for an organization that
      // has not configured onboarding — not an error worth surfacing.
      if (!(err instanceof NoApplicableTemplateError)) {
        logger.warn(
          { err, organizationId: params.organizationId, employeeId },
          "employee converted but onboarding could not be started",
        );
      }
    }

    return { link, employeeId, reusedExistingEmployee, onboardingInstanceId };
  } catch (err) {
    const translated = isUniqueViolation(err) ? new AlreadyConvertedError() : err;
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "employee_conversion.failed",
      targetType: "application",
      targetId: String(params.applicationId),
      afterState: { reason: translated instanceof Error ? translated.name : "unknown" },
    });
    throw translated;
  }
}
