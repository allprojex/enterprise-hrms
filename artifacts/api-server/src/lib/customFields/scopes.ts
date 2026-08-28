/**
 * WS-8 — the scope allow-list (§24.8, §24.3).
 *
 * This is the single place that maps an approved scope to an authoritative
 * table. A client never names a table; it names a scope, and the scope must be
 * a member of the `custom_field_scope` enum. The prohibited domains from §24.3
 * (payroll transactions and runs, leave, attendance, asset and inventory
 * movements, disciplinary findings, audit records, security identities) are
 * absent from that enum, so there is no request that can reach them.
 *
 * `onboarding` was originally present as a definable scope with NO entity
 * table, because WS-8 shipped before an onboarding domain existed and must not
 * invent one. WS-10 has now supplied the authoritative record
 * (`onboarding_instances`), so the scope is bindable and resolves like any
 * other: `bindable: true` plus one branch in the lookup below. That was the
 * whole integration contract, and nothing else about WS-8 changed.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  candidatesTable,
  applicationsTable,
  positionsTable,
  organizationsTable,
  onboardingInstancesTable,
  type CustomFieldScope,
} from "@workspace/db";

export class UnknownCustomFieldScopeError extends Error {
  constructor(scope: string) {
    super(`"${scope}" is not a supported custom field scope`);
    this.name = "UnknownCustomFieldScopeError";
  }
}

export class CustomFieldEntityNotFoundError extends Error {
  constructor() {
    // Deliberately identical whether the entity is missing or belongs to
    // another organization — the caller learns nothing about other tenants.
    super("The target record was not found in this organization");
    this.name = "CustomFieldEntityNotFoundError";
  }
}

export class ScopeNotYetBindableError extends Error {
  constructor(scope: string) {
    super(`Custom field values cannot yet be attached to "${scope}" records — no such record type exists in this platform yet`);
    this.name = "ScopeNotYetBindableError";
  }
}

export interface ScopeSpec {
  scope: CustomFieldScope;
  label: string;
  /** False for scopes that are definable but have no authoritative entity yet (onboarding). */
  bindable: boolean;
  /** The domain permission a caller must hold to read/write values in this scope (§24.15: no per-field ACLs). */
  readPermission: string;
  writePermission: string;
}

export const SCOPES: readonly ScopeSpec[] = [
  { scope: "employee", label: "Employee", bindable: true, readPermission: "employee.read", writePermission: "employee.write" },
  { scope: "candidate", label: "Candidate", bindable: true, readPermission: "candidate.read", writePermission: "candidate.manage" },
  { scope: "application", label: "Application", bindable: true, readPermission: "application.read", writePermission: "application.manage" },
  { scope: "position", label: "Position", bindable: true, readPermission: "position.read", writePermission: "position.manage" },
  {
    scope: "organization_profile",
    label: "Organization HR profile",
    bindable: true,
    readPermission: "organization.read",
    writePermission: "organization.update",
  },
  {
    // WS-10 shipped the authoritative record, so this is now bindable.
    // Permissions stay on the employee keys deliberately: a custom value
    // attached to an onboarding record is data about that employee, and §24.15
    // established that value authorization follows the target domain rather
    // than becoming a second authorization model.
    scope: "onboarding",
    label: "Onboarding",
    bindable: true,
    readPermission: "employee.read",
    writePermission: "employee.write",
  },
];

const BY_SCOPE = new Map(SCOPES.map((s) => [s.scope, s]));

export function getScopeSpec(scope: string): ScopeSpec | undefined {
  return BY_SCOPE.get(scope as CustomFieldScope);
}

export function isKnownScope(scope: string): boolean {
  return BY_SCOPE.has(scope as CustomFieldScope);
}

export function requireScopeSpec(scope: string): ScopeSpec {
  const spec = getScopeSpec(scope);
  if (!spec) throw new UnknownCustomFieldScopeError(scope);
  return spec;
}

/**
 * Proves the target record exists AND belongs to this organization, before any
 * value is written or read (§24.24). Authorizing on (scope, entityId) alone
 * would be exactly the IDOR this check exists to prevent.
 *
 * `organization_profile` is a special case: the "entity" is the organization
 * itself, so the only legitimate entityId is the caller's own organization.
 */
export async function assertEntityInOrganization(scope: string, entityId: number, organizationId: number): Promise<void> {
  const spec = requireScopeSpec(scope);
  if (!spec.bindable) throw new ScopeNotYetBindableError(scope);
  if (!Number.isInteger(entityId) || entityId <= 0) throw new CustomFieldEntityNotFoundError();

  if (spec.scope === "organization_profile") {
    if (entityId !== organizationId) throw new CustomFieldEntityNotFoundError();
    const [row] = await db.select({ id: organizationsTable.id }).from(organizationsTable).where(eq(organizationsTable.id, entityId)).limit(1);
    if (!row) throw new CustomFieldEntityNotFoundError();
    return;
  }

  const table =
    spec.scope === "employee"
      ? employeesTable
      : spec.scope === "candidate"
        ? candidatesTable
        : spec.scope === "application"
          ? applicationsTable
          : spec.scope === "onboarding"
            ? onboardingInstancesTable
            : positionsTable;

  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, entityId), eq(table.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new CustomFieldEntityNotFoundError();
}

/** Verifies an `employee_reference` value points at an employee in the same organization. */
export async function assertEmployeeReferenceValid(employeeId: number, organizationId: number): Promise<void> {
  const [row] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new CustomFieldEntityNotFoundError();
}
