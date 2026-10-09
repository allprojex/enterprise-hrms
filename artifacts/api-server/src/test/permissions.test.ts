/**
 * Unit tests for the permission-resolution helper: given a membership's
 * roles and each role's granted permissions, the effective permission set
 * must be their union.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, membershipRolesTable, organizationMembershipsTable, rolesTable, rolePermissionsTable, permissionsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      roleRows: [] as { roleId: number; roleOrganizationId?: number | null; membershipOrganizationId?: number }[],
      permissionRows: [] as { key: string }[],
      roleQuery: { joins: [] as unknown[], permittedRoleIds: null as number[] | null },
    },
    membershipRolesTable: { __name: "membership_roles" },
    organizationMembershipsTable: { __name: "organization_memberships" },
    rolesTable: { __name: "roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
  };
});

vi.mock("@workspace/db", () => ({
  membershipRolesTable,
  organizationMembershipsTable,
  rolesTable,
  rolePermissionsTable,
  permissionsTable,
  db: {
    select: () => ({
      from(table: unknown) {
        if (table === membershipRolesTable) {
          const builder = {
            innerJoin: (joined: unknown) => {
              fixtures.roleQuery.joins.push(joined);
              return builder;
            },
            where: () => Promise.resolve(fixtures.roleRows),
          };
          return builder;
        }
        const builder = {
          innerJoin: () => builder,
          where: () => Promise.resolve(fixtures.permissionRows),
        };
        return builder;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  inArray: (_column: unknown, ids: number[]) => {
    fixtures.roleQuery.permittedRoleIds = ids;
    return "inArray";
  },
}));

const { getEffectivePermissions, hasPermission } = await import("../lib/permissions");

describe("getEffectivePermissions", () => {
  beforeEach(() => {
    fixtures.roleRows = [];
    fixtures.permissionRows = [];
  });

  it("returns an empty set when the membership has no roles", async () => {
    const result = await getEffectivePermissions(1);
    expect(result.size).toBe(0);
  });

  it("returns the union of permissions granted by all of the membership's roles", async () => {
    fixtures.roleRows = [{ roleId: 1 }, { roleId: 2 }];
    fixtures.permissionRows = [{ key: "organization.read" }, { key: "employee.write" }];

    const result = await getEffectivePermissions(1);

    expect(result).toEqual(new Set(["organization.read", "employee.write"]));
  });

  it("joins each role's owner and the membership's organization", async () => {
    fixtures.roleQuery = { joins: [], permittedRoleIds: null };
    await getEffectivePermissions(1);
    expect(fixtures.roleQuery.joins).toEqual([organizationMembershipsTable, rolesTable]);
  });

  it("counts template and same-organization roles, and drops another organization's role", async () => {
    // The real denial is also proved against a database in
    // effectivePermissionsTenantGuardLive.test.ts.
    fixtures.roleQuery = { joins: [], permittedRoleIds: null };
    fixtures.roleRows = [
      { roleId: 1, roleOrganizationId: null, membershipOrganizationId: 5 }, // system template
      { roleId: 2, roleOrganizationId: 5, membershipOrganizationId: 5 }, // own organization
      { roleId: 3, roleOrganizationId: 9, membershipOrganizationId: 5 }, // another organization
    ];
    fixtures.permissionRows = [{ key: "organization.read" }];
    await getEffectivePermissions(1);
    expect(fixtures.roleQuery.permittedRoleIds).toEqual([1, 2]);
  });

  it("grants nothing when every linked role belongs to another organization", async () => {
    fixtures.roleQuery = { joins: [], permittedRoleIds: null };
    fixtures.roleRows = [{ roleId: 3, roleOrganizationId: 9, membershipOrganizationId: 5 }];
    fixtures.permissionRows = [{ key: "membership.manage" }];
    const result = await getEffectivePermissions(1);
    expect(result.size).toBe(0);
    expect(fixtures.roleQuery.permittedRoleIds).toBeNull();
  });
});

describe("hasPermission", () => {
  beforeEach(() => {
    fixtures.roleRows = [{ roleId: 1 }];
    fixtures.permissionRows = [{ key: "organization.read" }];
  });

  it("returns true when the key is in the effective set", async () => {
    expect(await hasPermission(1, "organization.read")).toBe(true);
  });

  it("returns false when the key is not in the effective set", async () => {
    expect(await hasPermission(1, "employee.write")).toBe(false);
  });
});
