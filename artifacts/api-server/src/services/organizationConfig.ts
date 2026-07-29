/**
 * Organization Configuration Engine.
 *
 * Replaces the old single uncontrolled JSON settings blob with named,
 * validated, versioned configuration namespaces. Each namespace has its own
 * Zod schema and safe defaults; unknown namespaces are rejected rather than
 * silently accepted. New namespaces (numbering formats, branding, ...) are
 * added by registering them here as their owning workstream lands — the
 * storage and API layers don't need to change. Per-organization module
 * enablement (W4) is not one of these namespaces — it has clear relational
 * structure (an org either has a module on or off) and needs referential
 * integrity against the module registry, so it lives in its own
 * `organization_modules` table instead; see
 * artifacts/api-server/src/lib/organizationModules.ts.
 *
 * Namespace schemas use `.passthrough()` so organizations that already wrote
 * arbitrary keys under the legacy blob (now the "general" namespace, via the
 * schema column default) keep that data readable and mergeable instead of
 * being rejected on the first read after this change ships.
 */
import { eq, and } from "drizzle-orm";
import { db, organizationSettingsTable } from "@workspace/db";
import { z } from "zod/v4";

const generalConfigSchema = z
  .object({
    timezone: z.string().optional(),
    defaultLocale: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
  })
  .passthrough();

const terminologyConfigSchema = z
  .object({
    employeeLabel: z.string().min(1).optional(),
    employeeLabelPlural: z.string().min(1).optional(),
    branchLabel: z.string().min(1).optional(),
    branchLabelPlural: z.string().min(1).optional(),
    departmentLabel: z.string().min(1).optional(),
    departmentLabelPlural: z.string().min(1).optional(),
    positionLabel: z.string().min(1).optional(),
    positionLabelPlural: z.string().min(1).optional(),
  })
  .passthrough();

// HH:MM, 24-hour — plain civil time, never a timestamp; W38 is configuration
// only, so there is no instant to attach a timezone to.
const CIVIL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WORK_DAY_VALUES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const attendanceConfigSchema = z
  .object({
    workStartTime: z.string().regex(CIVIL_TIME_PATTERN, "workStartTime must be in 24-hour HH:MM format").optional(),
    workEndTime: z.string().regex(CIVIL_TIME_PATTERN, "workEndTime must be in 24-hour HH:MM format").optional(),
    gracePeriodMinutes: z.number().int().min(0).max(180).optional(),
    workDays: z.array(z.enum(WORK_DAY_VALUES)).optional(),
  })
  .passthrough()
  .refine((v) => !v.workStartTime || !v.workEndTime || v.workStartTime < v.workEndTime, {
    message: "workStartTime must be earlier than workEndTime",
    path: ["workEndTime"],
  });

interface NamespaceDefinition {
  schemaVersion: number;
  schema: z.ZodType;
  defaults: () => Record<string, unknown>;
  // Which module (W5/W6) must be enabled for this namespace's routes to be
  // reachable. Foundation namespaces (general, terminology) have none — they
  // predate Module Management. Undefined means no gate.
  moduleKey?: string;
}

export const CONFIG_NAMESPACES: Record<string, NamespaceDefinition> = {
  general: {
    schemaVersion: 1,
    schema: generalConfigSchema,
    defaults: () => ({}),
  },
  terminology: {
    schemaVersion: 1,
    schema: terminologyConfigSchema,
    defaults: () => ({
      employeeLabel: "Employee",
      employeeLabelPlural: "Employees",
      branchLabel: "Branch",
      branchLabelPlural: "Branches",
      departmentLabel: "Department",
      departmentLabelPlural: "Departments",
      positionLabel: "Position",
      positionLabelPlural: "Positions",
    }),
  },
  // W38 — Attendance Configuration. Config only, no capture: work days/hours,
  // grace period. No new table — reuses this engine (ADR-009), per the
  // frozen Phase 2B plan's explicit architecture reuse for this workstream.
  attendance: {
    schemaVersion: 1,
    schema: attendanceConfigSchema,
    defaults: () => ({
      workStartTime: "09:00",
      workEndTime: "17:00",
      gracePeriodMinutes: 0,
      workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    }),
    moduleKey: "attendance",
  },
};

