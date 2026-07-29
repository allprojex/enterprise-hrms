/**
 * W41 — Phase 2B Verification: leave_policies cross-org isolation. Listed by
 * name in the frozen plan's Verification Requirements alongside leave_types/
 * leave_requests/leave_balance_entries/public_holidays, but not previously
 * exercised directly (leaveTypes.test.ts only covers FK-reference
 * validation, and its shared mock doesn't do real where()-condition
 * filtering, so it can't distinguish organizations). Tests lib/leavePolicies.ts
 * directly, with a mock that does real field-based filtering, mirroring
 * leaveRequests.test.ts's precedent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

function mockTable(name: string, columns: string[]) {
  const table: Record<string, string> & { __name: string } = { __name: name } as never;
  for (const col of columns) table[col] = `${name}.${col}`;
  return table;
}

const { fixtures, leaveTypesTable, leavePoliciesTable } = vi.hoisted(() => ({
  fixtures: {
    leaveTypeRows: [] as Record<string, unknown>[],
    leavePolicyRows: [] as Record<string, unknown>[],
  },
  leaveTypesTable: mockTable("leave_types", ["id", "organizationId"]),
  leavePoliciesTable: mockTable("leave_policies", ["id", "organizationId", "leaveTypeId", "status", "name"]),
}));

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  return true;
}

vi.mock("@workspace/db", () => ({
  leaveTypesTable,
  leavePoliciesTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        const rows = table === leaveTypesTable ? fixtures.leaveTypeRows : table === leavePoliciesTable ? fixtures.leavePolicyRows : [];
        let filtered = rows;
        const builder = {
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
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ ...fixtures.leavePolicyRows[0], status: "inactive" }]),
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
}));

vi.mock("../lib/auditLog", () => ({ recordAuditEvent: vi.fn() }));

const { archiveLeavePolicy, LeavePolicyNotFoundError } = await import("../lib/leavePolicies");

beforeEach(() => {
  fixtures.leaveTypeRows = [];
  fixtures.leavePolicyRows = [];
});

describe("leave_policies tenant isolation (W41)", () => {
  it("throws LeavePolicyNotFoundError rather than archiving a policy that belongs to a different organization", async () => {
    // Policy genuinely exists — but under organization 20, not the caller's
    // organization 10. The lookup must scope by organizationId, not id alone.
    fixtures.leavePolicyRows = [{ id: 1, organizationId: 20, leaveTypeId: 1, status: "active", name: "Full-time policy" }];

    await expect(
      archiveLeavePolicy({
        organizationId: 10,
        leaveTypeId: 1,
        leavePolicyId: 1,
        actorApplicationUserId: 1,
        actorMembershipId: 5,
      }),
    ).rejects.toBeInstanceOf(LeavePolicyNotFoundError);

    // Confirms the row was never mutated.
    expect(fixtures.leavePolicyRows[0].status).toBe("active");
  });

  it("archives the policy when it genuinely belongs to the caller's organization", async () => {
    fixtures.leavePolicyRows = [{ id: 1, organizationId: 10, leaveTypeId: 1, status: "active", name: "Full-time policy" }];

    const result = await archiveLeavePolicy({
      organizationId: 10,
      leaveTypeId: 1,
      leavePolicyId: 1,
      actorApplicationUserId: 1,
      actorMembershipId: 5,
    });

    expect(result.status).toBe("inactive");
  });
});
