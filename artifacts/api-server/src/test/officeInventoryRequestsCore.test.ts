/**
 * Office Inventory, Workstream 3 — pure-logic and architectural coverage.
 * `deriveHeaderStatus` needs no mocking. The "no stock effect" invariant is
 * verified structurally: officeInventoryRequests.ts must never import the
 * ledger or receiving modules — approval must never be able to append a
 * movement row, proven by the absence of the import itself, not merely by
 * inspection. Business-logic coverage requiring a mocked db (creation,
 * cancellation, approve/reject orchestration) lives in
 * officeInventoryRequests.test.ts / officeInventoryDelegations.test.ts;
 * full end-to-end correctness (including the historical-authority and
 * concurrency scenarios) was proven live against the real development
 * database — see PROJECT_STATUS.md's Workstream 3 entry.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveHeaderStatus } from "../lib/officeInventoryRequests";

// Minimal-fields helper for the W3-only (pre-fulfilment) test cases below —
// every line defaults to "nothing issued yet" so these cases exercise only
// the approval layer, unchanged from Workstream 3.
function line(approvalStatus: string, extra: Partial<{ approvedQuantity: string | null; quantityIssuedSoFar: string }> = {}) {
  return { approvalStatus, approvedQuantity: null, quantityIssuedSoFar: "0.00", ...extra };
}

describe("deriveHeaderStatus — approval layer (Workstream 3, unchanged)", () => {
  it("no line decided yet -> pending", () => {
    expect(deriveHeaderStatus([line("pending"), line("pending")])).toBe("pending");
  });

  it("every line approved, nothing issued -> approved", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "5.00" }), line("approved", { approvedQuantity: "5.00" })])).toBe("approved");
  });

  it("every line rejected -> rejected", () => {
    expect(deriveHeaderStatus([line("rejected"), line("rejected")])).toBe("rejected");
  });

  it("a single line, approved -> approved (not partially_approved)", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "5.00" })])).toBe("approved");
  });

  it("mix of approved and rejected -> partially_approved", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "5.00" }), line("rejected")])).toBe("partially_approved");
  });

  it("mix of approved and still-pending -> partially_approved", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "5.00" }), line("pending")])).toBe("partially_approved");
  });

  it("mix of rejected and still-pending (none approved yet) -> partially_approved", () => {
    expect(deriveHeaderStatus([line("rejected"), line("pending")])).toBe("partially_approved");
  });
});

describe("deriveHeaderStatus — fulfilment layer (Workstream 4)", () => {
  it("approved but nothing issued yet -> approved (not fulfilled)", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "0.00" })])).toBe("approved");
  });

  it("approved, partially issued -> partially_fulfilled", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "4.00" })])).toBe("partially_fulfilled");
  });

  it("single line, approved and fully issued, every line decided -> fulfilled", () => {
    expect(deriveHeaderStatus([line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "10.00" })])).toBe("fulfilled");
  });

  it("multi-line: one fully issued, one still only approved (not yet issued) -> partially_fulfilled", () => {
    expect(
      deriveHeaderStatus([
        line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "10.00" }),
        line("approved", { approvedQuantity: "5.00", quantityIssuedSoFar: "0.00" }),
      ]),
    ).toBe("partially_fulfilled");
  });

  it("multi-line: every approved line fully issued, a rejected line alongside -> fulfilled (rejected lines don't block fulfilment)", () => {
    expect(
      deriveHeaderStatus([
        line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "10.00" }),
        line("rejected"),
      ]),
    ).toBe("fulfilled");
  });

  it("multi-line: an approved-and-fully-issued line alongside a STILL-PENDING line -> partially_fulfilled (not fulfilled, since not every line is decided)", () => {
    expect(
      deriveHeaderStatus([
        line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "10.00" }),
        line("pending"),
      ]),
    ).toBe("partially_fulfilled");
  });

  it("§38's own worked example: Paper approved 10/issued 10, Toner approved 5/issued 2, Cable rejected -> partially_fulfilled", () => {
    expect(
      deriveHeaderStatus([
        line("approved", { approvedQuantity: "10.00", quantityIssuedSoFar: "10.00" }),
        line("approved", { approvedQuantity: "5.00", quantityIssuedSoFar: "2.00" }),
        line("rejected"),
      ]),
    ).toBe("partially_fulfilled");
  });
});

describe("architectural regression: approval never touches the stock ledger", () => {
  it("officeInventoryRequests.ts imports nothing from the ledger or receiving modules", () => {
    const path = fileURLToPath(new URL("../lib/officeInventoryRequests.ts", import.meta.url));
    const source = readFileSync(path, "utf-8");
    expect(source).not.toMatch(/from ["']\.\/officeInventoryLedger["']/);
    expect(source).not.toMatch(/from ["']\.\/officeInventoryReceiving["']/);
    expect(source).not.toContain("officeInventoryStockMovementsTable");
    expect(source).not.toContain("appendStoreMovement");
  });

  it("officeInventoryDelegations.ts imports nothing from the ledger or receiving modules", () => {
    const path = fileURLToPath(new URL("../lib/officeInventoryDelegations.ts", import.meta.url));
    const source = readFileSync(path, "utf-8");
    expect(source).not.toMatch(/from ["']\.\/officeInventoryLedger["']/);
    expect(source).not.toMatch(/from ["']\.\/officeInventoryReceiving["']/);
    expect(source).not.toContain("officeInventoryStockMovementsTable");
  });

  it("officeInventoryApprovalContext.ts (the one file allowed to read the ledger) never appends a movement — read-only balance functions only", () => {
    const path = fileURLToPath(new URL("../lib/officeInventoryApprovalContext.ts", import.meta.url));
    const source = readFileSync(path, "utf-8");
    expect(source).not.toContain("appendStoreMovement");
    expect(source).toContain("getOrganizationTotalBalance");
  });
});
