/**
 * Unit tests for the permission-resolution helper: given a membership's
 * roles and each role's granted permissions, the effective permission set
 * must be their union.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, membershipRolesTable, rolePermissionsTable, permissionsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      roleRows: [] as { roleId: number }[],
      permissionRows: [] as { key: string }[],
    },
    membershipRolesTable: { __name: "membership_roles" },
    rolePermissionsTable: { __name: "role_permissions" },
    permissionsTable: { __name: "permissions" },
  };
});

vi.mock("@workspace/db", () => ({
  membershipRolesTable,
  rolePermissionsTable,
  permissionsTable,
  db: {
    select: () => ({
      from(table: unknown) {
        if (table === membershipRolesTable) {
          return {
            where: () => Promise.resolve(fixtures.roleRows),
          };
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
  inArray: () => "inArray",
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
