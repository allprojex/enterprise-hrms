/**
 * WS-26 — submissions: lifecycle, revisions, chronology, finalization.
 *
 * State machine (server-enforced; every transition appends a revision when
 * content changed and always appends an event):
 *
 *   draft ──submit──► pending_approval ──approve/complete (last stage)──► approved ──finalize──► finalized ──► archived
 *     ▲                     │ return                                        │ reject
 *     └── returned ◄────────┘                                            rejected ──► archived
 *          │ resubmit
 *          └──────────────► pending_approval (stage 1)
 *
 * A template with no stages goes draft → approved on submit.
 *
 * Rules held here, not in routes:
 *   - Every read/write is scoped by organization; foreign ids are "not found".
 *   - The version used is the template's published version at creation and
 *     is frozen on the submission (`templateVersionId`); the version's
 *     `firstUsedAt` is set on first use so the definition can never change.
 *   - Stage count is frozen at first submit (WS-13 rule).
 *   - Maker-checker: approve / return / reject may not be taken by the
 *     submission's creator or its subject employee, checked by BOTH user id
 *     and membership id.
 *   - Revisions are append-only; the current revision pointer advances.
 *   - Finalization renders the final PDF once, stores it through the WS-5
 *     generated_documents sink with a SHA-256, and can never run twice.
 */
import { and, eq, asc, desc, inArray, sql } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  formSubmissionsTable,
  formSubmissionRevisionsTable,
  formSubmissionEventsTable,
  formTemplateVersionsTable,
  formTemplatesTable,
  formWorkflowStagesTable,
  generatedDocumentsTable,
  employeesTable,
  employeeUserLinksTable,
  organizationMembershipsTable,
  usersTable,
  type FormSubmission,
  type FormSubmissionRevision,
  type FormSubmissionEvent,
  type FormWorkflowStage,
  type FormTemplate,
  type FormTemplateVersion,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { writeOrgFile, discardOrphanedFile } from "../fileStorage";
import { getEffectivePermissions } from "../permissions";
import type { FormDefinition } from "./definition";
import type { ResolvedAssistance } from "./assistedSubmission";
import { validateAnswers, computeValues, sectionKeysEditableBy, type Answers, type ComputedValues } from "./answers";
import { resolveAutofill, readonlyKeys, type AutofillSnapshot } from "./bindings";
import { redactedSensitiveKeys, redactValues } from "./sensitivity";
import { getTemplate, getPublishedVersion, getVersion, listStages, membershipSatisfiesFormStage, parseDefinition } from "./templates";
import { renderSubmissionDocument, type DocumentKind, type HistoryLine } from "./render";

export class FormSubmissionNotFoundError extends Error {}
export class FormSubmissionStateError extends Error {}
export class FormStageAuthorityError extends Error {}
export class FormSubmissionFinalizedError extends Error {}
export class FormSubjectNotFoundError extends Error {}

export interface FormActor {
  userId: number;
  membershipId: number;
  requestId?: string | null;
}

export type StageAction = "complete" | "approve" | "return" | "reject";

const STORAGE_SUBDIR = "forms";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/* ---------------------------------------------------------------------- */
/* Reads                                                                   */
/* ---------------------------------------------------------------------- */

export async function getSubmission(organizationId: number, submissionId: number): Promise<FormSubmission | null> {
  const [s] = await db
    .select()
    .from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.organizationId, organizationId)))
    .limit(1);
  return s ?? null;
}

export async function getRevision(organizationId: number, revisionId: number): Promise<FormSubmissionRevision | null> {
  const [r] = await db
    .select()
    .from(formSubmissionRevisionsTable)
    .where(and(eq(formSubmissionRevisionsTable.id, revisionId), eq(formSubmissionRevisionsTable.organizationId, organizationId)))
    .limit(1);
  return r ?? null;
}

export async function listRevisions(organizationId: number, submissionId: number): Promise<FormSubmissionRevision[]> {
  return db
    .select()
    .from(formSubmissionRevisionsTable)
    .where(and(eq(formSubmissionRevisionsTable.submissionId, submissionId), eq(formSubmissionRevisionsTable.organizationId, organizationId)))
    .orderBy(asc(formSubmissionRevisionsTable.revisionNumber));
}

export async function listEvents(organizationId: number, submissionId: number): Promise<FormSubmissionEvent[]> {
  return db
    .select()
    .from(formSubmissionEventsTable)
    .where(and(eq(formSubmissionEventsTable.submissionId, submissionId), eq(formSubmissionEventsTable.organizationId, organizationId)))
    .orderBy(asc(formSubmissionEventsTable.occurredAt), asc(formSubmissionEventsTable.id));
}

