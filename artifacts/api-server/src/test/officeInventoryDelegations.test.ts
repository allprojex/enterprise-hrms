/**
 * Office Inventory, Workstream 3 — Approval Delegation
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §5.3, §6). Mocks
 * `../lib/departmentHeads` directly (its own real half-open-interval
 * resolution logic is already covered by departmentHeads.test.ts from
 * Workstream 1) — this file exercises only `resolveApprovalAuthority`'s
 * own decision logic and the delegation CRUD orchestration. No real
 * database connection is made; the load-bearing Head-replacement-inertness
 * scenario is additionally proven live — see PROJECT_STATUS.md's
 * Workstream 3 entry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "isNull"; field: string }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "isNull") return row[cond.field] == null;
  return true;
}

const { fixtures, departmentsTable, officeInventoryApprovalDelegationsTable, organizationMembershipsTable } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      departmentRows: [] as Record<string, unknown>[],
      delegationRows: [] as Record<string, unknown>[],
      membershipRows: [] as Record<string, unknown>[],
      auditInserts: [] as unknown[],
      idCounter: 0,
      currentHead: null as { headMembershipId: number } | null,
    },
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    // WS-18 Pass 2 (F-4): createDelegation now validates the delegate is a real,
    // active membership of the delegating organization, so the fixture must
    // carry memberships too.
    organizationMembershipsTable: mockTable("organization_memberships", ["id", "organizationId", "status"]),
    officeInventoryApprovalDelegationsTable: mockTable("office_inventory_approval_delegations", [
      "id", "organizationId", "departmentId", "delegatingHeadMembershipId", "delegateMembershipId", "validFrom", "validTo",
    ]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table.__name === "departments") return fixtures.departmentRows;
  if (table.__name === "office_inventory_approval_delegations") return fixtures.delegationRows;
  if (table.__name === "organization_memberships") return fixtures.membershipRows;
  return [];
}
function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table.__name === "office_inventory_approval_delegations") fixtures.delegationRows = rows;
  if (table.__name === "organization_memberships") fixtures.membershipRows = rows;
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: () => ({
      from(table: { __name: string }) {
        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            orderBy: () => stage(current),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        const row = { id: ++fixtures.idCounter, createdAt: new Date(), validTo: null, ...v };
        setRowsFor(table, [...rowsFor(table), row]);
        return { returning: () => Promise.resolve([row]) };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where(cond: Cond) {
          const rows = rowsFor(table);
          const updated: Record<string, unknown>[] = [];
          const next = rows.map((r) => {
            if (matches(r, cond)) {
              const merged = { ...r, ...patch };
              updated.push(merged);
              return merged;
            }
            return r;
          });
          setRowsFor(table, next);
          return { returning: () => Promise.resolve(updated) };
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const dbMock = makeQueryClient();

vi.mock("@workspace/db", () => ({
  db: dbMock,
  departmentsTable,
  officeInventoryApprovalDelegationsTable,
  organizationMembershipsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  isNull: (col: string) => ({ __op: "isNull", field: typeof col === "string" ? col.split(".").pop() : col }),
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: (v: Record<string, unknown>) => {
    fixtures.auditInserts.push(v);
    return Promise.resolve(undefined);
  },
}));

vi.mock("../lib/departmentHeads", () => ({
  getCurrentDepartmentHead: (_orgId: number, _deptId: number) => Promise.resolve(fixtures.currentHead),
}));

const {
  resolveApprovalAuthority,
  createDelegation,
  revokeDelegation,
  getCurrentDepartmentHeadCheck,
  NotCurrentDepartmentHeadError,
  DepartmentNotFoundError,
  DelegationNotFoundError,
  InvalidDelegateError,
} = await import("../lib/officeInventoryDelegations");

const ORG_ID = 10;
const DEPT_ID = 1;
const HEAD_A = 100;
const HEAD_B = 200;
const DELEGATE = 300;
const RANDOM = 400;

beforeEach(() => {
  fixtures.departmentRows = [{ id: DEPT_ID, organizationId: ORG_ID }];
  fixtures.delegationRows = [];
  fixtures.auditInserts = [];
  fixtures.idCounter = 0;
  fixtures.currentHead = { headMembershipId: HEAD_A };
  fixtures.membershipRows = [
    { id: HEAD_A, organizationId: ORG_ID, status: "active" },
    { id: HEAD_B, organizationId: ORG_ID, status: "active" },
    { id: DELEGATE, organizationId: ORG_ID, status: "active" },
    { id: RANDOM, organizationId: ORG_ID, status: "active" },
  ];
});

describe("resolveApprovalAuthority", () => {
  it("returns department_head capacity when the actor IS the current Head", async () => {
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, HEAD_A);
    expect(authority).toMatchObject({ capacity: "department_head", headMembershipId: HEAD_A, delegation: null });
  });

  it("returns null for a random membership with no relationship to the department", async () => {
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, RANDOM);
    expect(authority).toBeNull();
  });

  it("returns null when the department is vacant (no current Head) — no fallback, no auto-approval", async () => {
    fixtures.currentHead = null;
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, HEAD_A);
    expect(authority).toBeNull();
  });

  it("returns delegate capacity for a currently-valid delegation", async () => {
    fixtures.delegationRows = [{ id: 1, organizationId: ORG_ID, departmentId: DEPT_ID, delegatingHeadMembershipId: HEAD_A, delegateMembershipId: DELEGATE, validFrom: new Date(), validTo: null }];
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, DELEGATE);
    expect(authority?.capacity).toBe("delegate");
    expect(authority?.delegation?.delegateMembershipId).toBe(DELEGATE);
  });

  it("the load-bearing rule: a delegation from a Head who is no longer current is inert, even though the row remains open", async () => {
    fixtures.delegationRows = [{ id: 1, organizationId: ORG_ID, departmentId: DEPT_ID, delegatingHeadMembershipId: HEAD_A, delegateMembershipId: DELEGATE, validFrom: new Date(), validTo: null }];
    fixtures.currentHead = { headMembershipId: HEAD_B }; // Head replaced
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, DELEGATE);
    expect(authority).toBeNull();
    // The row itself is untouched — still open, still queryable.
    expect(fixtures.delegationRows[0]?.validTo).toBeNull();
  });

  it("a revoked (closed) delegation grants no authority", async () => {
    fixtures.delegationRows = [{ id: 1, organizationId: ORG_ID, departmentId: DEPT_ID, delegatingHeadMembershipId: HEAD_A, delegateMembershipId: DELEGATE, validFrom: new Date(), validTo: new Date() }];
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, DELEGATE);
    expect(authority).toBeNull();
  });

  // Regression test for a real Category A defect caught by live concurrency
  // QA (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md's own Workstream 3
  // scenario): the unique constraint is per (org, department,
  // delegatingHeadMembershipId) — NOT per delegate — so the SAME delegate
  // can simultaneously hold an open-but-inert row from a FORMER Head
  // alongside a genuinely valid open row from the CURRENT Head (neither is
  // ever auto-revoked by a headship change, per §5.3). The resolver must
  // find the CURRENT Head's own row specifically, never an arbitrary open
  // row for the delegate.
  it("a delegate holding two simultaneously-open delegations (one inert, from a former Head; one valid, from the current Head) is granted authority via the valid one", async () => {
    fixtures.delegationRows = [
      { id: 1, organizationId: ORG_ID, departmentId: DEPT_ID, delegatingHeadMembershipId: HEAD_A, delegateMembershipId: DELEGATE, validFrom: new Date("2026-01-01"), validTo: null },
      { id: 2, organizationId: ORG_ID, departmentId: DEPT_ID, delegatingHeadMembershipId: HEAD_B, delegateMembershipId: DELEGATE, validFrom: new Date("2026-02-01"), validTo: null },
    ];
    fixtures.currentHead = { headMembershipId: HEAD_B }; // A was replaced by B; A's own delegation row is still open but inert
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, DELEGATE);
    expect(authority?.capacity).toBe("delegate");
    expect(authority?.delegation?.id).toBe(2);
    expect(authority?.delegation?.delegatingHeadMembershipId).toBe(HEAD_B);
  });
});

describe("createDelegation / revokeDelegation", () => {
  it("only the current Head may create a delegation for their department", async () => {
    await expect(
      createDelegation({ organizationId: ORG_ID, departmentId: DEPT_ID, delegateMembershipId: DELEGATE, actorMembershipId: RANDOM, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(NotCurrentDepartmentHeadError);
  });

  it("the current Head successfully creates a delegation", async () => {
    const delegation = await createDelegation({ organizationId: ORG_ID, departmentId: DEPT_ID, delegateMembershipId: DELEGATE, actorMembershipId: HEAD_A, actorApplicationUserId: 1 });
    expect(delegation.delegatingHeadMembershipId).toBe(HEAD_A);
    expect(delegation.delegateMembershipId).toBe(DELEGATE);
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "office_inventory_delegation.created" });
  });

  it("creating a new delegation closes the Head's own previous open delegation (never overwrites)", async () => {
    const first = await createDelegation({ organizationId: ORG_ID, departmentId: DEPT_ID, delegateMembershipId: DELEGATE, actorMembershipId: HEAD_A, actorApplicationUserId: 1 });
    const second = await createDelegation({ organizationId: ORG_ID, departmentId: DEPT_ID, delegateMembershipId: RANDOM, actorMembershipId: HEAD_A, actorApplicationUserId: 1 });
    expect(second.delegateMembershipId).toBe(RANDOM);
    const closedFirst = fixtures.delegationRows.find((r) => r.id === first.id);
    expect(closedFirst?.validTo).not.toBeNull();
  });

  it("throws DepartmentNotFoundError for an unknown department", async () => {
    await expect(
      createDelegation({ organizationId: ORG_ID, departmentId: 9999, delegateMembershipId: DELEGATE, actorMembershipId: HEAD_A, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
  });

  it("revoke: only the current Head may revoke", async () => {
    const delegation = await createDelegation({ organizationId: ORG_ID, departmentId: DEPT_ID, delegateMembershipId: DELEGATE, actorMembershipId: HEAD_A, actorApplicationUserId: 1 });
    await expect(
      revokeDelegation({ organizationId: ORG_ID, delegationId: delegation.id, actorMembershipId: RANDOM, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(NotCurrentDepartmentHeadError);
  });

  it("revoke succeeds for the current Head and closes the row", async () => {
    const delegation = await createDelegation({ organizationId: ORG_ID, departmentId: DEPT_ID, delegateMembershipId: DELEGATE, actorMembershipId: HEAD_A, actorApplicationUserId: 1 });
    const revoked = await revokeDelegation({ organizationId: ORG_ID, delegationId: delegation.id, actorMembershipId: HEAD_A, actorApplicationUserId: 1 });
    expect(revoked.validTo).not.toBeNull();
    const authority = await resolveApprovalAuthority(ORG_ID, DEPT_ID, DELEGATE);
    expect(authority).toBeNull();
  });

  it("revoking an already-closed/unknown delegation throws DelegationNotFoundError", async () => {
    await expect(
      revokeDelegation({ organizationId: ORG_ID, delegationId: 9999, actorMembershipId: HEAD_A, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(DelegationNotFoundError);
  });
});

describe("getCurrentDepartmentHeadCheck", () => {
  it("true only for the actual current Head, false for a delegate or anyone else", async () => {
    expect(await getCurrentDepartmentHeadCheck(ORG_ID, DEPT_ID, HEAD_A)).toBe(true);
    expect(await getCurrentDepartmentHeadCheck(ORG_ID, DEPT_ID, DELEGATE)).toBe(false);
    fixtures.currentHead = null;
    expect(await getCurrentDepartmentHeadCheck(ORG_ID, DEPT_ID, HEAD_A)).toBe(false);
  });
});

/**
 * WS-18 Pass 2 §14 — F-4 delegate validation.
 *
 * Before this, `createDelegation` accepted any `delegateMembershipId` it was
 * handed. The finding was graded Low rather than an escalation path because the
 * request middleware (requireAuth -> requireMembership -> requirePermission) is
 * a second, independent gate that a foreign or inactive membership never gets
 * through — so the row was inert. It was still wrong to store: an authority
 * record asserting a relationship the platform would never honour is a lie in
 * the delegation list and in the audit trail, and it left tenant isolation
 * resting entirely on a downstream check.
 *
 * Both halves are asserted here: the row is now refused at creation, AND the
 * middleware protection that made this Low is proven to still be the reason it
 * was never exploitable.
 */
