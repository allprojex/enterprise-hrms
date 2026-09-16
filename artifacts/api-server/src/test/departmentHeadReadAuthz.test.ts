/**
 * ROLE-02 — Department Head READ authorization.
 *
 * The three GET routes were gated on `department.head.manage`, so the role that
 * owns organizational structure (org_admin: department.manage, branch.manage,
 * position.manage, membership.manage) could not discover who leads a department
 * it can itself create and rename. Production showed this as one 403 per
 * department from the departments page for an org_admin caller.
 *
 * These tests pin the capability split:
 *
 *   GET  head, head/history, head/as-of  -> department.head.read OR .manage
 *   POST head, DELETE head               -> department.head.manage ONLY
 *
 * Reads accept either key because `department.head.manage` has been assignable
 * since Office Inventory W1 and organizations may have granted it to roles this
 * codebase cannot see — gating reads on the new key alone would have REVOKED
 * their read. The "legacy manage-only holder" persona below is that regression
 * guard.
 *
 * The real requireAuth -> requireMembership -> requireAnyPermission chain runs
 * through supertest, and the read handlers run their REAL lib-layer queries
 * against a condition-evaluating in-memory mock, so the organization filter is
 * genuinely exercised rather than assumed. Only the two write service functions
 * are stubbed (their transaction/audit internals are covered by
 * departmentHeads.test.ts). No real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

type Condition =
  | { op: "eq"; field: string; value: unknown }
  | { op: "gt"; field: string; value: unknown }
  | { op: "isNull"; field: string }
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | null
  | undefined;

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  departmentsTable,
  departmentHeadsTable,
  assignDepartmentHeadMock,
  revokeDepartmentHeadMock,
} = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = col;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      membershipRows: [] as Record<string, unknown>[],
      departmentRows: [] as Record<string, unknown>[],
      departmentHeadRows: [] as Record<string, unknown>[],
      grantedPermissions: new Set<string>(),
    },
    usersTable: mockTable("users", ["id", "email", "disabledAt", "role"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "applicationUserId", "organizationId", "status", "expiresAt"]),
    departmentsTable: mockTable("departments", ["id", "organizationId", "name"]),
    departmentHeadsTable: mockTable("department_heads", ["id", "organizationId", "departmentId", "headMembershipId", "validFrom", "validTo"]),
    assignDepartmentHeadMock: vi.fn(),
    revokeDepartmentHeadMock: vi.fn(),
  };
});

function evalCondition(cond: Condition, row: Record<string, unknown>): boolean {
  if (!cond) return true;
  if (cond.op === "eq") return row[cond.field] === cond.value;
  if (cond.op === "gt") return (row[cond.field] as number) > (cond.value as number);
  if (cond.op === "isNull") return row[cond.field] === null || row[cond.field] === undefined;
  if (cond.op === "and") return cond.conditions.every((c) => evalCondition(c, row));
  if (cond.op === "or") return cond.conditions.some((c) => evalCondition(c, row));
  return true;
}

vi.mock("drizzle-orm", () => ({
  eq: (field: string, value: unknown) => ({ op: "eq", field, value }),
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
  isNull: (field: string) => ({ op: "isNull", field }),
  gt: (field: string, value: unknown) => ({ op: "gt", field, value }),
  desc: (field: string) => field,
  sql: () => ({}),
}));

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  departmentsTable,
  departmentHeadsTable,
  db: {
    select: () => ({
      from(table: unknown) {
        if (table === sessionsTable) {
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(fixtures.sessionRows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(fixtures.sessionRows).then(resolve, reject),
          };
          return builder;
        }

        const rows: Record<string, unknown>[] =
          table === organizationMembershipsTable
            ? fixtures.membershipRows
            : table === departmentsTable
              ? fixtures.departmentRows
              : table === departmentHeadsTable
                ? fixtures.departmentHeadRows
                : [];

        let condition: Condition = null;
        const settle = () => Promise.resolve(rows.filter((r) => evalCondition(condition, r)));
        const builder = {
          where: (cond: Condition) => {
            condition = cond;
            return builder;
          },
          orderBy: () => builder,
          limit: (n: number) => settle().then((r) => r.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => settle().then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("../lib/permissions", () => ({
  hasPermission: async (_membershipId: number, key: string) => fixtures.grantedPermissions.has(key),
  getEffectivePermissions: async () => new Set(fixtures.grantedPermissions),
}));

// Only the two WRITE service functions are stubbed; the reads run for real.
vi.mock("../lib/departmentHeads", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, assignDepartmentHead: assignDepartmentHeadMock, revokeDepartmentHead: revokeDepartmentHeadMock };
});

const { default: app } = await import("../app");

const ORG = 10;
const OTHER_ORG = 20;
const DEPT = 100;
const OTHER_ORG_DEPT = 200;
const MEMBERSHIP_ID = 55;
const TOKEN = "valid-token";

/** Permission sets for each persona under test. */
const PERSONAS = {
  /** Canonical `employee` role keys relevant here — neither head key. */
  employee: ["organization.read", "employee.read", "department.read", "position.read", "branch.read"],
  /** A department head holding only the canonical employee role (org 71's real shape). */
  departmentHead: ["organization.read", "employee.read", "department.read", "leave_request.approve"],
  /** org_admin after this change: read, deliberately WITHOUT manage. */
  orgAdmin: ["organization.read", "employee.read", "department.read", "department.manage", "membership.manage", "department.head.read"],
  /** HR: holds both, as the seed grants them. */
  hr: ["department.read", "department.head.read", "department.head.manage"],
  /** A pre-existing holder of manage only — e.g. an organization-defined role. */
  legacyManageOnly: ["department.read", "department.head.manage"],
  /** Member of the organization with no department-head capability at all. */
  none: ["organization.read"],
} as const;

