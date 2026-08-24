/**
 * Office Inventory, Workstream 7 — pure-logic and architectural coverage.
 * Full business-logic correctness (snapshot-at-start, post-snapshot
 * movement reconciliation, count/recount, adjustment/missing resolution,
 * finalization rules and immutability, concurrency) was proven live
 * against the real development database — see PROJECT_STATUS.md's
 * Workstream 7 entry. This file covers what's meaningfully unit-testable
 * without a real database: the "no generic ledger-write API" architectural
 * boundary for the new stocktake routes.
 */
import { describe, it, expect } from "vitest";
import { OfficeInventoryStocktakeIncompleteError, OfficeInventoryStocktakeInvalidStateError } from "../lib/officeInventoryStocktakes";

describe("OfficeInventoryStocktakeIncompleteError — carries the exact blocking lines", () => {
  it("preserves the blockingLines list for the route layer to surface", () => {
    const err = new OfficeInventoryStocktakeIncompleteError([
      { lineId: 1, itemId: 10, reason: "not_counted" },
      { lineId: 2, itemId: 11, reason: "unresolved_variance" },
    ]);
    expect(err.blockingLines).toHaveLength(2);
    expect(err.blockingLines[0]!.reason).toBe("not_counted");
    expect(err.blockingLines[1]!.reason).toBe("unresolved_variance");
  });
});

describe("OfficeInventoryStocktakeInvalidStateError — names both the expected and actual state", () => {
  it("message is accurate", () => {
    const err = new OfficeInventoryStocktakeInvalidStateError("counting", "draft");
    expect(err.message).toContain("counting");
    expect(err.message).toContain("draft");
  });
});

describe("architectural regression: no generic ledger-write route exists (Workstream 7 additions)", () => {
  it("officeInventoryStocktakes.ts routes register only GET and POST — no PATCH/PUT/DELETE", async () => {
    const { default: stocktakesRouter } = await import("../routes/officeInventoryStocktakes");
    const stack = (stocktakesRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const routes = stack.filter((layer) => layer.route).map((layer) => layer.route!);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      for (const method of Object.keys(route.methods)) {
        expect(["get", "post"]).toContain(method);
      }
    }
  });

  it("exactly the expected domain-action paths exist — no generic status-PATCH, no arbitrary movementType selection", async () => {
    const { default: stocktakesRouter } = await import("../routes/officeInventoryStocktakes");
    const stack = (stocktakesRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const postPaths = stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route!.path);
    const getPaths = stack.filter((layer) => layer.route?.methods.get).map((layer) => layer.route!.path);
    expect(postPaths.sort()).toEqual(
      [
        "/organizations/:organizationId/office-inventory/stocktakes",
        "/organizations/:organizationId/office-inventory/stocktakes/:id/start",
        "/organizations/:organizationId/office-inventory/stocktakes/:id/lines/:lineId/count",
        "/organizations/:organizationId/office-inventory/stocktakes/:id/lines/:lineId/resolve",
        "/organizations/:organizationId/office-inventory/stocktakes/:id/finalize",
      ].sort(),
    );
    expect(getPaths.sort()).toEqual(
      [
        "/organizations/:organizationId/office-inventory/stocktakes",
        "/organizations/:organizationId/office-inventory/stocktakes/:id",
      ].sort(),
    );
  });
});
