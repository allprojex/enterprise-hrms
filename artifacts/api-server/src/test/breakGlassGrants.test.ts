/**
 * WS-4 (Break-Glass Access Foundation, Owner Decision #31) — unit tests for
 * lib/breakGlass.ts's grant lifecycle and validation rules against a mocked
 * @workspace/db. The elevation mechanic itself (requireMembership's use of
 * getActiveGrantForActorAndOrg) is covered end-to-end, through the real app,
 * in breakGlassElevation.test.ts — this file focuses on the CRUD/validation
 * surface: scope rules, expiry/duration policy, and revocation.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { fixtures, breakGlassGrantsTable, permissionsTable, auditEventsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      grantRows: [] as Record<string, unknown>[],
      permissionRows: [] as { key: string }[],
      auditInserts: [] as Record<string, unknown>[],
    },
    breakGlassGrantsTable: { __name: "break_glass_grants" },
    permissionsTable: { __name: "permissions" },
    auditEventsTable: { __name: "audit_events" },
  };
});

vi.mock("@workspace/db", () => ({
  breakGlassGrantsTable,
  permissionsTable,
  auditEventsTable,
  db: {
    select: (cols?: { key?: unknown }) => ({
      from(table: { __name: string }) {
        const rows = table === breakGlassGrantsTable ? fixtures.grantRows : table === permissionsTable ? fixtures.permissionRows : [];
        const builder = {
          where: () => builder,
          limit: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return {
          returning: () => {
            // status defaults to "active" at the DB level (schema default) —
            // mirror that here since createBreakGlassGrant never sets it explicitly.
            const row = { id: fixtures.grantRows.length + 1, status: "active", ...v };
            if (table === breakGlassGrantsTable) fixtures.grantRows.push(row);
            return Promise.resolve([row]);
          },
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            const updated = { ...fixtures.grantRows[0], ...v };
            return Promise.resolve([updated]);
          },
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  gt: () => "gt",
  inArray: () => "inArray",
}));

const {
  createBreakGlassGrant,
  revokeBreakGlassGrant,
  InvalidGrantInputError,
  GrantNotFoundError,
  GrantAlreadyRevokedError,
} = await import("../lib/breakGlass");

const ONE_HOUR = 60 * 60 * 1000;

describe("breakGlass service", () => {
  beforeEach(() => {
    fixtures.grantRows = [];
    fixtures.permissionRows = [{ key: "employee.read" }, { key: "payroll.banking.read" }, { key: "employee.write" }];
    fixtures.auditInserts = [];
    delete process.env.BREAK_GLASS_MAX_DURATION_HOURS;
  });
  afterEach(() => {
    delete process.env.BREAK_GLASS_MAX_DURATION_HOURS;
  });

  const validInput = () => ({
    actorUserId: 1,
    targetOrganizationId: 10,
    reason: "support ticket #123",
    scope: ["employee.read"],
    expiresAt: new Date(Date.now() + ONE_HOUR),
  });

  it("creates a grant and records break_glass_grant.activated", async () => {
    const grant = await createBreakGlassGrant(validInput());
    expect(grant.status).toBe("active");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "break_glass_grant.activated", actorApplicationUserId: 1 });
  });

  it("rejects an empty reason", async () => {
    await expect(createBreakGlassGrant({ ...validInput(), reason: "  " })).rejects.toThrow(InvalidGrantInputError);
  });

  it("rejects an empty scope", async () => {
    await expect(createBreakGlassGrant({ ...validInput(), scope: [] })).rejects.toThrow(InvalidGrantInputError);
  });

  it("rejects a non-read-only scope key (e.g. employee.write)", async () => {
    await expect(createBreakGlassGrant({ ...validInput(), scope: ["employee.write"] })).rejects.toThrow(InvalidGrantInputError);
  });

  it("rejects a scope key that isn't a real permission", async () => {
    await expect(createBreakGlassGrant({ ...validInput(), scope: ["not.a.real.read"] })).rejects.toThrow(InvalidGrantInputError);
  });

  it("accepts multiple real read-only scope keys", async () => {
    const grant = await createBreakGlassGrant({ ...validInput(), scope: ["employee.read", "payroll.banking.read"] });
    expect(grant.scope).toEqual(["employee.read", "payroll.banking.read"]);
  });

  it("rejects an expiresAt in the past", async () => {
    await expect(createBreakGlassGrant({ ...validInput(), expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow(InvalidGrantInputError);
  });

  it("rejects an expiresAt beyond the default maximum duration (8h)", async () => {
    await expect(createBreakGlassGrant({ ...validInput(), expiresAt: new Date(Date.now() + 9 * ONE_HOUR) })).rejects.toThrow(
      InvalidGrantInputError,
    );
  });

  it("honors a platform-configured BREAK_GLASS_MAX_DURATION_HOURS override", async () => {
    process.env.BREAK_GLASS_MAX_DURATION_HOURS = "1";
    await expect(createBreakGlassGrant({ ...validInput(), expiresAt: new Date(Date.now() + 2 * ONE_HOUR) })).rejects.toThrow(
      InvalidGrantInputError,
    );
    await expect(createBreakGlassGrant({ ...validInput(), expiresAt: new Date(Date.now() + 30 * 60 * 1000) })).resolves.toBeDefined();
  });

  it("revoke flips status and records break_glass_grant.revoked", async () => {
    fixtures.grantRows = [
      { id: 1, actorUserId: 1, targetOrganizationId: 10, status: "active", expiresAt: new Date(Date.now() + ONE_HOUR) },
    ];
    const revoked = await revokeBreakGlassGrant(1, 2);
    expect(revoked.status).toBe("revoked");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "break_glass_grant.revoked", actorApplicationUserId: 2 });
  });

  it("revoke 404s (GrantNotFoundError) for an unknown id", async () => {
    fixtures.grantRows = [];
    await expect(revokeBreakGlassGrant(999, 2)).rejects.toThrow(GrantNotFoundError);
  });

  it("revoke refuses an already-revoked grant (GrantAlreadyRevokedError)", async () => {
    fixtures.grantRows = [{ id: 1, actorUserId: 1, targetOrganizationId: 10, status: "revoked" }];
    await expect(revokeBreakGlassGrant(1, 2)).rejects.toThrow(GrantAlreadyRevokedError);
  });
});
