/**
 * Integration tests for Interviews & Scheduling (Phase 3A, W54), exercising
 * the real requireAuth/requireMembership/requireModuleEnabled/
 * requirePermission chain through supertest. Mirrors
 * candidatesTalentPools.test.ts's harness style. No real database
 * connection is made.
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
  applicationsTable,
  interviewsTable,
  interviewPanelMembersTable,
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
      applicationRows: [] as Record<string, unknown>[],
      interviewRows: [] as Record<string, unknown>[],
      interviewPanelMemberRows: [] as Record<string, unknown>[],
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
    applicationsTable: mockTable("applications", ["id", "organizationId", "candidateId", "vacancyId"]),
    interviewsTable: mockTable("interviews", [
      "id",
      "organizationId",
      "applicationId",
      "interviewType",
      "scheduledAt",
      "durationMinutes",
      "location",
      "meetingLink",
      "status",
      "outcome",
    ]),
    interviewPanelMembersTable: mockTable("interview_panel_members", [
      "id",
      "organizationId",
      "interviewId",
      "interviewerMembershipId",
      "externalInterviewerName",
      "externalInterviewerEmail",
      "role",
      "conflictDeclared",
    ]),
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
  if (table === applicationsTable) return fixtures.applicationRows;
  if (table === interviewsTable) return fixtures.interviewRows;
  if (table === interviewPanelMembersTable) return fixtures.interviewPanelMemberRows;
  return [];
}

function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]) {
  if (table === interviewsTable) fixtures.interviewRows = rows;
  else if (table === interviewPanelMembersTable) fixtures.interviewPanelMemberRows = rows;
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
    select: (proj?: unknown) => ({ from: (table: { __name: string }) => selectBuilder(table) }),
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
  applicationsTable,
  interviewsTable,
  interviewPanelMembersTable,
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
const OTHER_MEMBERSHIP_ID = 6;
const APPLICATION_ID = 500;

function mockSession(userId = REQUESTER_USER_ID) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
}

function mockActiveMembership(membershipId = REQUESTER_MEMBERSHIP_ID, organizationId = ORG_ID) {
  fixtures.membershipRows = [
    { id: membershipId, applicationUserId: REQUESTER_USER_ID, organizationId, status: "active" },
    { id: OTHER_MEMBERSHIP_ID, applicationUserId: 999, organizationId, status: "active" },
  ];
}

function mockPermissions(permissionKeys: string[]) {
  fixtures.membershipRoleRows = [{ roleId: 1 }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ key }));
}

function mockRecruitmentModuleEnabled(enabled: boolean) {
  fixtures.moduleRows = [{ id: 1, key: "recruitment", status: "hidden", defaultEnabled: false, requiredModuleKeys: [] }];
  fixtures.organizationModuleRows = enabled ? [{ id: 1, organizationId: ORG_ID, moduleId: 1, enabled: true }] : [];
}

function seedApplication() {
  fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: ORG_ID, candidateId: 1, vacancyId: 1 }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.moduleRows = [];
  fixtures.organizationModuleRows = [];
  fixtures.applicationRows = [];
  fixtures.interviewRows = [];
  fixtures.interviewPanelMemberRows = [];
  fixtures.idCounters = new Map();

  mockSession();
  mockActiveMembership();
  mockRecruitmentModuleEnabled(true);
  seedApplication();
});

describe("POST /api/organizations/:organizationId/applications/:applicationId/interviews", () => {
  it("returns 403 without interview.manage", async () => {
    mockPermissions(["interview.read"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews`)
      .set("Authorization", "Bearer valid-token")
      .send({ interviewType: "virtual", scheduledAt: new Date().toISOString(), durationMinutes: 45 });
    expect(res.status).toBe(403);
  });

  it("schedules an interview with an initial panel", async () => {
    mockPermissions(["interview.read", "interview.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews`)
      .set("Authorization", "Bearer valid-token")
      .send({
        interviewType: "virtual",
        scheduledAt: new Date("2026-08-01T10:00:00Z").toISOString(),
        durationMinutes: 45,
        meetingLink: "https://example.com/meet",
        panelMembers: [{ interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, role: "lead" }],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ applicationId: APPLICATION_ID, interviewType: "virtual", status: "scheduled" });
    expect(res.body.panelMembers).toHaveLength(1);
    expect(res.body.panelMembers[0]).toMatchObject({ interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, role: "lead" });
  });

  it("returns 404 scheduling an interview for an application in a different organization", async () => {
    mockPermissions(["interview.manage"]);
    fixtures.applicationRows = [{ id: APPLICATION_ID, organizationId: OTHER_ORG_ID, candidateId: 1, vacancyId: 1 }];
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews`)
      .set("Authorization", "Bearer valid-token")
      .send({ interviewType: "phone", scheduledAt: new Date().toISOString(), durationMinutes: 30 });
    expect(res.status).toBe(404);
  });

  it("rejects a panel member supplying both internal and external identity", async () => {
    mockPermissions(["interview.manage"]);
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews`)
      .set("Authorization", "Bearer valid-token")
      .send({
        interviewType: "phone",
        scheduledAt: new Date().toISOString(),
        durationMinutes: 30,
        panelMembers: [{ interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerName: "Jane", externalInterviewerEmail: "jane@example.com" }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects an interviewerMembershipId belonging to a different organization", async () => {
    mockPermissions(["interview.manage"]);
    fixtures.membershipRows.push({ id: 999, applicationUserId: 111, organizationId: OTHER_ORG_ID, status: "active" });
    const res = await request(app)
      .post(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews`)
      .set("Authorization", "Bearer valid-token")
      .send({ interviewType: "phone", scheduledAt: new Date().toISOString(), durationMinutes: 30, panelMembers: [{ interviewerMembershipId: 999 }] });
    expect(res.status).toBe(400);
  });
});

describe("Interview visibility (own-scheduled-as-interviewer vs org-wide)", () => {
  it("an org-wide holder (interview.manage) sees every interview in the organization", async () => {
    mockPermissions(["interview.read", "interview.manage"]);
    fixtures.interviewRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/interviews`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("a caller without org-wide reach sees only interviews where their own membership is on the panel", async () => {
    mockPermissions(["interview.read"]);
    fixtures.interviewRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];

    const notOnPanel = await request(app).get(`/api/organizations/${ORG_ID}/interviews`).set("Authorization", "Bearer valid-token");
    expect(notOnPanel.body.total).toBe(0);

    fixtures.interviewPanelMemberRows = [{ id: 1, organizationId: ORG_ID, interviewId: 1, interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerName: null, externalInterviewerEmail: null, role: "member", conflictDeclared: false }];
    const onPanel = await request(app).get(`/api/organizations/${ORG_ID}/interviews`).set("Authorization", "Bearer valid-token");
    expect(onPanel.body.total).toBe(1);
  });

  it("does not leak another organization's interviews", async () => {
    mockPermissions(["interview.read", "interview.manage"]);
    fixtures.interviewRows = [
      { id: 1, organizationId: OTHER_ORG_ID, applicationId: 1, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/interviews`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("returns 404 for an interview that exists but is not visible to this caller", async () => {
    mockPermissions(["interview.read"]);
    fixtures.interviewRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];
    const res = await request(app).get(`/api/organizations/${ORG_ID}/interviews/1`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});

describe("PATCH .../applications/:applicationId/interviews/:id — reschedule as new row, status transitions, panel replace", () => {
  beforeEach(() => {
    mockPermissions(["interview.read", "interview.manage"]);
    fixtures.interviewRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, interviewType: "phone", scheduledAt: new Date("2026-08-01T10:00:00Z"), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];
    fixtures.interviewPanelMemberRows = [{ id: 1, organizationId: ORG_ID, interviewId: 1, interviewerMembershipId: REQUESTER_MEMBERSHIP_ID, externalInterviewerName: null, externalInterviewerEmail: null, role: "lead", conflictDeclared: false }];
    // The manually-seeded row above bypasses insertSingleRow's nextId
    // counter — prime it so a real reschedule insert doesn't collide with id 1.
    fixtures.idCounters.set("interviews", 1);
    fixtures.idCounters.set("interview_panel_members", 1);
  });

  it("supplying scheduledAt cancels the old row and creates a brand new one, carrying over the panel", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ scheduledAt: new Date("2026-08-02T14:00:00Z").toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.id).not.toBe(1);
    expect(res.body.status).toBe("scheduled");
    expect(new Date(res.body.scheduledAt).toISOString()).toBe(new Date("2026-08-02T14:00:00Z").toISOString());
    expect(res.body.panelMembers).toHaveLength(1);

    const oldRow = fixtures.interviewRows.find((r) => r.id === 1);
    expect(oldRow?.status).toBe("cancelled");
  });

  it("returns 400 updating an interview that is not currently scheduled", async () => {
    fixtures.interviewRows[0].status = "completed";
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ location: "Room 2" });
    expect(res.status).toBe(400);
  });

  it("marks an interview completed with an outcome, in place (same id)", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "completed", outcome: "Went well" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.status).toBe("completed");
    expect(res.body.outcome).toBe("Went well");
  });

  it("marks an interview no_show", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ status: "no_show" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("no_show");
  });

  it("replaces the full panel when panelMembers is supplied without scheduledAt", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/${APPLICATION_ID}/interviews/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ panelMembers: [{ externalInterviewerName: "Jane Panelist", externalInterviewerEmail: "jane@example.com" }] });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.panelMembers).toHaveLength(1);
    expect(res.body.panelMembers[0]).toMatchObject({ externalInterviewerName: "Jane Panelist" });
  });

  it("returns 404 updating an interview id that does not belong to the given application", async () => {
    const res = await request(app)
      .patch(`/api/organizations/${ORG_ID}/applications/999999/interviews/1`)
      .set("Authorization", "Bearer valid-token")
      .send({ location: "Room 2" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/organizations/:organizationId/interviews/:id/cancel", () => {
  beforeEach(() => {
    fixtures.interviewRows = [
      { id: 1, organizationId: ORG_ID, applicationId: APPLICATION_ID, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];
  });

  it("returns 403 without interview.manage", async () => {
    mockPermissions(["interview.read"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/1/cancel`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(403);
  });

  it("cancels a scheduled interview", async () => {
    mockPermissions(["interview.manage"]);
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/1/cancel`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
  });

  it("returns 400 cancelling an already-cancelled interview (double cancel)", async () => {
    mockPermissions(["interview.manage"]);
    const first = await request(app).post(`/api/organizations/${ORG_ID}/interviews/1/cancel`).set("Authorization", "Bearer valid-token");
    expect(first.status).toBe(200);
    const second = await request(app).post(`/api/organizations/${ORG_ID}/interviews/1/cancel`).set("Authorization", "Bearer valid-token");
    expect(second.status).toBe(400);
  });

  it("returns 404 cancelling an interview belonging to a different organization", async () => {
    mockPermissions(["interview.manage"]);
    fixtures.interviewRows = [
      { id: 1, organizationId: OTHER_ORG_ID, applicationId: 1, interviewType: "phone", scheduledAt: new Date(), durationMinutes: 30, location: null, meetingLink: null, status: "scheduled", outcome: null },
    ];
    const res = await request(app).post(`/api/organizations/${ORG_ID}/interviews/1/cancel`).set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(404);
  });
});
