/**
 * Payroll, Workstream 2 — Employee Compensation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §9.4). `employee_compensation_components`
 * is the sole payroll authority for compensation — `employees.id` is the
 * only identity ever used here, never a staff/PIF number. Effective-dating
 * mirrors numbering.ts's own employee-number-allocation lifecycle: opening a
 * new component for a (employee, category, componentTypeCode) that already
 * has an open one closes the old one's validTo inside the same transaction,
 * never overwrites it — the partial unique index
 * (employee_compensation_components_open_unique) is the final,
 * database-level guarantee against two simultaneously-open rows for the
 * same triple, exactly mirroring employee_number_allocations' own two-layer
 * (row-lock + partial-unique-index) concurrency guarantee.
 */
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  db,
  employeeCompensationComponentsTable,
  masterDataItemsTable,
  type EmployeeCompensationComponent,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class UnknownComponentTypeError extends Error {
  constructor(domain: string, code: string) {
    super(`"${code}" is not a known component type for domain "${domain}" in this organization`);
  }
}
export class CompensationComponentCollisionError extends Error {
  constructor() {
    super("Another open compensation component already exists for this employee/category/component type at an overlapping effective period");
  }
}
export class CompensationComponentNotFoundError extends Error {
  constructor() {
    super("Compensation component not found");
  }
}
export class CompensationComponentAlreadyEndedError extends Error {
  constructor() {
    super("This compensation component has already ended");
  }
}

const CATEGORY_TO_DOMAIN: Record<string, string> = {
  earning: "payroll_earning_component_type",
  deduction: "payroll_deduction_component_type",
};

/** Free-text componentTypeCode validated against master_data_items (system row or this org's own), mirroring separationReason's own established precedent — never FK-enforced. */
async function assertComponentTypeKnown(organizationId: number, category: string, componentTypeCode: string): Promise<void> {
  const domain = CATEGORY_TO_DOMAIN[category];
  const [row] = await db
    .select()
    .from(masterDataItemsTable)
    .where(
      and(
        eq(masterDataItemsTable.domain, domain),
        eq(masterDataItemsTable.code, componentTypeCode),
        eq(masterDataItemsTable.status, "active"),
      ),
    );
  // organizationId is either null (system default, visible to every org) or
  // this org's own — checked here rather than in the WHERE clause so a
  // cross-org item (another organization's own component type) is rejected
  // with the same clear error as a genuinely nonexistent one.
  if (!row || (row.organizationId !== null && row.organizationId !== organizationId)) {
    throw new UnknownComponentTypeError(domain, componentTypeCode);
  }
}

export interface CreateCompensationComponentParams {
  organizationId: number;
  employeeId: number;
  category: "earning" | "deduction";
  componentTypeCode: string;
  amount: string;
  currency: string;
  recurring?: boolean;
  taxableTreatment?: "ordinary" | "benefit_in_kind" | "bonus" | "overtime";
  pensionable?: boolean;
  sourceReferenceType?: string | null;
  sourceReferenceId?: number | null;
  validFrom: Date;
  actorMembershipId: number;
}

export async function createCompensationComponent(
  params: CreateCompensationComponentParams,
): Promise<EmployeeCompensationComponent> {
  await assertComponentTypeKnown(params.organizationId, params.category, params.componentTypeCode);

  try {
    return await db.transaction(async (tx) => {
      const [openExisting] = await tx
        .select()
        .from(employeeCompensationComponentsTable)
        .where(
          and(
            eq(employeeCompensationComponentsTable.employeeId, params.employeeId),
            eq(employeeCompensationComponentsTable.category, params.category),
            eq(employeeCompensationComponentsTable.componentTypeCode, params.componentTypeCode),
            isNull(employeeCompensationComponentsTable.validTo),
          ),
        )
        .for("update");

      if (openExisting) {
        if (openExisting.validFrom >= params.validFrom) {
          throw new CompensationComponentCollisionError();
        }
        await tx
          .update(employeeCompensationComponentsTable)
          .set({ validTo: params.validFrom })
          .where(eq(employeeCompensationComponentsTable.id, openExisting.id));
      }

      const [created] = await tx
        .insert(employeeCompensationComponentsTable)
        .values({
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          category: params.category,
          componentTypeCode: params.componentTypeCode,
          amount: params.amount,
          currency: params.currency,
          recurring: params.recurring ?? true,
          taxableTreatment: params.taxableTreatment ?? "ordinary",
          pensionable: params.pensionable ?? false,
          sourceReferenceType: params.sourceReferenceType ?? null,
          sourceReferenceId: params.sourceReferenceId ?? null,
          validFrom: params.validFrom,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CompensationComponentCollisionError();
    throw err;
  }
}

/** Ends an open component (validTo = endDate) without a successor — e.g. an allowance simply stops. */
export async function endCompensationComponent(params: {
  organizationId: number;
  id: number;
  endDate: Date;
}): Promise<EmployeeCompensationComponent> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(employeeCompensationComponentsTable)
      .where(
        and(
          eq(employeeCompensationComponentsTable.id, params.id),
          eq(employeeCompensationComponentsTable.organizationId, params.organizationId),
        ),
      )
      .for("update");
    if (!row) throw new CompensationComponentNotFoundError();
    if (row.validTo !== null) throw new CompensationComponentAlreadyEndedError();

    const [updated] = await tx
      .update(employeeCompensationComponentsTable)
      .set({ validTo: params.endDate })
      .where(eq(employeeCompensationComponentsTable.id, params.id))
      .returning();
    return updated;
  });
}

/** Every currently-open component for this employee. */
export async function listCurrentCompensationComponents(
  organizationId: number,
  employeeId: number,
): Promise<EmployeeCompensationComponent[]> {
  return db
    .select()
    .from(employeeCompensationComponentsTable)
    .where(
      and(
        eq(employeeCompensationComponentsTable.organizationId, organizationId),
        eq(employeeCompensationComponentsTable.employeeId, employeeId),
        isNull(employeeCompensationComponentsTable.validTo),
      ),
    );
}

/** Full history for this employee, most recent first — the authoritative source for any as-of resolution, never a live cache. */
export async function listCompensationComponentHistory(
  organizationId: number,
  employeeId: number,
): Promise<EmployeeCompensationComponent[]> {
  return db
    .select()
    .from(employeeCompensationComponentsTable)
    .where(
      and(
        eq(employeeCompensationComponentsTable.organizationId, organizationId),
        eq(employeeCompensationComponentsTable.employeeId, employeeId),
      ),
    )
    .orderBy(desc(employeeCompensationComponentsTable.validFrom));
}

/**
 * Resolves every component in force for this employee as of `asOfDate` — the
 * same half-open [validFrom, validTo) resolution already proven twice
 * (employee_number_allocations/pickAllocationAsOf,
 * payroll_statutory_rule_versions/resolveStatutoryRuleVersionAsOf), applied
 * here so a future payroll run can snapshot compensation as it stood on the
 * pay date, never a live join.
 */
export async function resolveCompensationAsOf(
  organizationId: number,
  employeeId: number,
  asOfDate: Date,
): Promise<EmployeeCompensationComponent[]> {
  const history = await listCompensationComponentHistory(organizationId, employeeId);
  const at = asOfDate.getTime();
  return history.filter((row) => {
    const from = row.validFrom.getTime();
    const to = row.validTo ? row.validTo.getTime() : Infinity;
    return at >= from && at < to;
  });
}
