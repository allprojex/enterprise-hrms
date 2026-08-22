/**
 * Integration tests for GET /organizations/:organizationId/manager-portal/team
 * (Phase 3G, W109 — Manager Portal Foundation & Team Overview), exercising
 * the real requireAuth/requireMembership/requireModuleEnabled chain through
 * supertest. Deliberately NO requirePermission in this route's own chain —
 * mirrors assets.test.ts's own harness style, trimmed to what this route
 * actually needs (no permission tables at all, since none are used).
 * @workspace/db is mocked with real field-based filtering — no real
 * database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "ne"; field: string; val: unknown }
  | { __op: "in"; field: string; vals: unknown[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "ne") return row[cond.field] !== cond.val;
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  return true;
}

const {
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  state,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status"]),
    modulesTable: mockTable("modules", ["id", "key", "status", "defaultEnabled", "requiredModuleKeys"]),
    organizationModulesTable: mockTable("organization_modules", ["id", "organizationId", "moduleId", "enabled"]),
    employeesTable: mockTable("employees", [
      "id", "organizationId", "reportingManagerId", "employmentStatus", "firstName", "lastName",
      "employeeNumber", "profilePictureKey", "departmentId", "branchId", "positionId",
    ]),
    employeeUserLinksTable: mockTable("employee_user_links", ["employeeId", "applicationUserId"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    branchesTable: mockTable("branches", ["id", "organizationId", "name"]),
    positionsTable: mockTable("positions", ["id", "organizationId", "title"]),
    state: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      moduleRows: [] as Record<string, unknown>[],
      organizationModuleRows: [] as Record<string, unknown>[],
      employeeRows: [] as Record<string, unknown>[],
      employeeUserLinkRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      branchRows: [] as Record<string, unknown>[],
      positionRows: [] as Record<string, unknown>[],
    },
  };
});

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  modulesTable,
  organizationModulesTable,
  employeesTable,
  employeeUserLinksTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = state.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        if (table === modulesTable) {
          const rows = state.moduleRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = state.membershipRows;
        else if (table === organizationModulesTable) rows = state.organizationModuleRows;
        else if (table === employeesTable) rows = state.employeeRows;
        else if (table === employeeUserLinksTable) rows = state.employeeUserLinkRows;
        else if (table === departmentsTable) rows = state.departmentRows;
        else if (table === branchesTable) rows = state.branchRows;
        else if (table === positionsTable) rows = state.positionRows;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          orderBy: () => Promise.resolve(filtered),
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  ne: (col: string, val: unknown) => ({ __op: "ne", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  isNull: () => undefined,
  gt: () => undefined,
  desc: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
}));

const { default: app } = await import("../app");

const ORG_ID = 10;
const OTHER_ORG_ID = 20;
const MANAGER_USER_ID = 1;
const HR_USER_ID = 2;
const OTHER_ORG_MANAGER_USER_ID = 3;
const UNLINKED_USER_ID = 4;
const MANAGER_EMPLOYEE_ID = 900;
const HR_EMPLOYEE_ID = 901;
const REPORT_A_ID = 902;
const REPORT_B_ID = 903;
const OTHER_ORG_MANAGER_EMPLOYEE_ID = 904;

function mockSession(userId: number) {
  state.sessionRows = [
    {
      session: { id: userId, token: `token-${userId}`, userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "user@example.com", firstName: "Test", lastName: "User", organizationId: ORG_ID, createdAt: new Date() },
    },
  ];
}
function mockMembership(userId: number, organizationId: number, membershipId: number) {
  state.membershipRows = [
    ...state.membershipRows.filter((m) => (m as Record<string, unknown>).applicationUserId !== userId),
    { id: membershipId, applicationUserId: userId, organizationId, status: "active" },
  ];
}
function mockManagerPortalModuleEnabled(organizationId: number, enabled = true) {
  state.moduleRows = [{ id: 1, key: "manager_portal", status: "active", defaultEnabled: false, requiredModuleKeys: [], optionalModuleKeys: [] }];
  state.organizationModuleRows = [
    ...state.organizationModuleRows.filter((r) => (r as Record<string, unknown>).organizationId !== organizationId),
    ...(enabled ? [{ id: state.organizationModuleRows.length + 1, organizationId, moduleId: 1, enabled: true }] : []),
  ];
}

function managerHeaders() {
  mockSession(MANAGER_USER_ID);
  return { Authorization: `Bearer token-${MANAGER_USER_ID}` };
}
function hrHeaders() {
  mockSession(HR_USER_ID);
  return { Authorization: `Bearer token-${HR_USER_ID}` };
}
function otherOrgManagerHeaders() {
  mockSession(OTHER_ORG_MANAGER_USER_ID);
  return { Authorization: `Bearer token-${OTHER_ORG_MANAGER_USER_ID}` };
}
function unlinkedHeaders() {
  mockSession(UNLINKED_USER_ID);
  return { Authorization: `Bearer token-${UNLINKED_USER_ID}` };
}

beforeEach(() => {
  state.sessionRows = [];
  state.membershipRows = [];
  state.moduleRows = [];
  state.organizationModuleRows = [];
  state.employeeRows = [];
  state.employeeUserLinkRows = [];
  state.departmentRows = [];
  state.branchRows = [];
  state.positionRows = [];

  mockMembership(MANAGER_USER_ID, ORG_ID, 100);
  mockMembership(HR_USER_ID, ORG_ID, 101);
  mockMembership(OTHER_ORG_MANAGER_USER_ID, OTHER_ORG_ID, 102);
  mockMembership(UNLINKED_USER_ID, ORG_ID, 103);
  mockManagerPortalModuleEnabled(ORG_ID);
  mockManagerPortalModuleEnabled(OTHER_ORG_ID);

  state.departmentRows = [{ id: 55, organizationId: ORG_ID, name: "Engineering" }];
  state.branchRows = [{ id: 66, organizationId: ORG_ID, name: "Head Office" }];
  state.positionRows = [{ id: 77, organizationId: ORG_ID, title: "Software Engineer" }];

  state.employeeRows = [
    { id: MANAGER_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null, employmentStatus: "active", firstName: "Mona", lastName: "Manager", employeeNumber: "E-900", profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
    { id: HR_EMPLOYEE_ID, organizationId: ORG_ID, reportingManagerId: null, employmentStatus: "active", firstName: "Hana", lastName: "HrAdmin", employeeNumber: "E-901", profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
    { id: OTHER_ORG_MANAGER_EMPLOYEE_ID, organizationId: OTHER_ORG_ID, reportingManagerId: null, employmentStatus: "active", firstName: "Otto", lastName: "OtherOrg", employeeNumber: "E-904", profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
  ];
  state.employeeUserLinkRows = [
    { employeeId: MANAGER_EMPLOYEE_ID, applicationUserId: MANAGER_USER_ID },
    { employeeId: HR_EMPLOYEE_ID, applicationUserId: HR_USER_ID },
    { employeeId: OTHER_ORG_MANAGER_EMPLOYEE_ID, applicationUserId: OTHER_ORG_MANAGER_USER_ID },
  ];
});

describe("GET /api/organizations/:organizationId/manager-portal/team", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller has no membership in the organization", async () => {
    const headers = managerHeaders();
    state.membershipRows = state.membershipRows.filter((m) => m.applicationUserId !== MANAGER_USER_ID);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the manager_portal module is disabled for the organization", async () => {
    const headers = managerHeaders();
    mockManagerPortalModuleEnabled(ORG_ID, false);
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);
    expect(res.status).toBe(403);
  });

  it("returns linked:false, directReports:[] for a caller with no employee link — not a 404 or 500", async () => {
    const headers = unlinkedHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false, directReports: [] });
  });

  it("returns linked:true, directReports:[] for a linked caller with zero current direct reports", async () => {
    const headers = managerHeaders();
    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, directReports: [] });
  });

  it("returns the caller's direct reports with the narrow DTO fields only", async () => {
    const headers = managerHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: "E-902", profilePictureKey: "documents/photo.png",
      departmentId: 55, branchId: 66, positionId: 77,
    });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.directReports).toHaveLength(1);
    expect(res.body.directReports[0]).toEqual({
      id: REPORT_A_ID,
      employeeNumber: "E-902",
      firstName: "Amara",
      lastName: "Report",
      positionId: 77,
      positionName: "Software Engineer",
      departmentId: 55,
      departmentName: "Engineering",
      branchId: 66,
      branchName: "Head Office",
      employmentStatus: "active",
      hasProfilePicture: true,
    });
  });

  it("returns hasProfilePicture:false when profilePictureKey is null", async () => {
    const headers = managerHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: "E-902", profilePictureKey: null,
      departmentId: null, branchId: null, positionId: null,
    });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.status).toBe(200);
    expect(res.body.directReports[0].hasProfilePicture).toBe(false);
  });

  it("never exposes a sensitive field beyond the frozen DTO (no address/email/phone/nationalId/etc.)", async () => {
    const headers = managerHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: "E-902", profilePictureKey: null,
      departmentId: null, branchId: null, positionId: null,
      // Fields a full Employee row would carry but this DTO must never surface:
      nationalId: "SECRET-ID", personalEmail: "amara@example.com", phoneNumber: "+1-555-0100", residentialAddress: { line1: "123 Main St" },
    });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    const keys = Object.keys(res.body.directReports[0]);
    expect(keys.sort()).toEqual(
      ["id", "employeeNumber", "firstName", "lastName", "positionId", "positionName", "departmentId", "departmentName", "branchId", "branchName", "employmentStatus", "hasProfilePicture"].sort(),
    );
  });

  it("orders direct reports deterministically by lastName, then firstName, then id", async () => {
    const headers = managerHeaders();
    state.employeeRows.push(
      { id: 910, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active", firstName: "Zed", lastName: "Zeta", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
      { id: 911, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active", firstName: "Amy", lastName: "Alpha", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
      { id: 912, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active", firstName: "Bea", lastName: "Beta", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
    );

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.body.directReports.map((d: { id: number }) => d.id)).toEqual([911, 912, 910]);
  });

  it("excludes terminated employees from the live direct-report set", async () => {
    const headers = managerHeaders();
    state.employeeRows.push(
      { id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active", firstName: "Amara", lastName: "Active", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
      { id: REPORT_B_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "terminated", firstName: "Tomi", lastName: "Terminated", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
    );

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.body.directReports).toHaveLength(1);
    expect(res.body.directReports[0].id).toBe(REPORT_A_ID);
  });

  it("includes non-terminated statuses other than active (probation/on_leave/suspended)", async () => {
    const headers = managerHeaders();
    state.employeeRows.push(
      { id: 920, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "probation", firstName: "A", lastName: "Probation", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
      { id: 921, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "on_leave", firstName: "B", lastName: "OnLeave", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
      { id: 922, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "suspended", firstName: "C", lastName: "Suspended", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
    );

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.body.directReports).toHaveLength(3);
  });

  it("an unrelated manager (no direct reports of their own) never sees another manager's team", async () => {
    const headers = managerHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: HR_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null,
    });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.body).toEqual({ linked: true, directReports: [] });
  });

  it("HR/admin caller with their own direct report sees only their own direct report, never the whole organization", async () => {
    const headers = hrHeaders();
    state.employeeRows.push(
      { id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: HR_EMPLOYEE_ID, employmentStatus: "active", firstName: "Amara", lastName: "Report", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
      { id: REPORT_B_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active", firstName: "Bo", lastName: "OtherManagersReport", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null },
    );

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.body.directReports).toHaveLength(1);
    expect(res.body.directReports[0].id).toBe(REPORT_A_ID);
  });

  it("HR/admin caller with zero direct reports of their own gets the same empty state as any other employee — never an organization-wide fallback", async () => {
    const headers = hrHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null,
    });

    const res = await request(app).get(`/api/organizations/${ORG_ID}/manager-portal/team`).set(headers);

    expect(res.body).toEqual({ linked: true, directReports: [] });
  });

  it("does not leak a direct report belonging to a different organization than the caller's active one", async () => {
    const headers = otherOrgManagerHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: OTHER_ORG_MANAGER_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null,
    });

    const res = await request(app).get(`/api/organizations/${OTHER_ORG_ID}/manager-portal/team`).set(headers);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, directReports: [] });
  });

  it("never trusts a client-supplied employeeId/managerId — there is no such parameter on this route", async () => {
    const headers = managerHeaders();
    state.employeeRows.push({
      id: REPORT_A_ID, organizationId: ORG_ID, reportingManagerId: MANAGER_EMPLOYEE_ID, employmentStatus: "active",
      firstName: "Amara", lastName: "Report", employeeNumber: null, profilePictureKey: null, departmentId: null, branchId: null, positionId: null,
    });

    const res = await request(app)
      .get(`/api/organizations/${ORG_ID}/manager-portal/team?employeeId=${HR_EMPLOYEE_ID}&managerEmployeeId=${HR_EMPLOYEE_ID}`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.directReports).toHaveLength(1);
    expect(res.body.directReports[0].id).toBe(REPORT_A_ID);
  });
});
