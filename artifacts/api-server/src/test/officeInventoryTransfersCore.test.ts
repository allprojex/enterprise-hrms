/**
 * Office Inventory, Workstream 5 — pure-logic and architectural coverage.
 * Full business-logic correctness (return, handover in all four
 * directions, store transfer, over-return/over-handover rejection,
 * department-to-department authority, concurrency) was proven live
 * against the real development database — see PROJECT_STATUS.md's
 * Workstream 5 entry. This file covers what's meaningfully unit-testable
 * without a real database: the extended holder-direction table (see
 * officeInventoryIssuingCore.test.ts for the actual assertions, updated
 * in place rather than duplicated here) and the "no generic ledger-write
 * API" architectural boundary for the three new routes.
 */
import { describe, it, expect } from "vitest";
import { InsufficientCustodyError } from "../lib/officeInventoryLedger";

describe("InsufficientCustodyError — accurate holder-side error message (distinct from InsufficientStockError)", () => {
  it("names the holder, not a store", () => {
    const err = new InsufficientCustodyError(5, "employee", 42, "3.00", "10.00");
    expect(err.message).toContain("held by employee 42");
    expect(err.message).not.toContain("store");
  });
});

describe("architectural regression: no generic ledger-write route exists (Workstream 5 additions)", () => {
  it("officeInventoryTransfers.ts routes register only POST — no GET/PATCH/PUT/DELETE", async () => {
    const { default: transfersRouter } = await import("../routes/officeInventoryTransfers");
    const stack = (transfersRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const routes = stack.filter((layer) => layer.route).map((layer) => layer.route!);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      for (const method of Object.keys(route.methods)) {
        expect(["post"]).toContain(method);
      }
    }
  });

  it("exactly the three expected domain-action paths exist — no arbitrary movementType selection, no generic status-PATCH", async () => {
    const { default: transfersRouter } = await import("../routes/officeInventoryTransfers");
    const stack = (transfersRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const postPaths = stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route!.path);
    expect(postPaths.sort()).toEqual(
      [
        "/organizations/:organizationId/office-inventory/returns",
        "/organizations/:organizationId/office-inventory/handovers",
        "/organizations/:organizationId/office-inventory/transfers",
      ].sort(),
    );
  });
});