export interface SubmissionListFilter {
  templateId?: number;
  subjectEmployeeId?: number;
  status?: FormSubmission["status"];
  createdByMembershipId?: number;
}

export async function listSubmissions(organizationId: number, filter: SubmissionListFilter = {}) {
  const conditions = [eq(formSubmissionsTable.organizationId, organizationId)];
  if (filter.templateId) conditions.push(eq(formSubmissionsTable.templateId, filter.templateId));
  if (filter.subjectEmployeeId) conditions.push(eq(formSubmissionsTable.subjectEmployeeId, filter.subjectEmployeeId));
  if (filter.status) conditions.push(eq(formSubmissionsTable.status, filter.status));
  if (filter.createdByMembershipId) conditions.push(eq(formSubmissionsTable.createdByMembershipId, filter.createdByMembershipId));
  const rows = await db
    .select({
      submission: formSubmissionsTable,
      templateTitle: formTemplatesTable.title,
      templateKey: formTemplatesTable.templateKey,
      formType: formTemplatesTable.formType,
      versionNumber: formTemplateVersionsTable.versionNumber,
      subjectFirstName: employeesTable.firstName,
      subjectLastName: employeesTable.lastName,
    })
    .from(formSubmissionsTable)
    .innerJoin(formTemplatesTable, eq(formTemplatesTable.id, formSubmissionsTable.templateId))
    .innerJoin(formTemplateVersionsTable, eq(formTemplateVersionsTable.id, formSubmissionsTable.templateVersionId))
    .innerJoin(employeesTable, eq(employeesTable.id, formSubmissionsTable.subjectEmployeeId))
    .where(and(...conditions))
    .orderBy(desc(formSubmissionsTable.updatedAt));
  return rows.map((r) => toSummary(r));
}

