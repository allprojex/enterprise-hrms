import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  interviewsTable,
  interviewPanelMembersTable,
  interviewScorecardsTable,
  jobRequisitionsTable,
} from "@workspace/db";
import { getModuleAccess } from "./organizationModules";
import { resolveInterviewVisibilityContext } from "./interviews";
import { resolveScorecardVisibilityContext } from "./interviewScorecards";
import { resolveRecruitmentActorEmployeeId, RECRUITMENT_MODULE_KEY } from "./recruitmentAuthorization";

/**
 * WS-15 P2 — Manager Portal's missing Recruitment participation source (§31.28).
 *
 * THE GAP THIS CLOSES, AND NOTHING WIDER. Manager Portal already aggregates
 * Leave, Performance and Learning. §31.28 names exactly three absent Recruitment
 * responsibilities, and this file adds exactly those three:
 *
 *   1. an outstanding OWN scorecard   — `interview_scorecards.submittedAt is null`
 *                                       (or no scorecard row at all yet)
 *   2. interview panel participation  — `interview_panel_members.interviewerMembershipId`
 *   3. hiring-manager standing        — `job_requisitions.hiringManagerEmployeeId`
 *
 * Requisition approvals and offer approvals are DELIBERATELY NOT HERE. They are
 * approval authority rather than participation, they already ship as WS-15 P1
 * Action Centre providers, and §31.28 does not name them. Adding them would
 * duplicate a shipped surface and widen a frozen bundle.
 *
 * THIS IS PARTICIPATION, NOT AUTHORITY. Every row says "you are involved in
 * this" and links to the Recruitment surface that already gates the decision.
 * Manager Portal grants no Recruitment authority it did not already have: the
 * only thing an actor can DO from a row here is follow a link into Recruitment,
 * which re-gates at the destination.
 *
 * AUTHORITY IS RECRUITMENT'S OWN, RESOLVED LIVE. The two shipped visibility
 * contexts are reused unchanged, and panel membership and hiring-manager
 * standing are read fresh on every call. There is no cached assignment, no
 * manager-task table and no second manager-authority concept — the exact
 * principle `managerPortalPendingActions.ts` states for itself, extended rather
 * than replaced. Removing somebody from a panel, or reassigning a requisition's
 * hiring manager, is reflected on the very next request.
 *
 * NO CANDIDATE-SENSITIVE DATA. A row carries an interview or requisition
 * reference, a generic title and a date. It never carries a candidate name,
 * application detail, another panel member's scoring or comments, offered
 * compensation, or any protected candidate document — `scorecard.read_all` is
 * not consulted here at all, because own-outstanding-work does not depend on
 * it and reading it would invite widening later.
 */

export type ManagerPortalRecruitmentKind = "interview_scorecard" | "interview_panel" | "job_requisition";

export interface ManagerPortalRecruitmentItem {
  kind: ManagerPortalRecruitmentKind;
  /** The underlying Recruitment row's own id. Never a Manager Portal-minted identifier. */
  id: number;
  /** A safe, generic operational label. Never a candidate name or application detail. */
  title: string;
  /** The source's own current status string, passed through. */
  status: string;
  /**
   * The source's own authoritative date — an interview's `scheduledAt`, a
   * requisition's `createdAt`. Never a fabricated deadline.
   */
  occurredAt: Date;
  /** Route into the Recruitment surface that owns the work and re-gates it. */
  deepLink: string;
}

export interface ManagerPortalRecruitmentParticipation {
  /**
   * Whether the caller has an employee record. Only hiring-manager standing
   * needs one — scorecards and panel membership key on the MEMBERSHIP — so an
   * unlinked interviewer still sees their own outstanding work.
   */
  linked: boolean;
  items: ManagerPortalRecruitmentItem[];
}

/** Interviews that have not been abandoned. A cancelled or no-show interview asks nothing of anybody. */
const LIVE_INTERVIEW_STATUSES = ["scheduled", "completed"] as const;

/** Requisitions still in flight. `filled`, `rejected`, `cancelled` and `closed` ask nothing of a hiring manager. */
const IN_FLIGHT_REQUISITION_STATUSES = ["pending_approval", "approved", "partially_filled"] as const;