function actAs(persona: keyof typeof PERSONAS): void {
  fixtures.grantedPermissions = new Set(PERSONAS[persona]);
}

const READ_ROUTES = [
  ["current head", `/api/organizations/${ORG}/departments/${DEPT}/head`],
  ["head history", `/api/organizations/${ORG}/departments/${DEPT}/head/history`],
  ["head as-of", `/api/organizations/${ORG}/departments/${DEPT}/head/as-of?date=2026-06-01`],
] as const;

beforeEach(() => {
  assignDepartmentHeadMock.mockReset();
  revokeDepartmentHeadMock.mockReset();

  fixtures.sessionRows = [
    {
      session: { token: TOKEN, userId: 1, expiresAt: new Date(Date.now() + 3_600_000) },
      user: { id: 1, email: "caller@example.test", disabledAt: null, role: "employee" },
    },
  ];
  // The caller is a member of ORG only — never OTHER_ORG.
  fixtures.membershipRows = [{ id: MEMBERSHIP_ID, applicationUserId: 1, organizationId: ORG, status: "active", expiresAt: null }];
  fixtures.departmentRows = [
    { id: DEPT, organizationId: ORG, name: "North Ridge Operations" },
    { id: OTHER_ORG_DEPT, organizationId: OTHER_ORG, name: "Another Tenant Department" },
  ];
  fixtures.departmentHeadRows = [
    { id: 1, organizationId: ORG, departmentId: DEPT, headMembershipId: 77, validFrom: new Date("2026-01-01"), validTo: null },
    // Same department id, different tenant — a missing organization filter would surface this.
    { id: 2, organizationId: OTHER_ORG, departmentId: DEPT, headMembershipId: 999, validFrom: new Date("2026-01-01"), validTo: null },
  ];
  fixtures.grantedPermissions = new Set();
});

describe("ROLE-02 — ordinary employee stays refused", () => {
  for (const [label, url] of READ_ROUTES) {
    it(`refuses (403) an ordinary employee reading ${label}`, async () => {
      actAs("employee");
      const res = await request(app).get(url).set("Authorization", `Bearer ${TOKEN}`);
      expect(res.status).toBe(403);
    });
  }

  it("refuses (403) a member of the organization holding no department-head capability", async () => {
    actAs("none");
    const res = await request(app).get(READ_ROUTES[0][1]).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(403);
  });
});

