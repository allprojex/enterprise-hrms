import { and, eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeUserLinksTable,
  organizationMembershipsTable,
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
} from "@workspace/db";
import { resolveDepartmentHeadAsOf } from "../departmentHeads";

/**
 * WS-10 — responsibility resolution (§26.11, §26.12).
 *
 * Authority is derived from RELATIONSHIPS, never from a role-name string. This
 * is the same ruling WS-9 recorded for Recruitment approvals (§25.2), and it is
 * why there is no "is this person called HR Manager?" check anywhere below:
 * renaming a role must never silently move authority, and a person must never
 * gain authority merely by holding a title.
 *
 * Resolution happens at READ time for pending work, so replacing a manager or a
 * Department Head moves the outstanding task to whoever now holds that
 * relationship. Completed work is untouched by any of this: the task row froze
 * `completedBy`/`completedByName` at the moment of completion, and nothing here
 * ever rewrites it (§26.12).
 */

export type OnboardingResponsibilityResolver =
  | "employee_self"
  | "reporting_manager"
  | "department_head"
  | "permission_holder"
  | "specific_membership";

export interface ResponsibilityConfig {
  resolver: OnboardingResponsibilityResolver;
  permissionKey: string | null;
  membershipId: number | null;
}

export interface ResolvedResponsibility {
  resolver: OnboardingResponsibilityResolver;
  /** Memberships currently responsible. Empty is legitimate — see below. */
  membershipIds: number[];
  /**
   * Why these memberships are responsible, recorded in the same spirit as
   * WS-9's `authorityBasis`: it explains the decision without re-deriving it.
   */
  basis: string;
}

/**
 * Resolves who is responsible for a task right now.
 *
 * An EMPTY result is a legitimate outcome, not an error: a department may have
 * no current head, an employee may have no reporting manager, and a permission
 * may be held by nobody. The caller decides what to do (typically: show the
 * task as unassigned to HR rather than inventing an assignee).
 */
export async function resolveResponsibility(
  organizationId: number,
  employeeId: number,
  config: ResponsibilityConfig,
  asOf: Date = new Date(),
): Promise<ResolvedResponsibility> {
  switch (config.resolver) {
    case "employee_self": {
      const [link] = await db
        .select({ membershipId: employeeUserLinksTable.organizationMembershipId })
        .from(employeeUserLinksTable)
        .where(eq(employeeUserLinksTable.employeeId, employeeId))
        .limit(1);
      return {
        resolver: config.resolver,
        membershipIds: link ? [link.membershipId] : [],
        basis: link ? "The employee themselves." : "The employee has no linked user account yet.",
      };
    }

    case "reporting_manager": {
      const [employee] = await db
        .select({ reportingManagerId: employeesTable.reportingManagerId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
        .limit(1);
      if (!employee?.reportingManagerId) {
        return { resolver: config.resolver, membershipIds: [], basis: "No reporting manager is recorded for this employee." };
      }
      const [link] = await db
        .select({ membershipId: employeeUserLinksTable.organizationMembershipId })
        .from(employeeUserLinksTable)
        .where(eq(employeeUserLinksTable.employeeId, employee.reportingManagerId))
        .limit(1);
      return {
        resolver: config.resolver,
        membershipIds: link ? [link.membershipId] : [],
        basis: link
          ? "The employee's current reporting manager."
          : "The reporting manager has no linked user account.",
      };
    }

    case "department_head": {
      const [employee] = await db
        .select({ departmentId: employeesTable.departmentId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
        .limit(1);
      if (!employee?.departmentId) {
        return { resolver: config.resolver, membershipIds: [], basis: "The employee is not assigned to a department." };
      }
      // The temporal department_heads relationship — the model WS-9 established
      // and the reason Department Head authority is never a role-name check.
      const head = await resolveDepartmentHeadAsOf(organizationId, employee.departmentId, asOf);
      return {
        resolver: config.resolver,
        membershipIds: head ? [head.headMembershipId] : [],
        basis: head
          ? "The current head of the employee's department."
          : "The employee's department has no current head.",
      };
    }

    case "permission_holder": {
      if (!config.permissionKey) {
        return { resolver: config.resolver, membershipIds: [], basis: "No permission key is configured." };
      }
      // Roles attach to a membership through `membership_roles` (a membership
      // may hold several), which is the same path getEffectivePermissions uses.
      const rows = await db
        .selectDistinct({ membershipId: organizationMembershipsTable.id })
        .from(organizationMembershipsTable)
        .innerJoin(membershipRolesTable, eq(membershipRolesTable.membershipId, organizationMembershipsTable.id))
        .innerJoin(rolePermissionsTable, eq(rolePermissionsTable.roleId, membershipRolesTable.roleId))
        .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissionsTable.permissionId))
        .where(
          and(
            eq(organizationMembershipsTable.organizationId, organizationId),
            eq(organizationMembershipsTable.status, "active"),
            eq(permissionsTable.key, config.permissionKey),
          ),
        );
      return {
        resolver: config.resolver,
        membershipIds: rows.map((r) => r.membershipId),
        basis: `Anyone currently holding ${config.permissionKey}.`,
      };
    }

    case "specific_membership": {
      if (!config.membershipId) {
        return { resolver: config.resolver, membershipIds: [], basis: "No person is configured." };
      }
      // Re-verified against THIS organization every time: a stale configured id
      // must never resolve across a tenant boundary.
      const [membership] = await db
        .select({ id: organizationMembershipsTable.id })
        .from(organizationMembershipsTable)
        .where(
          and(
            eq(organizationMembershipsTable.id, config.membershipId),
            eq(organizationMembershipsTable.organizationId, organizationId),
            eq(organizationMembershipsTable.status, "active"),
          ),
        )
        .limit(1);
      return {
        resolver: config.resolver,
        membershipIds: membership ? [membership.id] : [],
        basis: membership ? "A specifically named member." : "The named member is no longer active.",
      };
    }
  }
}

/**
 * Whether a given membership is currently responsible for a task.
 *
 * This is the manager/Department Head visibility gate (§26.26): holding a
 * managerial position confers NO organization-wide onboarding access. A manager
 * sees exactly the work the resolvers currently point at them, and nothing else.
 */
export async function isCurrentlyResponsible(
  organizationId: number,
  employeeId: number,
  config: ResponsibilityConfig,
  membershipId: number,
): Promise<boolean> {
  const resolved = await resolveResponsibility(organizationId, employeeId, config);
  return resolved.membershipIds.includes(membershipId);
}