export function toSummary(r: {
  submission: FormSubmission;
  templateTitle: string;
  templateKey: string;
  formType: FormTemplate["formType"];
  versionNumber: number;
  subjectFirstName: string;
  subjectLastName: string;
}) {
  const s = r.submission;
  return {
    id: s.id,
    organizationId: s.organizationId,
    templateId: s.templateId,
    templateKey: r.templateKey,
    templateTitle: r.templateTitle,
    formType: r.formType,
    templateVersionId: s.templateVersionId,
    versionNumber: r.versionNumber,
    subjectEmployeeId: s.subjectEmployeeId,
    subjectName: `${r.subjectFirstName} ${r.subjectLastName}`.trim(),
    status: s.status,
    currentStageOrder: s.currentStageOrder,
    stageCountSnapshot: s.stageCountSnapshot,
    createdByMembershipId: s.createdByMembershipId,
    // HR monitoring marker. The CATEGORY is safe to list; assistanceNotes is
    // deliberately absent from every summary projection because it may carry
    // medical or accessibility detail.
    assisted: s.assisted,
    assistanceReason: s.assistanceReason,
    submittedAt: s.submittedAt,
    approvedAt: s.approvedAt,
    finalizedAt: s.finalizedAt,
    finalDocumentId: s.finalDocumentId,
    finalSha256: s.finalSha256,
    archivedAt: s.archivedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/* ---------------------------------------------------------------------- */
/* Viewer context and visibility                                           */
/* ---------------------------------------------------------------------- */

export interface ViewerContext {
  userId: number;
  membershipId: number;
  employeeId: number | null;
  permissions: Set<string>;
}

export async function buildViewerContext(organizationId: number, actor: FormActor): Promise<ViewerContext> {
  const [link] = await db
    .select({ employeeId: employeeUserLinksTable.employeeId })
    .from(employeeUserLinksTable)
    .innerJoin(employeesTable, eq(employeesTable.id, employeeUserLinksTable.employeeId))
    .where(and(eq(employeeUserLinksTable.organizationMembershipId, actor.membershipId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  return { userId: actor.userId, membershipId: actor.membershipId, employeeId: link?.employeeId ?? null, permissions: await getEffectivePermissions(actor.membershipId) };
}

/**
 * Who may open a submission: HR (`form.read`), the subject employee, the
 * creator, and the actor of the current pending stage. Anyone else gets
 * "not found" from the route so the id's existence is not confirmed.
 */
export async function canViewSubmission(organizationId: number, submission: FormSubmission, viewer: ViewerContext, stages?: FormWorkflowStage[]): Promise<boolean> {
  if (viewer.permissions.has("form.read")) return true;
  if (viewer.employeeId != null && viewer.employeeId === submission.subjectEmployeeId) return true;
  if (submission.createdByMembershipId === viewer.membershipId) return true;
  if (submission.status === "pending_approval" && submission.currentStageOrder != null) {
    const stageRows = stages ?? (await listStages(organizationId, submission.templateVersionId));
    const stage = stageRows.find((s) => s.stageOrder === submission.currentStageOrder);
    if (stage && (await membershipSatisfiesFormStage({ organizationId, stage, membershipId: viewer.membershipId, subjectEmployeeId: submission.subjectEmployeeId }))) return true;
  }
  return false;
}

/** Submissions a non-HR viewer may list: own (as subject or creator) plus those awaiting their stage. */
export async function listVisibleSubmissions(organizationId: number, viewer: ViewerContext, filter: SubmissionListFilter = {}) {
  const all = await listSubmissions(organizationId, filter);
  if (viewer.permissions.has("form.read")) return all;
  const stageCache = new Map<number, FormWorkflowStage[]>();
  const visible = [];
  for (const summary of all) {
    const own = (viewer.employeeId != null && summary.subjectEmployeeId === viewer.employeeId) || summary.createdByMembershipId === viewer.membershipId;
    if (own) {
      visible.push(summary);
      continue;
    }
    if (summary.status === "pending_approval" && summary.currentStageOrder != null) {
      let stages = stageCache.get(summary.templateVersionId);
      if (!stages) {
        stages = await listStages(organizationId, summary.templateVersionId);
        stageCache.set(summary.templateVersionId, stages);
      }
      const stage = stages.find((s) => s.stageOrder === summary.currentStageOrder);
      if (stage && (await membershipSatisfiesFormStage({ organizationId, stage, membershipId: viewer.membershipId, subjectEmployeeId: summary.subjectEmployeeId }))) {
        visible.push(summary);
      }
    }
  }
  return visible;
}

/* ---------------------------------------------------------------------- */
/* Detail                                                                  */
/* ---------------------------------------------------------------------- */

export interface SubmissionDetail {
  submission: ReturnType<typeof toSummary>;
  template: { id: number; templateKey: string; title: string; formType: FormTemplate["formType"] };
  version: { id: number; versionNumber: number; definition: FormDefinition; signaturePolicy: unknown; definitionSha256: string };
  stages: { id: number; stageOrder: number; name: string; participant: string; resolver: string; editableSectionKeys: string[]; allowedActions: string[]; signatureSlotKey: string | null }[];
  currentRevision: { id: number; revisionNumber: number; kind: string; answers: Answers; autofillSnapshot: AutofillSnapshot; computed: ComputedValues; stageOrder: number | null; savedAt: Date } | null;
  revisions: { id: number; revisionNumber: number; kind: string; stageOrder: number | null; savedByMembershipId: number; savedAt: Date }[];
  events: { id: number; eventType: string; stageOrder: number | null; stageName: string | null; revisionId: number | null; notes: string | null; details: unknown; actorUserId: number | null; actorMembershipId: number | null; actorName: string | null; occurredAt: Date }[];
  viewer: { canEdit: boolean; editableSectionKeys: string[]; canSubmit: boolean; availableActions: StageAction[]; canFinalize: boolean; canArchive: boolean; isSubject: boolean };
  /** WS-26C: sensitive field keys whose value was blanked for THIS viewer (structure preserved). */
  sensitiveRedactedKeys: string[];
}

async function loadTemplateAndVersion(organizationId: number, submission: FormSubmission): Promise<{ template: FormTemplate; version: FormTemplateVersion }> {
  const template = await getTemplate(organizationId, submission.templateId);
  const version = await getVersion(organizationId, submission.templateVersionId);
  if (!template || !version) throw new FormSubmissionNotFoundError();
  return { template, version };
}

async function actorNames(userIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(userIds.filter((id): id is number => id != null))];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(inArray(usersTable.id, ids));
  return new Map(rows.map((r) => [r.id, `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()]));
}

async function currentStageFor(organizationId: number, submission: FormSubmission, stages: FormWorkflowStage[], viewer: ViewerContext): Promise<FormWorkflowStage | null> {
  if (submission.status !== "pending_approval" || submission.currentStageOrder == null) return null;
  const stage = stages.find((s) => s.stageOrder === submission.currentStageOrder);
  if (!stage) return null;
  const ok = await membershipSatisfiesFormStage({ organizationId, stage, membershipId: viewer.membershipId, subjectEmployeeId: submission.subjectEmployeeId });
  return ok ? stage : null;
}

export async function getSubmissionDetail(organizationId: number, submissionId: number, viewer: ViewerContext): Promise<SubmissionDetail | null> {
  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) return null;
  const stages = await listStages(organizationId, submission.templateVersionId);
  if (!(await canViewSubmission(organizationId, submission, viewer, stages))) return null;
  const { template, version } = await loadTemplateAndVersion(organizationId, submission);
  const [subject] = await db
    .select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName })
    .from(employeesTable)
    .where(eq(employeesTable.id, submission.subjectEmployeeId))
    .limit(1);
  const revisions = await listRevisions(organizationId, submission.id);
  const events = await listEvents(organizationId, submission.id);
  const names = await actorNames(events.map((e) => e.actorUserId).filter((id): id is number => id != null));
  const current = revisions.find((r) => r.id === submission.currentRevisionId) ?? revisions[revisions.length - 1] ?? null;

  const isSubject = viewer.employeeId != null && viewer.employeeId === submission.subjectEmployeeId;
  const isCreator = submission.createdByMembershipId === viewer.membershipId;
  const editableByEmployee = (submission.status === "draft" || submission.status === "returned") && (isSubject || isCreator);
  const definition = parseDefinition(version);
  // WS-26C: blank sensitive field values this viewer is not authorized to see
  // (subject sees own; others need the field's readPermission). Labels/structure stay.
  const redacted = redactedSensitiveKeys(definition, viewer, submission.subjectEmployeeId);
  const stage = await currentStageFor(organizationId, submission, stages, viewer);
  const stageEditable = stage ? (stage.editableSectionKeys as string[]) : [];
  const editableSectionKeys = editableByEmployee ? [...sectionKeysEditableBy(definition, "employee")] : stageEditable;
  const isMaker = isSubject || isCreator || submission.createdByMembershipId === viewer.membershipId;
  const availableActions = stage
    ? (stage.allowedActions as StageAction[]).filter((a) => a === "complete" || !isMaker)
    : [];

  return {
    submission: toSummary({
      submission,
      templateTitle: template.title,
      templateKey: template.templateKey,
      formType: template.formType,
      versionNumber: version.versionNumber,
      subjectFirstName: subject?.firstName ?? "",
      subjectLastName: subject?.lastName ?? "",
    }),
    template: { id: template.id, templateKey: template.templateKey, title: template.title, formType: template.formType },
    version: { id: version.id, versionNumber: version.versionNumber, definition, signaturePolicy: version.signaturePolicy, definitionSha256: version.definitionSha256 },
    stages: stages.map((s) => ({
      id: s.id,
      stageOrder: s.stageOrder,
      name: s.name,
      participant: s.participant,
      resolver: s.resolver,
      editableSectionKeys: s.editableSectionKeys as string[],
      allowedActions: s.allowedActions as string[],
      signatureSlotKey: s.signatureSlotKey,
    })),
    currentRevision: current
      ? { id: current.id, revisionNumber: current.revisionNumber, kind: current.kind, answers: redactValues(current.answers as Answers, redacted), autofillSnapshot: redactValues(current.autofillSnapshot as AutofillSnapshot, redacted), computed: current.computed as ComputedValues, stageOrder: current.stageOrder, savedAt: current.savedAt }
      : null,
    revisions: revisions.map((r) => ({ id: r.id, revisionNumber: r.revisionNumber, kind: r.kind, stageOrder: r.stageOrder, savedByMembershipId: r.savedByMembershipId, savedAt: r.savedAt })),
    events: events.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      stageOrder: e.stageOrder,
      stageName: e.stageName,
      revisionId: e.revisionId,
      notes: e.notes,
      details: e.details,
      actorUserId: e.actorUserId,
      actorMembershipId: e.actorMembershipId,
      actorName: e.actorUserId != null ? (names.get(e.actorUserId) ?? null) : null,
      occurredAt: e.occurredAt,
    })),
    viewer: {
      canEdit: editableByEmployee || editableSectionKeys.length > 0,
      editableSectionKeys,
      canSubmit: editableByEmployee,
      availableActions,
      canFinalize: submission.status === "approved" && viewer.permissions.has("form.finalize"),
      canArchive: (submission.status === "finalized" || submission.status === "rejected") && viewer.permissions.has("form.approve"),
      isSubject,
    },
    sensitiveRedactedKeys: [...redacted],
  };
}

/* ---------------------------------------------------------------------- */
/* Writes                                                                  */
/* ---------------------------------------------------------------------- */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function appendEvent(
  tx: Tx,
  params: {
    organizationId: number;
    submissionId: number;
    eventType: FormSubmissionEvent["eventType"];
    stageOrder?: number | null;
    stageName?: string | null;
    revisionId?: number | null;
    notes?: string | null;
    details?: Record<string, unknown> | null;
    actor: FormActor;
  },
): Promise<FormSubmissionEvent> {
  const [event] = await tx
    .insert(formSubmissionEventsTable)
    .values({
      organizationId: params.organizationId,
      submissionId: params.submissionId,
      eventType: params.eventType,
      stageOrder: params.stageOrder ?? null,
      stageName: params.stageName ?? null,
      revisionId: params.revisionId ?? null,
      notes: params.notes?.trim() || null,
      details: params.details ?? null,
      actorUserId: params.actor.userId,
      actorMembershipId: params.actor.membershipId,
      requestId: params.actor.requestId ?? null,
    })
    .returning();
  return event;
}

async function appendRevision(
  tx: Tx,
  params: {
    organizationId: number;
    submission: FormSubmission;
    kind: FormSubmissionRevision["kind"];
    answers: Answers;
    autofillSnapshot: AutofillSnapshot;
    computed: ComputedValues;
    stageOrder?: number | null;
    actor: FormActor;
  },
): Promise<FormSubmissionRevision> {
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${formSubmissionRevisionsTable.revisionNumber}), 0)` })
    .from(formSubmissionRevisionsTable)
    .where(eq(formSubmissionRevisionsTable.submissionId, params.submission.id));
  const [revision] = await tx
    .insert(formSubmissionRevisionsTable)
    .values({
      organizationId: params.organizationId,
      submissionId: params.submission.id,
      revisionNumber: Number(max) + 1,
      kind: params.kind,
      answers: params.answers,
      autofillSnapshot: params.autofillSnapshot,
      computed: params.computed,
      stageOrder: params.stageOrder ?? null,
      savedByMembershipId: params.actor.membershipId,
    })
    .returning();
  await tx.update(formSubmissionsTable).set({ currentRevisionId: revision.id }).where(eq(formSubmissionsTable.id, params.submission.id));
  return revision;
}

function audit(actor: FormActor, organizationId: number, eventType: string, submissionId: number, metadata: Record<string, unknown>) {
  return recordAuditEvent({
    actorApplicationUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    organizationId,
    eventType,
    targetType: "form_submission",
    targetId: String(submissionId),
    metadata,
  });
}

export async function createSubmission(params: {
  organizationId: number;
  templateId: number;
  subjectEmployeeId: number;
  actor: FormActor;
  /**
   * Present only for an assisted ("on behalf of") creation, already authorized
   * and validated by lib/formEngine/assistedSubmission.ts. Written once here and
   * never updated afterwards — these columns are provenance, not state.
   */
  assistance?: ResolvedAssistance;
}) {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template || template.status !== "active") throw new FormSubmissionStateError("Template is not available");
  const version = await getPublishedVersion(params.organizationId, params.templateId);
  if (!version) throw new FormSubmissionStateError("Template has no published version");
  const [subject] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.subjectEmployeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!subject) throw new FormSubjectNotFoundError();
  const definition = parseDefinition(version);
  const autofill = await resolveAutofill(params.organizationId, params.subjectEmployeeId, definition);

  const created = await db.transaction(async (tx) => {
    // Freeze the version the moment a submission references it.
    await tx
      .update(formTemplateVersionsTable)
      .set({ firstUsedAt: new Date() })
      .where(and(eq(formTemplateVersionsTable.id, version.id), sql`${formTemplateVersionsTable.firstUsedAt} IS NULL`));
    const [submission] = await tx
      .insert(formSubmissionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: template.id,
        templateVersionId: version.id,
        subjectEmployeeId: params.subjectEmployeeId,
        status: "draft",
        createdByMembershipId: params.actor.membershipId,
        assisted: params.assistance?.assisted ?? false,
        assistanceReason: params.assistance?.assistanceReason ?? null,
        assistanceNotes: params.assistance?.assistanceNotes ?? null,
      })
      .returning();
    const revision = await appendRevision(tx, { organizationId: params.organizationId, submission, kind: "draft", answers: {}, autofillSnapshot: autofill, computed: computeValues(definition, {}), actor: params.actor });
    await appendEvent(tx, {
      organizationId: params.organizationId,
      submissionId: submission.id,
      eventType: params.assistance ? "created_on_behalf" : "created",
      revisionId: revision.id,
      actor: params.actor,
      // Category only. assistanceNotes may carry medical detail and is never
      // copied into the event chronology or the audit log.
      details: {
        templateVersionId: version.id,
        versionNumber: version.versionNumber,
        ...(params.assistance
          ? { assisted: true, assistanceReason: params.assistance.assistanceReason, subjectEmployeeId: params.subjectEmployeeId }
          : {}),
      },
    });
    return { ...submission, currentRevisionId: revision.id };
  });
  await audit(params.actor, params.organizationId, params.assistance ? "form.created_on_behalf" : "form.created", created.id, {
    templateId: template.id,
    templateVersionId: version.id,
    subjectEmployeeId: params.subjectEmployeeId,
    ...(params.assistance ? { assisted: true, assistanceReason: params.assistance.assistanceReason } : {}),
  });
  return created;
}

async function loadForWrite(organizationId: number, submissionId: number) {
  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) throw new FormSubmissionNotFoundError();
  const { template, version } = await loadTemplateAndVersion(organizationId, submission);
  const definition = parseDefinition(version);
  const revisions = await listRevisions(organizationId, submission.id);
  const current = revisions.find((r) => r.id === submission.currentRevisionId) ?? revisions[revisions.length - 1] ?? null;
  const stages = await listStages(organizationId, version.id);
  return { submission, template, version, definition, current, stages };
}

function assertEmployeeMayEdit(submission: FormSubmission, viewer: ViewerContext) {
  const isSubject = viewer.employeeId != null && viewer.employeeId === submission.subjectEmployeeId;
  const isCreator = submission.createdByMembershipId === viewer.membershipId;
  if (!isSubject && !isCreator) throw new FormStageAuthorityError("Only the subject employee or the creator may edit this form");
}

export async function saveDraft(params: { organizationId: number; submissionId: number; answers: unknown; viewer: ViewerContext; actor: FormActor }) {
  const { submission, definition, current } = await loadForWrite(params.organizationId, params.submissionId);
  if (submission.status !== "draft" && submission.status !== "returned") throw new FormSubmissionStateError("Only a draft or returned form can be edited");
  assertEmployeeMayEdit(submission, params.viewer);
  const answers = validateAnswers(definition, params.answers, {
    strict: false,
    readonlyKeys: readonlyKeys(definition),
    editableSections: sectionKeysEditableBy(definition, "employee"),
    previous: (current?.answers as Answers) ?? null,
  });
  const autofill = await resolveAutofill(params.organizationId, submission.subjectEmployeeId, definition);
  const computed = computeValues(definition, answers);
  const revision = await db.transaction(async (tx) => {
    const r = await appendRevision(tx, { organizationId: params.organizationId, submission, kind: "draft", answers, autofillSnapshot: autofill, computed, actor: params.actor });
    await appendEvent(tx, { organizationId: params.organizationId, submissionId: submission.id, eventType: "draft_saved", revisionId: r.id, actor: params.actor });
    return r;
  });
  return revision;
}

export async function submit(params: { organizationId: number; submissionId: number; answers?: unknown; viewer: ViewerContext; actor: FormActor }) {
  const { submission, definition, current, stages, version, template } = await loadForWrite(params.organizationId, params.submissionId);
  if (submission.status !== "draft" && submission.status !== "returned") throw new FormSubmissionStateError("Only a draft or returned form can be submitted");
  assertEmployeeMayEdit(submission, params.viewer);
  const answers = validateAnswers(definition, params.answers ?? (current?.answers as Answers) ?? {}, {
    strict: true,
    readonlyKeys: readonlyKeys(definition),
    editableSections: sectionKeysEditableBy(definition, "employee"),
    previous: (current?.answers as Answers) ?? null,
  });
  const autofill = await resolveAutofill(params.organizationId, submission.subjectEmployeeId, definition);
  const computed = computeValues(definition, answers);
  const resubmission = submission.status === "returned";
  const stageCount = submission.stageCountSnapshot ?? stages.length;
  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    const revision = await appendRevision(tx, { organizationId: params.organizationId, submission, kind: resubmission ? "resubmitted" : "submitted", answers, autofillSnapshot: autofill, computed, actor: params.actor });
    const next: Partial<FormSubmission> = stageCount > 0
      ? { status: "pending_approval", currentStageOrder: 1 }
      : { status: "approved", currentStageOrder: null, approvedAt: now };
    const [s] = await tx
      .update(formSubmissionsTable)
      .set({ ...next, stageCountSnapshot: stageCount, submittedAt: submission.submittedAt ?? now })
      .where(and(eq(formSubmissionsTable.id, submission.id), inArray(formSubmissionsTable.status, ["draft", "returned"])))
      .returning();
    if (!s) throw new FormSubmissionStateError("Form state changed; reload and try again");
    await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType: resubmission ? "resubmitted" : "submitted", revisionId: revision.id, actor: params.actor, details: { stageCount } });
    if (stageCount === 0) await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType: "approved", revisionId: revision.id, actor: params.actor, details: { automatic: true } });
    return s;
  });
  await audit(params.actor, params.organizationId, resubmission ? "form.resubmitted" : "form.submitted", updated.id, { templateId: template.id, templateVersionId: version.id, stageCount });
  return updated;
}

