/**
 * Organization Configuration Engine.
 *
 * Replaces the old single uncontrolled JSON settings blob with named,
 * validated, versioned configuration namespaces. Each namespace has its own
 * Zod schema and safe defaults; unknown namespaces are rejected rather than
 * silently accepted. New namespaces (module enablement, numbering formats,
 * branding, ...) are added by registering them here as their owning
 * workstream lands — the storage and API layers don't need to change.
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

interface NamespaceDefinition {
  schemaVersion: number;
  schema: z.ZodType;
  defaults: () => Record<string, unknown>;
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
