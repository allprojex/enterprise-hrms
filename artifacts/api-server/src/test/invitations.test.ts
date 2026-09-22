/**
 * Integration tests for Administrative User Management (W10): inviting a
 * user who may not yet have an account, and the public accept-invitation
 * flow. Exercises the real middleware chain through supertest.
 * @workspace/db is mocked — no real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  organizationsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  organizationDomainsTable,
  organizationSettingsTable,
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
      membershipRows: [] as Record<string, unknown>[],
      userRows: [] as Record<string, unknown>[],
      membershipRoleRows: [] as { membershipId: number; roleId: number }[],
      permissionRows: [] as { roleId: number; key: string }[],
      // Pre-shaped {membership, user, organizationName} rows -- getInvitationByToken
      // does a 3-table join the generic select() mock below can't reshape itself.
      invitationJoinRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    usersTable: mockTable("users", ["id", "email"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    organizationMembershipsTable: mockTable("organization_memberships", [
      "id",
      "applicationUserId",
      "organizationId",
      "status",
      "inviteToken",
    ]),
    organizationsTable: mockTable("organizations", ["id", "name"]),
    membershipRolesTable: mockTable("membership_roles", ["membershipId", "roleId"]),
    rolesTable: mockTable("roles", ["id", "key", "organizationId", "isSystemRole"]),
    rolePermissionsTable: mockTable("role_permissions", ["roleId", "permissionId"]),
    permissionsTable: mockTable("permissions", ["id", "key"]),
    organizationDomainsTable: mockTable("organization_domains", ["id", "organizationId", "hostname", "status", "isPrimary", "domainType"]),
    organizationSettingsTable: mockTable("organization_settings", ["id", "organizationId", "namespace", "schemaVersion", "settings"]),
    auditEventsTable: mockTable("audit_events", ["organizationId"]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "in"; field: string; vals: unknown[] }
  | { __op: "and"; conds: Cond[] }
  | undefined;
function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "in") return cond.vals.includes(row[cond.field]);
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

let lastSelectedFields: unknown;

const dbMock = {
  select: (fields?: unknown) => {
    lastSelectedFields = fields;
    return {
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
          };
          return builder;
        }

        // getInvitationByToken's 3-table join -- served from a dedicated,
        // pre-shaped fixture (see invitationJoinRows above).
        if (table === organizationMembershipsTable && lastSelectedFields && typeof lastSelectedFields === "object") {
          const rows = fixtures.invitationJoinRows;
          const builder = {
            innerJoin: () => builder,
            where(cond: Cond) {
              const filtered = rows.filter((r) => matches(r.membership as Record<string, unknown>, cond));
              return { ...builder, limit: () => Promise.resolve(filtered) };
            },
            limit: () => Promise.resolve(rows),
          };
          return builder;
        }

        let rows: Record<string, unknown>[] = [];
        if (table === organizationMembershipsTable) rows = fixtures.membershipRows;
        else if (table === usersTable) rows = fixtures.userRows;
        else if (table === membershipRolesTable) rows = fixtures.membershipRoleRows as never;
        else if (table === rolePermissionsTable) rows = fixtures.permissionRows as never;

        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit(n: number) {
            filtered = filtered.slice(0, n);
            return builder;
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    };
  },
  insert: (table: { __name: string }) => ({
    values: (v: Record<string, unknown>) => {
      fixtures.inserted.push({ table: table.__name, values: v });
      if (table === auditEventsTable) return { returning: () => Promise.resolve([]) };
      const row = { id: nextId(table), ...v };
      if (table === usersTable) fixtures.userRows.push(row);
      if (table === organizationMembershipsTable) fixtures.membershipRows.push(row);
      return { returning: () => Promise.resolve([row]) };
    },
  }),
  update: (table: { __name: string }) => ({
    set: (v: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          fixtures.inserted.push({ table: table.__name, values: v });
          if (table === usersTable) {
            const base = fixtures.userRows[0] ?? fixtures.invitationJoinRows[0]?.user;
            return Promise.resolve(base ? [{ ...(base as object), ...v }] : []);
          }
          if (table === organizationMembershipsTable) {
            const base = fixtures.membershipRows[0] ?? fixtures.invitationJoinRows[0]?.membership;
            return Promise.resolve(base ? [{ ...(base as object), ...v }] : []);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  }),
};

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  organizationsTable,
  membershipRolesTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  organizationDomainsTable,
  organizationSettingsTable,
  auditEventsTable,
  db: dbMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: (col: string, vals: unknown[]) => ({ __op: "in", field: col.split(".").pop(), vals }),
}));

process.env.APP_BASE_URL = process.env.APP_BASE_URL ?? "https://platform.test";
const { default: app } = await import("../app");

function mockSession(userId = 1) {
  fixtures.sessionRows = [
    {
      session: { id: 1, token: "valid-token", userId, expiresAt: new Date(Date.now() + 100000) },
      user: { id: userId, email: "admin@example.com" },
    },
  ];
}

function mockActiveMembership(membershipId = 5, organizationId = 10) {
  fixtures.membershipRows = [{ id: membershipId, applicationUserId: 1, organizationId, status: "active" }];
}

function mockPermissions(permissionKeys: string[], membershipId = 5, roleId = 1) {
  fixtures.membershipRoleRows = [{ membershipId, roleId }];
  fixtures.permissionRows = permissionKeys.map((key) => ({ roleId, key }));
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.membershipRows = [];
  fixtures.userRows = [];
  fixtures.membershipRoleRows = [];
  fixtures.permissionRows = [];
  fixtures.invitationJoinRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("POST /api/organizations/:organizationId/invitations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).post("/api/organizations/10/invitations").send({ email: "new@example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 403 without membership.manage", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["membership.read"]);

    const res = await request(app)
      .post("/api/organizations/10/invitations")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "new@example.com" });

    expect(res.status).toBe(403);
  });

  it("creates a new user and an invited membership, returning the accept token", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["membership.manage"]);
    fixtures.userRows = []; // no existing user with this email

    const res = await request(app)
      .post("/api/organizations/10/invitations")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "newperson@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("invited");
    expect(typeof res.body.inviteToken).toBe("string");
    expect(res.body.inviteToken.length).toBeGreaterThan(10);

    const userInsert = fixtures.inserted.find((i) => i.table === "users");
    expect(userInsert).toBeDefined();
    expect((userInsert!.values as Record<string, unknown>).email).toBe("newperson@example.com");
  });

  it("returns 409 when the email already has a membership in this organization", async () => {
    mockSession();
    mockActiveMembership();
    mockPermissions(["membership.manage"]);
    fixtures.userRows = [{ id: 42, email: "existing@example.com" }];
    // getAnyMembership looks up (applicationUserId=42, organizationId=10) -- give it a hit.
    fixtures.membershipRows = [
      { id: 5, applicationUserId: 1, organizationId: 10, status: "active" },
      { id: 99, applicationUserId: 42, organizationId: 10, status: "invited" },
    ];

    const res = await request(app)
      .post("/api/organizations/10/invitations")
      .set("Authorization", "Bearer valid-token")
      .send({ email: "existing@example.com" });

    expect(res.status).toBe(409);
  });
});

describe("GET /api/invitations/:token", () => {
  it("returns a pending preview for a valid, unexpired token", async () => {
    fixtures.invitationJoinRows = [
      {
        membership: {
          id: 7,
          applicationUserId: 42,
          organizationId: 10,
          status: "invited",
          inviteToken: "good-token",
          inviteTokenExpiresAt: new Date(Date.now() + 100000),
        },
        user: { id: 42, email: "invitee@example.com" },
        organizationName: "Acme Co",
      },
    ];

    const res = await request(app).get("/api/invitations/good-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ organizationName: "Acme Co", email: "invitee@example.com", status: "pending" });
  });

  it("returns 404 for an unknown token", async () => {
    fixtures.invitationJoinRows = [];
    const res = await request(app).get("/api/invitations/nonexistent");
    expect(res.status).toBe(404);
  });

  it("reports status expired for a token past its expiry", async () => {
    fixtures.invitationJoinRows = [
      {
        membership: {
          id: 7,
          applicationUserId: 42,
          organizationId: 10,
          status: "invited",
          inviteToken: "stale-token",
          inviteTokenExpiresAt: new Date(Date.now() - 1000),
        },
        user: { id: 42, email: "invitee@example.com" },
        organizationName: "Acme Co",
      },
    ];

    const res = await request(app).get("/api/invitations/stale-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
  });

  it("reports status accepted for an already-accepted invitation", async () => {
    fixtures.invitationJoinRows = [
      {
        membership: {
          id: 7,
          applicationUserId: 42,
          organizationId: 10,
          status: "active",
          inviteToken: "used-token",
          inviteTokenExpiresAt: null,
        },
        user: { id: 42, email: "invitee@example.com" },
        organizationName: "Acme Co",
      },
    ];

    const res = await request(app).get("/api/invitations/used-token");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
  });
});

describe("POST /api/invitations/:token/accept", () => {
  function seedPendingInvitation(overrides: Partial<{ status: string; expiresAt: Date | null }> = {}) {
    fixtures.invitationJoinRows = [
      {
        membership: {
          id: 7,
          applicationUserId: 42,
          organizationId: 10,
          status: overrides.status ?? "invited",
          inviteToken: "good-token",
          inviteTokenExpiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : new Date(Date.now() + 100000),
        },
        user: { id: 42, email: "invitee@example.com" },
        organizationName: "Acme Co",
      },
    ];
  }

  it("returns 404 for an unknown token", async () => {
    fixtures.invitationJoinRows = [];
    const res = await request(app)
      .post("/api/invitations/nonexistent/accept")
      .send({ firstName: "Jane", lastName: "Doe", password: "correct-horse-battery" });
    expect(res.status).toBe(404);
  });

  it("returns 410 for an expired invitation", async () => {
    seedPendingInvitation({ expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app)
      .post("/api/invitations/good-token/accept")
      .send({ firstName: "Jane", lastName: "Doe", password: "correct-horse-battery" });
    expect(res.status).toBe(410);
  });

  it("returns 409 for an already-accepted invitation", async () => {
    seedPendingInvitation({ status: "active" });
    const res = await request(app)
      .post("/api/invitations/good-token/accept")
      .send({ firstName: "Jane", lastName: "Doe", password: "correct-horse-battery" });
    expect(res.status).toBe(409);
  });

  it("activates the membership and sets the user's name and password on success", async () => {
    seedPendingInvitation();
    const res = await request(app)
      .post("/api/invitations/good-token/accept")
      .send({ firstName: "Jane", lastName: "Doe", password: "correct-horse-battery" });

    expect(res.status).toBe(200);

    const userUpdate = fixtures.inserted.find((i) => i.table === "users");
    expect(userUpdate).toBeDefined();
    expect((userUpdate!.values as Record<string, unknown>).firstName).toBe("Jane");
    expect((userUpdate!.values as Record<string, unknown>).passwordHash).toBeDefined();

    const membershipUpdate = fixtures.inserted.find((i) => i.table === "organization_memberships");
    expect(membershipUpdate).toBeDefined();
    expect((membershipUpdate!.values as Record<string, unknown>).status).toBe("active");
    expect((membershipUpdate!.values as Record<string, unknown>).inviteToken).toBeNull();
  });

  it("does not include a password in the response body", async () => {
    seedPendingInvitation();
    const res = await request(app)
      .post("/api/invitations/good-token/accept")
      .send({ firstName: "Jane", lastName: "Doe", password: "correct-horse-battery" });

    expect(JSON.stringify(res.body)).not.toContain("correct-horse-battery");
  });
});
