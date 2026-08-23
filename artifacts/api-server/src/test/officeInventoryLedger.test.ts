/**
 * Office Inventory, Workstream 2 — Stock Ledger core, pure-logic coverage.
 * The SQL-computed balance derivation itself (the CASE/SUM expression, the
 * advisory-lock-then-validate sequence under real Postgres) is deliberately
 * NOT re-implemented against a mocked db here — mocking arbitrary `sql`
 * template execution accurately would mean re-implementing SQL semantics in
 * the mock, which this codebase's own established precedent explicitly
 * avoids (see employeeNumbering.test.ts's header: "genuine concurrency ...
 * is not exercised here ... per this codebase's own established
 * precedent — real row-locking behavior is exercised only in live QA").
 * The same posture applies here: balance-derivation math, the negative-
 * stock guard under real contention, and the 5-way concurrency race are
 * proven live against the real development database (see
 * PROJECT_STATUS.md's Workstream 2 entry), not simulated in this file. This
 * file covers what IS meaningfully unit-testable without a real database:
 * the movement-direction table itself, and that the module exposes no
 * update/delete path (append-only enforcement).
 */
import { describe, it, expect } from "vitest";
import * as ledger from "../lib/officeInventoryLedger";

const ALL_MOVEMENT_TYPES: ledger.OfficeInventoryMovementType[] = [
  "received",
  "issued",
  "returned",
  "transferred_out",
  "transferred_in",
  "adjustment_in",
  "adjustment_out",
  "written_off",
  "missing",
  "recovered",
  "asset_handoff",
];

describe("movementSign — the one central store-balance direction table", () => {
  it("classifies every one of the 11 frozen movement types as either increasing or decreasing, never both, never neither", () => {
    for (const type of ALL_MOVEMENT_TYPES) {
      const inIncreasing = ledger.STORE_INCREASING_TYPES.includes(type);
      const inDecreasing = ledger.STORE_DECREASING_TYPES.includes(type);
      expect(inIncreasing !== inDecreasing).toBe(true);
    }
  });

  it("received is store-increasing — the only type W2 itself ever produces", () => {
    expect(ledger.movementSign("received")).toBe(1);
  });

  it("issued/transferred_out/adjustment_out/written_off/missing/asset_handoff are store-decreasing", () => {
    for (const type of ["issued", "transferred_out", "adjustment_out", "written_off", "missing", "asset_handoff"] as const) {
      expect(ledger.movementSign(type)).toBe(-1);
    }
  });

  it("transferred_in/adjustment_in/returned/recovered are store-increasing", () => {
    for (const type of ["transferred_in", "adjustment_in", "returned", "recovered"] as const) {
      expect(ledger.movementSign(type)).toBe(1);
    }
  });
});

describe("append-only enforcement — no update/delete path exists in this module", () => {
  it("exports no function whose name implies mutating or removing an existing movement row", () => {
    const exportedNames = Object.keys(ledger);
    // Anchored to the start of the name (a verb prefix), not "contains
    // anywhere" — a substring search would false-positive on
    // "appendStoreMovement" itself ("StoreMovement" contains "reMove").
    const mutatingNamePattern = /^(update|delete|edit|remove)/i;
    const offenders = exportedNames.filter((name) => mutatingNamePattern.test(name));
    expect(offenders).toEqual([]);
  });
});

describe("InsufficientStockError", () => {
  it("carries the item, store, available, and requested figures for a controlled 409-shaped rejection", () => {
    const err = new ledger.InsufficientStockError(7, 3, "70.00", "9999.00");
    expect(err.itemId).toBe(7);
    expect(err.storeId).toBe(3);
    expect(err.available).toBe("70.00");
    expect(err.requested).toBe("9999.00");
    expect(err.message).toContain("70.00");
    expect(err.message).toContain("9999.00");
  });
});
