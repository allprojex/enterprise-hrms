/**
 * PATCH /users/me — the account profile must not be a second, self-editable
 * copy of an employee's HR-owned identity (Core-HR Phase 1). A login linked to
 * an employee record cannot change its name, job title or department here;
 * an unlinked (platform/Super Admin/bootstrap) account can. The account phone
 * number stays editable for everyone, validated and audited.
 *
 * @workspace/db is mocked with field-based filtering; no real database.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const { fixtures, usersTable, sessionsTable, employeeUserLinksTable, auditEventsTable } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      sessionRows: [] as unknown[],
      userRows: [] as Record<string, unknown>[],
      linkRows: [] as Record<string, unknown>[],
      audits: [] as Record<string, unknown>[],
      userUpdates: [] as Record<string, unknown>[],
    },
    usersTable: mockTable("users", ["id", "email", "firstName", "lastName", "jobTitle", "department", "phoneNumber"]),
    sessionsTable: mockTable("sessions", ["token", "userId", "expiresAt"]),
    employeeUserLinksTable: mockTable("employee_user_links", ["id", "employeeId", "applicationUserId"]),
    auditEventsTable: mockTable("audit_events", ["id"]),
  };
});

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  employeeUserLinksTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        if (table === sessionsTable) {
          const rows = fixtures.sessionRows;
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
          };
          return builder;
        }
        const rows = table === employeeUserLinksTable ? fixtures.linkRows : table === usersTable ? fixtures.userRows : [];
        let filtered = rows;
        const builder = {
          innerJoin: () => builder,
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(filtered).then(resolve, reject),
        };
        return builder;
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where(cond: Cond) {
          return {
            returning: () => {
              if (table !== usersTable) return Promise.resolve([]);
              fixtures.userUpdates.push(v);
              fixtures.userRows = fixtures.userRows.map((row) => (matches(row, cond) ? { ...row, ...v } : row));
              return Promise.resolve(fixtures.userRows.filter((row) => matches(row, cond)));
            },
          };
        },
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.audits.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  or: () => undefined,
  isNull: () => undefined,
  gt: () => undefined,
  inArray: () => undefined,
  notInArray: () => undefined,
}));

vi.mock("../lib/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/membership")>()),
  resolveActiveOrganizationId: vi.fn(async () => 10),
}));

const { default: app } = await import("../app");
const { computeAccountProfileChanges, assertNoHrOwnedChanges, AccountIdentityManagedByHrError, AccountProfileValidationError } =
  await import("../lib/accountProfile");

const TOKEN = "valid-token";
const ACCOUNT = {
  id: 1,
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  role: "employee",
  organizationId: 10,
  avatarUrl: null,
  jobTitle: "Analyst",
  department: "Finance",
  phoneNumber: "+233 20 000 0000",
  disabledAt: null,
  createdAt: new Date(),
};

function signIn(account: Record<string, unknown> = ACCOUNT) {
  fixtures.userRows = [{ ...account }];
  fixtures.sessionRows = [
    { session: { id: 1, token: TOKEN, userId: account.id, expiresAt: new Date(Date.now() + 100000), activeOrganizationId: 10 }, user: { ...account } },
  ];
}

function linkToEmployee(userId = 1) {
  fixtures.linkRows = [{ id: 7, employeeId: 42, applicationUserId: userId }];
}

beforeEach(() => {
  fixtures.sessionRows = [];
  fixtures.userRows = [];
  fixtures.linkRows = [];
  fixtures.audits = [];
  fixtures.userUpdates = [];
  signIn();
});

describe("PATCH /api/users/me — account linked to an employee record", () => {
  beforeEach(() => linkToEmployee());

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).patch("/api/users/me").send({ phoneNumber: "+233 20 111 1111" });
    expect(res.status).toBe(401);
  });

  it.each([
    ["firstName", "Augusta"],
    ["lastName", "King"],
    ["jobTitle", "Chief Analyst"],
    ["department", "Operations"],
  ])("refuses to change the HR-owned %s", async (field, value) => {
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ [field]: value });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/managed|HR/i);
    expect(fixtures.userUpdates).toHaveLength(0);
    expect(fixtures.audits).toHaveLength(0);
  });

  it("refuses to clear the HR-owned job title or department", async () => {
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ jobTitle: null });
    expect(res.status).toBe(403);
    expect(fixtures.userUpdates).toHaveLength(0);
  });

  it("accepts the unchanged identity values a client resubmits, and changes only the phone", async () => {
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ firstName: "Ada", lastName: "Lovelace", jobTitle: "Analyst", department: "Finance", phoneNumber: "+233 24 555 0101" });
    expect(res.status).toBe(200);
    expect(fixtures.userUpdates).toEqual([{ phoneNumber: "+233 24 555 0101" }]);
    expect(res.body.phoneNumber).toBe("+233 24 555 0101");
    expect(res.body.firstName).toBe("Ada");
  });

  it("updates the account phone number and audits the field names only", async () => {
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ phoneNumber: "+233 24 555 0101" });
    expect(res.status).toBe(200);
    expect(fixtures.audits).toHaveLength(1);
    const audit = fixtures.audits[0]!;
    expect(audit.eventType).toBe("user.profile_updated");
    expect(audit.category).toBe("security");
    expect(audit.actorApplicationUserId).toBe(1);
    expect(audit.metadata).toEqual({ changedFields: ["phoneNumber"] });
    // The phone value itself never reaches the audit row.
    expect(JSON.stringify(audit)).not.toContain("555 0101");
  });

  it("clears the account phone number with null or blank", async () => {
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ phoneNumber: "   " });
    expect(res.status).toBe(200);
    expect(fixtures.userUpdates).toEqual([{ phoneNumber: null }]);
  });

  it("rejects a malformed phone number without writing", async () => {
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ phoneNumber: "call me maybe" });
    expect(res.status).toBe(400);
    expect(fixtures.userUpdates).toHaveLength(0);
    expect(fixtures.audits).toHaveLength(0);
  });

  it("writes and audits nothing when nothing changes", async () => {
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ phoneNumber: "+233 20 000 0000" });
    expect(res.status).toBe(200);
    expect(fixtures.userUpdates).toHaveLength(0);
    expect(fixtures.audits).toHaveLength(0);
  });

  it("is decided by the caller's own link, not anyone else's", async () => {
    // Another login is linked; this caller is not — so this caller keeps the unlinked rules.
    fixtures.linkRows = [{ id: 8, employeeId: 43, applicationUserId: 99 }];
    const res = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ jobTitle: "Consultant" });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/users/me — account with no employee record (platform/Super Admin fallback)", () => {
  it("keeps name, job title and department editable, validated and audited", async () => {
    signIn({ ...ACCOUNT, role: "super_admin" });
    const res = await request(app)
      .patch("/api/users/me")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ firstName: "  Platform  ", lastName: "Owner", jobTitle: "", department: "Platform" });
    expect(res.status).toBe(200);
    expect(fixtures.userUpdates).toEqual([{ firstName: "Platform", lastName: "Owner", jobTitle: null, department: "Platform" }]);
    expect(res.body.firstName).toBe("Platform");
    expect(fixtures.audits[0]!.metadata).toEqual({ changedFields: ["department", "firstName", "jobTitle", "lastName"] });
  });

  it("refuses a blank or over-long name", async () => {
    const blank = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ firstName: "   " });
    expect(blank.status).toBe(400);
    const long = await request(app).patch("/api/users/me").set("Authorization", `Bearer ${TOKEN}`).send({ lastName: "x".repeat(101) });
    expect(long.status).toBe(400);
    expect(fixtures.userUpdates).toHaveLength(0);
  });
});

describe("lib/accountProfile", () => {
  const current = { firstName: "Ada", lastName: "Lovelace", jobTitle: "Analyst", department: null, phoneNumber: null };

  it("returns only fields whose normalized value differs", () => {
    expect(computeAccountProfileChanges(current, { firstName: " Ada ", department: "", phoneNumber: "0201234567" })).toEqual({
      phoneNumber: "0201234567",
    });
  });

  it("refuses HR-owned changes only for linked accounts", () => {
    expect(() => assertNoHrOwnedChanges({ lastName: "King" }, true)).toThrow(AccountIdentityManagedByHrError);
    expect(() => assertNoHrOwnedChanges({ lastName: "King" }, false)).not.toThrow();
    expect(() => assertNoHrOwnedChanges({ phoneNumber: "0201234567" }, true)).not.toThrow();
  });

  it("validates lengths and phone shape", () => {
    expect(() => computeAccountProfileChanges(current, { jobTitle: "x".repeat(151) })).toThrow(AccountProfileValidationError);
    expect(() => computeAccountProfileChanges(current, { phoneNumber: "12345" })).toThrow(AccountProfileValidationError);
  });
});
