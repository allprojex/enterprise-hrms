import { eq } from "drizzle-orm";
import {
  db,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeesTable,
  leaveTypesTable,
  recruitmentWorkflowsTable,
  jobRequisitionsTable,
  organizationMembershipsTable,
  performanceRatingScalesTable,
  learningCoursesTable,
} from "@workspace/db";

export class CrossOrganizationReferenceError extends Error {
  constructor(label: string) {
    super(`${label} does not belong to this organization`);
    this.name = "CrossOrganizationReferenceError";
  }
}

type ScopedTable =
  | typeof departmentsTable
  | typeof branchesTable
  | typeof positionsTable
  | typeof employeesTable
  | typeof leaveTypesTable
  | typeof recruitmentWorkflowsTable
  | typeof jobRequisitionsTable
  | typeof organizationMembershipsTable
  | typeof performanceRatingScalesTable
  | typeof learningCoursesTable;

/**
 * Verifies a foreign key (department/branch/position/employee id) actually
 * belongs to `organizationId` before it's allowed to be attached to another
 * org-scoped record. The raw FK constraint alone doesn't enforce this — a
 * department ID that's syntactically valid but belongs to a different
 * organization would otherwise silently link across tenants.
 */
export async function assertBelongsToOrganization(
  table: ScopedTable,
  id: number | null | undefined,
  organizationId: number,
  label: string,
): Promise<void> {
  if (id == null) return;
  const [row] = await db
    .select({ organizationId: table.organizationId })
    .from(table as typeof employeesTable)
    .where(eq((table as typeof employeesTable).id, id))
    .limit(1);
  if (!row || row.organizationId !== organizationId) {
    throw new CrossOrganizationReferenceError(label);
  }
}
