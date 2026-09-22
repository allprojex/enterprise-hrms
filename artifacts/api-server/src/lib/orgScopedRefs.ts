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
  recordsLocationsTable,
  employeeDocumentsTable,
  employeeExitProcessesTable,
  customFormsTable,
  customFormSubmissionsTable,
  generatedDocumentsTable,
  employeeCertificationsTable,
  skillsTable,
  learningEnrollmentsTable,
  assetsTable,
  vehiclesTable,
} from "@workspace/db";

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx`, matching the same alias used in employees.ts/numbering.ts.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  | typeof learningCoursesTable
  | typeof recordsLocationsTable
  // WS-12 (§28.11, §28.8) — evidence documents and offboarding records are
  // client-supplied references on WS-12 surfaces, so they need the same
  // cross-tenant proof every other reference here already gets.
  | typeof employeeDocumentsTable
  | typeof employeeExitProcessesTable
  // WS-13 (§29.12-29.14) — form, submission and generated-document references
  // are client-supplied on service-request surfaces, so they need the same
  // cross-tenant proof every other reference here already gets.
  | typeof customFormsTable
  | typeof customFormSubmissionsTable
  | typeof generatedDocumentsTable
  // WS-14 (§30.20) — a certification is a client-supplied reference when it is
  // linked as skill evidence, so it needs the same cross-tenant proof.
  | typeof employeeCertificationsTable
  // WS-14 (§30.9, §30.14) — skill and Learning enrolment references are
  // client-supplied on WS-14 surfaces and need the same cross-tenant proof.
  | typeof skillsTable
  | typeof learningEnrollmentsTable
  // VR-01 — a vehicle's optional capital-asset link is a client-supplied
  // reference, so it needs the same cross-tenant proof as every other one.
  | typeof assetsTable
  // VR-02B — the vehicle a requester chooses is the one client-supplied
  // reference on a vehicle request, so it needs the same cross-tenant proof: a
  // foreign vehicle id proves only that a row exists, never that it is ours.
  | typeof vehiclesTable;

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
  /**
   * Optional transaction client. Defaults to the global `db`, so every
   * pre-existing call site is unchanged. A caller running inside its own
   * transaction passes its `tx` so this check can SEE rows that transaction
   * has created but not yet committed — without it, an atomic multi-entity
   * write (e.g. WS-7 creating a department and then an employee in that
   * department, in one transaction) would fail this check against a
   * department that genuinely exists in the caller's own snapshot.
   */
  client: QueryClient = db,
): Promise<void> {
  if (id == null) return;
  const [row] = await client
    .select({ organizationId: table.organizationId })
    .from(table as typeof employeesTable)
    .where(eq((table as typeof employeesTable).id, id))
    .limit(1);
  if (!row || row.organizationId !== organizationId) {
    throw new CrossOrganizationReferenceError(label);
  }
}