export async function stageAction(params: {
  organizationId: number;
  submissionId: number;
  action: StageAction;
  answers?: unknown;
  notes?: string | null;
  viewer: ViewerContext;
  actor: FormActor;
}) {
  const { submission, definition, current, stages, template, version } = await loadForWrite(params.organizationId, params.submissionId);
  if (submission.status !== "pending_approval" || submission.currentStageOrder == null) throw new FormSubmissionStateError("Form is not awaiting a stage");
  const stage = stages.find((s) => s.stageOrder === submission.currentStageOrder);
  if (!stage) throw new FormSubmissionStateError("Stage configuration is missing for this version");
  if (!(stage.allowedActions as string[]).includes(params.action)) throw new FormStageAuthorityError(`Action "${params.action}" is not allowed at this stage`);
  const authorized = await membershipSatisfiesFormStage({ organizationId: params.organizationId, stage, membershipId: params.viewer.membershipId, subjectEmployeeId: submission.subjectEmployeeId });
  if (!authorized) throw new FormStageAuthorityError("You are not the actor for this stage");

  if (params.action !== "complete") {
    // Maker-checker: a decision may not be taken by the maker (creator) or the subject, by user AND membership.
    const [creator] = await db.select({ userId: organizationMembershipsTable.applicationUserId }).from(organizationMembershipsTable).where(eq(organizationMembershipsTable.id, submission.createdByMembershipId)).limit(1);
    const isCreator = submission.createdByMembershipId === params.viewer.membershipId || creator?.userId === params.viewer.userId;
    const isSubject = params.viewer.employeeId != null && params.viewer.employeeId === submission.subjectEmployeeId;
    if (isCreator || isSubject) throw new FormStageAuthorityError("A form cannot be decided by the person who raised it or whom it concerns");
  }

  const editable = new Set(stage.editableSectionKeys as string[]);
  let revisionId: number | null = null;
  const previous = (current?.answers as Answers) ?? {};
  const answers = params.answers === undefined
    ? previous
    : validateAnswers(definition, params.answers, { strict: params.action === "complete" || params.action === "approve", readonlyKeys: readonlyKeys(definition), editableSections: editable, previous });
  const autofill = (current?.autofillSnapshot as AutofillSnapshot) ?? {};
  const computed = computeValues(definition, answers);
  const isLast = submission.currentStageOrder >= (submission.stageCountSnapshot ?? stages.length);
  const now = new Date();

  const updated = await db.transaction(async (tx) => {
    if (params.answers !== undefined) {
      const r = await appendRevision(tx, { organizationId: params.organizationId, submission, kind: "stage_update", answers, autofillSnapshot: autofill, computed, stageOrder: stage.stageOrder, actor: params.actor });
      revisionId = r.id;
    }
    let next: Partial<FormSubmission>;
    let eventType: FormSubmissionEvent["eventType"];
    switch (params.action) {
      case "return":
        next = { status: "returned", currentStageOrder: null };
        eventType = "returned";
        break;
      case "reject":
        next = { status: "rejected", currentStageOrder: null };
        eventType = "rejected";
        break;
      default:
        next = isLast ? { status: "approved", currentStageOrder: null, approvedAt: now } : { currentStageOrder: submission.currentStageOrder! + 1 };
        eventType = "stage_completed";
    }
    const [s] = await tx
      .update(formSubmissionsTable)
      .set(next)
      .where(and(eq(formSubmissionsTable.id, submission.id), eq(formSubmissionsTable.status, "pending_approval"), eq(formSubmissionsTable.currentStageOrder, stage.stageOrder)))
      .returning();
    if (!s) throw new FormSubmissionStateError("Form state changed; reload and try again");
    await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType, stageOrder: stage.stageOrder, stageName: stage.name, revisionId, notes: params.notes, actor: params.actor, details: { action: params.action } });
    if (eventType === "stage_completed" && isLast) {
      await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType: "approved", stageOrder: stage.stageOrder, stageName: stage.name, revisionId, actor: params.actor });
    }
    return s;
  });
  await audit(params.actor, params.organizationId, `form.${params.action === "complete" ? "stage_completed" : params.action === "approve" ? (isLast ? "approved" : "stage_completed") : params.action === "return" ? "returned" : "rejected"}`, updated.id, {
    templateId: template.id,
    templateVersionId: version.id,
    stageOrder: stage.stageOrder,
    stageName: stage.name,
    action: params.action,
  });
  return updated;
}