export function isKnownNamespace(namespace: string): namespace is keyof typeof CONFIG_NAMESPACES {
  return Object.prototype.hasOwnProperty.call(CONFIG_NAMESPACES, namespace);
}

export interface OrganizationConfigResult {
  organizationId: number;
  namespace: string;
  schemaVersion: number;
  data: Record<string, unknown>;
  updatedAt: Date | null;
}

async function findRow(organizationId: number, namespace: string) {
  const [row] = await db
    .select()
    .from(organizationSettingsTable)
    .where(
      and(
        eq(organizationSettingsTable.organizationId, organizationId),
        eq(organizationSettingsTable.namespace, namespace),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Returns the namespace's current config, or its safe defaults if nothing has been saved yet — no row is created on read. */
export async function getNamespaceConfig(organizationId: number, namespace: string): Promise<OrganizationConfigResult> {
  const definition = CONFIG_NAMESPACES[namespace];
  const row = await findRow(organizationId, namespace);

  if (!row) {
    return {
      organizationId,
      namespace,
      schemaVersion: definition.schemaVersion,
      data: definition.defaults(),
      updatedAt: null,
    };
  }

  return {
    organizationId,
    namespace,
    schemaVersion: row.schemaVersion,
    data: row.settings as Record<string, unknown>,
    updatedAt: row.updatedAt,
  };
}

export class InvalidNamespaceConfigError extends Error {
  constructor(readonly issues: z.ZodError["issues"]) {
    super("Invalid configuration for this namespace");
  }
}

/**
 * Merges `patch` into the namespace's existing data (or its defaults) and
 * validates the *merged result* — not just the patch — against the
 * namespace's schema before persisting, so a partial update can never leave
 * the stored config in a state that wouldn't itself pass validation.
 */
export async function updateNamespaceConfig(
  organizationId: number,
  namespace: string,
  patch: Record<string, unknown>,
): Promise<OrganizationConfigResult> {
  const definition = CONFIG_NAMESPACES[namespace];
  const existing = await getNamespaceConfig(organizationId, namespace);
  const merged = { ...existing.data, ...patch };

  const parsed = definition.schema.safeParse(merged);
  if (!parsed.success) {
    throw new InvalidNamespaceConfigError(parsed.error.issues);
  }

  const row = await findRow(organizationId, namespace);
  if (row) {
    const [updated] = await db
      .update(organizationSettingsTable)
      .set({ settings: parsed.data, schemaVersion: definition.schemaVersion })
      .where(eq(organizationSettingsTable.id, row.id))
      .returning();
    return {
      organizationId,
      namespace,
      schemaVersion: updated.schemaVersion,
      data: updated.settings as Record<string, unknown>,
      updatedAt: updated.updatedAt,
    };
  }

  const [created] = await db
    .insert(organizationSettingsTable)
    .values({ organizationId, namespace, schemaVersion: definition.schemaVersion, settings: parsed.data })
    .onConflictDoNothing({ target: [organizationSettingsTable.organizationId, organizationSettingsTable.namespace] })
    .returning();

  if (created) {
    return {
      organizationId,
      namespace,
      schemaVersion: created.schemaVersion,
      data: created.settings as Record<string, unknown>,
      updatedAt: created.updatedAt,
    };
  }

  // Lost a race with a concurrent first write for this (org, namespace) pair.
  const raced = await findRow(organizationId, namespace);
  return {
    organizationId,
    namespace,
    schemaVersion: raced!.schemaVersion,
    data: raced!.settings as Record<string, unknown>,
    updatedAt: raced!.updatedAt,
  };
}
