/**
 * Interview Scorecards (Phase 3A, W55): independent, lockable evaluations —
 * one per panel member per interview (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
 * §23 W55). Never redesigns W54 (interviews/panel membership) — reads it,
 * never writes to `interviews`/`interview_panel_members`. Never mixed with
 * W52's `application_scores` (a distinct business process — screening vs.
 * interview evaluation) and never mixed into the application's own
 * `scoreRollup`. Never moves the W51 application stage, never triggers an
 * offer/hiring decision — a scorecard informs later decisions, it does not
 * make them.
 *
 * Scope boundary — the frozen §9 table plan defines exactly two tables
 * (`interview_scorecards`, `interview_scorecard_responses`) with no
 * template/criteria table, no weight column, and no rating scale. This
 * workstream therefore does not build a scorecard-template/criteria
 * configuration system: `criterion` is plain free text supplied per
 * submission, `rating` is an unconstrained integer (mirroring
 * `application_scores.score`'s own unconstrained-numeric precedent) — a
 * documented limitation, not an oversight.
 *
 * Audit — deliberately none. §20's Audit Plan explicitly names finalized
 * `interview_scorecards` among the tables that are "routine,
 * already-self-documenting movements" NOT duplicated into `audit_events`
 * (alongside `application_stage_history`/`requisition_approvals`/
 * `offer_approvals`) — the row's own `interviewerMembershipId` +
 * `submittedAt`/`finalizedAt` columns already record who and when.
 *
 * Visibility (§7 — Scorecards row): `scorecard.submit` (own scorecard only,
 * verified by fresh interview_panel_members membership at every write —
 * never cached) vs. `scorecard.read_all` (every scorecard on the
 * interview) — `scorecard.submit` never implies `.read_all` (bias
 * prevention: an interviewer must not see colleagues' scores before
 * submitting their own). `scorecard.finalize` has no "own" tier at all —
 * an interviewer can never finalize/lock their own scorecard, only an
 * HR/recruiter administrator can.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  interviewsTable,
  interviewPanelMembersTable,
  interviewScorecardsTable,
  interviewScorecardResponsesTable,
  type Interview,
  type InterviewScorecard,
  type InterviewScorecardResponse,
} from "@workspace/db";
import { hasOrgWideRecruitmentAccess } from "./recruitmentAuthorization";

export class InterviewNotFoundForScorecardError extends Error {
  constructor() {
    super("Interview not found");
    this.name = "InterviewNotFoundForScorecardError";
  }
}

export class ScorecardNotFoundError extends Error {
  constructor() {
    super("Scorecard not found");
    this.name = "ScorecardNotFoundError";
  }
}

export class NotPanelMemberError extends Error {
  constructor() {
    super("You are not a panel member for this interview");
    this.name = "NotPanelMemberError";
  }
}

export class InterviewCancelledError extends Error {
  constructor() {
    super("Cannot submit or update a scorecard for a cancelled interview");
    this.name = "InterviewCancelledError";
  }
}

export class ScorecardNotEditableError extends Error {
  constructor() {
    super("A submitted scorecard is immutable and cannot be changed");
    this.name = "ScorecardNotEditableError";
  }
}

export class ScorecardNotFinalizableError extends Error {
  constructor() {
    super("Only a submitted, not-yet-finalized scorecard can be finalized");
    this.name = "ScorecardNotFinalizableError";
  }
}

export type InterviewScorecardRecommendation = "strong_yes" | "yes" | "no" | "strong_no";

export interface ResponseInput {
  criterion: string;
  rating?: number | null;
  comment?: string | null;
}

/**
 * Never exposed to any caller — reserved for a later workstream, not this
 * one (§10 lists no route that reads or writes it). Omitted explicitly
 * (never just spread from the raw DB row) so a raw token can never leak
 * through this API even once another workstream starts populating it.
 */
export type PublicInterviewScorecard = Omit<InterviewScorecard, "externalInterviewerToken" | "externalInterviewerTokenExpiresAt">;

export interface ScorecardWithResponses extends PublicInterviewScorecard {
  responses: InterviewScorecardResponse[];
}

