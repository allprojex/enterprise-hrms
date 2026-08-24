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
import { getOrganizationTotalBalance, getStoreBalancesForItem, getHolderCustodyForItem, sumHolderMovementsSince, type HolderCustodyEntry } from "./officeInventoryLedger";
import { type OfficeInventoryRequest, type OfficeInventoryRequestLine } from "@workspace/db";

/**
 * Workstream 8 (§15, §34) — completes the repeat-request/accountability
 * warning with the actual W4-W7 data W3 could only defer (see this file's
 * own header, and officeInventoryRequests.ts's `RepeatRequestWarning`
 * comment: "adding them later is additive... not breaking"). Lives here,
 * not on `RepeatRequestWarning` itself, to preserve officeInventoryRequests.ts's
 * own proven architectural boundary (approval never touches the ledger) —
 * this file remains the ONLY W3-lineage file that reads officeInventoryLedger.ts.
 * `employeeCurrentCustody` is null only when the request has no
 * `forEmployeeId` (a pure department request) — never a fabricated zero.
 */
export interface AccountabilityContext {
  employeeCurrentCustody: HolderCustodyEntry | null;
  departmentCurrentCustody: HolderCustodyEntry;
  recentEmployeeIssuedQuantity: string | null;
  recentDepartmentIssuedQuantity: string;
  recentEmployeeReturnedQuantity: string | null;
  recentDepartmentReturnedQuantity: string;
}

export interface RequestLineApprovalContext {
  line: OfficeInventoryRequestLine;
  storeAvailability: { total: string; byStore: { storeId: number; balance: string }[] };
  repeatRequestWarning: RepeatRequestWarning;
  accountability: AccountabilityContext;
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

      const since = new Date(Date.now() - repeatRequestWarning.windowDays * 24 * 60 * 60 * 1000);
      const [
        employeeCurrentCustody,
        departmentCurrentCustody,
        recentEmployeeIssuedQuantity,
        recentDepartmentIssuedQuantity,
        recentEmployeeReturnedQuantity,
        recentDepartmentReturnedQuantity,
      ] = await Promise.all([
        request.forEmployeeId !== null ? getHolderCustodyForItem(organizationId, line.itemId, "employee", request.forEmployeeId) : Promise.resolve(null),
        getHolderCustodyForItem(organizationId, line.itemId, "department", request.forDepartmentId),
        request.forEmployeeId !== null ? sumHolderMovementsSince(organizationId, line.itemId, "employee", request.forEmployeeId, "issued", since) : Promise.resolve(null),
        sumHolderMovementsSince(organizationId, line.itemId, "department", request.forDepartmentId, "issued", since),
        request.forEmployeeId !== null ? sumHolderMovementsSince(organizationId, line.itemId, "employee", request.forEmployeeId, "returned", since) : Promise.resolve(null),
        sumHolderMovementsSince(organizationId, line.itemId, "department", request.forDepartmentId, "returned", since),
      ]);

      const accountability: AccountabilityContext = {
        employeeCurrentCustody,
        departmentCurrentCustody,
        recentEmployeeIssuedQuantity,
        recentDepartmentIssuedQuantity,
        recentEmployeeReturnedQuantity,
        recentDepartmentReturnedQuantity,
      };

      return { line, storeAvailability: { total, byStore }, repeatRequestWarning, accountability };
    }),
  );

  return { request, lines: enrichedLines };
}
