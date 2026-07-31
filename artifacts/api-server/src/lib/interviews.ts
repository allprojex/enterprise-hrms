/**
 * Interviews & Scheduling (Phase 3A, W54): scheduling and panel composition
 * only — this workstream never evaluates an interview (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
 * §23 W54). Scoring/recommendations/hiring decisions are W55's
 * `interview_scorecards`, a wholly separate table this workstream never
 * touches.
 *
 * Visibility (§7 permission matrix — Interviews row): unlike every other
 * Recruitment resource so far, the "assigned" tier here is not the linked
 * requisition's recruiterEmployeeId/hiringManagerEmployeeId — it's whether
 * the caller's own membership appears as an `interviewerMembershipId` on
 * that specific interview's panel ("own scheduled interviews as
 * interviewer"). Org-wide reach is signaled by holding `interview.manage`,
 * same pattern as every other resource.
 *
 * Status model (§4.5): `scheduled -> completed | cancelled | no_show`.
 * Rescheduling is realized entirely through the one PATCH route (§10 lists
 * no separate reschedule/complete/no-show endpoint): supplying `scheduledAt`
 * cancels the existing row and creates a brand new one (never mutating a
 * scheduled interview's date in place); omitting `scheduledAt` performs an
 * ordinary in-place field update (including a status transition to
 * completed/no_show, or a full panel replace).
 *
 * Reconciliation — two top-level routes beyond §10's literal nested text:
 * `GET .../interviews` and `GET .../interviews/:id` are added at the
 * organization root, not nested under one application, to back the frozen
 * §11 frontend route `/interviews` ("calendar/list of scheduled interviews
 * for the caller") and its detail page — the same top-level-list precedent
 * W51 already established for `/organizations/:organizationId/applications`
 * despite every application belonging to one vacancy. Scheduling/updating
 * remain nested under `.../applications/:id/interviews[/:id]` and cancel
 * stays a top-level `.../interviews/:id/cancel`, exactly matching §10's
 * literal text.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  interviewsTable,
  interviewPanelMembersTable,
  applicationsTable,
  organizationMembershipsTable,
  type Interview,
  type InterviewPanelMember,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { hasOrgWideRecruitmentAccess } from "./recruitmentAuthorization";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";

export class InterviewNotFoundError extends Error {
  constructor() {
    super("Interview not found");
    this.name = "InterviewNotFoundError";
  }
}

export class ApplicationNotFoundForInterviewError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundForInterviewError";
  }
}

export class InvalidInterviewError extends Error {}

export class InterviewNotEditableError extends Error {
  constructor() {
    super("Only a scheduled interview can be updated, rescheduled, or cancelled");
    this.name = "InterviewNotEditableError";
  }
}

export type InterviewType = "phone" | "virtual" | "in_person";
export type InterviewStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export interface InterviewVisibilityContext {
  isOrgWide: boolean;
  membershipId: number;
}

export async function resolveInterviewVisibilityContext(params: { membershipId: number }): Promise<InterviewVisibilityContext> {
  const isOrgWide = await hasOrgWideRecruitmentAccess(params.membershipId, "interview.manage");
  return { isOrgWide, membershipId: params.membershipId };
}

export interface PanelMemberInput {
  interviewerMembershipId?: number | null;
  externalInterviewerName?: string | null;
  externalInterviewerEmail?: string | null;
  role?: "lead" | "member";
  conflictDeclared?: boolean;
}

export interface InterviewWithPanel extends Interview {
  panelMembers: InterviewPanelMember[];
}

async function loadPanelMembers(interviewIds: number[]): Promise<Map<number, InterviewPanelMember[]>> {
  const result = new Map<number, InterviewPanelMember[]>();
  if (interviewIds.length === 0) return result;
  const rows = await db.select().from(interviewPanelMembersTable).where(inArray(interviewPanelMembersTable.interviewId, interviewIds));
  for (const row of rows) {
    const list = result.get(row.interviewId) ?? [];
    list.push(row);
    result.set(row.interviewId, list);
  }
  return result;
}

function withPanel(interview: Interview, panelByInterview: Map<number, InterviewPanelMember[]>): InterviewWithPanel {
  return { ...interview, panelMembers: panelByInterview.get(interview.id) ?? [] };
}

async function isPanelMember(interviewId: number, membershipId: number): Promise<boolean> {
  const [row] = await db
    .select()
    .from(interviewPanelMembersTable)
    .where(and(eq(interviewPanelMembersTable.interviewId, interviewId), eq(interviewPanelMembersTable.interviewerMembershipId, membershipId)))
    .limit(1);
  return !!row;
}

function validatePanelInput(input: PanelMemberInput): void {
  const hasInternal = input.interviewerMembershipId != null;
  const hasExternal = !!(input.externalInterviewerName || input.externalInterviewerEmail);
  if (hasInternal && hasExternal) {
    throw new InvalidInterviewError("A panel member is either an internal interviewer or an external one, not both");
  }
  if (!hasInternal && !hasExternal) {
    throw new InvalidInterviewError("A panel member requires either interviewerMembershipId or an external name/email");
  }
  if (hasExternal && (!input.externalInterviewerName?.trim() || !input.externalInterviewerEmail?.trim())) {
    throw new InvalidInterviewError("An external panel member requires both a name and an email");
  }
}

async function insertPanelMembers(tx: typeof db, organizationId: number, interviewId: number, members: PanelMemberInput[]): Promise<void> {
  for (const member of members) validatePanelInput(member);
  for (const member of members) {
    if (member.interviewerMembershipId != null) {
      await assertBelongsToOrganization(organizationMembershipsTable, member.interviewerMembershipId, organizationId, "Interviewer membership");
    }
  }
  if (members.length === 0) return;
  await tx.insert(interviewPanelMembersTable).values(
    members.map((m) => ({
      organizationId,
      interviewId,
      interviewerMembershipId: m.interviewerMembershipId ?? null,
      externalInterviewerName: m.externalInterviewerName ?? null,
      externalInterviewerEmail: m.externalInterviewerEmail ?? null,
      role: m.role ?? "member",
      conflictDeclared: m.conflictDeclared ?? false,
    })),
  );
}

async function findOwnInterview(organizationId: number, interviewId: number): Promise<Interview | null> {
  const [row] = await db
    .select()
    .from(interviewsTable)
    .where(and(eq(interviewsTable.id, interviewId), eq(interviewsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findApplicationInOrg(organizationId: number, applicationId: number) {
  const [row] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

function isVisible(interviewId: number, ctx: InterviewVisibilityContext, panelByInterview: Map<number, InterviewPanelMember[]>): boolean {
  if (ctx.isOrgWide) return true;
  const panel = panelByInterview.get(interviewId) ?? [];
  return panel.some((p) => p.interviewerMembershipId === ctx.membershipId);
}

// --- Reads ---

export interface ListInterviewsParams {
  organizationId: number;
  visibility: InterviewVisibilityContext;
  applicationId?: number;
  status?: InterviewStatus;
  page: number;
  pageSize: number;
}

export async function listInterviews(params: ListInterviewsParams): Promise<{ items: InterviewWithPanel[]; total: number }> {
  const conditions = [eq(interviewsTable.organizationId, params.organizationId)];
  if (params.applicationId != null) conditions.push(eq(interviewsTable.applicationId, params.applicationId));
  if (params.status) conditions.push(eq(interviewsTable.status, params.status));

  const rows = await db
    .select()
    .from(interviewsTable)
    .where(and(...conditions))
    .orderBy(desc(interviewsTable.scheduledAt));

  const panelByInterview = await loadPanelMembers(rows.map((r) => r.id));
  const visible = rows.filter((r) => isVisible(r.id, params.visibility, panelByInterview));

  const total = visible.length;
  const start = (params.page - 1) * params.pageSize;
  const page = visible.slice(start, start + params.pageSize);
  return { items: page.map((r) => withPanel(r, panelByInterview)), total };
}

/** Returns null both when the interview doesn't exist and when it exists but isn't visible to this caller — never distinguishing the two. */
export async function getVisibleInterviewById(organizationId: number, interviewId: number, visibility: InterviewVisibilityContext): Promise<InterviewWithPanel | null> {
  const row = await findOwnInterview(organizationId, interviewId);
  if (!row) return null;
  const panelByInterview = await loadPanelMembers([row.id]);
  if (!isVisible(row.id, visibility, panelByInterview)) return null;
  return withPanel(row, panelByInterview);
}

