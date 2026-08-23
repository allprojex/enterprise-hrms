/**
 * Office Inventory, Workstream 1 — Item catalog & Store foundation
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.1, §7.2). numbering.ts
 * and organizationConfig.ts are mocked directly (their own real logic is
 * already covered by employeeNumbering.test.ts / organizationConfig's own
 * suite) — this file exercises only officeInventoryCatalog.ts's own
 * behavior: code-generation retry-on-collision, immutable itemCode/
 * classification/code fields, and store-code collision translation. The
 * real `isUniqueViolation` (./dbErrors) is used un-mocked. No real database
 * connection is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

function uniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { cause?: { code: string } };
  err.cause = { code: "23505" };
  return err;
}

const { fixtures, officeInventoryItemsTable, officeInventoryStoresTable } = vi.hoisted(() => {
  function mockTable(name: string, columns: string[]) {
    const table: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const col of columns) table[col] = `${name}.${col}`;
    return table;
  }
  return {
    fixtures: {
      itemRows: [] as Record<string, unknown>[],
      storeRows: [] as Record<string, unknown>[],
      auditInserts: [] as unknown[],
      idCounters: new Map<string, number>(),
      // When set, insert() throws a unique violation this many times before succeeding.
      itemCodeCollisionsRemaining: 0,
      storeCodeCollision: false,
    },
    officeInventoryItemsTable: mockTable("office_inventory_items", ["id", "organizationId", "itemCode", "name", "categoryCode", "classification", "status"]),
    officeInventoryStoresTable: mockTable("office_inventory_stores", ["id", "organizationId", "name", "code", "status"]),
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

let sequenceCounter = 0;

vi.mock("@workspace/db", () => ({
  db: {
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          if (table === officeInventoryItemsTable && fixtures.itemCodeCollisionsRemaining > 0) {
            fixtures.itemCodeCollisionsRemaining -= 1;
            return Promise.reject(uniqueViolation());
          }
          if (table === officeInventoryStoresTable && fixtures.storeCodeCollision) {
            return Promise.reject(uniqueViolation());
          }
          const row = { id: nextId(table), createdAt: new Date(), updatedAt: new Date(), ...v };
          if (table === officeInventoryItemsTable) fixtures.itemRows.push(row);
          if (table === officeInventoryStoresTable) fixtures.storeRows.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    select: () => ({
      from: (table: { __name: string }) => ({
        where: () => {
          const rows = table === officeInventoryItemsTable ? fixtures.itemRows : fixtures.storeRows;
          return Promise.resolve(rows);
        },
      }),
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            const rows = table === officeInventoryItemsTable ? fixtures.itemRows : fixtures.storeRows;
            const merged = { ...rows[0], ...patch };
            rows[0] = merged;
            return Promise.resolve([merged]);
          },
        }),
      }),
    }),
  },
  officeInventoryItemsTable,
  officeInventoryStoresTable,
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
}));

vi.mock("../lib/auditLog", () => ({
  recordAuditEvent: (v: Record<string, unknown>) => {
    fixtures.auditInserts.push(v);
    return Promise.resolve(undefined);
  },
}));

vi.mock("../services/organizationConfig", () => ({
  getNamespaceConfig: () => Promise.resolve({ data: { itemNumber: { prefix: "ITM-", sequenceLength: 4 } } }),
}));

vi.mock("../lib/numbering", () => ({
  resolvePeriodKey: () => "none",
  lockAndIncrementSequence: () => {
    sequenceCounter += 1;
    return Promise.resolve(sequenceCounter);
  },
  formatGeneratedNumber: (config: { prefix?: string }, seq: number) => `${config.prefix ?? ""}${String(seq).padStart(4, "0")}`,
}));

const {
  createOfficeInventoryItem,
  updateOfficeInventoryItem,
  createOfficeInventoryStore,
  updateOfficeInventoryStore,
  OfficeInventoryStoreCodeCollisionError,
  OfficeInventoryItemCodeGenerationError,
} = await import("../lib/officeInventoryCatalog");

describe("createOfficeInventoryItem", () => {
  beforeEach(() => {
    fixtures.itemRows = [];
    fixtures.storeRows = [];
    fixtures.auditInserts = [];
    fixtures.idCounters = new Map();
    fixtures.itemCodeCollisionsRemaining = 0;
    fixtures.storeCodeCollision = false;
    sequenceCounter = 0;
  });

  it("generates a server-side itemCode and records an audit event", async () => {
    const item = await createOfficeInventoryItem({
      organizationId: 10,
      name: "A4 Paper Ream",
      categoryCode: "stationery",
      unitOfMeasure: "ream",
      classification: "consumable",
      actorMembershipId: 1,
      actorApplicationUserId: 100,
    });

    expect(item.itemCode).toBe("ITM-0001");
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "office_inventory_item.created" });
  });

  it("retries on itemCode collision and eventually succeeds", async () => {
    fixtures.itemCodeCollisionsRemaining = 2;

    const item = await createOfficeInventoryItem({
      organizationId: 10,
      name: "Stapler",
      categoryCode: "equipment",
      unitOfMeasure: "unit",
      classification: "returnable",
      actorMembershipId: 1,
      actorApplicationUserId: 100,
    });

    expect(item.itemCode).toBe("ITM-0003");
  });

  it("throws OfficeInventoryItemCodeGenerationError after exhausting retry attempts", async () => {
    fixtures.itemCodeCollisionsRemaining = 999;

    await expect(
      createOfficeInventoryItem({
        organizationId: 10,
        name: "Stapler",
        categoryCode: "equipment",
        unitOfMeasure: "unit",
        classification: "returnable",
        actorMembershipId: 1,
        actorApplicationUserId: 100,
      }),
    ).rejects.toBeInstanceOf(OfficeInventoryItemCodeGenerationError);
  });

  it("update never mutates itemCode or classification even if present in the patch object", async () => {
    const created = await createOfficeInventoryItem({
      organizationId: 10,
      name: "Stapler",
      categoryCode: "equipment",
      unitOfMeasure: "unit",
      classification: "returnable",
      actorMembershipId: 1,
      actorApplicationUserId: 100,
    });

    const updated = await updateOfficeInventoryItem({
      organizationId: 10,
      itemId: created.id,
      name: "Heavy-Duty Stapler",
      actorMembershipId: 1,
      actorApplicationUserId: 100,
    });

    expect(updated.itemCode).toBe(created.itemCode);
    expect(updated.classification).toBe(created.classification);
    expect(updated.name).toBe("Heavy-Duty Stapler");
    // UpdateOfficeInventoryItemParams has no itemCode/classification fields at
    // all (verified statically at the call site above by TypeScript) — the
    // service function has no branch that could ever set them.
  });
});

describe("createOfficeInventoryStore", () => {
  beforeEach(() => {
    fixtures.itemRows = [];
    fixtures.storeRows = [];
    fixtures.auditInserts = [];
    fixtures.idCounters = new Map();
    fixtures.itemCodeCollisionsRemaining = 0;
    fixtures.storeCodeCollision = false;
  });

  it("creates a store and records an audit event", async () => {
    const store = await createOfficeInventoryStore({
      organizationId: 10,
      name: "Head Office Store",
      code: "HO-01",
      actorMembershipId: 1,
      actorApplicationUserId: 100,
    });

    expect(store.code).toBe("HO-01");
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "office_inventory_store.created" });
  });

  it("translates a duplicate store code into OfficeInventoryStoreCodeCollisionError", async () => {
    fixtures.storeCodeCollision = true;

    await expect(
      createOfficeInventoryStore({ organizationId: 10, name: "Dup Store", code: "HO-01", actorMembershipId: 1, actorApplicationUserId: 100 }),
    ).rejects.toBeInstanceOf(OfficeInventoryStoreCodeCollisionError);
  });

  it("update never accepts a code change (UpdateOfficeInventoryStoreParams has no code field)", async () => {
    const created = await createOfficeInventoryStore({ organizationId: 10, name: "Branch Store", code: "BR-01", actorMembershipId: 1, actorApplicationUserId: 100 });

    const updated = await updateOfficeInventoryStore({ organizationId: 10, storeId: created.id, name: "Branch Store (Renamed)", actorMembershipId: 1, actorApplicationUserId: 100 });

    expect(updated.code).toBe("BR-01");
    expect(updated.name).toBe("Branch Store (Renamed)");
  });
});
