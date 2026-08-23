/**
 * Office Inventory, Workstream 3 — Department Head Approval Context
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §15, §34). Deliberately a
 * separate file from officeInventoryRequests.ts — it is the ONLY W3 file
 * that reads from officeInventoryLedger.ts (current store availability),
 * so that officeInventoryRequests.ts itself can be verified, by a simple
 * import-graph regression test, to touch nothing ledger-related: request
 * creation, cancellation, and approval/rejection never import this file or
 * officeInventoryLedger.ts.
 */
import { getRequestWithLines, getRepeatRequestWarning, type RepeatRequestWarning } from "./officeInventoryRequests";
import { getOrganizationTotalBalance, getStoreBalancesForItem } from "./officeInventoryLedger";
import { type OfficeInventoryRequest, type OfficeInventoryRequestLine } from "@workspace/db";

export interface RequestLineApprovalContext {
  line: OfficeInventoryRequestLine;
  storeAvailability: { total: string; byStore: { storeId: number; balance: string }[] };
  repeatRequestWarning: RepeatRequestWarning;
}

export interface RequestApprovalContext {
  request: OfficeInventoryRequest;
  lines: RequestLineApprovalContext[];
}

/**
 * Everything a Department Head/delegate needs to decide a request: the
 * request itself, current organization-wide/per-store stock for each
 * line's item (read-only — Workstream 3 never appends a ledger row), and
 * the repeat-request warning per line. Authorization (is this caller
 * actually the Head or a currently-valid delegate?) is the caller's own
 * responsibility — this function does not itself enforce it.
 */
export async function getRequestApprovalContext(organizationId: number, requestId: number): Promise<RequestApprovalContext> {
  const { request, lines } = await getRequestWithLines(organizationId, requestId);

  const enrichedLines = await Promise.all(
    lines.map(async (line) => {
      const [total, byStore, repeatRequestWarning] = await Promise.all([
        getOrganizationTotalBalance(organizationId, line.itemId),
        getStoreBalancesForItem(organizationId, line.itemId),
        getRepeatRequestWarning(organizationId, request.forEmployeeId, request.forDepartmentId, line.itemId),
      ]);
      return { line, storeAvailability: { total, byStore }, repeatRequestWarning };
    }),
  );

  return { request, lines: enrichedLines };
}