// --- Writes ---

export interface ScheduleInterviewParams {
  organizationId: number;
  applicationId: number;
  interviewType: InterviewType;
  scheduledAt: Date;
  durationMinutes: number;
  location?: string | null;
  meetingLink?: string | null;
  panelMembers?: PanelMemberInput[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}

function validateScheduleFields(fields: { scheduledAt: Date; durationMinutes: number }): void {
  if (fields.durationMinutes <= 0) {
    throw new InvalidInterviewError("durationMinutes must be positive");
  }
}

export async function scheduleInterview(params: ScheduleInterviewParams): Promise<InterviewWithPanel> {
  const application = await findApplicationInOrg(params.organizationId, params.applicationId);
  if (!application) throw new ApplicationNotFoundForInterviewError();

  validateScheduleFields(params);

  const interview = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(interviewsTable)
      .values({
        organizationId: params.organizationId,
        applicationId: params.applicationId,
        interviewType: params.interviewType,
        scheduledAt: params.scheduledAt,
        durationMinutes: params.durationMinutes,
        location: params.location ?? null,
        meetingLink: params.meetingLink ?? null,
        status: "scheduled",
      })
      .returning();

    await insertPanelMembers(tx as unknown as typeof db, params.organizationId, row.id, params.panelMembers ?? []);
    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "interview.scheduled",
    targetType: "interview",
    targetId: String(interview.id),
    afterState: { applicationId: interview.applicationId, scheduledAt: interview.scheduledAt, interviewType: interview.interviewType },
  });

  const panelByInterview = await loadPanelMembers([interview.id]);
  return withPanel(interview, panelByInterview);
}

