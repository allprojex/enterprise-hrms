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

describe("deriveHeaderStatus — request header status derivation", () => {
  it("no line decided yet -> pending", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "pending" }, { approvalStatus: "pending" }])).toBe("pending");
  });

  it("every line approved -> approved", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "approved" }, { approvalStatus: "approved" }])).toBe("approved");
  });

  it("every line rejected -> rejected", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "rejected" }, { approvalStatus: "rejected" }])).toBe("rejected");
  });

  it("a single line, approved -> approved (not partially_approved)", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "approved" }])).toBe("approved");
  });

  it("mix of approved and rejected -> partially_approved", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "approved" }, { approvalStatus: "rejected" }])).toBe("partially_approved");
  });

  it("mix of approved and still-pending -> partially_approved", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "approved" }, { approvalStatus: "pending" }])).toBe("partially_approved");
  });

  it("mix of rejected and still-pending (none approved yet) -> partially_approved", () => {
    expect(deriveHeaderStatus([{ approvalStatus: "rejected" }, { approvalStatus: "pending" }])).toBe("partially_approved");
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
