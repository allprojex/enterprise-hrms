/**
 * Vacancies (Phase 3A — the frozen plan's own W48; this session's W47): the
 * postable unit produced from an approved job requisition. Internal
 * lifecycle only (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §23 W48
 * objective: "no public exposure yet") — no candidate, application, or
 * public careers logic lives here.
 *
 * Status model simplification: see vacancies.ts's schema-file header
 * (lib/db/src/schema/vacancies.ts) for why `pending_approval`/`cancelled`
 * from the frozen plan's full §4.2 model are not implemented here — no
 * `vacancyApprovalRequired` config exists, and the frozen API plan exposes
 * only publish/pause/close/archive, no separate cancel action.
 *
 * Locations/questions are nested fields on the vacancy payload, not
 * separate CRUD endpoints — the frozen plan's §10 API Plan lists only
 * `GET/POST/PATCH .../vacancies[/:id]` plus the four lifecycle actions for
 * this workstream; no `.../vacancies/:id/locations` or `.../questions`
 * route is specified, and the frontend plan describes a single editor page
 * ("description, questions, locations, publish controls"), not separate
 * sub-resource screens. A create/update replaces the full location/question
 * set transactionally when provided — acceptable at this volume (a handful
 * of rows per vacancy) and avoids inventing undocumented API surface.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  vacanciesTable,
  vacancyLocationsTable,
  vacancyQuestionsTable,
  jobRequisitionsTable,
  recruitmentWorkflowsTable,
  branchesTable,
  type Vacancy,
  type VacancyLocation,
  type VacancyQuestion,
  type JobRequisition,
} from "@workspace/db";
import { generateToken } from "./auth";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization } from "./orgScopedRefs";
import {
  resolveRecruitmentActorEmployeeId,
  hasOrgWideRecruitmentAccess,
  isAssignedRecruitmentActor,
} from "./recruitmentAuthorization";

export class VacancyNotFoundError extends Error {
  constructor() {
    super("Vacancy not found");
    this.name = "VacancyNotFoundError";
  }
}

export class InvalidVacancyError extends Error {}

export class VacancyNotEditableError extends Error {
  constructor() {
    super("Only a draft vacancy can be edited");
    this.name = "VacancyNotEditableError";
  }
}

export class InvalidVacancyTransitionError extends Error {}

export type VacancyVisibility = "internal" | "external" | "both";

export interface VacancyLocationInput {
  branchId?: number | null;
  label?: string | null;
}

export interface VacancyQuestionInput {
  questionText: string;
  questionType?: "text" | "yes_no" | "multiple_choice" | "numeric";
  isKnockout?: boolean;
  expectedAnswer?: string | null;
  displayOrder?: number;
}

export interface VacancyFields {
  requisitionId?: number;
  workflowId?: number | null;
  title?: string;
  visibility?: VacancyVisibility;
  openingsCount?: number;
  openDate?: Date | null;
  closeDate?: Date | null;
  jobDescription?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  preferredQualifications?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  featured?: boolean;
  locations?: VacancyLocationInput[];
  questions?: VacancyQuestionInput[];
}

export interface VacancyWithChildren extends Vacancy {
  locations: VacancyLocation[];
  questions: VacancyQuestion[];
}

async function validateReferences(organizationId: number, fields: VacancyFields): Promise<void> {
  await assertBelongsToOrganization(recruitmentWorkflowsTable, fields.workflowId, organizationId, "Recruitment workflow");
  for (const location of fields.locations ?? []) {
    await assertBelongsToOrganization(branchesTable, location.branchId, organizationId, "Branch");
  }
}

/** Validates the fully-merged (not partial) vacancy state — mirrors jobRequisitions.ts's validateMergedFields convention. */
function validateMergedFields(merged: {
  title: string;
  openingsCount: number;
  filledCount: number;
  openDate: Date | null;
  closeDate: Date | null;
}): void {
  if (!merged.title.trim()) {
    throw new InvalidVacancyError("title is required");
  }
  if (merged.openingsCount <= 0) {
    throw new InvalidVacancyError("openingsCount must be positive");
  }
  if (merged.filledCount > merged.openingsCount) {
    throw new InvalidVacancyError("filledCount cannot exceed openingsCount");
  }
  if (merged.openDate != null && merged.closeDate != null && merged.openDate.getTime() > merged.closeDate.getTime()) {
    throw new InvalidVacancyError("openDate cannot be after closeDate");
  }
}

