/**
 * WS-16 Pass 2A (§32.7, §32.9) — the canonical shared helper for LIVE
 * current direct-report resolution, sibling to `departmentHeads.ts` and
 * following its shape: one small module owning one relationship question,
 * consumed by whichever modules genuinely ask it.
 *
 * It answers exactly one question:
 *
 *   "who currently reports to this manager, in this organization, right now?"
 *
 * resolved fresh from `employees.reportingManagerId` on every call — never
 * cached, never snapshotted, never materialized. Changing an employee's
 * `reportingManagerId` is reflected on the very next call, by construction.
 *
 * WHAT THIS HELPER IS NOT (§32.3, §32.12) — each line is load-bearing:
 *
 *   - It is NOT a substitute for SNAPSHOT authority. Learning's
 *     `learning_enrollments.managerEmployeeIdSnapshot` and Performance's
 *     `performance_reviews.reviewerEmployeeId` deliberately record the
 *     manager/reviewer who owned a record at the time, so that history stays
 *     attributable. Routing either through this helper would silently rewrite
 *     that history. Never import this module from a Performance or Learning
 *     authority path.
 *   - It is NOT a department-head resolver. Headship lives in
 *     `departmentHeads.ts` and is a different relationship entirely — Leave
 *     approval authority, for one, is derived from headship and never from
 *     `reportingManagerId`.
 *   - It is NOT an authority or permission decision. It returns a
 *     relationship, not a verdict. Callers keep their own permission gates,
 *     their own business filters and their own confidentiality rules
 *     (§32.14).
 *   - It is NOT a generic workflow authority resolver. WS-9's and WS-13's
 *     stage resolvers remain separate and are not built on this (§32.14).
 *
 * NOT EVERY MANAGER-SHAPED LOOKUP USES THIS HELPER, AND THAT IS DELIBERATE.
 * `managerPortalAuthorization.ts`'s `listLiveDirectReports` is frozen as
 * RETAIN — DIFFERENT SEMANTICS (§32.9 #7): it additionally excludes
 * `terminated` employees and returns full rows in a deterministic order,
 * because a team roster and a workflow-bounding scope are different
 * questions. Do not merge the two in a future cleanup — see that file's own
 * header, and the regression test that guards the difference.
 */
import { and, eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";

/**
 * Current direct reports of `managerEmployeeId`, as employee ids.
 *
 * Frozen semantics (§32.7) — every clause here matched all six migrating
 * call sites before consolidation, and changing any of them would change
 * shipped behaviour:
 *
 *   - `organizationId` is predicated explicitly, in the same `and(...)` as
 *     the relationship. Tenant scope is never left to foreign-key identity
 *     alone: a manager employee id belonging to another organization returns
 *     `[]` here rather than that organization's employees.
 *   - NO `employmentStatus` filter. None of the six sites filtered by status,
 *     because their purpose — bounding a workflow or report scope — is not a
 *     roster. Adding an exclusion here would silently narrow six shipped
 *     scopes at once.
 *   - Ids only. Callers that need rows fetch them themselves.
 *   - NO `orderBy`. None of the six had one, and every one of them consumes
 *     the result as a membership set rather than a sequence. Adding an order
 *     would be a behaviour change dressed as a tidy-up.
 *   - A `null` manager yields `[]` without touching the database. Four of the
 *     six sites previously wrote `reportingManagerId = (ownEmployeeId ?? -1)`,
 *     relying on `-1` matching no serial id; this contract produces the same
 *     empty result without putting a sentinel id into a SQL predicate.
 *
 * Employees whose `reportingManagerId` is NULL are excluded, as they were
 * before: SQL equality never matches NULL.
 */
export async function listLiveDirectReportEmployeeIds(organizationId: number, managerEmployeeId: number | null): Promise<number[]> {
  if (managerEmployeeId == null) return [];

  const rows = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.reportingManagerId, managerEmployeeId)));

  return rows.map((row) => row.id);
}