export interface PanelSummary {
  totalPanelMembers: number;
  submittedCount: number;
  pendingCount: number;
  recommendationCounts: Record<InterviewScorecardRecommendation, number>;
}

async function findInterviewInOrg(organizationId: number, interviewId: number): Promise<Interview | null> {
  const [row] = await db
    .select()
    .from(interviewsTable)
    .where(and(eq(interviewsTable.id, interviewId), eq(interviewsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function isPanelMember(interviewId: number, membershipId: number): Promise<boolean> {
  const [row] = await db
    .select()
    .from(interviewPanelMembersTable)
    .where(and(eq(interviewPanelMembersTable.interviewId, interviewId), eq(interviewPanelMembersTable.interviewerMembershipId, membershipId)))
    .limit(1);
  return !!row;
}

async function findOwnScorecard(organizationId: number, scorecardId: number): Promise<InterviewScorecard | null> {
  const [row] = await db
    .select()
    .from(interviewScorecardsTable)
    .where(and(eq(interviewScorecardsTable.id, scorecardId), eq(interviewScorecardsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function loadResponses(scorecardIds: number[]): Promise<Map<number, InterviewScorecardResponse[]>> {
  const result = new Map<number, InterviewScorecardResponse[]>();
  if (scorecardIds.length === 0) return result;
  const rows = await db.select().from(interviewScorecardResponsesTable).where(inArray(interviewScorecardResponsesTable.scorecardId, scorecardIds));
  for (const row of rows) {
    const list = result.get(row.scorecardId) ?? [];
    list.push(row);
    result.set(row.scorecardId, list);
  }
  return result;
}

function toPublicScorecard(scorecard: InterviewScorecard): PublicInterviewScorecard {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { externalInterviewerToken, externalInterviewerTokenExpiresAt, ...rest } = scorecard;
  return rest;
}

function withResponses(scorecard: InterviewScorecard, responsesByScorecard: Map<number, InterviewScorecardResponse[]>): ScorecardWithResponses {
  return { ...toPublicScorecard(scorecard), responses: responsesByScorecard.get(scorecard.id) ?? [] };
}

export interface ScorecardVisibilityContext {
  canReadAll: boolean;
  membershipId: number;
}

export async function resolveScorecardVisibilityContext(params: { membershipId: number }): Promise<ScorecardVisibilityContext> {
  const canReadAll = await hasOrgWideRecruitmentAccess(params.membershipId, "scorecard.read_all");
  return { canReadAll, membershipId: params.membershipId };
}

/**
 * Returns every scorecard on the interview if the caller holds
 * scorecard.read_all; otherwise only the caller's own (possibly
 * nonexistent) scorecard — never another interviewer's, submitted or not.
 */
export async function listInterviewScorecards(params: {
  organizationId: number;
  interviewId: number;
  visibility: ScorecardVisibilityContext;
}): Promise<{ scorecards: ScorecardWithResponses[]; panelSummary: PanelSummary | null }> {
  const interview = await findInterviewInOrg(params.organizationId, params.interviewId);
  if (!interview) throw new InterviewNotFoundForScorecardError();

  const allScorecards = await db.select().from(interviewScorecardsTable).where(eq(interviewScorecardsTable.interviewId, params.interviewId));
  const responsesByScorecard = await loadResponses(allScorecards.map((s) => s.id));

  if (params.visibility.canReadAll) {
    const panelMembers = await db.select().from(interviewPanelMembersTable).where(eq(interviewPanelMembersTable.interviewId, params.interviewId));
    const recommendationCounts: Record<InterviewScorecardRecommendation, number> = { strong_yes: 0, yes: 0, no: 0, strong_no: 0 };
    let submittedCount = 0;
    for (const s of allScorecards) {
      if (s.submittedAt) {
        submittedCount += 1;
        if (s.recommendation) recommendationCounts[s.recommendation as InterviewScorecardRecommendation] += 1;
      }
    }
    const panelSummary: PanelSummary = {
      totalPanelMembers: panelMembers.length,
      submittedCount,
      pendingCount: Math.max(0, panelMembers.length - submittedCount),
      recommendationCounts,
    };
    return { scorecards: allScorecards.map((s) => withResponses(s, responsesByScorecard)), panelSummary };
  }

  const own = allScorecards.filter((s) => s.interviewerMembershipId === params.visibility.membershipId);
  return { scorecards: own.map((s) => withResponses(s, responsesByScorecard)), panelSummary: null };
}

/**
 * Upserts the caller's own draft (or, with `submit: true`, transitions it to
 * submitted in the same call — §10 lists no separate submit route). Panel
 * membership is re-verified fresh on every call, never cached, so a
 * since-removed panel member is rejected even if they previously had a
 * scorecard. Rejects outright once the scorecard is already submitted —
 * "a submitted scorecard cannot be silently replaced."
 */
export async function saveOwnInterviewScorecard(params: {
  organizationId: number;
  interviewId: number;
  membershipId: number;
  recommendation?: InterviewScorecardRecommendation | null;
  overallComment?: string | null;
  responses?: ResponseInput[];
  submit?: boolean;
}): Promise<ScorecardWithResponses> {
  const interview = await findInterviewInOrg(params.organizationId, params.interviewId);
  if (!interview) throw new InterviewNotFoundForScorecardError();
  if (interview.status === "cancelled") throw new InterviewCancelledError();

  const onPanel = await isPanelMember(params.interviewId, params.membershipId);
  if (!onPanel) throw new NotPanelMemberError();

  const [existing] = await db
    .select()
    .from(interviewScorecardsTable)
    .where(and(eq(interviewScorecardsTable.interviewId, params.interviewId), eq(interviewScorecardsTable.interviewerMembershipId, params.membershipId)))
    .limit(1);

  if (existing && existing.submittedAt) throw new ScorecardNotEditableError();

  const scorecard = await db.transaction(async (tx) => {
    const patch: Record<string, unknown> = {};
    if (params.recommendation !== undefined) patch.recommendation = params.recommendation;
    if (params.overallComment !== undefined) patch.overallComment = params.overallComment;
    if (params.submit) patch.submittedAt = new Date();

    let row: InterviewScorecard;
    if (existing) {
      const [updated] = Object.keys(patch).length
        ? await tx.update(interviewScorecardsTable).set(patch).where(eq(interviewScorecardsTable.id, existing.id)).returning()
        : [existing];
      row = updated;
    } else {
      const [inserted] = await tx
        .insert(interviewScorecardsTable)
        .values({
          organizationId: params.organizationId,
          interviewId: params.interviewId,
          interviewerMembershipId: params.membershipId,
          recommendation: params.recommendation ?? null,
          overallComment: params.overallComment ?? null,
          submittedAt: params.submit ? new Date() : null,
        })
        .returning();
      row = inserted;
    }

    if (params.responses !== undefined) {
      await tx.delete(interviewScorecardResponsesTable).where(eq(interviewScorecardResponsesTable.scorecardId, row.id));
      if (params.responses.length) {
        await tx.insert(interviewScorecardResponsesTable).values(
          params.responses.map((r) => ({
            organizationId: params.organizationId,
            scorecardId: row.id,
            criterion: r.criterion,
            rating: r.rating ?? null,
            comment: r.comment ?? null,
          })),
        );
      }
    }

    return row;
  });

  const responsesByScorecard = await loadResponses([scorecard.id]);
  return withResponses(scorecard, responsesByScorecard);
}

/** HR/recruiter-only lock — never available to the submitting interviewer themselves (no "own" tier for finalize, §7). */
export async function finalizeInterviewScorecard(params: { organizationId: number; scorecardId: number }): Promise<ScorecardWithResponses> {
  const existing = await findOwnScorecard(params.organizationId, params.scorecardId);
  if (!existing) throw new ScorecardNotFoundError();
  if (!existing.submittedAt || existing.finalizedAt) throw new ScorecardNotFinalizableError();

  const [updated] = await db.update(interviewScorecardsTable).set({ finalizedAt: new Date() }).where(eq(interviewScorecardsTable.id, params.scorecardId)).returning();
  if (!updated) throw new ScorecardNotFinalizableError();

  const responsesByScorecard = await loadResponses([updated.id]);
  return withResponses(updated, responsesByScorecard);
}
