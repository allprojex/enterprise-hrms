/**
 * Office Inventory, Workstream 1 — Department Head foundation
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §5). Mocked @workspace/db,
 * the same Cond-matching style established by payrollPaymentBatches.test.ts;
 * `db.transaction` simply invokes its callback with the same client
 * (real row-locking is exercised only in live QA, per this codebase's own
 * established precedent — see employeeNumbering.test.ts's header comment).
 * No real database connection is made.
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

const { fixtures, departmentsTable, departmentHeadsTable, auditEventsTable } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      departmentRows: [] as Record<string, unknown>[],
      headRows: [] as Record<string, unknown>[],
      auditInserts: [] as unknown[],
      idCounters: new Map<string, number>(),
    },
    departmentsTable: mockTable("departments", ["id", "organizationId"]),
    departmentHeadsTable: mockTable("department_heads", ["id", "organizationId", "departmentId", "headMembershipId", "validFrom", "validTo", "assignedByMembershipId", "revokedByMembershipId"]),
    auditEventsTable: mockTable("audit_events", ["id"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table.__name === "departments") return fixtures.departmentRows;
  if (table.__name === "department_heads") return fixtures.headRows;
  return [];
}
function setRowsFor(table: { __name: string }, rows: Record<string, unknown>[]): void {
  if (table.__name === "department_heads") fixtures.headRows = rows;
}
function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
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
            orderBy: () => stage([...current].sort((a, b) => (a.validFrom as Date).getTime() - (b.validFrom as Date).getTime())),
            for: () => stage(current),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) {
          fixtures.auditInserts.push(v);
          return Promise.resolve(undefined);
        }
        const row = { id: nextId(table), createdAt: new Date(), validTo: null, ...v };
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
  departmentHeadsTable,
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

const {
  assignDepartmentHead,
  revokeDepartmentHead,
  getCurrentDepartmentHead,
  listDepartmentHeadHistory,
  pickDepartmentHeadAsOf,
  DepartmentNotFoundError,
  DepartmentHeadNotFoundError,
} = await import("../lib/departmentHeads");

describe("assignDepartmentHead / revokeDepartmentHead", () => {
  beforeEach(() => {
    fixtures.departmentRows = [{ id: 1, organizationId: 10 }];
    fixtures.headRows = [];
    fixtures.auditInserts = [];
    fixtures.idCounters = new Map();
  });

  it("throws DepartmentNotFoundError for an unknown or cross-org department", async () => {
    await expect(
      assignDepartmentHead({ organizationId: 10, departmentId: 999, headMembershipId: 5, actorMembershipId: 1, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);

    await expect(
      assignDepartmentHead({ organizationId: 999, departmentId: 1, headMembershipId: 5, actorMembershipId: 1, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
  });

  it("assigns a first Head to a vacant department and audits it", async () => {
    const record = await assignDepartmentHead({ organizationId: 10, departmentId: 1, headMembershipId: 5, actorMembershipId: 2, actorApplicationUserId: 20 });

    expect(record.headMembershipId).toBe(5);
    expect(record.validTo).toBeNull();

    const current = await getCurrentDepartmentHead(10, 1);
    expect(current?.headMembershipId).toBe(5);

    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "department_head.assigned", beforeState: null });
  });

  it("replacing a Head closes the previous row (never overwrites) and opens exactly one new current row", async () => {
    await assignDepartmentHead({ organizationId: 10, departmentId: 1, headMembershipId: 5, actorMembershipId: 2, actorApplicationUserId: 20 });
    const replacement = await assignDepartmentHead({ organizationId: 10, departmentId: 1, headMembershipId: 7, actorMembershipId: 2, actorApplicationUserId: 20 });

    expect(replacement.headMembershipId).toBe(7);

    const history = await listDepartmentHeadHistory(10, 1);
    expect(history).toHaveLength(2);
    const openRows = history.filter((r) => r.validTo === null);
    expect(openRows).toHaveLength(1);
    expect(openRows[0]?.headMembershipId).toBe(7);

    const closedRow = history.find((r) => r.headMembershipId === 5);
    expect(closedRow?.validTo).not.toBeNull();

    expect(fixtures.auditInserts).toHaveLength(2);
    expect(fixtures.auditInserts[1]).toMatchObject({ eventType: "department_head.assigned", beforeState: { headMembershipId: 5 } });
  });

  it("revoking leaves the department vacant (no fallback, no auto-fill) and audits it", async () => {
    await assignDepartmentHead({ organizationId: 10, departmentId: 1, headMembershipId: 5, actorMembershipId: 2, actorApplicationUserId: 20 });
    await revokeDepartmentHead({ organizationId: 10, departmentId: 1, actorMembershipId: 2, actorApplicationUserId: 20 });

    const current = await getCurrentDepartmentHead(10, 1);
    expect(current).toBeNull();
    expect(fixtures.auditInserts.at(-1)).toMatchObject({ eventType: "department_head.revoked" });
  });

  it("throws DepartmentHeadNotFoundError when revoking an already-vacant department", async () => {
    await expect(
      revokeDepartmentHead({ organizationId: 10, departmentId: 1, actorMembershipId: 2, actorApplicationUserId: 20 }),
    ).rejects.toBeInstanceOf(DepartmentHeadNotFoundError);
  });
});

describe("pickDepartmentHeadAsOf — half-open interval historical resolution", () => {
  // §Q scenario: Department Media, Head A effective Jan 1 – Jun 1 (closed by
  // Head B's assignment), Head B effective Jun 1 onward (still open).
  const headA = { id: 1, organizationId: 10, departmentId: 1, headMembershipId: 100, validFrom: new Date("2026-01-01T00:00:00Z"), validTo: new Date("2026-06-01T00:00:00Z"), assignedByMembershipId: null, revokedByMembershipId: null, createdAt: new Date("2026-01-01T00:00:00Z") };
  const headB = { id: 2, organizationId: 10, departmentId: 1, headMembershipId: 200, validFrom: new Date("2026-06-01T00:00:00Z"), validTo: null, assignedByMembershipId: null, revokedByMembershipId: null, createdAt: new Date("2026-06-01T00:00:00Z") };
  const history = [headA, headB];

  it("returns null before the first assignment ever began", () => {
    expect(pickDepartmentHeadAsOf(history, new Date("2025-12-31T23:59:59Z"))).toBeNull();
  });

  it("returns Head A exactly at the effective start boundary", () => {
    expect(pickDepartmentHeadAsOf(history, new Date("2026-01-01T00:00:00Z"))?.headMembershipId).toBe(100);
  });

  it("returns Head A during their tenure (May)", () => {
    expect(pickDepartmentHeadAsOf(history, new Date("2026-05-15T00:00:00Z"))?.headMembershipId).toBe(100);
  });

  it("returns Head B exactly at the replacement boundary (half-open: [validFrom, validTo))", () => {
    expect(pickDepartmentHeadAsOf(history, new Date("2026-06-01T00:00:00Z"))?.headMembershipId).toBe(200);
  });

  it("returns Head B after the replacement (August)", () => {
    expect(pickDepartmentHeadAsOf(history, new Date("2026-08-15T00:00:00Z"))?.headMembershipId).toBe(200);
  });

  it("returns null for a department with no assignment history at all", () => {
    expect(pickDepartmentHeadAsOf([], new Date("2026-08-15T00:00:00Z"))).toBeNull();
  });
});
