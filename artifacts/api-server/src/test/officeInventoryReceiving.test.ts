/**
 * Office Inventory, Workstream 2 — Receiving orchestration
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §9, §47). Mocks
 * `../lib/officeInventoryLedger`'s `appendStoreMovement` directly (its own
 * real SQL-derived balance/lock behavior is out of scope for this file —
 * see officeInventoryLedger.test.ts's header for why, and PROJECT_STATUS.md
 * for the live-QA proof) — this file exercises only
 * officeInventoryReceiving.ts's own orchestration: pre-transaction
 * validation, atomicity, reference generation, and idempotency replay. No
 * real database connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "and"; conds: Cond[] }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | undefined;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") return row[cond.field] === cond.val;
  if (cond.__op === "and") return cond.conds.every((c) => matches(row, c));
  if (cond.__op === "inArray") return cond.vals.includes(row[cond.field]);
  return true;
}

const { fixtures, officeInventoryStoresTable, officeInventoryItemsTable, officeInventoryStockMovementsTable } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      storeRows: [] as Record<string, unknown>[],
      itemRows: [] as Record<string, unknown>[],
      movementRows: [] as Record<string, unknown>[],
      appendCalls: [] as Record<string, unknown>[],
      auditInserts: [] as unknown[],
      idCounter: 0,
    },
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId"]),
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId"]),
    officeInventoryStockMovementsTable: mockTable("office_inventory_stock_movements", ["id", "organizationId", "idempotencyKey", "referenceNumber", "movementType"]),
  };
});

function rowsFor(table: { __name: string }): Record<string, unknown>[] {
  if (table.__name === "office_inventory_stores") return fixtures.storeRows;
  if (table.__name === "office_inventory_items") return fixtures.itemRows;
  if (table.__name === "office_inventory_stock_movements") return fixtures.movementRows;
  return [];
}

function makeQueryClient(): Record<string, unknown> {
  const client: Record<string, unknown> = {
    select: (proj?: Record<string, unknown>) => ({
      from(table: { __name: string }) {
        const rows = rowsFor(table);
        const stage = (current: Record<string, unknown>[]): Record<string, unknown> & PromiseLike<Record<string, unknown>[]> => {
          const promise = Promise.resolve(proj ? current.map((r) => Object.fromEntries(Object.keys(proj).map((k) => [k, r[k]]))) : current);
          return {
            where: (cond: Cond) => stage(current.filter((r) => matches(r, cond))),
            then: promise.then.bind(promise),
          } as never;
        };
        return stage(rows);
      },
    }),
    execute: () => Promise.resolve(undefined),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  };
  return client;
}

const dbMock = makeQueryClient();

vi.mock("@workspace/db", () => ({
  db: dbMock,
  officeInventoryStoresTable,
  officeInventoryItemsTable,
  officeInventoryStockMovementsTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: typeof col === "string" ? col.split(".").pop() : col, val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  inArray: (col: string, vals: unknown[]) => ({ __op: "inArray", field: typeof col === "string" ? col.split(".").pop() : col, vals }),
  sql: Object.assign((strings: TemplateStringsArray, ..._vals: unknown[]) => strings.join(""), { join: () => "" }),
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: (v: Record<string, unknown>) => {
    fixtures.auditInserts.push(v);
    return Promise.resolve(undefined);
  },
}));

vi.mock("../services/organizationConfig", () => ({
  getNamespaceConfig: () => Promise.resolve({ data: { receiptNumber: { prefix: "RCV", sequenceLength: 5 } } }),
}));

let sequenceCounter = 0;
vi.mock("../lib/numbering", () => ({
  resolvePeriodKey: () => "none",
  lockAndIncrementSequence: () => {
    sequenceCounter += 1;
    return Promise.resolve(sequenceCounter);
  },
  formatGeneratedNumber: (config: { prefix?: string }, seq: number) => `${config.prefix ?? ""}-${String(seq).padStart(5, "0")}`,
}));

vi.mock("../lib/officeInventoryLedger", () => ({
  appendStoreMovement: (_tx: unknown, params: Record<string, unknown>) => {
    fixtures.appendCalls.push(params);
    const row = { id: ++fixtures.idCounter, organizationId: 10, occurredAt: new Date(), ...params };
    fixtures.movementRows.push(row);
    return Promise.resolve(row);
  },
}));

const {
  createOfficeInventoryReceipt,
  getOfficeInventoryReceipt,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryReceivingItemsNotFoundError,
  OfficeInventoryReceivingNoLinesError,
  OfficeInventoryReceivingInvalidQuantityError,
} = await import("../lib/officeInventoryReceiving");

const ORG_ID = 10;

beforeEach(() => {
  fixtures.storeRows = [{ id: 1, organizationId: ORG_ID }, { id: 2, organizationId: 99 }];
  fixtures.itemRows = [{ id: 100, organizationId: ORG_ID }, { id: 101, organizationId: ORG_ID }, { id: 200, organizationId: 99 }];
  fixtures.movementRows = [];
  fixtures.appendCalls = [];
  fixtures.auditInserts = [];
  fixtures.idCounter = 0;
  sequenceCounter = 0;
});

describe("createOfficeInventoryReceipt", () => {
  it("receives one item and produces one movement row under a generated reference", async () => {
    const receipt = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [{ itemId: 100, quantity: "100.00" }],
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });

    expect(receipt.lines).toHaveLength(1);
    expect(receipt.referenceNumber).toBe("RCV-00001");
    expect(receipt.replay).toBe(false);
    expect(fixtures.appendCalls).toHaveLength(1);
    expect(fixtures.appendCalls[0]).toMatchObject({ itemId: 100, storeId: 1, movementType: "received", quantity: "100.00" });
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "office_inventory_receipt.created" });
  });

  it("receives multiple items atomically, all sharing one reference", async () => {
    const receipt = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [
        { itemId: 100, quantity: "100.00" },
        { itemId: 101, quantity: "20.00" },
      ],
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });

    expect(receipt.lines).toHaveLength(2);
    expect(new Set(receipt.lines.map((l) => l.referenceNumber)).size).toBe(1);
    expect(fixtures.appendCalls).toHaveLength(2);
  });

  it("fails the entire submission and inserts zero rows when any line's item is not found for this organization", async () => {
    await expect(
      createOfficeInventoryReceipt({
        organizationId: ORG_ID,
        storeId: 1,
        lines: [
          { itemId: 100, quantity: "100.00" },
          { itemId: 9999, quantity: "20.00" }, // does not exist
        ],
        actorMembershipId: 1,
        actorApplicationUserId: 1,
      }),
    ).rejects.toBeInstanceOf(OfficeInventoryReceivingItemsNotFoundError);

    expect(fixtures.appendCalls).toHaveLength(0);
    expect(fixtures.movementRows).toHaveLength(0);
  });

  it("rejects a cross-org item even if the ID exists for a different organization", async () => {
    await expect(
      createOfficeInventoryReceipt({
        organizationId: ORG_ID,
        storeId: 1,
        lines: [{ itemId: 200, quantity: "10.00" }], // belongs to org 99
        actorMembershipId: 1,
        actorApplicationUserId: 1,
      }),
    ).rejects.toBeInstanceOf(OfficeInventoryReceivingItemsNotFoundError);
  });

  it("rejects a cross-org store", async () => {
    await expect(
      createOfficeInventoryReceipt({
        organizationId: ORG_ID,
        storeId: 2, // belongs to org 99
        lines: [{ itemId: 100, quantity: "10.00" }],
        actorMembershipId: 1,
        actorApplicationUserId: 1,
      }),
    ).rejects.toBeInstanceOf(OfficeInventoryStoreNotFoundError);
  });

  it("rejects an empty lines array", async () => {
    await expect(
      createOfficeInventoryReceipt({ organizationId: ORG_ID, storeId: 1, lines: [], actorMembershipId: 1, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(OfficeInventoryReceivingNoLinesError);
  });

  it.each([["0.00"], ["-5.00"], ["not-a-number"]])("rejects a non-positive or unparseable quantity (%s)", async (quantity) => {
    await expect(
      createOfficeInventoryReceipt({ organizationId: ORG_ID, storeId: 1, lines: [{ itemId: 100, quantity }], actorMembershipId: 1, actorApplicationUserId: 1 }),
    ).rejects.toBeInstanceOf(OfficeInventoryReceivingInvalidQuantityError);
    expect(fixtures.appendCalls).toHaveLength(0);
  });

  it("replays the original receipt for a repeated idempotencyKey instead of creating a second one", async () => {
    const first = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [{ itemId: 100, quantity: "50.00" }],
      idempotencyKey: "submit-1",
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });
    expect(first.replay).toBe(false);
    expect(fixtures.appendCalls).toHaveLength(1);

    const second = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [{ itemId: 100, quantity: "50.00" }],
      idempotencyKey: "submit-1",
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });

    expect(second.replay).toBe(true);
    expect(second.referenceNumber).toBe(first.referenceNumber);
    // Zero new movement rows or audit events on replay.
    expect(fixtures.appendCalls).toHaveLength(1);
    expect(fixtures.auditInserts).toHaveLength(1);
  });

  it("a different idempotencyKey creates a genuinely new, independent receipt", async () => {
    const first = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [{ itemId: 100, quantity: "50.00" }],
      idempotencyKey: "submit-A",
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });
    const second = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [{ itemId: 100, quantity: "50.00" }],
      idempotencyKey: "submit-B",
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });
    expect(second.referenceNumber).not.toBe(first.referenceNumber);
    expect(fixtures.appendCalls).toHaveLength(2);
  });
});

describe("getOfficeInventoryReceipt", () => {
  it("assembles a receipt from every movement row sharing its reference number", async () => {
    const created = await createOfficeInventoryReceipt({
      organizationId: ORG_ID,
      storeId: 1,
      lines: [
        { itemId: 100, quantity: "100.00" },
        { itemId: 101, quantity: "20.00" },
      ],
      actorMembershipId: 1,
      actorApplicationUserId: 1,
    });

    const fetched = await getOfficeInventoryReceipt(ORG_ID, created.referenceNumber);
    expect(fetched.lines).toHaveLength(2);
    expect(fetched.storeId).toBe(1);
  });
});