export async function resolveManagerPortalRecruitmentParticipation(
  organizationId: number,
  applicationUserId: number,
  membershipId: number,
): Promise<ManagerPortalRecruitmentParticipation> {
  const actorEmployeeId = await resolveRecruitmentActorEmployeeId(organizationId, applicationUserId);

  // Module enablement first, exactly as every other Manager Portal source does.
  // A disabled Recruitment module contributes nothing and says nothing.
  if (!(await getModuleAccess(organizationId, RECRUITMENT_MODULE_KEY)).enabled) {
    return { linked: actorEmployeeId != null, items: [] };
  }

  // Recruitment's own shipped visibility contexts, reused unchanged. Neither is
  // widened here: this surface is own-participation only, so `isOrgWide` and
  // `canReadAll` deliberately do not broaden what is returned. They are resolved
  // because §31.28 names them as the authority path, and because resolving them
  // keeps this file honest about which module owns the decision.
  const [interviewVisibility, scorecardVisibility] = await Promise.all([
    resolveInterviewVisibilityContext({ membershipId }),
    resolveScorecardVisibilityContext({ membershipId }),
  ]);

  const items: ManagerPortalRecruitmentItem[] = [];

  // --- Panel membership: the anchor for both interview sources ---------------
  const panelRows = await db
    .select({ interview: interviewsTable })
    .from(interviewPanelMembersTable)
    .innerJoin(interviewsTable, eq(interviewsTable.id, interviewPanelMembersTable.interviewId))
    .where(
      and(
        eq(interviewsTable.organizationId, organizationId),
        // Membership-keyed, read fresh. A since-removed panel member disappears
        // on the next request with nothing to invalidate.
        eq(interviewPanelMembersTable.interviewerMembershipId, interviewVisibility.membershipId),
        inArray(interviewsTable.status, [...LIVE_INTERVIEW_STATUSES]),
      ),
    )
    .orderBy(asc(interviewsTable.scheduledAt));

  if (panelRows.length > 0) {
    const interviewIds = panelRows.map((r) => r.interview.id);

    // The caller's OWN scorecards only. A scorecard row exists only once it has
    // been saved, so "outstanding" means either no row yet or an unsubmitted
    // one — never another interviewer's, submitted or not.
    const ownScorecards = await db
      .select({ interviewId: interviewScorecardsTable.interviewId, submittedAt: interviewScorecardsTable.submittedAt })
      .from(interviewScorecardsTable)
      .where(
        and(
          eq(interviewScorecardsTable.organizationId, organizationId),
          eq(interviewScorecardsTable.interviewerMembershipId, scorecardVisibility.membershipId),
          inArray(interviewScorecardsTable.interviewId, interviewIds),
        ),
      );
    const submittedInterviewIds = new Set(
      ownScorecards.filter((s) => s.submittedAt != null).map((s) => s.interviewId),
    );

    for (const { interview } of panelRows) {
      if (interview.status === "completed") {
        // Work: the interview happened and this panel member has not submitted.
        // A submitted scorecard drops out here, so completing it elsewhere
        // removes the row on the next request.
        if (!submittedInterviewIds.has(interview.id)) {
          items.push({
            kind: "interview_scorecard",
            id: interview.id,
            title: "Interview scorecard outstanding",
            status: interview.status,
            occurredAt: interview.scheduledAt,
            deepLink: `/interviews/${interview.id}/scorecard`,
          });
        }
        continue;
      }

      // Awareness: an upcoming interview this person sits on.
      items.push({
        kind: "interview_panel",
        id: interview.id,
        title: "Interview panel",
        status: interview.status,
        occurredAt: interview.scheduledAt,
        deepLink: `/interviews/${interview.id}`,
      });
    }
  }

  // --- Hiring-manager standing ----------------------------------------------
  // The only source here that needs an employee link, because
  // `hiringManagerEmployeeId` keys on the employee rather than the membership.
  if (actorEmployeeId != null) {
    const requisitions = await db
      .select({
        id: jobRequisitionsTable.id,
        title: jobRequisitionsTable.title,
        status: jobRequisitionsTable.status,
        createdAt: jobRequisitionsTable.createdAt,
      })
      .from(jobRequisitionsTable)
      .where(
        and(
          eq(jobRequisitionsTable.organizationId, organizationId),
          eq(jobRequisitionsTable.hiringManagerEmployeeId, actorEmployeeId),
          inArray(jobRequisitionsTable.status, [...IN_FLIGHT_REQUISITION_STATUSES]),
        ),
      )
      .orderBy(asc(jobRequisitionsTable.createdAt));

    for (const requisition of requisitions) {
      items.push({
        kind: "job_requisition",
        id: requisition.id,
        // The requisition's own title is the role being recruited for, not
        // candidate information — safe, and the only thing that makes the row
        // actionable to a hiring manager.
        title: requisition.title,
        status: requisition.status,
        occurredAt: requisition.createdAt,
        deepLink: `/requisitions/${requisition.id}`,
      });
    }
  }

  // Deterministic: soonest interview and oldest requisition first, then kind,
  // then the source's own id. Manager Portal's own list is newest-first, but
  // this one is genuinely dated work — an interview tomorrow matters more than
  // one scheduled a month ago — so oldest/soonest-first is the honest order.
  items.sort((a, b) => {
    const byDate = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (byDate !== 0) return byDate;
    const byKind = a.kind.localeCompare(b.kind);
    if (byKind !== 0) return byKind;
    return a.id - b.id;
  });

  return { linked: actorEmployeeId != null, items };
}
