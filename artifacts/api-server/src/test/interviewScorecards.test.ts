/**
 * Integration tests for Interview Scorecards (Phase 3A, W55), exercising the
 * real requireAuth/requireMembership/requireModuleEnabled/requirePermission
 * chain through supertest. Mirrors interviews.test.ts's harness style. No
 * real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  interviewsTable,
  interviewPanelMembersTable,
  interviewScorecardsTable,
  interviewScorecardResponsesTable,
  auditEventsTable,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as unknown[],
      membershipRoleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      interviewRows: [] as Record<string, unknown>[],
      interviewPanelMemberRows: [] as Record<string, unknown>[],
      scorecardRows: [] as Record<string, unknown>[],
      scorecardResponseRows: [] as Record<string, unknown>[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    interviewsTable: mockTable("interviews", ["id", "organizationId", "applicationId", "interviewType", "scheduledAt", "durationMinutes", "location", "meetingLink", "status", "outcome"]),
    interviewPanelMembersTable: mockTable("interview_panel_members", ["id", "organizationId", "interviewId", "interviewerMembershipId", "externalInterviewerName", "externalInterviewerEmail", "role", "conflictDeclared"]),
    interviewScorecardsTable: mockTable("interview_scorecards", [
      "id",
      "organizationId",
      "interviewId",
      "interviewerMembershipId",
      "externalInterviewerToken",
      "externalInterviewerTokenExpiresAt",
      "recommendation",
      "overallComment",
      "submittedAt",
      "finalizedAt",
    ]),
    interviewScorecardResponsesTable: mockTable("interview_scorecard_responses", ["id", "organizationId", "scorecardId", "criterion", "rating", "comment"]),
    auditEventsTable: mockTable("audit_events", []),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | { __op: "inArray"; field: string; vals: unknown[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

function getRowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table === organizationModulesTable) return fixtures.organizationModuleRows;
  if (table === organizationMembershipsTable) return fixtures.membershipRows as Record<string, unknown>[];
  if (table === interviewsTable) return fixtures.interviewRows;
  if (table === interviewPanelMembersTable) return fixtures.interviewPanelMemberRows;
  if (table === interviewScorecardsTable) return fixtures.scorecardRows;
  if (table === interviewScorecardResponsesTable) return fixtures.scorecardResponseRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === interviewScorecardsTable) fixtures.scorecardRows = rows;
  else if (table === interviewScorecardResponsesTable) fixtures.scorecardResponseRows = rows;
}

function selectBuilder(table: { __name: string }) {
  if (table === sessionsTable) {
    const rows = fixtures.sessionRows;
    const b = {
      innerJoin: () => b,
      where: () => b,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return b;
  }

  const unfiltered =
    table === membershipRolesTable
      ? fixtures.membershipRoleRows
      : table === rolePermissionsTable
        ? fixtures.permissionRows
        : table === modulesTable
          ? fixtures.moduleRows
          : undefined;
  if (unfiltered !== undefined) {
    const rows = unfiltered as unknown[];
    const b = {
      innerJoin: () => b,
      where: () => b,
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
    };
    return b;
  }

  const rows = getRowsFor(table);
  let filtered = rows;
  const builder = {
    innerJoin: () => builder,
    where(cond: Cond) {
      filtered = rows.filter((r) => matches(r, cond));
      return builder;
    },
    limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
    orderBy: () => Promise.resolve(filtered),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
  };
  return builder;
}

function insertSingleRow(table: { __name: string }, v: Record<string, unknown>): Record<string, unknown> {
  const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...v };
  const current = getRowsFor(table);
  setRowsFor(table, [...current, row]);
  return row;
}

function insertRow(table: { __name: string }, v: Record<string, unknown> | Record<string, unknown>[]) {
  const rows = Array.isArray(v) ? v.map((item) => insertSingleRow(table, item)) : [insertSingleRow(table, v)];
  return { returning: () => Promise.resolve(rows) };
}

function thenableResult(resultPromise: Promise<unknown>) {
  return {
    returning: () => resultPromise,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => resultPromise.then(resolve, reject),
  };
}

function updateRow(table: { __name: string }, cond: Cond, v: Record<string, unknown>) {
  const rows = getRowsFor(table);
  const idx = rows.findIndex((r) => matches(r, cond));
  if (idx === -1) return Promise.resolve([]);
  const updated = { ...rows[idx], ...v };
  setRowsFor(
    table,
    rows.map((r, i) => (i === idx ? updated : r)),
  );
  return Promise.resolve([updated]);
}

function deleteRow(table: { __name: string }, cond: Cond) {
  const rows = getRowsFor(table);
  const remaining = rows.filter((r) => !matches(r, cond));
  setRowsFor(table, remaining);
  return Promise.resolve(rows.filter((r) => matches(r, cond)));
}

function makeQueryClient() {
  return {
    select: () => ({ from: (table: { __name: string }) => selectBuilder(table) }),
    insert: (table: { __name: string }) => ({ values: (v: Record<string, unknown> | Record<string, unknown>[]) => insertRow(table, v) }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: (cond: Cond) => thenableResult(Promise.resolve(updateRow(table, cond, v))),
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: (cond: Cond) => thenableResult(Promise.resolve(deleteRow(table, cond))),
    }),
  };
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  modulesTable,
  organizationModulesTable,
  interviewsTable,
  interviewPanelMembersTable,
  interviewScorecardsTable,
  interviewScorecardResponsesTable,
  auditEventsTable,
  db: {
    ...makeQueryClient(),
    transaction: async (cb: (tx: ReturnType<typeof makeQueryClient>) => Promise<unknown>) => cb(makeQueryClient()),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  asc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const REQUESTER_USER_ID = 1;
const REQUESTER_MEMBERSHIP_ID = 5;
const OTHER_PANELIST_MEMBERSHIP_ID = 6;
const INTERVIEW_ID = 100;

function mockSession(userId = REQUESTER_USER_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = REQUESTER_MEMBERSHIP_ID, organizationId = ORG_ID) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: REQUESTER_USER_ID, organizationId, status: "active" }];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockRecruitmentModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "recruitment", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function seedInterviewWithPanel(overrides: Record<string, unknown> = {}) {
  fixtures.interviewRows = [
    { id: INTERVIEW_ID, organizationId: ORG_ID, applicationId: 500, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null, ...overrides },
  ];
  fixtures.interviewPanelMemberRows = [
    { id: 1, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerName: null, externalInterviewerEmail: null, role: "member", conflictDeclared: false },
  ];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.interviewRows = [];
  fixtures.interviewPanelMemberRows = [];
  fixtures.scorecardRows = [];
  fixtures.scorecardResponseRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
});

describe("POST /api/organizations/:organizationId/interviews/:id/scorecards", () => {
  it("returns 403 without scorecard.submit", async () => {
    mockPermissions([]);
    seedInterviewWithPanel();
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(403);
  });

  it("returns 404 for an interview belonging to a different organization", async () => {
    mockPermissions(["scorecard.submit"]);
    fixtures.interviewRows = [{ id: INTERVIEW_ID, organizationId: OTHER_ORG_ID, applicationId: 1, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null }];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(404);
  });

  it("returns 400 when the caller is not a panel member for this interview", async () => {
    mockPermissions(["scorecard.submit"]);
    fixtures.interviewRows = [{ id: INTERVIEW_ID, organizationId: ORG_ID, applicationId: 500, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null }];
    fixtures.interviewPanelMemberRows = [];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a cancelled interview", async () => {
    mockPermissions(["scorecard.submit"]);
    seedInterviewWithPanel({ status: "cancelled" });
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({});
    expect(res.status).toBe(400);
  });

  it("never exposes externalInterviewerToken/expiry on the returned scorecard, even when the DB row has one set", async () => {
    mockPermissions(["scorecard.submit"]);
    seedInterviewWithPanel();
    fixtures.scorecardRows = [
      {
        id: 1,
        organizationId: ORG_ID,
        interviewId: INTERVIEW_ID,
        interviewerMembershipId: REQUESTER_MEMBERSHIP_ID,
        externalInterviewerToken: "super-secret-raw-token",
        externalInterviewerTokenExpiresAt: new Date(Date.now() + 100000),
        recommendation: null,
        overallComment: null,
        submittedAt: null,
        finalizedAt: null,
      },
    ];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({ overallComment: "updated" });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("externalInterviewerToken");
    expect(res.body).not.toHaveProperty("externalInterviewerTokenExpiresAt");
  });

  it("saves a draft with responses, upserting on repeated calls", async () => {
    mockPermissions(["scorecard.submit"]);
    seedInterviewWithPanel();

    const first = await request(app)
      .post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`)
      .set("Authorization", "Bearer valid-token")
      .send({ recommendation: "yes", overallComment: "Solid so far", responses: [{ criterion: "Communication", rating: 4 }] });
    expect(first.status).toBe(200);
    expect(first.body.submittedAt).toBeNull();
    expect(first.body.responses).toHaveLength(1);

    const second = await request(app)
      .post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`)
      .set("Authorization", "Bearer valid-token")
      .send({ recommendation: "strong_yes", responses: [{ criterion: "Communication", rating: 5 }, { criterion: "Technical", rating: 5 }] });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.recommendation).toBe("strong_yes");
    expect(second.body.responses).toHaveLength(2);
  });

  it("submits the evaluation, then rejects any further save as immutable", async () => {
    mockPermissions(["scorecard.submit"]);
    seedInterviewWithPanel();

    const submitted = await request(app)
      .post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`)
      .set("Authorization", "Bearer valid-token")
      .send({ recommendation: "yes", submit: true });
    expect(submitted.status).toBe(200);
    expect(submitted.body.submittedAt).not.toBeNull();

    const secondAttempt = await request(app)
      .post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`)
      .set("Authorization", "Bearer valid-token")
      .send({ recommendation: "no" });
    expect(secondAttempt.status).toBe(400);

    const resubmitAttempt = await request(app)
      .post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`)
      .set("Authorization", "Bearer valid-token")
      .send({ submit: true });
    expect(resubmitAttempt.status).toBe(400);
  });

  it("returns 400 once a panel member has been removed from the panel", async () => {
    mockPermissions(["scorecard.submit"]);
    seedInterviewWithPanel();
    await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({ recommendation: "yes" });

    fixtures.interviewPanelMemberRows = [];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token").send({ recommendation: "no" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/organizations/:organizationId/interviews/:id/scorecards — visibility", () => {
  it("an org-wide holder (scorecard.read_all) sees every panel member's scorecard plus a panel summary", async () => {
    mockPermissions(["scorecard.submit", "scorecard.read_all"]);
    seedInterviewWithPanel();
    fixtures.interviewPanelMemberRows.push({ id: 2, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: OTHER_PANELIST_MEMBERSHIP_ID, externalInterviewerName: null, externalInterviewerEmail: null, role: "lead", conflictDeclared: false });
    fixtures.scorecardRows = [
      { id: 1, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerToken: null, externalInterviewerTokenExpiresAt: null, recommendation: "yes", overallComment: null, submittedAt: new Date(), finalizedAt: null },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.scorecards).toHaveLength(1);
    expect(res.body.panelSummary).toMatchObject({ totalPanelMembers: 2, submittedCount: 1, pendingCount: 1 });
    expect(res.body.panelSummary.recommendationCounts.yes).toBe(1);
  });

  it("a submit-only holder sees only their own scorecard, never a colleague's — even one that's already submitted", async () => {
    mockPermissions(["scorecard.submit"]);
    seedInterviewWithPanel();
    fixtures.interviewPanelMemberRows.push({ id: 2, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: OTHER_PANELIST_MEMBERSHIP_ID, externalInterviewerName: null, externalInterviewerEmail: null, role: "lead", conflictDeclared: false });
    fixtures.scorecardRows = [
      { id: 1, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: OTHER_PANELIST_MEMBERSHIP_ID, externalInterviewerToken: null, externalInterviewerTokenExpiresAt: null, recommendation: "strong_no", overallComment: "colleague's take", submittedAt: new Date(), finalizedAt: null },
    ];

    const res = await request(app).get(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.scorecards).toHaveLength(0);
    expect(res.body.panelSummary).toBeNull();
  });

  it("does not leak another organization's scorecards", async () => {
    mockPermissions(["scorecard.read_all"]);
    fixtures.interviewRows = [{ id: INTERVIEW_ID, organizationId: OTHER_ORG_ID, applicationId: 1, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null }];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/interviews/${INTERVIEW_ID}/scorecards`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/scorecards/:id/finalize", () => {
  beforeEach(() => {
    seedInterviewWithPanel();
    fixtures.scorecardRows = [
      { id: 1, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerToken: null, externalInterviewerTokenExpiresAt: null, recommendation: "yes", overallComment: null, submittedAt: new Date(), finalizedAt: null },
    ];
  });

  it("returns 403 without scorecard.finalize", async () => {
    mockPermissions(["scorecard.submit", "scorecard.read_all"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/scorecards/1/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("finalizes a submitted scorecard, then rejects finalizing it again", async () => {
    mockPermissions(["scorecard.finalize"]);
    const first = await request(app).post(`/api/organizations/${ORG_ID}/scorecards/1/finalize`).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(200);
    expect(first.body.finalizedAt).not.toBeNull();

    const second = await request(app).post(`/api/organizations/${ORG_ID}/scorecards/1/finalize`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(400);
  });

  it("returns 400 finalizing a scorecard that was never submitted (still a draft)", async () => {
    mockPermissions(["scorecard.finalize"]);
    fixtures.scorecardRows = [
      { id: 2, organizationId: ORG_ID, interviewId: INTERVIEW_ID, interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerToken: null, externalInterviewerTokenExpiresAt: null, recommendation: null, overallComment: null, submittedAt: null, finalizedAt: null },
    ];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/scorecards/2/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a scorecard belonging to a different organization", async () => {
    mockPermissions(["scorecard.finalize"]);
    fixtures.scorecardRows = [
      { id: 3, organizationId: OTHER_ORG_ID, interviewId: 999, interviewerMembershipId: 1, externalInterviewerToken: null, externalInterviewerTokenExpiresAt: null, recommendation: "yes", overallComment: null, submittedAt: new Date(), finalizedAt: null },
    ];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/scorecards/3/finalize`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