describe("ROLE-02 — department head boundary is unchanged", () => {
  // Heading a department is a relationship in department_heads; it confers no
  // permission key. A head holding only the canonical employee role could not
  // read head assignments before this change and still cannot.
  for (const [label, url] of READ_ROUTES) {
    it(`refuses (403) a department head with only employee-role keys reading ${label}`, async () => {
      actAs("departmentHead");
      const res = await request(app).get(url).set("Authorization", `Bearer ${TOKEN}`);
      expect(res.status).toBe(403);
    });
  }
});

describe("ROLE-02 — organization administrator can read, but not manage", () => {
  it("lets org_admin read the current head", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(READ_ROUTES[0][1]).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ organizationId: ORG, departmentId: DEPT, headMembershipId: 77 });
  });

  it("lets org_admin read the head history", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(READ_ROUTES[1][1]).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ organizationId: ORG, headMembershipId: 77 });
  });

  it("lets org_admin resolve the head as of a date", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(READ_ROUTES[2][1]).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ headMembershipId: 77 });
  });

  it("still refuses (403) org_admin ASSIGNING a head — a read fix must not widen management", async () => {
    actAs("orgAdmin");
    const res = await request(app)
      .post(`/api/organizations/${ORG}/departments/${DEPT}/head`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ headMembershipId: 88 });
    expect(res.status).toBe(403);
    expect(assignDepartmentHeadMock).not.toHaveBeenCalled();
  });

  it("still refuses (403) org_admin REVOKING a head", async () => {
    actAs("orgAdmin");
    const res = await request(app).delete(`/api/organizations/${ORG}/departments/${DEPT}/head`).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(403);
    expect(revokeDepartmentHeadMock).not.toHaveBeenCalled();
  });
});

describe("ROLE-02 — HR access is preserved", () => {
  for (const [label, url] of READ_ROUTES) {
    it(`lets HR read ${label}`, async () => {
      actAs("hr");
      const res = await request(app).get(url).set("Authorization", `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
    });
  }

  it("lets HR assign a head", async () => {
    actAs("hr");
    assignDepartmentHeadMock.mockResolvedValue({ id: 9, organizationId: ORG, departmentId: DEPT, headMembershipId: 88 });
    const res = await request(app)
      .post(`/api/organizations/${ORG}/departments/${DEPT}/head`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ headMembershipId: 88 });
    expect(res.status).toBe(201);
    expect(assignDepartmentHeadMock).toHaveBeenCalledTimes(1);
  });

  it("lets HR revoke a head", async () => {
    actAs("hr");
    revokeDepartmentHeadMock.mockResolvedValue({ id: 9, organizationId: ORG, departmentId: DEPT, headMembershipId: 77 });
    const res = await request(app).delete(`/api/organizations/${ORG}/departments/${DEPT}/head`).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(revokeDepartmentHeadMock).toHaveBeenCalledTimes(1);
  });
});

describe("ROLE-02 — manage keeps implying read (no revocation for existing holders)", () => {
  for (const [label, url] of READ_ROUTES) {
    it(`lets a manage-only holder read ${label}`, async () => {
      actAs("legacyManageOnly");
      const res = await request(app).get(url).set("Authorization", `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
    });
  }
});

describe("ROLE-02 — tenant isolation", () => {
  it("refuses (403) a caller acting on an organization they are not a member of", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(`/api/organizations/${OTHER_ORG}/departments/${DEPT}/head`).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(403);
  });

  it("never returns another tenant's head row for the same department id", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(READ_ROUTES[0][1]).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(ORG);
    expect(res.body.headMembershipId).not.toBe(999);
  });

  it("scopes history to the caller's organization only", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(READ_ROUTES[1][1]).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.every((r: { organizationId: number }) => r.organizationId === ORG)).toBe(true);
  });

  it("returns null rather than a foreign row for a department belonging to another tenant", async () => {
    actAs("orgAdmin");
    const res = await request(app).get(`/api/organizations/${ORG}/departments/${OTHER_ORG_DEPT}/head`).set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe("ROLE-02 — authentication is still required", () => {
  it("refuses (401) an unauthenticated read", async () => {
    actAs("hr");
    const res = await request(app).get(READ_ROUTES[0][1]);
    expect(res.status).toBe(401);
  });

  it("refuses (401) an unknown bearer token", async () => {
    actAs("hr");
    fixtures.sessionRows = [];
    const res = await request(app).get(READ_ROUTES[0][1]).set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });
});
