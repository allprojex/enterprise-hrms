/**
 * Idempotent seed for system roles, permissions, and their default
 * role_permissions mapping. Safe to re-run — every insert conflicts
 * harmlessly on the table's unique key. Never touches existing data in
 * other tables. Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:roles
 */
import { db, rolesTable, permissionsTable, rolePermissionsTable } from "../index";

const SYSTEM_ROLES = [
  { key: "super_admin", label: "Super Admin", description: "Platform-wide access across all organizations." },
  {
    key: "org_admin",
    label: "Organization Admin",
    description: "Full administrative access within an organization.",
  },
  { key: "hr_manager", label: "HR Manager", description: "Manages HR records within an organization." },
  {
    key: "employee",
    label: "Employee",
    description: "Self-service access to own profile and organization info.",
  },
] as const;

const PERMISSIONS = [
  { key: "organization.read", resource: "organization", action: "read" },
  { key: "organization.update", resource: "organization", action: "update" },
  { key: "membership.read", resource: "membership", action: "read" },
  { key: "membership.manage", resource: "membership", action: "manage" },
  { key: "primary_hr.manage", resource: "primary_hr", action: "manage" },
  { key: "employee.read", resource: "employee", action: "read" },
  { key: "employee.write", resource: "employee", action: "write" },
  { key: "employee.notes.read", resource: "employee", action: "notes.read" },
  { key: "employee.disciplinary.read", resource: "employee", action: "disciplinary.read" },
  { key: "branch.read", resource: "branch", action: "read" },
  { key: "branch.manage", resource: "branch", action: "manage" },
  { key: "department.read", resource: "department", action: "read" },
  { key: "department.manage", resource: "department", action: "manage" },
  { key: "position.read", resource: "position", action: "read" },
  { key: "position.manage", resource: "position", action: "manage" },
  { key: "audit.read", resource: "audit", action: "read" },
  { key: "role.manage", resource: "role", action: "manage" },
  { key: "module.manage", resource: "module", action: "manage" },
  { key: "master_data.manage", resource: "master_data", action: "manage" },
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: PERMISSIONS.map((p) => p.key),
  org_admin: [
    "organization.read",
    "organization.update",
    "membership.read",
    "membership.manage",
    "primary_hr.manage",
    "employee.read",
    "employee.write",
    "employee.notes.read",
    "employee.disciplinary.read",
    "branch.read",
    "branch.manage",
    "department.read",
    "department.manage",
    "position.read",
    "position.manage",
    "audit.read",
    "role.manage",
    "module.manage",
    "master_data.manage",
  ],
  hr_manager: [
    "organization.read",
    "membership.read",
    "employee.read",
    "employee.write",
    "employee.notes.read",
    "employee.disciplinary.read",
    "branch.read",
    "branch.manage",
    "department.read",
    "department.manage",
    "position.read",
    "position.manage",
  ],
  employee: ["organization.read", "employee.read", "branch.read", "department.read", "position.read"],
};

async function main() {
  await db.insert(rolesTable).values([...SYSTEM_ROLES]).onConflictDoNothing({ target: rolesTable.key });
  await db
    .insert(permissionsTable)
    .values([...PERMISSIONS])
    .onConflictDoNothing({ target: permissionsTable.key });

  const roles = await db.select().from(rolesTable);
  const permissions = await db.select().from(permissionsTable);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleByKey.get(roleKey);
    if (!role) continue;

    for (const permissionKey of permissionKeys) {
      const permission = permissionByKey.get(permissionKey);
      if (!permission) continue;

      await db
        .insert(rolePermissionsTable)
        .values({ roleId: role.id, permissionId: permission.id })
        .onConflictDoNothing({
          target: [rolePermissionsTable.roleId, rolePermissionsTable.permissionId],
        });
    }
  }

  console.log("Seeded roles, permissions, and role_permissions.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
