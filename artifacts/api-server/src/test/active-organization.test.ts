/**
 * Tests for active-organization resolution (lib/membership.ts
 * resolveActiveOrganizationId), plus the two routes that depend on it:
 * GET /auth/me (which surfaces the resolved value to the client) and
 * GET /dashboard/summary (which must scope by the resolved active org, not
 * the legacy usersTable.organizationId — a real bug found and fixed while
 * building this: the dashboard was counting employees under whichever org
 * the user was created in, ignoring which org they'd since switched to).
 *
 * Unlike the simpler existing auth tests, this file's drizzle-orm mock
 * actually evaluates where() conditions against the fixture rows (rather
 * than ignoring them), because resolveActiveOrganizationId's three fallback
 * tiers only differ in which organizationId gets queried — a mock that
 * always returns the same rows regardless of the query can't distinguish
 * them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

interface MembershipRow {
  applicationUserId: number;
  organizationId: number;
  status: string;
  expiresAt: Date | null;
}

const {
  fixtures,
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  employeesTable,
  notificationsTable,
  modulesTable,
  organizationModulesTable,
} = vi.hoisted(() => {
    return {
      fixtures: {
        sessionRows: [] as unknown[],
        membershipRows: [] as MembershipRow[],
        employeeRows: [] as { organizationId: number }[],
        notificationRows: [] as { userId: number; read: boolean }[],
        moduleRows: [] as Record<string, unknown>[],
        organizationModuleRows: [] as Record<string, unknown>[],
      },
      usersTable: { __name: "users" },
      sessionsTable: { __name: "sessions" },
      organizationMembershipsTable: {
        __name: "organization_memberships",
        applicationUserId: "applicationUserId",
        organizationId: "organizationId",
        status: "status",
        expiresAt: "expiresAt",
      },
      employeesTable: { __name: "employees", organizationId: "organizationId" },
      notificationsTable: { __name: "notifications", userId: "userId", read: "read" },
      modulesTable: { __name: "modules" },
      organizationModulesTable: { __name: "organization_modules", organizationId: "organizationId" },
    };
  });

type Condition =
  | { op: "eq"; field: string; value: unknown }
  | { op: "and" | "or"; conditions: Condition[] }
  | { op: "isNull"; field: string }
  | { op: "gt"; field: string; value: unknown }
  | null
  | undefined;

function evalCondition(cond: Condition, row: Record<string, unknown>): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "eq":
      return row[cond.field] === cond.value;
    case "and":
      return cond.conditions.every((c) => evalCondition(c, row));
    case "or":
      return cond.conditions.some((c) => evalCondition(c, row));
    case "isNull":
      return row[cond.field] == null;
    case "gt": {
      const v = row[cond.field] as Date | null;
      return v != null && v > (cond.value as Date);
    }
    default:
      return true;
  }
}

vi.mock("drizzle-orm", () => ({
  eq: (field: string, value: unknown) => ({ op: "eq", field, value }),
  and: (...conditions: Condition[]) => ({ op: "and", conditions }),
  or: (...conditions: Condition[]) => ({ op: "or", conditions }),
  isNull: (field: string) => ({ op: "isNull", field }),
  gt: (field: string, value: unknown) => ({ op: "gt", field, value }),
}));

vi.mock("@workspace/db", () => ({
  usersTable,
  sessionsTable,
  organizationMembershipsTable,
  employeesTable,
  notificationsTable,
  modulesTable,
  organizationModulesTable,
  db: {
    select: () => ({
      from(table: unknown) {
        // requireAuth's session+user join is not exercised by the resolver
        // tests below and is left unfiltered, matching the convention used
        // by the other auth-focused test files in this directory.
        if (table === sessionsTable) {
          const builder = {
            innerJoin: () => builder,
            where: () => builder,
            limit: () => Promise.resolve(fixtures.sessionRows),
            then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
              Promise.resolve(fixtures.sessionRows).then(resolve, reject),
          };
          return builder;
        }

        const rows: Record<string, unknown>[] =
          table === organizationMembershipsTable
            ? (fixtures.membershipRows as unknown as Record<string, unknown>[])
            : table === employeesTable
              ? (fixtures.employeeRows as unknown as Record<string, unknown>[])
              : table === notificationsTable
                ? (fixtures.notificationRows as unknown as Record<string, unknown>[])
                : table === modulesTable
                  ? fixtures.moduleRows
                  : table === organizationModulesTable
                    ? fixtures.organizationModuleRows
                    : [];

        let condition: Condition = null;
        const builder = {
          where: (cond: Condition) => {
            condition = cond;
            return builder;
          },
          limit: (n: number) => Promise.resolve(rows.filter((r) => evalCondition(condition, r)).slice(0, n)),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows.filter((r) => evalCondition(condition, r))).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
}));

const { resolveActiveOrganizationId } = await import("../lib/membership");
const { default: app } = await import("../app");

function activeMembership(organizationId: number): MembershipRow {
  return { applicationUserId: 1, organizationId, status: "active", expiresAt: null };
}

function mockSession(overrides: { activeOrganizationId: number | null; legacyOrganizationId: number }) {
  fixtures.sessionRows = [
    {
      session: {
        id: 1,
        token: "valid-token",
        userId: 1,
        expiresAt: new Date(Date.now() + 100000),
        activeOrganizationId: overrides.activeOrganizationId,
      },
      user: {
        id: 1,
        email: "user@example.com",
        firstName: "Test",
        lastName: "User",
        role: "employee",
        organizationId: overrides.legacyOrganizationId,
        avatarUrl: null,
        jobTitle: null,
        department: null,
        phoneNumber: null,
        createdAt: new Date(),
      },
    },
  ];
}

describe("resolveActiveOrganizationId", () => {
  beforeEach(() => {
    fixtures.membershipRows = [];
  });

  it("prefers the session's active organization when the caller still has a live membership there", async () => {
    fixtures.membershipRows = [activeMembership(20), activeMembership(10)];
    const result = await resolveActiveOrganizationId(1, 20, 10);
    expect(result).toBe(20);
  });

  it("falls back to the legacy organization when the session org membership no longer exists", async () => {
    fixtures.membershipRows = [activeMembership(10)];
    const result = await resolveActiveOrganizationId(1, 99, 10);
    expect(result).toBe(10);
  });

  it("falls back to any other active membership when both the session and legacy orgs are unavailable", async () => {
    fixtures.membershipRows = [activeMembership(30)];
    const result = await resolveActiveOrganizationId(1, 99, 10);
    expect(result).toBe(30);
  });

  it("returns null when the caller has no active memberships at all", async () => {
    fixtures.membershipRows = [];
    const result = await resolveActiveOrganizationId(1, 99, 10);
    expect(result).toBeNull();
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    fixtures.membershipRows = [];
  });

  it("includes activeOrganizationId resolved from the session", async () => {
    mockSession({ activeOrganizationId: 20, legacyOrganizationId: 10 });
    fixtures.membershipRows = [activeMembership(20), activeMembership(10)];

    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(10);
    expect(res.body.activeOrganizationId).toBe(20);
  });
});

describe("GET /api/dashboard/summary", () => {
  beforeEach(() => {
    fixtures.membershipRows = [];
    fixtures.employeeRows = [];
    fixtures.notificationRows = [];
    fixtures.moduleRows = [];
    fixtures.organizationModuleRows = [];
  });

  it("counts employees for the resolved active organization, not the legacy organizationId", async () => {
    // Legacy org (10) has 2 employees; the org the caller switched into (20)
    // has 1. Before the fix, this endpoint always queried by the legacy
    // field and would report 2 regardless of which org was active.
    mockSession({ activeOrganizationId: 20, legacyOrganizationId: 10 });
    fixtures.membershipRows = [activeMembership(20), activeMembership(10)];
    fixtures.employeeRows = [{ organizationId: 10 }, { organizationId: 10 }, { organizationId: 20 }];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.totalEmployees).toBe(1);
  });

  it("derives activeModules from the real per-organization module registry, not a hardcoded constant (W18)", async () => {
    mockSession({ activeOrganizationId: 20, legacyOrganizationId: 10 });
    fixtures.membershipRows = [activeMembership(20)];
    fixtures.moduleRows = [
      { id: 1, key: "recruitment", defaultEnabled: false, requiredModuleKeys: [] },
      { id: 2, key: "attendance", defaultEnabled: false, requiredModuleKeys: [] },
      { id: 3, key: "leave", defaultEnabled: false, requiredModuleKeys: [] },
    ];
    // Module 1 explicitly enabled for org 20; module 2 explicitly disabled;
    // module 3 has no override row, so it falls back to defaultEnabled (false).
    fixtures.organizationModuleRows = [
      { organizationId: 20, moduleId: 1, enabled: true },
      { organizationId: 20, moduleId: 2, enabled: false },
    ];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.activeModules).toBe(1);
  });

  it("does not expose a pendingRequests field (removed hardcoded stat, W18)", async () => {
    mockSession({ activeOrganizationId: 20, legacyOrganizationId: 10 });
    fixtures.membershipRows = [activeMembership(20)];

    const res = await request(app).get("/api/dashboard/summary").set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.pendingRequests).toBeUndefined();
  });
});