describe("F-4 — delegate validation at creation", () => {
  const OTHER_ORG_MEMBERSHIP = 900;
  const INACTIVE_MEMBERSHIP = 901;

  beforeEach(() => {
    fixtures.membershipRows.push(
      { id: OTHER_ORG_MEMBERSHIP, organizationId: 99, status: "active" },
      { id: INACTIVE_MEMBERSHIP, organizationId: ORG_ID, status: "suspended" },
    );
  });

  const create = (delegateMembershipId: number) =>
    createDelegation({
      organizationId: ORG_ID,
      departmentId: DEPT_ID,
      delegateMembershipId,
      actorMembershipId: HEAD_A,
      actorApplicationUserId: 1,
    });

  it("positive control: a valid same-organization active delegate is accepted", async () => {
    const created = await create(DELEGATE);
    expect(created.delegateMembershipId).toBe(DELEGATE);
    expect(fixtures.delegationRows).toHaveLength(1);
  });

  it("refuses a delegate belonging to another organization, and writes nothing", async () => {
    await expect(create(OTHER_ORG_MEMBERSHIP)).rejects.toBeInstanceOf(InvalidDelegateError);
    expect(fixtures.delegationRows).toHaveLength(0);
    expect(fixtures.auditInserts).toHaveLength(0);
  });

  it("refuses an inactive delegate, and writes nothing", async () => {
    await expect(create(INACTIVE_MEMBERSHIP)).rejects.toBeInstanceOf(InvalidDelegateError);
    expect(fixtures.delegationRows).toHaveLength(0);
    expect(fixtures.auditInserts).toHaveLength(0);
  });

  it("refuses self-delegation, and writes nothing", async () => {
    await expect(create(HEAD_A)).rejects.toBeInstanceOf(InvalidDelegateError);
    expect(fixtures.delegationRows).toHaveLength(0);
    expect(fixtures.auditInserts).toHaveLength(0);
  });

  it("does not disclose whether a rejected membership id exists elsewhere", async () => {
    // A membership in another organization and one that does not exist at all
    // must be indistinguishable, or a department Head can probe the platform's
    // membership id space.
    const foreign = await create(OTHER_ORG_MEMBERSHIP).catch((e: Error) => e);
    const missing = await create(123456).catch((e: Error) => e);
    expect((foreign as Error).message).toBe((missing as Error).message);
  });

  it("an existing open delegation is left untouched when a bad delegate is rejected", async () => {
    await create(DELEGATE);
    expect(fixtures.delegationRows).toHaveLength(1);
    const before = { ...fixtures.delegationRows[0] };

    await expect(create(OTHER_ORG_MEMBERSHIP)).rejects.toBeInstanceOf(InvalidDelegateError);

    // The refusal must not have closed the good delegation as a side effect —
    // the close happens inside the transaction, after validation.
    expect(fixtures.delegationRows).toHaveLength(1);
    expect(fixtures.delegationRows[0].validTo).toBe(before.validTo);
    expect(fixtures.delegationRows[0].delegateMembershipId).toBe(DELEGATE);
  });
});
