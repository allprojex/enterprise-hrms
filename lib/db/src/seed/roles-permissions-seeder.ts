/**
 * The seed:roles core — system role templates, the permission catalogue and
 * each template's default permission mapping. Idempotent: every insert
 * conflicts harmlessly on the table's unique key, and nothing is ever updated
 * or deleted. `seed-roles-permissions.ts` is the command-line runner.
 *
 * TEMPLATES ARE RESOLVED BY THEIR SYSTEM IDENTITY, NEVER BY KEY ALONE.
 * `roles.key` is unique only per scope (roles_system_key_unique on key WHERE
 * organization_id IS NULL; roles_org_key_unique on (organization_id, key)
 * WHERE organization_id IS NOT NULL — ADR-015's system/org-copy split). An
 * organization may therefore own a role keyed `employee`, `super_admin` or any
 * other template key, in as many organizations as it likes. An earlier version
 * of this seed built its key → role map from EVERY role, so whichever row came
 * last won: an organization-owned role could silently receive a template's
 * entire permission list, and the real template receive nothing. Only rows that
 * are templates — organization_id IS NULL AND is_system_role — are ever mapped
 * here, so an organization-owned role is never touched by this seed, whatever
 * its key.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, rolesTable, permissionsTable, rolePermissionsTable } from "../index";
import { SYSTEM_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "./roles-permissions-definitions";

export class DuplicateSystemRoleTemplateError extends Error {
  constructor(key: string) {
    super(`More than one system role template is keyed "${key}" — refusing to guess which one to seed`);
    this.name = "DuplicateSystemRoleTemplateError";
  }
}

export async function seedRolesAndPermissions(): Promise<void> {
  // SYSTEM_ROLES are always templates (organizationId unset), so the conflict
  // target carries roles_system_key_unique's own partial condition, or
  // Postgres rejects it (42P10).
  await db
    .insert(rolesTable)
    .values([...SYSTEM_ROLES])
    .onConflictDoNothing({ target: rolesTable.key, where: sql`${rolesTable.organizationId} is null` });
  await db
    .insert(permissionsTable)
    .values([...PERMISSIONS])
    .onConflictDoNothing({ target: permissionsTable.key });

  // Templates only. An organization-owned role — even one keyed `employee` or
  // `super_admin` — is not in this list, so it can never be mistaken for one.
  const templates = await db
    .select()
    .from(rolesTable)
    .where(and(isNull(rolesTable.organizationId), eq(rolesTable.isSystemRole, true)));
  const templateByKey = new Map<string, (typeof templates)[number]>();
  for (const template of templates) {
    // roles_system_key_unique makes this impossible; refuse rather than pick.
    if (templateByKey.has(template.key)) throw new DuplicateSystemRoleTemplateError(template.key);
    templateByKey.set(template.key, template);
  }

  // permissions.key is globally unique, so key → permission is unambiguous.
  const permissions = await db.select().from(permissionsTable);
  const permissionByKey = new Map(permissions.map((p) => [p.key, p]));

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const template = templateByKey.get(roleKey);
    if (!template) continue;

    for (const permissionKey of permissionKeys) {
      const permission = permissionByKey.get(permissionKey);
      if (!permission) continue;

      await db
        .insert(rolePermissionsTable)
        .values({ roleId: template.id, permissionId: permission.id })
        .onConflictDoNothing({
          target: [rolePermissionsTable.roleId, rolePermissionsTable.permissionId],
        });
    }
  }
}
