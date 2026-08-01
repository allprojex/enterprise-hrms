/**
 * Offers (Phase 3A, W57 — Offers): the final Recruitment stage — a
 * versioned offer envelope per application, taken through a single-step
 * approval chain (offerApprovals.ts) before being issued
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §4.6/§9/§14). Lives
 * alongside offerApprovals.ts the same way jobRequisitions.ts lives
 * alongside requisitionApprovals.ts — this file calls into
 * offerApprovals.ts (to create the pending approval step on submit), but
 * offerApprovals.ts never imports this file, keeping the dependency
 * one-directional.
 *
 * Visibility mirrors applicationPipeline.ts's own application -> vacancy ->
 * requisition three-hop resolution (an offer carries no
 * recruiter/hiring-manager column of its own), but org-wide reach is
 * signaled by holding any of offer.approve / offer.issue / offer.withdraw
 * — never offer.manage, which this workstream seeds broadly (including to
 * "employee") per §7's own "✔ manage draft" assigned-tier marking. A
 * broadly-seeded offer.manage would make every employee org-wide if it
 * were used as the org-wide-reach signal, so the org-wide check
 * deliberately uses the three narrow admin permissions instead (see
 * seed-roles-permissions.ts's own W57 header for the same reasoning).
 * `offer.manage`-gated writes (create/edit/submit) reuse this exact same
 * isVisible check — this is the first Recruitment resource this phase
 * where "assigned" grants real write capability, not just narrower
 * visibility, per §7's own explicit marking; every write function below
 * re-verifies it independently rather than trusting the route-level
 * permission gate alone, since that gate now passes for any employee.
 *
 * §14's editing rule: a draft version is updated in place; editing an
 * approved/issued version instead creates a new version row and marks the
 * prior one superseded. §14 is silent on editing while pending_approval —
 * this workstream treats that as not editable at all (must wait for a
 * decision), mirroring every other "no edits while an active decision is
 * in flight" precedent this phase (W55 scorecards: submitted = frozen).
 *
 * No "reject" action exists (§10 names only submit-for-approval / approve /
 * issue / withdraw) — withdraw is the general abort action, reachable from
 * pending_approval, approved, or issued alike, since no other escape hatch
 * is named for a pending_approval version. Terminal states
 * accepted/declined/expired are schema-valid but have no routes in this
 * workstream (no candidate-facing acceptance flow and no expiry scheduler
 * exist anywhere in this codebase yet) — a deliberate scope boundary, not
 * an oversight.
 */
import { and, eq, inArray, asc, desc } from "drizzle-orm";
import {
  db,
  offersTable,
  offerVersionsTable,
  applicationsTable,
  vacanciesTable,
  jobRequisitionsTable,
  type Offer,
  type OfferVersion,
  type Application,
  type Vacancy,
  type JobRequisition,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { hasOrgWideRecruitmentAccess, isAssignedRecruitmentActor, resolveRecruitmentActorEmployeeId } from "./recruitmentAuthorization";
import { createPendingApprovalStep } from "./offerApprovals";
import { isUniqueViolation } from "./dbErrors";

export class OfferNotFoundError extends Error {
  constructor() {
    super("Offer not found");
    this.name = "OfferNotFoundError";
  }
}

export class ApplicationNotFoundForOfferError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundForOfferError";
  }
}

export class OfferVersionNotFoundError extends Error {
  constructor() {
    super("Offer version not found");
    this.name = "OfferVersionNotFoundError";
  }
}

export class InvalidOfferError extends Error {}

export class DuplicateOfferError extends Error {
  constructor() {
    super("This application already has an offer");
    this.name = "DuplicateOfferError";
  }
}

export class OfferVersionNotEditableError extends Error {
  constructor() {
    super("This offer version cannot be edited in its current status");
    this.name = "OfferVersionNotEditableError";
  }
}

export class InvalidOfferTransitionError extends Error {}

/**
 * generatedDocumentStorageKey is a reserved, never-populated internal file-
 * storage reference (see the schema header on lib/db's offer-versions.ts) —
 * no route in this workstream ever writes it, but per this phase's own
 * established DTO-shaping discipline (W55's externalInterviewerToken, W56's
 * documentStorageKey — both stripped even though offer routes here never
 * set them either), it's stripped from every outgoing response rather than
 * left to be forgotten once a later workstream starts populating it.
 * letterTemplateId is a plain FK-shaped integer with nothing sensitive in
 * it, so it stays.
 */
