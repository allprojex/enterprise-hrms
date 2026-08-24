/**
 * Office Inventory, Workstream 4 — pure-logic and architectural coverage.
 * Full business-logic correctness (issue, partial/over-fulfilment,
 * employee/department custody, direct issue, confirmation, concurrency)
 * was proven live against the real development database — see
 * PROJECT_STATUS.md's Workstream 4 entry. This file covers what's
 * meaningfully unit-testable without a real database: the holder-side
 * direction table and the "no generic ledger-write API" architectural
 * boundary (mirroring officeInventoryLedgerHttp.test.ts's own static route
 * introspection from Workstream 2).
 *
 * "returned" was reassigned from "undefined, throws" to "holder-decreasing"
 * by Workstream 5 (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §21/§22),
 * and "missing"/"written_off" were reassigned identically by Workstream 6
 * (§25/§13) — each test below was updated accordingly, not merely relaxed.
 */
import { describe, it, expect } from "vitest";
import * as ledger from "../lib/officeInventoryLedger";

describe("holderMovementSign — the holder-custody direction table", () => {
  it("issued increases holder custody — the only type Workstream 4 itself produces on the holder side", () => {
    expect(ledger.holderMovementSign("issued")).toBe(1);
  });

  it("returned decreases holder custody — Workstream 5's own addition, reused for both an ordinary return and a handover's source side", () => {
    expect(ledger.holderMovementSign("returned")).toBe(-1);
  });

  it("missing and written_off decrease holder custody — Workstream 6's own additions (mark-missing and a direct holder write-off)", () => {
    expect(ledger.holderMovementSign("missing")).toBe(-1);
    expect(ledger.holderMovementSign("written_off")).toBe(-1);
  });

  it("a type with no defined holder direction yet throws rather than guessing", () => {
    expect(() => ledger.holderMovementSign("adjustment_in")).toThrow();
    expect(() => ledger.holderMovementSign("recovered")).toThrow();
  });

  it("HOLDER_INCREASING_TYPES and HOLDER_DECREASING_TYPES never overlap", () => {
    const overlap = ledger.HOLDER_INCREASING_TYPES.filter((t) => (ledger.HOLDER_DECREASING_TYPES as readonly string[]).includes(t));
    expect(overlap).toEqual([]);
  });
});

describe("architectural regression: no generic ledger-write route exists (Workstream 4 additions)", () => {
  it("officeInventoryIssuing.ts routes register only GET and POST — no PATCH/PUT/DELETE", async () => {
    const { default: issuingRouter } = await import("../routes/officeInventoryIssuing");
    const stack = (issuingRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const routes = stack.filter((layer) => layer.route).map((layer) => layer.route!);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      for (const method of Object.keys(route.methods)) {
        expect(["get", "post"]).toContain(method);
      }
    }
  });

  it("no route accepts an arbitrary movementType — POST bodies are narrowly typed (issue/direct-issue/confirm only)", async () => {
    const { default: issuingRouter } = await import("../routes/officeInventoryIssuing");
    const stack = (issuingRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const postPaths = stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route!.path);
    expect(postPaths.sort()).toEqual(
      [
        "/organizations/:organizationId/office-inventory/request-lines/:lineId/issue",
        "/organizations/:organizationId/office-inventory/direct-issue",
        "/organizations/:organizationId/office-inventory/movements/:movementId/confirm",
      ].sort(),
    );
  });
});
