/**
 * Resolving a SYSTEM role template by its key — the one safe way to do it.
 *
 * `roles.key` is NOT globally unique. It is unique only per scope (ADR-015's
 * system/org-copy split): roles_system_key_unique on key WHERE
 * organization_id IS NULL, and roles_org_key_unique on (organization_id, key)
 * WHERE organization_id IS NOT NULL. Any organization may therefore own a role
 * keyed `org_admin`, `employee`, `hr` or any other template key — copying a
 * template lets the organization choose the key. A lookup by key alone returns
 * whichever matching row Postgres happens to read first, which can be another
 * tenant's role: that is how organization onboarding could hand a new
 * organization's creator a role owned by a different organization.
 *
 * A template is identified by ALL THREE of: the key, `organization_id IS
 * NULL`, and `is_system_role = true`. `organization_id IS NULL` is the part
 * that cannot be forged by a tenant — an organization-owned row, even one
 * wrongly carrying `is_system_role = true` (the column's default), always has
 * its organization set. Resolution fails closed unless exactly one template
 * matches: a missing template is an error, never a silent skip.
 *
 * Roles a tenant CHOOSES are resolved by id through
 * roleDelegation.ts's loadAssignableRole instead; this module is only for code
 * that needs a specific template by name.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, rolesTable, type Role } from "@workspace/db";

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx`, so a caller can resolve inside its own transaction.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class SystemRoleTemplateNotFoundError extends Error {
  constructor(key: string) {
    super(`The "${key}" system role template is missing — run seed:roles`);
    this.name = "SystemRoleTemplateNotFoundError";
  }
}

export class AmbiguousSystemRoleTemplateError extends Error {
  constructor(key: string) {
    super(`More than one system role template is keyed "${key}" — refusing to guess which one to use`);
    this.name = "AmbiguousSystemRoleTemplateError";
  }
}

/**
 * The predicate every system-template lookup must carry. A function, not a
 * module-level constant, so importing this module never touches the schema.
 */
export function systemRoleTemplateScope() {
  return and(isNull(rolesTable.organizationId), eq(rolesTable.isSystemRole, true));
}

/** The one system template keyed `key`, or an error. Never an organization-owned role. */
export async function resolveSystemRoleTemplate(executor: QueryClient, key: string): Promise<Role> {
  // limit(2), not limit(1): roles_system_key_unique makes a second match
  // impossible, but if it ever happened we refuse rather than pick one.
  const rows = await executor
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.key, key), systemRoleTemplateScope()))
    .limit(2);
  if (rows.length === 0) throw new SystemRoleTemplateNotFoundError(key);
  if (rows.length > 1) throw new AmbiguousSystemRoleTemplateError(key);
  return rows[0]!;
}

/**
 * The system templates among `keys` that exist — possibly none. For callers
 * (such as a deprecated-role migration) where an absent template legitimately
 * means "nothing to do". Organization-owned roles sharing a key never appear.
 */
export async function listSystemRoleTemplates(executor: QueryClient, keys: readonly string[]): Promise<Role[]> {
  if (keys.length === 0) return [];
  return executor
    .select()
    .from(rolesTable)
    .where(and(inArray(rolesTable.key, [...keys]), systemRoleTemplateScope()));
}