/**
 * Finalization: renders the final document once, stores it through the WS-5
 * generated_documents sink, records its SHA-256 and moves to `finalized`.
 * A second call is refused — the snapshot is never regenerated or replaced.
 */
export async function finalize(params: { organizationId: number; submissionId: number; viewer: ViewerContext; actor: FormActor }) {
  const { submission, template, version } = await loadForWrite(params.organizationId, params.submissionId);
  if (submission.finalizedAt || submission.finalDocumentId) throw new FormSubmissionFinalizedError("This form is already finalized");
  if (submission.status !== "approved") throw new FormSubmissionStateError("Only an approved form can be finalized");
  if (!params.viewer.permissions.has("form.finalize")) throw new FormStageAuthorityError("form.finalize is required");

  const pdf = await renderSubmissionDocument({ organizationId: params.organizationId, submissionId: submission.id, kind: "final" });
  const hash = sha256(pdf);
  const fileName = `${template.title.replace(/[^A-Za-z0-9-_ ]/g, "").trim() || "form"} - ${submission.id} - FINAL.pdf`;
  const storageKey = await writeOrgFile(params.organizationId, STORAGE_SUBDIR, "pdf", pdf);

  let result: FormSubmission;
  try {
    result = await db.transaction(async (tx) => {
      const [generated] = await tx
        .insert(generatedDocumentsTable)
        .values({
          organizationId: params.organizationId,
          templateId: null,
          templateVersionId: null,
          categoryCode: "form_final",
          sourceType: "form_submission",
          sourceId: submission.id,
          storageKey,
          fileName,
          mimeType: "application/pdf",
          fileSize: pdf.length,
          generatedBy: params.actor.userId,
        })
        .returning();
      const [s] = await tx
        .update(formSubmissionsTable)
        .set({ status: "finalized", finalizedAt: new Date(), finalDocumentId: generated.id, finalSha256: hash })
        .where(and(eq(formSubmissionsTable.id, submission.id), eq(formSubmissionsTable.status, "approved"), sql`${formSubmissionsTable.finalDocumentId} IS NULL`))
        .returning();
      if (!s) throw new FormSubmissionFinalizedError("Finalization raced; the form is already finalized");
      await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType: "final_document_generated", revisionId: s.currentRevisionId, actor: params.actor, details: { generatedDocumentId: generated.id, sha256: hash, bytes: pdf.length } });
      await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType: "finalized", revisionId: s.currentRevisionId, actor: params.actor });
      return s;
    });
  } catch (err) {
    await discardOrphanedFile(params.organizationId, storageKey);
    throw err;
  }
  await audit(params.actor, params.organizationId, "form.finalized", result.id, { templateId: template.id, templateVersionId: version.id, generatedDocumentId: result.finalDocumentId, sha256: hash });
  return result;
}

