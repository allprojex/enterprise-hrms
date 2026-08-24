/**
 * Manager Portal — Pending Actions (Phase 3G, W110). Frozen sources (frozen
 * plan §29/§33, this workstream's own §15): Leave, Performance, Learning
 * only — Attendance and Assets are dashboard/read-awareness tiles, not
 * action queues. Read-only aggregation of current authoritative work; no
 * persistent task table, no notifications engine, no mutation route (frozen
 * plan §17/§21 of the W110 charter). Every item is recomputed live on every
 * call from each module's own existing service functions — never a second
 * "task" concept.
 *
 * SAFE DTO ONLY: source module, the underlying entity's own existing id,
 * employeeId + raw first/last name (batch-joined, never a broader Employee
 * shape), current authoritative status, a concise safe title (never a leave
 * reason, never confidential Performance/Learning fields), and createdAt for
 * deterministic ordering. No arbitrary metadata blob.
 */
import { inArray } from "drizzle-orm";
import { db, employeesTable, performanceCyclesTable } from "@workspace/db";
import { getModuleAccess } from "./organizationModules";
import { hasPermission } from "./permissions";
import { resolveManagerPortalActorEmployeeId } from "./managerPortalAuthorization";
import { listPendingApprovals } from "./leaveApprovals";
import { listDepartmentsHeadedByMembership } from "./departmentHeads";
import { resolvePerformanceActorEmployeeId } from "./performanceAuthorization";
import { listTeamReviews } from "./performanceManagerReview";
import { resolveLearningActorEmployeeId } from "./learningAuthorization";
import { listTeamEnrollments } from "./learningEnrollments";

export type ManagerPortalPendingActionSourceModule = "leave" | "performance" | "learning";

export interface ManagerPortalPendingActionItem {
  sourceModule: ManagerPortalPendingActionSourceModule;
  id: number;
  employeeId: number;
  employeeFirstName: string;
  employeeLastName: string;
  status: string;
  title: string;
  createdAt: Date;
}

export interface ManagerPortalPendingActions {
  linked: boolean;
  items: ManagerPortalPendingActionItem[];
}

interface RawItem {
  sourceModule: ManagerPortalPendingActionSourceModule;
  id: number;
  employeeId: number;
  status: string;
  title: string;
  createdAt: Date;
}

/** Department-Head-scoped for a plain caller; org-wide if the caller separately holds leave_request.manage — identical resolution to the Dashboard's own Leave tile (frozen plan §31), reworked for Department Head authority by the Leave Approval Workflow Reconciliation. */
async function resolveLeaveItems(organizationId: number, membershipId: number): Promise<RawItem[]> {
  const moduleAccess = await getModuleAccess(organizationId, "leave");
  if (!moduleAccess.enabled) return [];
  if (!(await hasPermission(membershipId, "leave_request.approve"))) return [];

  const isOrgWideHr = await hasPermission(membershipId, "leave_request.manage");
  const headedDepartmentIds = isOrgWideHr ? [] : await listDepartmentsHeadedByMembership(organizationId, membershipId);
  const requests = await listPendingApprovals(organizationId, { isOrgWideHr, headedDepartmentIds });
  return requests.map((r) => ({
    sourceModule: "leave" as const,
    id: r.id,
    employeeId: r.employeeId,
    status: r.status,
    title: "Leave Request",
    createdAt: r.createdAt,
  }));
}

