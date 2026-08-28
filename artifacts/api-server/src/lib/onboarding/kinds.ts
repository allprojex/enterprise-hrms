import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  assetAssignmentsTable,
  officeInventoryStockMovementsTable,
  employeeUserLinksTable,
} from "@workspace/db";
import { getPersonnelFileByEmployee } from "../personnelFiles";
import { getModuleAccess } from "../organizationModules";
import { hasPermission } from "../permissions";

/**
 * WS-10 — task-kind behaviour (§26.24).
 *
 * The central rule of this file: onboarding OBSERVES other domains and never
 * writes to them. Nothing here creates an asset assignment, moves inventory
 * stock, provisions identity, allocates a personnel-file number or touches
 * Payroll. Every function below is a read, and the queries are deliberately
 * narrow — an existence check, not a data dump — so that a reference task can
 * never become a way to read another module's records without that module's
 * own permission.
 */

export type OnboardingTaskKind =
  | "general"
  | "document"
  | "acknowledgement"
  | "induction"
  | "asset_reference"
  | "inventory_reference"
  | "access_reference"
  | "payroll_reference"
  | "personnel_file_reference";

export const ONBOARDING_TASK_KINDS: readonly OnboardingTaskKind[] = [
  "general",
  "document",
  "acknowledgement",
  "induction",
  "asset_reference",
  "inventory_reference",
  "access_reference",
  "payroll_reference",
  "personnel_file_reference",
];

/** The kinds whose completion is checked against another module's authoritative state. */
const REFERENCE_KINDS = new Set<OnboardingTaskKind>([
  "asset_reference",
  "inventory_reference",
  "access_reference",
  "personnel_file_reference",
]);

export function isReferenceKind(kind: OnboardingTaskKind): boolean {
  return REFERENCE_KINDS.has(kind);
}

export interface ReferenceCheck {
  /** True when the referenced domain already shows the expected state. */
  satisfied: boolean;
  /**
   * A short, non-sensitive explanation for the UI. Deliberately carries no
   * identifiers, values or record contents (§26.30) — only whether the
   * expected state exists.
   */
  detail: string;
}

/**
 * Reads the referenced domain to see whether the expectation already holds.
 *
 * Returns `satisfied: false` rather than throwing when nothing is found: an
 * unmet reference is an ordinary onboarding state, not an error.
 */
export async function checkReference(
  kind: OnboardingTaskKind,
  organizationId: number,
  employeeId: number,
): Promise<ReferenceCheck> {
  switch (kind) {
    case "asset_reference": {
      // An OPEN custody row (custodyEndedAt IS NULL) is what "currently holds
      // an asset" means in the Assets module's own model.
      const [row] = await db
        .select({ id: assetAssignmentsTable.id })
        .from(assetAssignmentsTable)
        .where(
          and(
            eq(assetAssignmentsTable.organizationId, organizationId),
            eq(assetAssignmentsTable.employeeId, employeeId),
            isNull(assetAssignmentsTable.custodyEndedAt),
          ),
        )
        .limit(1);
      return row
        ? { satisfied: true, detail: "An active asset assignment exists in the Assets module." }
        : { satisfied: false, detail: "No active asset assignment found. Issue the asset through the Assets module." };
    }
    case "inventory_reference": {
      // holderType/holderId is Office Inventory's own disclosed polymorphic
      // custody pointer; there is no FK, so the organization filter is what
      // keeps this tenant-safe.
      const [row] = await db
        .select({ id: officeInventoryStockMovementsTable.id })
        .from(officeInventoryStockMovementsTable)
        .where(
          and(
            eq(officeInventoryStockMovementsTable.organizationId, organizationId),
            eq(officeInventoryStockMovementsTable.holderType, "employee"),
            eq(officeInventoryStockMovementsTable.holderId, employeeId),
          ),
        )
        .limit(1);
      return row
        ? { satisfied: true, detail: "Inventory has been issued to this employee." }
        : { satisfied: false, detail: "No inventory issue found. Issue it through the Office Inventory module." };
    }
    case "access_reference": {
      // WS-2 remains authoritative. The presence of a link is metadata only —
      // this never grants, implies or fabricates access.
      const [row] = await db
        .select({ id: employeeUserLinksTable.id })
        .from(employeeUserLinksTable)
        .where(eq(employeeUserLinksTable.employeeId, employeeId))
        .limit(1);
      return row
        ? { satisfied: true, detail: "This employee is linked to a user account." }
        : { satisfied: false, detail: "No linked user account. Invite and link the user through User Management." };
    }
    case "personnel_file_reference": {
      const file = await getPersonnelFileByEmployee(organizationId, employeeId);
      return file
        ? { satisfied: true, detail: "A personnel file exists for this employee." }
        : { satisfied: false, detail: "No personnel file found. Create it in the Personnel Files module." };
    }
    default:
      return { satisfied: true, detail: "" };
  }
}

export class PayrollReferenceNotPermittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollReferenceNotPermittedError";
  }
}

/**
 * A `payroll_reference` task may only be completed where Payroll is actually
 * enabled AND the acting user holds Payroll authority (§26.24).
 *
 * Note what this deliberately does NOT do: it never reads a salary, a bank
 * detail or a statutory identifier. Onboarding asks "is this person's payroll
 * setup done?" of somebody who is already entitled to know, and stores only
 * the yes. Onboarding must not become a way to see Payroll data.
 */
export async function assertPayrollReferenceAllowed(organizationId: number, membershipId: number): Promise<void> {
  const access = await getModuleAccess(organizationId, "payroll");
  if (!access.found || !access.enabled) {
    throw new PayrollReferenceNotPermittedError("Payroll is not enabled for this organization.");
  }
  const permitted = await hasPermission(membershipId, "payroll.compensation.read");
  if (!permitted) {
    throw new PayrollReferenceNotPermittedError("Completing a payroll setup task requires Payroll authority.");
  }
}
