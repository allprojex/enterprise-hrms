/**
 * Office Inventory, Workstream 8 — Employee Self-Service
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §33, Workstream 8 objective:
 * "no new backend authority beyond what Workstreams 3-6 already built").
 * Own request submission/viewing (officeInventoryRequests.ts), receipt
 * confirmation (officeInventoryIssuing.ts), and damage/missing reporting
 * (officeInventoryIncidents.ts) already exist as own-scoped ESS surfaces
 * from earlier workstreams and are reused unchanged by the routes that call
 * this file — this file adds only the genuinely new own-scoped operations:
 * current custody, full personal history, and self-service return/handover
 * "where permitted" (§33's own wording).
 *
 * Every function here trusts an already-server-resolved `employeeId`
 * (via `resolveOwnEmployeeId`, called by the route) — never a
 * client-supplied one.
 */
import { listCurrentCustody, listStockMovements, resolveItemIdentities } from "./officeInventoryLedger";
import type { HolderCustodyEntry } from "./officeInventoryLedger";
import { returnFromHolder, handover, type ReturnFromHolderParams, type ReturnResult, type HandoverParams, type HandoverResult } from "./officeInventoryTransfers";
import { assertOwnCustodyAuthority } from "./officeInventoryIncidents";
import type { OfficeInventoryStockMovement } from "@workspace/db";

/** GET .../office-inventory/my/custody: the caller's own current personal custody, live-derived. An unlinked caller gets an empty list, never an error. */
export async function getMyCustody(organizationId: number, employeeId: number | null): Promise<HolderCustodyEntry[]> {
  if (employeeId === null) return [];
  return listCurrentCustody(organizationId, "employee", employeeId);
}

/**
 * One own-history row: the ledger movement plus the item's display identity
 * (WWM Employee Access Remediation, 2026-09-07 — same rationale as
 * HolderCustodyEntry.itemName: a holder may read what THEY were issued
 * without the catalogue grant; never the wider catalogue).
 */
export type MyInventoryHistoryEntry = OfficeInventoryStockMovement & { itemName: string | null; itemCode: string | null };

/** GET .../office-inventory/my/history: every movement ever recorded against the caller's own personal custody, newest first. An unlinked caller gets an empty list, never an error. */
export async function getMyInventoryHistory(organizationId: number, employeeId: number | null): Promise<MyInventoryHistoryEntry[]> {
  if (employeeId === null) return [];
  const movements = await listStockMovements(organizationId, { holderType: "employee", holderId: employeeId });
  const identities = await resolveItemIdentities(organizationId, movements.map((m) => m.itemId));
  return movements.map((m) => {
    const identity = identities.get(m.itemId);
    return { ...m, itemName: identity?.name ?? null, itemCode: identity?.itemCode ?? null };
  });
}

export interface ReturnOwnItemParams extends ReturnFromHolderParams {
  /** Resolved server-side by the route via resolveOwnEmployeeId — never client-supplied. */
  actorEmployeeId: number | null;
}

/** `holderType`/`holderId` must be the caller's own personal custody or their own current department's custody (identical rule to reportIncident's own `assertOwnCustodyAuthority` — not a second, separately invented ownership check) — otherwise the same `returnFromHolder` Workstream 5 already built. */
export async function returnOwnItem(params: ReturnOwnItemParams): Promise<ReturnResult> {
  await assertOwnCustodyAuthority(params.organizationId, params.holderType, params.holderId, params.actorEmployeeId);
  return returnFromHolder(params);
}

export interface HandoverOwnItemParams extends HandoverParams {
  /** Resolved server-side by the route via resolveOwnEmployeeId — never client-supplied. */
  actorEmployeeId: number | null;
}

/** The FROM side must be the caller's own personal custody or their own current department's custody; the TO side is unrestricted (it is simply the recipient) beyond `handover`'s own existing checks, including Owner Decision 17's department-to-department authority gate. */
export async function handoverOwnItem(params: HandoverOwnItemParams): Promise<HandoverResult> {
  await assertOwnCustodyAuthority(params.organizationId, params.fromHolderType, params.fromHolderId, params.actorEmployeeId);
  return handover(params);
}