export type PublicOfferVersion = Omit<OfferVersion, "generatedDocumentStorageKey">;

export function toPublicOfferVersion(version: OfferVersion): PublicOfferVersion {
  const { generatedDocumentStorageKey, ...rest } = version;
  return rest;
}

export interface OfferVersionFields {
  proposedStartDate?: string | null;
  employmentType?: OfferVersion["employmentType"];
  workplaceType?: OfferVersion["workplaceType"];
  location?: string | null;
  compensationSummary?: unknown;
  conditions?: string | null;
  expiryDate?: string | null;
}

// --- Visibility (assigned recruiter/hiring manager via the linked requisition, organization-wide) ---

export interface OfferVisibilityContext {
  isOrgWide: boolean;
  actorEmployeeId: number | null;
}

export async function resolveOfferVisibilityContext(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<OfferVisibilityContext> {
  const [canApprove, canIssue, canWithdraw] = await Promise.all([
    hasOrgWideRecruitmentAccess(params.membershipId, "offer.approve"),
    hasOrgWideRecruitmentAccess(params.membershipId, "offer.issue"),
    hasOrgWideRecruitmentAccess(params.membershipId, "offer.withdraw"),
  ]);
  const actorEmployeeId = await resolveRecruitmentActorEmployeeId(params.organizationId, params.applicationUserId);
  return { isOrgWide: canApprove || canIssue || canWithdraw, actorEmployeeId };
}

function isVisible(requisition: JobRequisition | undefined, ctx: OfferVisibilityContext): boolean {
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

async function findOfferInOrg(organizationId: number, offerId: number): Promise<Offer | null> {
  const [row] = await db
    .select()
    .from(offersTable)
    .where(and(eq(offersTable.id, offerId), eq(offersTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOfferByApplicationInOrg(organizationId: number, applicationId: number): Promise<Offer | null> {
  const [row] = await db
    .select()
    .from(offersTable)
    .where(and(eq(offersTable.applicationId, applicationId), eq(offersTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOfferVersionInOrg(organizationId: number, versionId: number): Promise<OfferVersion | null> {
  const [row] = await db
    .select()
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.id, versionId), eq(offerVersionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function listVersionsForOffer(organizationId: number, offerId: number): Promise<OfferVersion[]> {
  return db
    .select()
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.offerId, offerId), eq(offerVersionsTable.organizationId, organizationId)))
    .orderBy(asc(offerVersionsTable.versionNumber));
}

/** Resolves the requisition an offer's application is linked to, three hops out (offer -> application -> vacancy -> requisition), for visibility/write gating. Returns undefined if any hop is missing. */
async function resolveOfferRequisition(organizationId: number, offer: Offer): Promise<JobRequisition | undefined> {
  const application = await findApplicationInOrg(organizationId, offer.applicationId);
  if (!application) return undefined;
  const vacancy = await findVacancyInOrg(organizationId, application.vacancyId);
  if (!vacancy) return undefined;
  const requisition = await findRequisitionInOrg(organizationId, vacancy.requisitionId);
  return requisition ?? undefined;
}

// --- Reads ---

export interface OfferDetail {
  offer: Offer;
  versions: PublicOfferVersion[];
}

/** Returns null both when the offer doesn't exist and when it exists but isn't visible to this caller — never distinguishing the two, so visibility can't be probed via a 403-vs-404 timing/response difference. */
export async function getVisibleOfferById(
  organizationId: number,
  offerId: number,
  visibility: OfferVisibilityContext,
): Promise<OfferDetail | null> {
  const offer = await findOfferInOrg(organizationId, offerId);
  if (!offer) return null;
  const requisition = await resolveOfferRequisition(organizationId, offer);
  if (!isVisible(requisition, visibility)) return null;
  const versions = await listVersionsForOffer(organizationId, offer.id);
  return { offer, versions: versions.map(toPublicOfferVersion) };
}

/** Same non-probeable-visibility contract as getVisibleOfferById, keyed by the owning application instead — the shape §10's `GET .../applications/:id/offers` route needs. Returns null (not an empty list) since offers_application_unique enforces at most one offer per application. */
export async function getVisibleOfferByApplicationId(
  organizationId: number,
  applicationId: number,
  visibility: OfferVisibilityContext,
): Promise<OfferDetail | null> {
  const offer = await findOfferByApplicationInOrg(organizationId, applicationId);
  if (!offer) return null;
  return getVisibleOfferById(organizationId, offer.id, visibility);
}

/** Same non-probeable-visibility contract as getVisibleOfferById, keyed by an offer version instead of the offer itself — the shape the version-scoped actions (submit/approve/issue/withdraw/approval history) all resolve visibility through. */
export async function getVisibleOfferVersionById(
  organizationId: number,
  offerVersionId: number,
  visibility: OfferVisibilityContext,
): Promise<PublicOfferVersion | null> {
  const version = await findOfferVersionInOrg(organizationId, offerVersionId);
  if (!version) return null;
  const offer = await findOfferInOrg(organizationId, version.offerId);
  if (!offer) return null;
  const requisition = await resolveOfferRequisition(organizationId, offer);
  if (!isVisible(requisition, visibility)) return null;
  return toPublicOfferVersion(version);
}

export interface ListOffersParams {
  organizationId: number;
  visibility: OfferVisibilityContext;
  page: number;
  pageSize: number;
}

export interface OfferSummary {
  offer: Offer;
  currentVersion: PublicOfferVersion | null;
  vacancyTitle: string;
  applicationId: number;
}

export async function listOffers(params: ListOffersParams): Promise<{ items: OfferSummary[]; total: number }> {
  const rows = await db
    .select()
    .from(offersTable)
    .where(eq(offersTable.organizationId, params.organizationId))
    .orderBy(desc(offersTable.createdAt));

  const visible: Offer[] = [];
  for (const row of rows) {
    const requisition = await resolveOfferRequisition(params.organizationId, row);
    if (isVisible(requisition, params.visibility)) visible.push(row);
  }

  const total = visible.length;
  const start = (params.page - 1) * params.pageSize;
  const page = visible.slice(start, start + params.pageSize);

  const versionIds = page.map((o) => o.currentVersionId).filter((id): id is number => id != null);
  const versions = versionIds.length ? await db.select().from(offerVersionsTable).where(inArray(offerVersionsTable.id, versionIds)) : [];
  const versionsById = new Map(versions.map((v) => [v.id, v]));

  const applicationIds = [...new Set(page.map((o) => o.applicationId))];
  const applications = applicationIds.length ? await db.select().from(applicationsTable).where(inArray(applicationsTable.id, applicationIds)) : [];
  const applicationsById = new Map(applications.map((a) => [a.id, a]));
  const vacancyIds = [...new Set(applications.map((a) => a.vacancyId))];
  const vacancies = vacancyIds.length ? await db.select().from(vacanciesTable).where(inArray(vacanciesTable.id, vacancyIds)) : [];
  const vacanciesById = new Map(vacancies.map((v) => [v.id, v]));

  const items: OfferSummary[] = page.map((offer) => {
    const application = applicationsById.get(offer.applicationId);
    const vacancy = application ? vacanciesById.get(application.vacancyId) : undefined;
    const currentVersionRow = offer.currentVersionId != null ? versionsById.get(offer.currentVersionId) : undefined;
    return {
      offer,
      currentVersion: currentVersionRow ? toPublicOfferVersion(currentVersionRow) : null,
      vacancyTitle: vacancy?.title ?? "Unknown vacancy",
      applicationId: offer.applicationId,
    };
  });

  return { items, total };
}

// --- Writes ---


/**
 * Creates the offer envelope and its first (draft) version for an
 * application in a single transaction — enforced org-wide unique per
 * application (offers_application_unique), since this codebase's actual
 * recruitment_settings table has no multipleActiveOffersAllowed toggle to
 * condition it on (see lib/db's offers.ts schema header).
 */
export async function createOffer(params: {
  organizationId: number;
  applicationId: number;
  fields: OfferVersionFields;
  visibility: OfferVisibilityContext;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OfferDetail> {
  const application = await findApplicationInOrg(params.organizationId, params.applicationId);
  if (!application) throw new ApplicationNotFoundForOfferError();
  const vacancy = await findVacancyInOrg(params.organizationId, application.vacancyId);
  const requisition = vacancy ? await findRequisitionInOrg(params.organizationId, vacancy.requisitionId) : null;
  if (!isVisible(requisition ?? undefined, params.visibility)) throw new ApplicationNotFoundForOfferError();

  try {
    const { offer, version } = await db.transaction(async (tx) => {
      const [insertedOffer] = await tx
        .insert(offersTable)
        .values({ organizationId: params.organizationId, applicationId: params.applicationId })
        .returning();

      const [insertedVersion] = await tx
        .insert(offerVersionsTable)
        .values({
          organizationId: params.organizationId,
          offerId: insertedOffer.id,
          versionNumber: 1,
          status: "draft",
          ...params.fields,
        })
        .returning();

      const [updatedOffer] = await tx
        .update(offersTable)
        .set({ currentVersionId: insertedVersion.id })
        .where(eq(offersTable.id, insertedOffer.id))
        .returning();

      return { offer: updatedOffer, version: insertedVersion };
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "offer.created",
      targetType: "offer",
      targetId: String(offer.id),
      afterState: { applicationId: offer.applicationId, versionNumber: version.versionNumber, status: version.status },
    });

    return { offer, versions: [toPublicOfferVersion(version)] };
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateOfferError();
    throw err;
  }
}

/**
 * PATCH .../offers/:id — edits the offer's current version IN PLACE. Only
 * callable while that version is still "draft" (§14's first branch);
 * everything else (pending_approval, a terminal state, or already
 * approved/issued) throws OfferVersionNotEditableError — an
 * approved/issued version must go through createNewOfferVersion instead
 * (§14's second branch, and §10's separate `POST .../offers/:id/versions`
 * route).
 */
export async function updateDraftOfferVersion(params: {
  organizationId: number;
  offerId: number;
  fields: OfferVersionFields;
  visibility: OfferVisibilityContext;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OfferDetail> {
  const offer = await findOfferInOrg(params.organizationId, params.offerId);
  if (!offer) throw new OfferNotFoundError();
  const requisition = await resolveOfferRequisition(params.organizationId, offer);
  if (!isVisible(requisition, params.visibility)) throw new OfferNotFoundError();
  if (offer.currentVersionId == null) throw new OfferVersionNotFoundError();
  const current = await findOfferVersionInOrg(params.organizationId, offer.currentVersionId);
  if (!current) throw new OfferVersionNotFoundError();
  if (current.status !== "draft") throw new OfferVersionNotEditableError();

  const [updated] = await db.update(offerVersionsTable).set({ ...params.fields }).where(eq(offerVersionsTable.id, current.id)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "offer_version.updated",
    targetType: "offer_version",
    targetId: String(current.id),
    beforeState: { status: current.status },
    afterState: { status: updated.status },
  });

  const versions = await listVersionsForOffer(params.organizationId, offer.id);
  return { offer, versions: versions.map(toPublicOfferVersion) };
}

/**
 * POST .../offers/:id/versions — creates a new draft version from the
 * offer's current one, marking the prior version superseded in the same
 * transaction (§14's second branch). Only callable while the current
 * version is "approved" or "issued" — anything else (still draft, awaiting
 * a decision, or terminal) throws OfferVersionNotEditableError; a draft
 * version is edited via updateDraftOfferVersion instead, never re-versioned.
 */
export async function createNewOfferVersion(params: {
  organizationId: number;
  offerId: number;
  fields: OfferVersionFields;
  visibility: OfferVisibilityContext;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OfferDetail> {
  const offer = await findOfferInOrg(params.organizationId, params.offerId);
  if (!offer) throw new OfferNotFoundError();
  const requisition = await resolveOfferRequisition(params.organizationId, offer);
  if (!isVisible(requisition, params.visibility)) throw new OfferNotFoundError();
  if (offer.currentVersionId == null) throw new OfferVersionNotFoundError();
  const current = await findOfferVersionInOrg(params.organizationId, offer.currentVersionId);
  if (!current) throw new OfferVersionNotFoundError();
  if (current.status !== "approved" && current.status !== "issued") throw new OfferVersionNotEditableError();

  const { updatedOffer, newVersion } = await db.transaction(async (tx) => {
    await tx.update(offerVersionsTable).set({ status: "superseded" }).where(eq(offerVersionsTable.id, current.id));

    const [insertedVersion] = await tx
      .insert(offerVersionsTable)
      .values({
        organizationId: params.organizationId,
        offerId: offer.id,
        versionNumber: current.versionNumber + 1,
        status: "draft",
        ...params.fields,
      })
      .returning();

    const [offerRow] = await tx.update(offersTable).set({ currentVersionId: insertedVersion.id }).where(eq(offersTable.id, offer.id)).returning();

    return { updatedOffer: offerRow, newVersion: insertedVersion };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "offer_version.superseded",
    targetType: "offer_version",
    targetId: String(current.id),
    beforeState: { status: current.status },
    afterState: { status: "superseded", newVersionId: newVersion.id },
  });

  const versions = await listVersionsForOffer(params.organizationId, offer.id);
  return { offer: updatedOffer, versions: versions.map(toPublicOfferVersion) };
}

/**
 * draft -> pending_approval, creating the single required approval step
 * (offerApprovals.ts) in the same transaction — mirrors
 * jobRequisitions.ts's submitJobRequisition exactly. A conditional UPDATE
 * ... WHERE status = 'draft' takes the row lock; a concurrent or repeated
 * submit sees zero rows affected and fails as InvalidOfferTransitionError.
 */
export async function submitOfferVersionForApproval(params: {
  organizationId: number;
  offerVersionId: number;
  visibility: OfferVisibilityContext;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicOfferVersion> {
  const before = await findOfferVersionInOrg(params.organizationId, params.offerVersionId);
  if (!before) throw new OfferVersionNotFoundError();
  const offer = await findOfferInOrg(params.organizationId, before.offerId);
  if (!offer) throw new OfferVersionNotFoundError();
  const requisition = await resolveOfferRequisition(params.organizationId, offer);
  if (!isVisible(requisition, params.visibility)) throw new OfferVersionNotFoundError();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(offerVersionsTable)
      .set({ status: "pending_approval" })
      .where(and(eq(offerVersionsTable.id, params.offerVersionId), eq(offerVersionsTable.status, "draft")))
      .returning();
    if (!row) throw new InvalidOfferTransitionError("Only a draft offer version can be submitted for approval");

    await createPendingApprovalStep(tx, {
      organizationId: params.organizationId,
      offerVersionId: params.offerVersionId,
    });

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "offer_version.submitted",
    targetType: "offer_version",
    targetId: String(params.offerVersionId),
    beforeState: { status: "draft" },
    afterState: { status: updated.status },
  });

  return toPublicOfferVersion(updated);
}

/** approved -> issued. Organization-wide only (offer.issue) — gated at the route layer, since §7 marks this action with no assigned tier at all, so no visibility re-check is needed here (mirrors requisitionApprovals.ts's decide() not re-checking visibility once an admin-only permission already gated the route). */
export async function issueOfferVersion(params: {
  organizationId: number;
  offerVersionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicOfferVersion> {
  const before = await findOfferVersionInOrg(params.organizationId, params.offerVersionId);
  if (!before) throw new OfferVersionNotFoundError();

  const [updated] = await db
    .update(offerVersionsTable)
    .set({ status: "issued" })
    .where(and(eq(offerVersionsTable.id, params.offerVersionId), eq(offerVersionsTable.status, "approved")))
    .returning();
  if (!updated) throw new InvalidOfferTransitionError("Only an approved offer version can be issued");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "offer_version.issued",
    targetType: "offer_version",
    targetId: String(params.offerVersionId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return toPublicOfferVersion(updated);
}

/**
 * pending_approval, approved, or issued -> withdrawn — the only escape
 * hatch §10 names beyond submit/approve/issue, so it does double duty as
 * both "pull back an issued offer" and "kill a pending/approved one" (no
 * separate reject action exists in this workstream's scope; see the module
 * header). Organization-wide only (offer.withdraw), gated at the route
 * layer. Deliberately does not touch any outstanding offer_approvals row —
 * an approval left "pending" when its version is withdrawn out from under
 * it is never cleaned up, the same precedent cancelJobRequisition already
 * established for a requisition cancelled mid pending_approval.
 */
export async function withdrawOfferVersion(params: {
  organizationId: number;
  offerVersionId: number;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicOfferVersion> {
  const before = await findOfferVersionInOrg(params.organizationId, params.offerVersionId);
  if (!before) throw new OfferVersionNotFoundError();

  const [updated] = await db
    .update(offerVersionsTable)
    .set({ status: "withdrawn" })
    .where(and(eq(offerVersionsTable.id, params.offerVersionId), inArray(offerVersionsTable.status, ["pending_approval", "approved", "issued"])))
    .returning();
  if (!updated) throw new InvalidOfferTransitionError("Only a pending, approved, or issued offer version can be withdrawn");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "offer_version.withdrawn",
    targetType: "offer_version",
    targetId: String(params.offerVersionId),
    beforeState: { status: before.status },
    afterState: { status: updated.status, reason: params.reason ?? null },
  });

  return toPublicOfferVersion(updated);
}