/** reviewerEmployeeId snapshot only — never the live manager relationship (frozen plan §19/§32). Cycle names batch-joined for a meaningful title, never a per-item query. */
async function resolvePerformanceItems(organizationId: number, membershipId: number, applicationUserId: number): Promise<RawItem[]> {
  const moduleAccess = await getModuleAccess(organizationId, "performance");
  if (!moduleAccess.enabled) return [];
  if (!(await hasPermission(membershipId, "performance.review.write"))) return [];

  const reviewerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, applicationUserId);
  if (reviewerEmployeeId == null) return [];
  const reviews = (await listTeamReviews(organizationId, reviewerEmployeeId)).filter((r) => r.status === "manager_review");
  if (reviews.length === 0) return [];

  const cycleIds = [...new Set(reviews.map((r) => r.cycleId))];
  const cycles = await db.select({ id: performanceCyclesTable.id, name: performanceCyclesTable.name }).from(performanceCyclesTable).where(inArray(performanceCyclesTable.id, cycleIds));
  const cycleNameById = new Map(cycles.map((c) => [c.id, c.name]));

  return reviews.map((r) => ({
    sourceModule: "performance" as const,
    id: r.id,
    employeeId: r.employeeId,
    status: r.status,
    title: `Performance Review — ${cycleNameById.get(r.cycleId) ?? "Cycle"}`,
    createdAt: r.createdAt,
  }));
}

/** managerEmployeeIdSnapshot only — instructor-of-record work is a separate relationship and is never included here (frozen plan §33). */
async function resolveLearningItems(organizationId: number, membershipId: number, applicationUserId: number): Promise<RawItem[]> {
  const moduleAccess = await getModuleAccess(organizationId, "learning");
  if (!moduleAccess.enabled) return [];
  if (!(await hasPermission(membershipId, "learning.review.write"))) return [];

  const managerEmployeeId = await resolveLearningActorEmployeeId(organizationId, applicationUserId);
  if (managerEmployeeId == null) return [];
  const enrollments = (await listTeamEnrollments(organizationId, managerEmployeeId)).filter((e) => e.approvalStatus === "pending");

  return enrollments.map((e) => ({
    sourceModule: "learning" as const,
    id: e.id,
    employeeId: e.employeeId,
    status: e.approvalStatus,
    title: e.courseTitleSnapshot,
    createdAt: e.createdAt,
  }));
}

/**
 * Resolves the caller's own aggregated Pending Actions across Leave/
 * Performance/Learning. `linked: false` only affects the Leave source's own
 * direct-report-only branch (Performance/Learning resolve their own
 * identity independently, per this file's own per-source functions) — this
 * mirrors the Dashboard's own `linked` semantics exactly.
 */
export async function resolveManagerPortalPendingActions(
  organizationId: number,
  applicationUserId: number,
  membershipId: number,
): Promise<ManagerPortalPendingActions> {
  const managerEmployeeId = await resolveManagerPortalActorEmployeeId(organizationId, applicationUserId);

  const [leaveItems, performanceItems, learningItems] = await Promise.all([
    resolveLeaveItems(organizationId, membershipId),
    resolvePerformanceItems(organizationId, membershipId, applicationUserId),
    resolveLearningItems(organizationId, membershipId, applicationUserId),
  ]);

  const rawItems = [...leaveItems, ...performanceItems, ...learningItems];
  if (rawItems.length === 0) return { linked: managerEmployeeId != null, items: [] };

  const employeeIds = [...new Set(rawItems.map((i) => i.employeeId))];
  const employees = await db
    .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
    .from(employeesTable)
    .where(inArray(employeesTable.id, employeeIds));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const items: ManagerPortalPendingActionItem[] = rawItems
    .map((raw) => {
      const employee = employeeById.get(raw.employeeId);
      return {
        sourceModule: raw.sourceModule,
        id: raw.id,
        employeeId: raw.employeeId,
        employeeFirstName: employee?.firstName ?? "",
        employeeLastName: employee?.lastName ?? "",
        status: raw.status,
        title: raw.title,
        createdAt: raw.createdAt,
      };
    })
    .sort((a, b) => {
      const byDate = b.createdAt.getTime() - a.createdAt.getTime();
      if (byDate !== 0) return byDate;
      const byModule = a.sourceModule.localeCompare(b.sourceModule);
      if (byModule !== 0) return byModule;
      return a.id - b.id;
    });

  return { linked: managerEmployeeId != null, items };
}
