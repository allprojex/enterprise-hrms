/**
 * Office Inventory, Workstream 6 — pure-logic and architectural coverage.
 * Full business-logic correctness (damage/missing report, mark-missing,
 * partial/full recovery, write-off, adjustment, incident linkage,
 * concurrency) was proven live against the real development database — see
 * PROJECT_STATUS.md's Workstream 6 entry. This file covers what's
 * meaningfully unit-testable without a real database: the extended
 * holder-direction table (see officeInventoryIssuingCore.test.ts for the
 * actual assertions) and the "no generic ledger-write API" architectural
 * boundary for the new incidents/write-offs/adjustments routes.
 */
import { describe, it, expect } from "vitest";
import { OfficeInventoryOverRecoveryError } from "../lib/officeInventoryDisposition";

describe("OfficeInventoryOverRecoveryError — accurate outstanding-vs-requested message", () => {
  it("names both figures", () => {
    const err = new OfficeInventoryOverRecoveryError("2.00", "3.00");
    expect(err.message).toContain("2.00");
    expect(err.message).toContain("3.00");
  });
});

describe("architectural regression: no generic ledger-write route exists (Workstream 6 additions)", () => {
  it("officeInventoryIncidents.ts routes register only GET and POST — no PATCH/PUT/DELETE", async () => {
    const { default: incidentsRouter } = await import("../routes/officeInventoryIncidents");
    const stack = (incidentsRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const routes = stack.filter((layer) => layer.route).map((layer) => layer.route!);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      for (const method of Object.keys(route.methods)) {
        expect(["get", "post"]).toContain(method);
      }
    }
  });

  it("exactly the expected domain-action paths exist — no arbitrary movementType selection, no generic status-PATCH", async () => {
    const { default: incidentsRouter } = await import("../routes/officeInventoryIncidents");
    const stack = (incidentsRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
    const postPaths = stack.filter((layer) => layer.route?.methods.post).map((layer) => layer.route!.path);
    const getPaths = stack.filter((layer) => layer.route?.methods.get).map((layer) => layer.route!.path);
    expect(postPaths.sort()).toEqual(
      [
        "/organizations/:organizationId/office-inventory/incidents",
        "/organizations/:organizationId/office-inventory/incidents/:id/review",
        "/organizations/:organizationId/office-inventory/incidents/:id/mark-missing",
        "/organizations/:organizationId/office-inventory/incidents/:id/recover",
        "/organizations/:organizationId/office-inventory/incidents/:id/write-off",
        "/organizations/:organizationId/office-inventory/write-offs",
        "/organizations/:organizationId/office-inventory/adjustments",
      ].sort(),
    );
    expect(getPaths.sort()).toEqual(
      [
        "/organizations/:organizationId/office-inventory/incidents",
        "/organizations/:organizationId/office-inventory/incidents/:id",
      ].sort(),
    );
  });
});