export interface UpdateInterviewParams {
  organizationId: number;
  applicationId: number;
  interviewId: number;
  interviewType?: InterviewType;
  scheduledAt?: Date;
  durationMinutes?: number;
  location?: string | null;
  meetingLink?: string | null;
  status?: "completed" | "no_show";
  outcome?: string | null;
  panelMembers?: PanelMemberInput[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}

async function replacePanelMembers(organizationId: number, interviewId: number, members: PanelMemberInput[]): Promise<void> {
  for (const member of members) validatePanelInput(member);
  for (const member of members) {
    if (member.interviewerMembershipId != null) {
      await assertBelongsToOrganization(organizationMembershipsTable, member.interviewerMembershipId, organizationId, "Interviewer membership");
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(interviewPanelMembersTable).where(eq(interviewPanelMembersTable.interviewId, interviewId));
    await insertPanelMembers(tx as unknown as typeof db, organizationId, interviewId, members);
  });
}

/**
 * Single PATCH entry point covering every non-cancel interview mutation
 * (§10 lists no separate reschedule/complete/no-show/panel route). Supplying
 * `scheduledAt` reschedules — cancels the current row and creates a new one
 * (§4.5), carrying over the current panel unless a new `panelMembers` array
 * is supplied in the same call. Omitting `scheduledAt` performs an ordinary
 * in-place update of the other fields, including a status transition to
 * completed/no_show and/or a full panel replace.
 */
export async function updateInterview(params: UpdateInterviewParams): Promise<InterviewWithPanel> {
  const before = await findOwnInterview(params.organizationId, params.interviewId);
  if (!before || before.applicationId !== params.applicationId) throw new InterviewNotFoundError();
  if (before.status !== "scheduled") throw new InterviewNotEditableError();

  if (params.durationMinutes != null && params.durationMinutes <= 0) {
    throw new InvalidInterviewError("durationMinutes must be positive");
  }

  if (params.scheduledAt) {
    // Reschedule: cancel the old row, create a brand new one — never mutate
    // a scheduled interview's date in place (§4.5).
    const currentPanel = await loadPanelMembers([before.id]);
    const carryOverPanel: PanelMemberInput[] = (currentPanel.get(before.id) ?? []).map((p) => ({
      interviewerMembershipId: p.interviewerMembershipId,
      externalInterviewerName: p.externalInterviewerName,
      externalInterviewerEmail: p.externalInterviewerEmail,
      role: p.role,
      conflictDeclared: p.conflictDeclared,
    }));

    const newInterview = await db.transaction(async (tx) => {
      await tx.update(interviewsTable).set({ status: "cancelled" }).where(eq(interviewsTable.id, before.id));

      const [row] = await tx
        .insert(interviewsTable)
        .values({
          organizationId: params.organizationId,
          applicationId: before.applicationId,
          interviewType: params.interviewType ?? before.interviewType,
          scheduledAt: params.scheduledAt!,
          durationMinutes: params.durationMinutes ?? before.durationMinutes,
          location: params.location !== undefined ? params.location : before.location,
          meetingLink: params.meetingLink !== undefined ? params.meetingLink : before.meetingLink,
          status: "scheduled",
        })
        .returning();

      await insertPanelMembers(tx as unknown as typeof db, params.organizationId, row.id, params.panelMembers ?? carryOverPanel);
      return row;
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "interview.rescheduled",
      targetType: "interview",
      targetId: String(newInterview.id),
      beforeState: { previousInterviewId: before.id, scheduledAt: before.scheduledAt },
      afterState: { scheduledAt: newInterview.scheduledAt },
    });

    const panelByInterview = await loadPanelMembers([newInterview.id]);
    return withPanel(newInterview, panelByInterview);
  }

  // Ordinary in-place update (no scheduledAt change).
  const patch: Record<string, unknown> = {};
  if (params.interviewType !== undefined) patch.interviewType = params.interviewType;
  if (params.durationMinutes !== undefined) patch.durationMinutes = params.durationMinutes;
  if (params.location !== undefined) patch.location = params.location;
  if (params.meetingLink !== undefined) patch.meetingLink = params.meetingLink;
  if (params.status !== undefined) patch.status = params.status;
  if (params.outcome !== undefined) patch.outcome = params.outcome;

  const [updated] = Object.keys(patch).length
    ? await db.update(interviewsTable).set(patch).where(eq(interviewsTable.id, before.id)).returning()
    : [before];

  if (params.panelMembers !== undefined) {
    await replacePanelMembers(params.organizationId, before.id, params.panelMembers);
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "interview.panel_updated",
      targetType: "interview",
      targetId: String(before.id),
      afterState: { panelSize: params.panelMembers.length },
    });
  }

  if (params.status !== undefined) {
    // `before.status` is guaranteed "scheduled" here (checked above), and
    // params.status is always "completed"/"no_show" — always a real
    // transition, never a same-value no-op.
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "interview.status_changed",
      targetType: "interview",
      targetId: String(before.id),
      beforeState: { status: before.status },
      afterState: { status: params.status },
    });
  }

  const panelByInterview = await loadPanelMembers([updated.id]);
  return withPanel(updated, panelByInterview);
}

export async function cancelInterview(params: {
  organizationId: number;
  interviewId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<InterviewWithPanel> {
  const before = await findOwnInterview(params.organizationId, params.interviewId);
  if (!before) throw new InterviewNotFoundError();
  if (before.status !== "scheduled") throw new InterviewNotEditableError();

  const [updated] = await db
    .update(interviewsTable)
    .set({ status: "cancelled" })
    .where(and(eq(interviewsTable.id, params.interviewId), eq(interviewsTable.status, "scheduled")))
    .returning();
  if (!updated) throw new InterviewNotEditableError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "interview.cancelled",
    targetType: "interview",
    targetId: String(params.interviewId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  const panelByInterview = await loadPanelMembers([updated.id]);
  return withPanel(updated, panelByInterview);
}

export { CrossOrganizationReferenceError };