async function findOwnVacancy(organizationId: number, vacancyId: number): Promise<Vacancy | null> {
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

async function loadChildren(vacancyIds: number[]): Promise<{
  locationsByVacancy: Map<number, VacancyLocation[]>;
  questionsByVacancy: Map<number, VacancyQuestion[]>;
}> {
  const locationsByVacancy = new Map<number, VacancyLocation[]>();
  const questionsByVacancy = new Map<number, VacancyQuestion[]>();
  if (vacancyIds.length === 0) return { locationsByVacancy, questionsByVacancy };

  const locations = await db.select().from(vacancyLocationsTable).where(inArray(vacancyLocationsTable.vacancyId, vacancyIds));
  for (const loc of locations) {
    const list = locationsByVacancy.get(loc.vacancyId) ?? [];
    list.push(loc);
    locationsByVacancy.set(loc.vacancyId, list);
  }

  const questions = await db.select().from(vacancyQuestionsTable).where(inArray(vacancyQuestionsTable.vacancyId, vacancyIds));
  for (const q of questions) {
    const list = questionsByVacancy.get(q.vacancyId) ?? [];
    list.push(q);
    questionsByVacancy.set(q.vacancyId, list);
  }

  return { locationsByVacancy, questionsByVacancy };
}

function withChildren(
  vacancy: Vacancy,
  locationsByVacancy: Map<number, VacancyLocation[]>,
  questionsByVacancy: Map<number, VacancyQuestion[]>,
): VacancyWithChildren {
  return {
    ...vacancy,
    locations: locationsByVacancy.get(vacancy.id) ?? [],
    questions: questionsByVacancy.get(vacancy.id) ?? [],
  };
}

// --- Visibility (assigned recruiter/hiring manager via the linked requisition, organization-wide) ---
//
// The frozen plan's §7 permission matrix marks only "Assigned" and
// "Org-wide" for Vacancies (no "Own" tier, unlike Requisitions) — a vacancy
// carries no recruiterId/hiringManagerId of its own (§9's column list has
// none), so the assigned tier is resolved through the linked requisition's
// recruiterEmployeeId/hiringManagerEmployeeId.

export interface VacancyVisibilityContext {
  isOrgWide: boolean;
  actorEmployeeId: number | null;
}

export async function resolveVacancyVisibilityContext(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<VacancyVisibilityContext> {
  const isOrgWide = await hasOrgWideRecruitmentAccess(params.membershipId, "vacancy.manage");
  const actorEmployeeId = await resolveRecruitmentActorEmployeeId(params.organizationId, params.applicationUserId);
  return { isOrgWide, actorEmployeeId };
}

function isVisible(requisition: JobRequisition | undefined, ctx: VacancyVisibilityContext): boolean {
  if (ctx.isOrgWide) return true;
  if (!requisition) return false;
  if (isAssignedRecruitmentActor(ctx.actorEmployeeId, requisition.recruiterEmployeeId)) return true;
  if (isAssignedRecruitmentActor(ctx.actorEmployeeId, requisition.hiringManagerEmployeeId)) return true;
  return false;
}

// --- Reads ---

export interface ListVacanciesParams {
  organizationId: number;
  visibility: VacancyVisibilityContext;
  status?: string;
  requisitionId?: number;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listVacancies(params: ListVacanciesParams): Promise<{ items: VacancyWithChildren[]; total: number }> {
  const conditions = [eq(vacanciesTable.organizationId, params.organizationId)];
  if (params.status) conditions.push(eq(vacanciesTable.status, params.status as Vacancy["status"]));
  if (params.requisitionId != null) conditions.push(eq(vacanciesTable.requisitionId, params.requisitionId));

  const rows = await db
    .select()
    .from(vacanciesTable)
    .where(and(...conditions))
    .orderBy(desc(vacanciesTable.createdAt));

  const requisitionIds = [...new Set(rows.map((r) => r.requisitionId))];
  const requisitions = requisitionIds.length
    ? await db.select().from(jobRequisitionsTable).where(inArray(jobRequisitionsTable.id, requisitionIds))
    : [];
  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));

  let visible = rows.filter((r) => isVisible(requisitionById.get(r.requisitionId), params.visibility));
  if (params.search) {
    const term = params.search.toLowerCase();
    visible = visible.filter((r) => r.title.toLowerCase().includes(term));
  }

  const total = visible.length;
  const start = (params.page - 1) * params.pageSize;
  const page = visible.slice(start, start + params.pageSize);

  const { locationsByVacancy, questionsByVacancy } = await loadChildren(page.map((v) => v.id));
  return { items: page.map((v) => withChildren(v, locationsByVacancy, questionsByVacancy)), total };
}

/** Returns null both when the vacancy doesn't exist and when it exists but isn't visible to this caller — never distinguishing the two (same discipline as jobRequisitions.ts's getVisibleJobRequisitionById). */
export async function getVisibleVacancyById(
  organizationId: number,
  vacancyId: number,
  visibility: VacancyVisibilityContext,
): Promise<VacancyWithChildren | null> {
  const row = await findOwnVacancy(organizationId, vacancyId);
  if (!row) return null;
  const requisition = await findRequisitionInOrg(organizationId, row.requisitionId);
  if (!isVisible(requisition ?? undefined, visibility)) return null;
  const { locationsByVacancy, questionsByVacancy } = await loadChildren([row.id]);
  return withChildren(row, locationsByVacancy, questionsByVacancy);
}

// --- Writes ---

export async function createVacancy(params: {
  organizationId: number;
  fields: Required<Pick<VacancyFields, "requisitionId" | "title">> & VacancyFields;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<VacancyWithChildren> {
  const requisition = await findRequisitionInOrg(params.organizationId, params.fields.requisitionId);
  if (!requisition) throw new InvalidVacancyError("requisitionId does not belong to this organization");
  if (requisition.status !== "approved") {
    throw new InvalidVacancyError("A vacancy can only be created from an approved requisition");
  }

  await validateReferences(params.organizationId, params.fields);

  const openDate = params.fields.openDate ?? null;
  const closeDate = params.fields.closeDate ?? null;
  const openingsCount = params.fields.openingsCount ?? 1;
  validateMergedFields({ title: params.fields.title, openingsCount, filledCount: 0, openDate, closeDate });

  const vacancy = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vacanciesTable)
      .values({
        organizationId: params.organizationId,
        requisitionId: params.fields.requisitionId,
        workflowId: params.fields.workflowId ?? null,
        publicId: generateToken(),
        title: params.fields.title,
        visibility: params.fields.visibility ?? "internal",
        status: "draft",
        openingsCount,
        filledCount: 0,
        openDate,
        closeDate,
        jobDescription: params.fields.jobDescription ?? null,
        responsibilities: params.fields.responsibilities ?? null,
        requirements: params.fields.requirements ?? null,
        preferredQualifications: params.fields.preferredQualifications ?? null,
        seoTitle: params.fields.seoTitle ?? null,
        seoDescription: params.fields.seoDescription ?? null,
        featured: params.fields.featured ?? false,
        createdBy: params.actorApplicationUserId,
        updatedBy: params.actorApplicationUserId,
      })
      .returning();

    if (params.fields.locations?.length) {
      await tx.insert(vacancyLocationsTable).values(
        params.fields.locations.map((l) => ({
          organizationId: params.organizationId,
          vacancyId: row.id,
          branchId: l.branchId ?? null,
          label: l.label ?? null,
        })),
      );
    }
    if (params.fields.questions?.length) {
      await tx.insert(vacancyQuestionsTable).values(
        params.fields.questions.map((q, i) => ({
          organizationId: params.organizationId,
          vacancyId: row.id,
          questionText: q.questionText,
          questionType: q.questionType ?? "text",
          isKnockout: q.isKnockout ?? false,
          expectedAnswer: q.expectedAnswer ?? null,
          displayOrder: q.displayOrder ?? i,
        })),
      );
    }

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vacancy.created",
    targetType: "vacancy",
    targetId: String(vacancy.id),
    afterState: { title: vacancy.title, requisitionId: vacancy.requisitionId, status: vacancy.status },
  });

  const { locationsByVacancy, questionsByVacancy } = await loadChildren([vacancy.id]);
  return withChildren(vacancy, locationsByVacancy, questionsByVacancy);
}

