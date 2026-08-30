/**
 * WS-15 P2 (§31.28) — Manager Portal's Recruitment participation source, live.
 *
 * The invariants this bundle depends on, each proved against a real database:
 *
 *   - a panel member sees their OWN outstanding scorecard and nobody else's;
 *   - submitting it removes the row on the very next request;
 *   - removing somebody from a panel removes their row immediately — authority
 *     is live, and there is no cached assignment to invalidate;
 *   - hiring-manager standing follows `job_requisitions.hiringManagerEmployeeId`,
 *     not a role name, and a reassignment is reflected at once;
 *   - a requisition that is filled, rejected or still a draft asks nothing;
 *   - a cancelled interview asks nothing;
 *   - no row carries a candidate name, an application detail, another panel
 *     member's scoring or comments, or offered compensation;
 *   - a disabled Recruitment module contributes nothing;
 *   - every cross-tenant identifier is invisible;
 *   - Manager Portal grants NO Recruitment authority it did not already have.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS15_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-15 P2 — Manager Portal Recruitment participation, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let participation: typeof import("../lib/managerPortalRecruitmentParticipation");

  let orgId: number;
  let otherOrgId: number;
  let recruitmentModuleId: number | null = null;

  const suffix = `ws15p2-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  interface Actor {
    userId: number;
    membershipId: number;
    employeeId: number;
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    participation = await import("../lib/managerPortalRecruitmentParticipation");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS15P2 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS15P2 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const [module] = await db
      .select()
      .from(schema.modulesTable)
      .where(eq(schema.modulesTable.key, "recruitment"))
      .limit(1);
    recruitmentModuleId = module?.id ?? null;
    for (const id of [orgId, otherOrgId]) {
      if (recruitmentModuleId) {
        await db
          .insert(schema.organizationModulesTable)
          .values({ organizationId: id, moduleId: recruitmentModuleId, enabled: true })
          .onConflictDoNothing();
      }
    }
  });

  async function makeActor(tag: string, organizationId = orgId): Promise<Actor> {
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq(tag)}@example.invalid`,
        passwordHash: "x",
        firstName: tag,
        lastName: "Interviewer",
        organizationId,
      })
      .returning();
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId, status: "active" })
      .returning();
    const [e] = await db
      .insert(schema.employeesTable)
      .values({ organizationId, firstName: tag, lastName: "Interviewer" })
      .returning();
    await db
      .insert(schema.employeeUserLinksTable)
      .values({ employeeId: e.id, applicationUserId: u.id, organizationMembershipId: m.id });
    return { userId: u.id, membershipId: m.id, employeeId: e.id };
  }

  /** A full requisition → vacancy → candidate → application → interview chain. */
  async function makeInterview(
    opts: { status?: string; organizationId?: number; hiringManagerEmployeeId?: number | null } = {},
  ) {
    const organizationId = opts.organizationId ?? orgId;
    const [requisition] = await db
      .insert(schema.jobRequisitionsTable)
      .values({
        organizationId,
        title: `Ward Sister ${uniq("req")}`,
        requisitionType: "new_role",
        requestedHeadcount: 1,
        status: "approved",
        hiringManagerEmployeeId: opts.hiringManagerEmployeeId ?? null,
      })
      .returning();
    const [vacancy] = await db
      .insert(schema.vacanciesTable)
      .values({
        organizationId,
        requisitionId: requisition.id,
        publicId: uniq("vac"),
        title: "Ward Sister",
        visibility: "internal",
        status: "published",
        openingsCount: 1,
      })
      .returning();
    const [candidate] = await db
      .insert(schema.candidatesTable)
      .values({
        organizationId,
        firstName: "Confidentialfirst",
        lastName: "Confidentiallast",
        email: `${uniq("cand")}@example.invalid`,
        source: "direct",
      })
      .returning();
    const [application] = await db
      .insert(schema.applicationsTable)
      .values({
        organizationId,
        candidateId: candidate.id,
        vacancyId: vacancy.id,
        publicId: uniq("app"),
        source: "direct",
        submittedAt: new Date(),
      })
      .returning();
    const [interview] = await db
      .insert(schema.interviewsTable)
      .values({
        organizationId,
        applicationId: application.id,
        interviewType: "in_person",
        scheduledAt: new Date(Date.now() - 86_400_000),
        durationMinutes: 60,
        status: opts.status ?? "completed",
      })
      .returning();
    return { requisition, vacancy, candidate, application, interview };
  }

  async function addPanelMember(interviewId: number, membershipId: number, organizationId = orgId) {
    const [row] = await db
      .insert(schema.interviewPanelMembersTable)
      .values({ organizationId, interviewId, interviewerMembershipId: membershipId, role: "member" })
      .returning();
    return row;
  }

  const resolve = (actor: Actor, organizationId = orgId) =>
    participation.resolveManagerPortalRecruitmentParticipation(organizationId, actor.userId, actor.membershipId);

  // -- Outstanding own scorecard --------------------------------------------

  it("a panel member sees their own outstanding scorecard, and nobody else's", async () => {
    const mine = await makeActor("panelist");
    const other = await makeActor("otherpanelist");
    const { interview } = await makeInterview({ status: "completed" });
    await addPanelMember(interview.id, mine.membershipId);
    await addPanelMember(interview.id, other.membershipId);

    // The other panel member has submitted; I have not.
    await db.insert(schema.interviewScorecardsTable).values({
      organizationId: orgId,
      interviewId: interview.id,
      interviewerMembershipId: other.membershipId,
      recommendation: "strong_yes",
      overallComment: "CONFIDENTIAL another panel member's private comment",
      submittedAt: new Date(),
    });

    const result = await resolve(mine);
    const row = result.items.find((i) => i.kind === "interview_scorecard" && i.id === interview.id);
    expect(row).toBeDefined();
    expect(row!.title).toBe("Interview scorecard outstanding");
    expect(row!.deepLink).toBe(`/interviews/${interview.id}/scorecard`);

    // Nothing of the other interviewer's scoring, and no candidate identity.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("CONFIDENTIAL");
    expect(serialized).not.toContain("Confidentialfirst");
    expect(serialized).not.toContain("strong_yes");

    // And the one who HAS submitted sees no outstanding row for it.
    const otherResult = await resolve(other);
    expect(otherResult.items.some((i) => i.kind === "interview_scorecard" && i.id === interview.id)).toBe(false);
  });

  it("submitting the scorecard removes the row on the next request", async () => {
    const actor = await makeActor("submitter");
    const { interview } = await makeInterview({ status: "completed" });
    await addPanelMember(interview.id, actor.membershipId);

    expect((await resolve(actor)).items.some((i) => i.kind === "interview_scorecard")).toBe(true);

    // A DRAFT does not clear it — outstanding means unsubmitted.
    const [draft] = await db
      .insert(schema.interviewScorecardsTable)
      .values({
        organizationId: orgId,
        interviewId: interview.id,
        interviewerMembershipId: actor.membershipId,
        submittedAt: null,
      })
      .returning();
    expect((await resolve(actor)).items.some((i) => i.kind === "interview_scorecard")).toBe(true);

    await db
      .update(schema.interviewScorecardsTable)
      .set({ submittedAt: new Date() })
      .where(eq(schema.interviewScorecardsTable.id, draft.id));

    // Completed elsewhere, gone here — nothing to invalidate.
    expect((await resolve(actor)).items.some((i) => i.kind === "interview_scorecard")).toBe(false);
  });

  // -- Live authority --------------------------------------------------------

  it("removing somebody from the panel removes their rows immediately", async () => {
    const actor = await makeActor("removable");
    const { interview } = await makeInterview({ status: "completed" });
    const panelRow = await addPanelMember(interview.id, actor.membershipId);

    expect((await resolve(actor)).items.length).toBeGreaterThan(0);

    await db
      .delete(schema.interviewPanelMembersTable)
      .where(eq(schema.interviewPanelMembersTable.id, panelRow.id));

    // No cached assignment table exists, so the next call is simply the truth.
    expect((await resolve(actor)).items.some((i) => i.id === interview.id)).toBe(false);
  });

  it("an upcoming interview is participation; a cancelled one asks nothing", async () => {
    const actor = await makeActor("upcoming");
    const upcoming = await makeInterview({ status: "scheduled" });
    const cancelled = await makeInterview({ status: "cancelled" });
    await addPanelMember(upcoming.interview.id, actor.membershipId);
    await addPanelMember(cancelled.interview.id, actor.membershipId);

    const result = await resolve(actor);
    const panel = result.items.find((i) => i.id === upcoming.interview.id);
    expect(panel).toBeDefined();
    expect(panel!.kind).toBe("interview_panel");
    expect(panel!.deepLink).toBe(`/interviews/${upcoming.interview.id}`);
    // A scheduled interview is awareness, not outstanding scorecard work.
    expect(result.items.some((i) => i.kind === "interview_scorecard" && i.id === upcoming.interview.id)).toBe(false);
    // A cancelled interview asks nothing of anybody.
    expect(result.items.some((i) => i.id === cancelled.interview.id)).toBe(false);
  });

  // -- Hiring-manager standing ----------------------------------------------

  it("hiring-manager standing follows the employee reference, and a reassignment is live", async () => {
    const manager = await makeActor("hiringmanager");
    const successor = await makeActor("successormanager");
    const { requisition } = await makeInterview({ hiringManagerEmployeeId: manager.employeeId });

    const mine = await resolve(manager);
    const row = mine.items.find((i) => i.kind === "job_requisition" && i.id === requisition.id);
    expect(row).toBeDefined();
    expect(row!.deepLink).toBe(`/requisitions/${requisition.id}`);
    // The role being recruited for is safe; a candidate name would not be.
    expect(row!.title).toContain("Ward Sister");

    // Somebody who is not the hiring manager sees nothing of it.
    expect((await resolve(successor)).items.some((i) => i.id === requisition.id && i.kind === "job_requisition")).toBe(
      false,
    );

    await db
      .update(schema.jobRequisitionsTable)
      .set({ hiringManagerEmployeeId: successor.employeeId })
      .where(eq(schema.jobRequisitionsTable.id, requisition.id));

    expect((await resolve(manager)).items.some((i) => i.id === requisition.id && i.kind === "job_requisition")).toBe(
      false,
    );
    expect((await resolve(successor)).items.some((i) => i.id === requisition.id && i.kind === "job_requisition")).toBe(
      true,
    );
  });

  it("a draft, filled or rejected requisition asks nothing of its hiring manager", async () => {
    const manager = await makeActor("statusmanager");
    for (const status of ["draft", "filled", "rejected"]) {
      await db.insert(schema.jobRequisitionsTable).values({
        organizationId: orgId,
        title: `Closed ${uniq("r")}`,
        requisitionType: "new_role",
        requestedHeadcount: 1,
        status,
        hiringManagerEmployeeId: manager.employeeId,
      });
    }
    const result = await resolve(manager);
    expect(result.items.some((i) => i.kind === "job_requisition")).toBe(false);

    // But one genuinely in flight does appear.
    const [live] = await db
      .insert(schema.jobRequisitionsTable)
      .values({
        organizationId: orgId,
        title: `Open ${uniq("r")}`,
        requisitionType: "new_role",
        requestedHeadcount: 1,
        status: "approved",
        hiringManagerEmployeeId: manager.employeeId,
      })
      .returning();
    expect((await resolve(manager)).items.some((i) => i.kind === "job_requisition" && i.id === live.id)).toBe(true);
  });

  // -- Safety ----------------------------------------------------------------

  it("the row shape carries exactly the safe fields and no candidate data", async () => {
    const actor = await makeActor("shape");
    const { interview } = await makeInterview({ status: "completed", hiringManagerEmployeeId: actor.employeeId });
    await addPanelMember(interview.id, actor.membershipId);

    const result = await resolve(actor);
    expect(result.items.length).toBeGreaterThan(0);
    const expected = ["kind", "id", "title", "status", "occurredAt", "deepLink"].sort();
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual(expected);
      // No candidate, no application, no compensation, no scoring.
      expect(item).not.toHaveProperty("candidateId");
      expect(item).not.toHaveProperty("candidateName");
      expect(item).not.toHaveProperty("applicationId");
      expect(item).not.toHaveProperty("salary");
      expect(item).not.toHaveProperty("recommendation");
    }
    expect(JSON.stringify(result)).not.toContain("Confidentialfirst");
  });

  it("a disabled Recruitment module contributes nothing", async () => {
    const actor = await makeActor("disabled");
    const { interview } = await makeInterview({ status: "completed" });
    await addPanelMember(interview.id, actor.membershipId);
    expect((await resolve(actor)).items.length).toBeGreaterThan(0);

    if (recruitmentModuleId) {
      await db
        .update(schema.organizationModulesTable)
        .set({ enabled: false })
        .where(
          and(
            eq(schema.organizationModulesTable.organizationId, orgId),
            eq(schema.organizationModulesTable.moduleId, recruitmentModuleId),
          ),
        );

      const result = await resolve(actor);
      expect(result.items).toHaveLength(0);
      // Still a legitimate answer, not an error.
      expect(result.linked).toBe(true);

      await db
        .update(schema.organizationModulesTable)
        .set({ enabled: true })
        .where(
          and(
            eq(schema.organizationModulesTable.organizationId, orgId),
            eq(schema.organizationModulesTable.moduleId, recruitmentModuleId),
          ),
        );
    }
  });

  it("cross-tenant Recruitment work is invisible", async () => {
    const actor = await makeActor("tenant");
    const foreign = await makeInterview({ status: "completed", organizationId: otherOrgId });
    // A panel row in the OTHER organization naming this membership.
    await addPanelMember(foreign.interview.id, actor.membershipId, otherOrgId);
    await db.insert(schema.jobRequisitionsTable).values({
      organizationId: otherOrgId,
      title: `Foreign ${uniq("r")}`,
      requisitionType: "new_role",
      requestedHeadcount: 1,
      status: "approved",
      hiringManagerEmployeeId: actor.employeeId,
    });

    // Asked in the caller's own organization, none of it appears.
    const own = await resolve(actor);
    expect(own.items.some((i) => i.id === foreign.interview.id)).toBe(false);
    expect(own.items.some((i) => i.kind === "job_requisition")).toBe(false);
  });

  it("an unlinked interviewer still sees their own panel work", async () => {
    // Panel membership keys on the MEMBERSHIP, so an account with no employee
    // record is still a legitimate interviewer.
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq("unlinked")}@example.invalid`,
        passwordHash: "x",
        firstName: "Unlinked",
        lastName: "Interviewer",
        organizationId: orgId,
      })
      .returning();
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId: orgId, status: "active" })
      .returning();
    const { interview } = await makeInterview({ status: "completed" });
    await addPanelMember(interview.id, m.id);

    const result = await participation.resolveManagerPortalRecruitmentParticipation(orgId, u.id, m.id);
    expect(result.linked).toBe(false);
    expect(result.items.some((i) => i.kind === "interview_scorecard" && i.id === interview.id)).toBe(true);
    // With no employee record there can be no hiring-manager standing.
    expect(result.items.some((i) => i.kind === "job_requisition")).toBe(false);
  });

  it("ordering is deterministic: soonest and oldest first, then kind, then id", async () => {
    const actor = await makeActor("ordering");
    const older = await makeInterview({ status: "completed" });
    const newer = await makeInterview({ status: "completed" });
    await db
      .update(schema.interviewsTable)
      .set({ scheduledAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(schema.interviewsTable.id, older.interview.id));
    await db
      .update(schema.interviewsTable)
      .set({ scheduledAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.interviewsTable.id, newer.interview.id));
    await addPanelMember(older.interview.id, actor.membershipId);
    await addPanelMember(newer.interview.id, actor.membershipId);

    const first = await resolve(actor);
    const ids = first.items.filter((i) => i.kind === "interview_scorecard").map((i) => i.id);
    expect(ids.indexOf(older.interview.id)).toBeLessThan(ids.indexOf(newer.interview.id));
    // Stable across repeated calls.
    const second = await resolve(actor);
    expect(second.items.map((i) => `${i.kind}-${i.id}`)).toEqual(first.items.map((i) => `${i.kind}-${i.id}`));
  });

  it("Manager Portal grants no Recruitment authority — the module exposes no mutation here", async () => {
    // The provider module's whole public surface is one read function. There is
    // no approve, submit, schedule or decide anywhere in it: acting on a row
    // means following its deepLink into Recruitment, which re-gates (§31.28).
    const exported = Object.keys(participation).filter((k) => typeof (participation as any)[k] === "function");
    expect(exported).toEqual(["resolveManagerPortalRecruitmentParticipation"]);
  });
});
