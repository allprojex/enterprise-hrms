/**
 * Manager Portal — Team Overview (Phase 3G, W109): resolves the caller's own
 * live direct reports and shapes a deliberately narrow DTO — never the full
 * HR-administrator Employee shape (formatEmployee, routes/employees.ts) and
 * never SelfServiceEmployeeProfile (which is scoped to a caller's OWN
 * record, not a team member's, and carries far more than this needs:
 * address, personal email, phone, emergency contacts, DOB...). Frozen field
 * set (frozen plan Decision 7/§27): id, employee number, first/last name
 * (raw parts, matching assetReporting.ts's own `${firstName} ${lastName}`
 * composition convention rather than a new server-composed "fullName"
 * field), position, department, branch, employment status, hasProfilePicture
 * (a boolean only — reuses employeeSelfService.ts's own
 * `profilePictureKey != null` precedent, confirmed safe with no additional
 * lookup or widened authorization).
 *
 * HR/ADMIN MODE (frozen plan §27, Decision 4/27): Team Overview stays
 * direct-report-based even for HR/admin — Option A. This function takes no
 * "org-wide" parameter at all; it always resolves only the caller's own
 * live direct reports, regardless of what other permissions the caller
 * holds. HR/admin already have Employee Management (/employees) for
 * organization-wide browsing — this endpoint never becomes a second one.
 */
import { inArray } from "drizzle-orm";
import { db, departmentsTable, branchesTable, positionsTable, type Employee } from "@workspace/db";
import { resolveManagerPortalActorEmployeeId, listLiveDirectReports } from "./managerPortalAuthorization";

export interface ManagerPortalTeamMember {
  id: number;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  positionId: number | null;
  positionName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  branchId: number | null;
  branchName: string | null;
  employmentStatus: string;
  hasProfilePicture: boolean;
}

export interface ManagerPortalTeamOverview {
  linked: boolean;
  directReports: ManagerPortalTeamMember[];
}

function shapeTeamMember(
  employee: Employee,
  departmentNameById: Map<number, string>,
  branchNameById: Map<number, string>,
  positionNameById: Map<number, string>,
): ManagerPortalTeamMember {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    positionId: employee.positionId,
    positionName: employee.positionId != null ? (positionNameById.get(employee.positionId) ?? null) : null,
    departmentId: employee.departmentId,
    departmentName: employee.departmentId != null ? (departmentNameById.get(employee.departmentId) ?? null) : null,
    branchId: employee.branchId,
    branchName: employee.branchId != null ? (branchNameById.get(employee.branchId) ?? null) : null,
    employmentStatus: employee.employmentStatus,
    hasProfilePicture: employee.profilePictureKey != null,
  };
}

/**
 * Resolves the caller's own Team Overview, scoped to `organizationId` (the
 * caller's currently active organization — never a client-supplied one).
 * `linked: false` (no employee link at all) is not an error — mirrors
 * resolveOwnEmployeeProfile's own "not linked" precedent, never a 404/500.
 * A linked caller with zero current direct reports gets `linked: true,
 * directReports: []` — a valid, explicit empty state (frozen plan Decision
 * 15), never denied.
 */
export async function resolveTeamOverview(organizationId: number, applicationUserId: number): Promise<ManagerPortalTeamOverview> {
  const managerEmployeeId = await resolveManagerPortalActorEmployeeId(organizationId, applicationUserId);
  if (managerEmployeeId == null) return { linked: false, directReports: [] };

  const directReports = await listLiveDirectReports(organizationId, managerEmployeeId);
  if (directReports.length === 0) return { linked: true, directReports: [] };

  const departmentIds = [...new Set(directReports.map((e) => e.departmentId).filter((id): id is number => id != null))];
  const branchIds = [...new Set(directReports.map((e) => e.branchId).filter((id): id is number => id != null))];
  const positionIds = [...new Set(directReports.map((e) => e.positionId).filter((id): id is number => id != null))];

  const [departments, branches, positions] = await Promise.all([
    departmentIds.length > 0
      ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, departmentIds))
      : Promise.resolve([]),
    branchIds.length > 0
      ? db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable).where(inArray(branchesTable.id, branchIds))
      : Promise.resolve([]),
    positionIds.length > 0
      ? db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(inArray(positionsTable.id, positionIds))
      : Promise.resolve([]),
  ]);

  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const positionNameById = new Map(positions.map((p) => [p.id, p.title]));

  return {
    linked: true,
    directReports: directReports.map((e) => shapeTeamMember(e, departmentNameById, branchNameById, positionNameById)),
  };
}