export async function updateVacancy(params: {
  organizationId: number;
  vacancyId: number;
  fields: VacancyFields;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<VacancyWithChildren> {
  const before = await findOwnVacancy(params.organizationId, params.vacancyId);
  if (!before) throw new VacancyNotFoundError();
  if (before.status !== "draft") throw new VacancyNotEditableError();

  await validateReferences(params.organizationId, params.fields);

  const openDate = params.fields.openDate !== undefined ? params.fields.openDate : before.openDate;
  const closeDate = params.fields.closeDate !== undefined ? params.fields.closeDate : before.closeDate;
  const merged = {
    title: params.fields.title ?? before.title,
    openingsCount: params.fields.openingsCount ?? before.openingsCount,
    filledCount: before.filledCount,
    openDate,
    closeDate,
  };
  validateMergedFields(merged);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(vacanciesTable)
      .set({
        ...(params.fields.workflowId !== undefined && { workflowId: params.fields.workflowId }),
        ...(params.fields.title !== undefined && { title: params.fields.title }),
        ...(params.fields.visibility !== undefined && { visibility: params.fields.visibility }),
        ...(params.fields.openingsCount !== undefined && { openingsCount: params.fields.openingsCount }),
        openDate,
        closeDate,
        ...(params.fields.jobDescription !== undefined && { jobDescription: params.fields.jobDescription }),
        ...(params.fields.responsibilities !== undefined && { responsibilities: params.fields.responsibilities }),
        ...(params.fields.requirements !== undefined && { requirements: params.fields.requirements }),
        ...(params.fields.preferredQualifications !== undefined && { preferredQualifications: params.fields.preferredQualifications }),
        ...(params.fields.seoTitle !== undefined && { seoTitle: params.fields.seoTitle }),
        ...(params.fields.seoDescription !== undefined && { seoDescription: params.fields.seoDescription }),
        ...(params.fields.featured !== undefined && { featured: params.fields.featured }),
        updatedBy: params.actorApplicationUserId,
      })
      .where(eq(vacanciesTable.id, params.vacancyId))
      .returning();

    if (params.fields.locations !== undefined) {
      await tx.delete(vacancyLocationsTable).where(eq(vacancyLocationsTable.vacancyId, params.vacancyId));
      if (params.fields.locations.length) {
        await tx.insert(vacancyLocationsTable).values(
          params.fields.locations.map((l) => ({
            organizationId: params.organizationId,
            vacancyId: params.vacancyId,
            branchId: l.branchId ?? null,
            label: l.label ?? null,
          })),
        );
      }
    }
    if (params.fields.questions !== undefined) {
      await tx.delete(vacancyQuestionsTable).where(eq(vacancyQuestionsTable.vacancyId, params.vacancyId));
      if (params.fields.questions.length) {
        await tx.insert(vacancyQuestionsTable).values(
          params.fields.questions.map((q, i) => ({
            organizationId: params.organizationId,
            vacancyId: params.vacancyId,
            questionText: q.questionText,
            questionType: q.questionType ?? "text",
            isKnockout: q.isKnockout ?? false,
            expectedAnswer: q.expectedAnswer ?? null,
            displayOrder: q.displayOrder ?? i,
          })),
        );
      }
    }

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vacancy.updated",
    targetType: "vacancy",
    targetId: String(params.vacancyId),
    beforeState: { title: before.title },
    afterState: { title: updated.title },
  });

  const { locationsByVacancy, questionsByVacancy } = await loadChildren([updated.id]);
  return withChildren(updated, locationsByVacancy, questionsByVacancy);
}