export async function archive(params: { organizationId: number; submissionId: number; viewer: ViewerContext; actor: FormActor }) {
  const submission = await getSubmission(params.organizationId, params.submissionId);
  if (!submission) throw new FormSubmissionNotFoundError();
  if (!params.viewer.permissions.has("form.approve")) throw new FormStageAuthorityError("form.approve is required");
  if (submission.status !== "finalized" && submission.status !== "rejected") throw new FormSubmissionStateError("Only a finalized or rejected form can be archived");
  const updated = await db.transaction(async (tx) => {
    const [s] = await tx
      .update(formSubmissionsTable)
      .set({ status: "archived", archivedAt: new Date() })
      .where(and(eq(formSubmissionsTable.id, submission.id), inArray(formSubmissionsTable.status, ["finalized", "rejected"])))
      .returning();
    if (!s) throw new FormSubmissionStateError("Form state changed; reload and try again");
    await appendEvent(tx, { organizationId: params.organizationId, submissionId: s.id, eventType: "archived", actor: params.actor });
    return s;
  });
  await audit(params.actor, params.organizationId, "form.archived", updated.id, {});
  return updated;
}

/** Records a download in the chronology (and audit) without altering the submission. */
export async function recordDownload(params: { organizationId: number; submissionId: number; kind: DocumentKind; revisionId: number | null; actor: FormActor }) {
  await db.insert(formSubmissionEventsTable).values({
    organizationId: params.organizationId,
    submissionId: params.submissionId,
    eventType: "downloaded",
    revisionId: params.revisionId,
    details: { kind: params.kind },
    actorUserId: params.actor.userId,
    actorMembershipId: params.actor.membershipId,
    requestId: params.actor.requestId ?? null,
  });
  await audit(params.actor, params.organizationId, "form.downloaded", params.submissionId, { kind: params.kind, revisionId: params.revisionId });
}

/** History lines for the certificate appendix (names resolved, no form content). */
export async function historyForCertificate(organizationId: number, submissionId: number): Promise<HistoryLine[]> {
  const events = await listEvents(organizationId, submissionId);
  const names = await actorNames(events.map((e) => e.actorUserId).filter((id): id is number => id != null));
  return events
    .filter((e) => e.eventType !== "draft_saved" && e.eventType !== "downloaded")
    .map((e) => ({
      step: e.eventType,
      stage: e.stageName ? `${e.stageOrder}. ${e.stageName}` : "",
      actor: e.actorUserId != null ? (names.get(e.actorUserId) ?? "") : "",
      at: e.occurredAt,
      notes: e.notes ?? (e.details && typeof e.details === "object" && "action" in e.details ? String((e.details as { action: unknown }).action) : ""),
    }));
}
