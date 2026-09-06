/**
 * WS-26 — auto-fill bindings.
 *
 * A template binding names a `(source, ref)` from the allow-list below; the
 * server resolves it against authoritative records for the submission's
 * subject employee, always scoped to the organization already proven by
 * requireMembership. Nothing here accepts a column name from a template or a
 * request — an unknown ref resolves to nothing rather than to a query.
 *
 * Resolved values are stored on each revision as `autofillSnapshot`, so a
 * later change to the employee record never rewrites what a submitted or
 * approved form said (brief §6, §10).
 */
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  employeesTable,
  departmentsTable,
  positionsTable,
  organizationsTable,
  employeeStatutoryIdentifiersTable,
} from "@workspace/db";
import type { FormDefinition, FormBinding } from "./definition";
import { walkItems } from "./definition";

export type AutofillValue = string | number | boolean | null;
export type AutofillSnapshot = Record<string, AutofillValue>;

interface SubjectContext {
  employee: typeof employeesTable.$inferSelect;
  department: typeof departmentsTable.$inferSelect | null;
  position: typeof positionsTable.$inferSelect | null;
  manager: typeof employeesTable.$inferSelect | null;
  managerPosition: typeof positionsTable.$inferSelect | null;
  organization: typeof organizationsTable.$inferSelect | null;
  ssnitNumber: string | null;
}

function fullName(e: { firstName: string | null; middleName?: string | null; lastName: string | null } | null): string {
  if (!e) return "";
  return [e.firstName, e.middleName, e.lastName].filter((p) => p && p.trim()).join(" ");
}

function isoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addressLine(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const a = value as Record<string, unknown>;
  return ["line1", "line2", "city", "state", "postalCode", "country"]
    .map((k) => (typeof a[k] === "string" ? (a[k] as string).trim() : ""))
    .filter(Boolean)
    .join(", ");
}

function emergencyContact(value: unknown, index: number, field: "name" | "relationship" | "phone"): string {
  if (!Array.isArray(value)) return "";
  const c = value[index];
  if (!c || typeof c !== "object") return "";
  const v = (c as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

/** The allow-list. Adding a source or ref is a code change reviewed like any other. */
const RESOLVERS: Record<FormBinding["source"], Record<string, (ctx: SubjectContext) => AutofillValue>> = {
  employee: {
    fullName: (c) => fullName(c.employee),
    firstName: (c) => c.employee.firstName ?? "",
    lastName: (c) => c.employee.lastName ?? "",
    employeeNumber: (c) => c.employee.employeeNumber ?? "",
    gender: (c) => c.employee.gender ?? "",
    dateOfBirth: (c) => isoDate(c.employee.dateOfBirth),
    maritalStatus: (c) => c.employee.maritalStatus ?? "",
    nationality: (c) => c.employee.nationality ?? "",
    nationalId: (c) => c.employee.nationalId ?? "",
    personalEmail: (c) => c.employee.personalEmail ?? "",
    workEmail: (c) => c.employee.workEmail ?? "",
    email: (c) => c.employee.personalEmail ?? c.employee.workEmail ?? "",
    phoneNumber: (c) => c.employee.phoneNumber ?? "",
    residentialAddress: (c) => addressLine(c.employee.residentialAddress),
    hireDate: (c) => isoDate(c.employee.hireDate),
    probationEndDate: (c) => isoDate(c.employee.probationEndDate),
    "emergencyContact.name": (c) => emergencyContact(c.employee.emergencyContacts, 0, "name"),
    "emergencyContact.relationship": (c) => emergencyContact(c.employee.emergencyContacts, 0, "relationship"),
    "emergencyContact.phone": (c) => emergencyContact(c.employee.emergencyContacts, 0, "phone"),
  },
  department: {
    name: (c) => c.department?.name ?? "",
  },
  position: {
    title: (c) => c.position?.title ?? "",
  },
  statutory: {
    ssnitNumber: (c) => c.ssnitNumber ?? "",
  },
  organization: {
    name: (c) => c.organization?.name ?? "",
  },
  reporting_manager: {
    fullName: (c) => fullName(c.manager),
    positionTitle: (c) => c.managerPosition?.title ?? "",
  },
};

export function isKnownBinding(binding: FormBinding): boolean {
  return Boolean(RESOLVERS[binding.source]?.[binding.ref]);
}

async function loadSubjectContext(organizationId: number, employeeId: number): Promise<SubjectContext | null> {
  const [employee] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!employee) return null;

  const [department] = employee.departmentId
    ? await db.select().from(departmentsTable).where(and(eq(departmentsTable.id, employee.departmentId), eq(departmentsTable.organizationId, organizationId))).limit(1)
    : [null];
  const [position] = employee.positionId
    ? await db.select().from(positionsTable).where(and(eq(positionsTable.id, employee.positionId), eq(positionsTable.organizationId, organizationId))).limit(1)
    : [null];
  const [manager] = employee.reportingManagerId
    ? await db.select().from(employeesTable).where(and(eq(employeesTable.id, employee.reportingManagerId), eq(employeesTable.organizationId, organizationId))).limit(1)
    : [null];
  const [managerPosition] = manager?.positionId
    ? await db.select().from(positionsTable).where(and(eq(positionsTable.id, manager.positionId), eq(positionsTable.organizationId, organizationId))).limit(1)
    : [null];
  const [organization] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  const [statutory] = await db
    .select({ ssnitNumber: employeeStatutoryIdentifiersTable.ssnitNumber })
    .from(employeeStatutoryIdentifiersTable)
    .where(and(eq(employeeStatutoryIdentifiersTable.employeeId, employeeId), eq(employeeStatutoryIdentifiersTable.organizationId, organizationId)))
    .orderBy(desc(employeeStatutoryIdentifiersTable.id))
    .limit(1);

  return {
    employee,
    department: department ?? null,
    position: position ?? null,
    manager: manager ?? null,
    managerPosition: managerPosition ?? null,
    organization: organization ?? null,
    ssnitNumber: statutory?.ssnitNumber ?? null,
  };
}

/**
 * Resolves every bound field of a definition for the subject employee. The
 * result is keyed by item key. Unknown refs are omitted (never errors at
 * fill time — the definition validator already restricted sources, and a
 * ref the platform does not know simply has no value).
 */
export async function resolveAutofill(organizationId: number, subjectEmployeeId: number, definition: FormDefinition): Promise<AutofillSnapshot> {
  const snapshot: AutofillSnapshot = {};
  const ctx = await loadSubjectContext(organizationId, subjectEmployeeId);
  if (!ctx) return snapshot;
  for (const { item } of walkItems(definition)) {
    if (item.kind !== "field" || !item.binding) continue;
    const resolver = RESOLVERS[item.binding.source]?.[item.binding.ref];
    if (!resolver) continue;
    snapshot[item.key] = resolver(ctx);
  }
  return snapshot;
}

/** Keys whose value the user may never supply (readonly bindings). */
export function readonlyKeys(definition: FormDefinition): Set<string> {
  const keys = new Set<string>();
  for (const { item } of walkItems(definition)) {
    if (item.kind === "field" && item.binding?.mode === "readonly") keys.add(item.key);
  }
  return keys;
}