/**
 * draft/scheduled/paused -> scheduled or published. If openDate is unset or
 * not in the future, the vacancy goes live immediately (published);
 * otherwise it becomes scheduled — not publicly visible until an operator
 * manually flips it again (calls publish a second time) or a future
 * scheduler workstream automates the flip, per the frozen plan's §4.2 note
 * that `scheduled` exists without a background scheduler in this phase.
 * Reused for the paused -> published "resume" direction too (§4.2's
 * `paused <-> published`) — the frozen API plan defines one publish action,
 * not a separate resume action.
 */
export async function publishVacancy(params: {
  organizationId: number;
  vacancyId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Vacancy> {
  const before = await findOwnVacancy(params.organizationId, params.vacancyId);
  if (!before) throw new VacancyNotFoundError();

  // Only the initial publish from draft weighs openDate to decide whether to
  // go live now or schedule for later. A subsequent publish call — from
  // scheduled (the manual flip) or paused (resume) — always goes straight
  // to published; re-evaluating openDate on every call would otherwise trap
  // a still-future-dated vacancy in scheduled forever, with no way for an
  // operator to flip it live early.
  const isFutureDated = before.openDate != null && before.openDate.getTime() > Date.now();
  const nextStatus: Vacancy["status"] = before.status === "draft" && isFutureDated ? "scheduled" : "published";

  const [updated] = await db
    .update(vacanciesTable)
    .set({ status: nextStatus, updatedBy: params.actorApplicationUserId })
    .where(and(eq(vacanciesTable.id, params.vacancyId), inArray(vacanciesTable.status, ["draft", "scheduled", "paused"])))
    .returning();
  if (!updated) throw new InvalidVacancyTransitionError("Only a draft, scheduled, or paused vacancy can be published");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vacancy.published",
    targetType: "vacancy",
    targetId: String(params.vacancyId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

/** published -> paused. */
export async function pauseVacancy(params: {
  organizationId: number;
  vacancyId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Vacancy> {
  const before = await findOwnVacancy(params.organizationId, params.vacancyId);
  if (!before) throw new VacancyNotFoundError();

  const [updated] = await db
    .update(vacanciesTable)
    .set({ status: "paused", updatedBy: params.actorApplicationUserId })
    .where(and(eq(vacanciesTable.id, params.vacancyId), eq(vacanciesTable.status, "published")))
    .returning();
  if (!updated) throw new InvalidVacancyTransitionError("Only a published vacancy can be paused");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vacancy.paused",
    targetType: "vacancy",
    targetId: String(params.vacancyId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

/**
 * draft/scheduled/published/paused -> closed. The single terminal-exit
 * action this workstream implements — see the schema-file header for why
 * the frozen plan's separate `cancelled` state is folded into `closed` here.
 */
export async function closeVacancy(params: {
  organizationId: number;
  vacancyId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Vacancy> {
  const before = await findOwnVacancy(params.organizationId, params.vacancyId);
  if (!before) throw new VacancyNotFoundError();

  const [updated] = await db
    .update(vacanciesTable)
    .set({ status: "closed", updatedBy: params.actorApplicationUserId })
    .where(and(eq(vacanciesTable.id, params.vacancyId), inArray(vacanciesTable.status, ["draft", "scheduled", "published", "paused"])))
    .returning();
  if (!updated) throw new InvalidVacancyTransitionError("A closed or archived vacancy cannot be closed again");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vacancy.closed",
    targetType: "vacancy",
    targetId: String(params.vacancyId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

/** closed -> archived. */
export async function archiveVacancy(params: {
  organizationId: number;
  vacancyId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Vacancy> {
  const before = await findOwnVacancy(params.organizationId, params.vacancyId);
  if (!before) throw new VacancyNotFoundError();

  const [updated] = await db
    .update(vacanciesTable)
    .set({ status: "archived", updatedBy: params.actorApplicationUserId })
    .where(and(eq(vacanciesTable.id, params.vacancyId), eq(vacanciesTable.status, "closed")))
    .returning();
  if (!updated) throw new InvalidVacancyTransitionError("Only a closed vacancy can be archived");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "vacancy.archived",
    targetType: "vacancy",
    targetId: String(params.vacancyId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}
