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

// WWM Readiness, Workstream 1 — organization branding. Foundation namespace
// (no moduleKey): every organization needs a login/shell identity regardless
// of which modules it has enabled, matching general/terminology. The
// organization's display name and logo already live on `organizations.name`
// / `organizations.logoUrl` (first-class columns, not duplicated here) —
// this namespace exists only for the one field with no existing column:
// the product/system name shown alongside the org's own identity (e.g. "HR
// Management System"). Left unset, callers fall back to platform-generic
// copy — see getPublicTenantContext and the login page.
// HSL triple, e.g. "217 45% 17%" — the exact raw format index.css's own
// CSS custom properties already store (consumed as hsl(var(--x))), so a
// configured value can be written straight into an inline style override
// with no conversion step.
const hslTripleSchema = z
  .string()
  .regex(/^\d{1,3} \d{1,3}% \d{1,3}%$/, 'Expected an HSL triple like "217 45% 17%"');

// WWM Presentation Readiness — a small, fixed set of theme tokens mapped
// directly onto index.css's existing CSS custom properties (--sidebar,
// --sidebar-foreground, --sidebar-accent, --sidebar-accent-foreground,
// --primary, --primary-foreground, --accent, --accent-foreground). Every
// key is optional and independently overridable; an organization that sets
// none of them (the default for every organization but WWM) renders with
// exactly today's shared theme — this is deliberately NOT a general
// theming engine (no arbitrary CSS, no per-component overrides), just
// enough to give one organization its own colour identity without
// hardcoding it into the application shell.
const brandingThemeSchema = z
  .object({
    sidebar: hslTripleSchema.optional(),
    sidebarForeground: hslTripleSchema.optional(),
    sidebarAccent: hslTripleSchema.optional(),
    sidebarAccentForeground: hslTripleSchema.optional(),
    primary: hslTripleSchema.optional(),
    primaryForeground: hslTripleSchema.optional(),
    accent: hslTripleSchema.optional(),
    accentForeground: hslTripleSchema.optional(),
    ring: hslTripleSchema.optional(),
  })
  .partial();

const brandingConfigSchema = z
  .object({
    systemDisplayName: z.string().min(1).optional(),
    theme: brandingThemeSchema.optional(),
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

// Phase 3C, W73 — Performance Foundation. Both fields are copied onto
// performance_reviews as scoringPrecisionSnapshot/
// acknowledgementRequiredSnapshot at review-creation time (a later
// workstream) — a subsequent change to this namespace never alters an
// already-created review (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md
// §9). No route/UI reads or writes this namespace in W73 — schema/config
// registration only.
const performanceConfigSchema = z
  .object({
    scoringPrecision: z.number().int().min(0).max(4).optional(),
    acknowledgementRequired: z.boolean().optional(),
  })
  .passthrough();

// Phase 3H, W114 — Numbering & Identifier History (frozen plan §4, Decision
// 5). One shared token-based format engine, reused for every identifier type
// this platform allocates — employeeNumber today, pifNumber reserved for
// W115 (Personnel File). Each identifier type's config lives under its own
// key so updating one never disturbs the other ("never shared state", per
// the frozen plan). `reuseEnabled` lives only under employeeNumber — PIF
// numbers are never reusable by design (Decision 4), so no such flag exists
// for pifNumber at all, not merely defaulted off.
const numberingIdentifierConfigSchema = z
  .object({
    prefix: z.string().max(20).optional(),
    suffix: z.string().max(20).optional(),
    separator: z.string().max(5).optional(),
    sequenceLength: z.number().int().min(1).max(10).optional(),
    startingSequence: z.number().int().min(0).optional(),
    includeBranchToken: z.boolean().optional(),
    includeDepartmentToken: z.boolean().optional(),
    includeYearToken: z.boolean().optional(),
    includeMonthToken: z.boolean().optional(),
    resetPolicy: z.enum(["never", "yearly", "monthly"]).optional(),
  })
  .passthrough();

const numberingConfigSchema = z
  .object({
    employeeNumber: numberingIdentifierConfigSchema.extend({ reuseEnabled: z.boolean().optional() }).optional(),
    pifNumber: numberingIdentifierConfigSchema.optional(),
  })
  .passthrough();

// Payroll, Workstream 1 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §6.1, §9.1,
// §F — Owner Review's explicit statutory-vs-organization-config separation
// invariant). Organization PAYROLL POLICY only — pay frequency, default
// currency, rounding rule. Deliberately contains no field that could be
// mistaken for or used to represent an official Ghana PAYE/SSNIT parameter;
// those live exclusively in payroll_statutory_rule_versions and its child
// tables (lib/db/src/schema/payroll-statutory-rule-versions.ts), a
// completely separate, non-organization-scoped table family an organization
// has no route to write to via this namespace. moduleKey: "payroll" — this
// namespace's routes are unreachable for any organization that has not
// deliberately enabled the payroll module (none are, by this workstream).
const payrollConfigSchema = z
  .object({
    payFrequency: z.enum(["monthly", "bi_weekly", "weekly"]).optional(),
    defaultCurrency: z.string().length(3).optional(),
    roundingRule: z.enum(["round", "floor", "ceil"]).optional(),
  })
  .passthrough();

// Office Inventory, Workstream 1
// (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §41, Owner Decision 5/22).
// itemNumber's format config is deliberately kept HERE (module-gated) rather
// than added to the always-on `numbering` namespace above — unlike
// employeeNumber/pifNumber (foundational to every organization), an item
// reference number only ever matters to an organization that has actually
// enabled Office Inventory, so it does not belong in a namespace every
// organization's config read touches regardless of module state.
// `repeatRequestReviewWindowDays`/`costTrackingEnabled`/`directIssueEnabled`/
// `receiptConfirmationRequired` are registered now, per the frozen plan's own
// "register once, wire up as each workstream lands" convention (mirroring
// Payroll's own W1 permission-registration precedent) — none of these four
// fields is read by any W1 route; each is consumed by its own later,
// separately-authorized workstream.
const officeInventoryItemNumberConfigSchema = z
  .object({
    prefix: z.string().max(20).optional(),
    suffix: z.string().max(20).optional(),
    separator: z.string().max(5).optional(),
    sequenceLength: z.number().int().min(1).max(10).optional(),
    startingSequence: z.number().int().min(0).optional(),
    resetPolicy: z.enum(["never", "yearly", "monthly"]).optional(),
  })
  .passthrough();

const officeInventoryConfigSchema = z
  .object({
    itemNumber: officeInventoryItemNumberConfigSchema.optional(),
    // Office Inventory, Workstream 2 — reuses the exact same format-config
    // shape as itemNumber (a second, independent number series via the
    // numbering engine's own multi-sequenceKey design), not a second
    // numbering system.
    receiptNumber: officeInventoryItemNumberConfigSchema.optional(),
    // Office Inventory, Workstream 3 — a third independent number series
    // via the same numbering-engine shape, for office_inventory_requests.
    requestNumber: officeInventoryItemNumberConfigSchema.optional(),
    // Office Inventory, Workstream 4 — a fourth independent number series,
    // for issue/fulfilment/direct-issue movement pairs (shared by both —
    // there is no separate sequence for direct issue; the distinguishing
    // signal between the two is `sourceReferenceType` on the ledger row
    // itself, not the reference number series).
    issueNumber: officeInventoryItemNumberConfigSchema.optional(),
    // Office Inventory, Workstream 5 — three more independent number
    // series via the same numbering-engine shape. The frozen plan's own
    // §40 lists `office_inventory_return` as omitted from its enumerated
    // sequenceKey list (only transfer/handover are named there) alongside
    // an explicit return-row pairing requirement in §21 ("A `returned`
    // ledger row... sharing one referenceNumber" — implicit in every other
    // paired-movement action's own documented shape) — treated here as the
    // same kind of minor enumeration gap already found and disclosed for
    // W1's own permission count, not a deliberate exclusion, so a
    // `returnNumber` series is added to close it.
    returnNumber: officeInventoryItemNumberConfigSchema.optional(),
    handoverNumber: officeInventoryItemNumberConfigSchema.optional(),
    transferNumber: officeInventoryItemNumberConfigSchema.optional(),
    // Office Inventory, Workstream 6 — two more independent number series,
    // matching the frozen plan's own §40 enumeration exactly (both
    // `office_inventory_writeoff` and `office_inventory_adjustment` are
    // explicitly named there, unlike W5's own return-key gap). Mark-missing
    // and recovery deliberately do NOT get their own series — both are
    // always anchored to, and fully traceable via, the incident's own id
    // (`sourceReferenceType='incident'`), which the frozen plan's own §40
    // text does not name either.
    writeoffNumber: officeInventoryItemNumberConfigSchema.optional(),
    adjustmentNumber: officeInventoryItemNumberConfigSchema.optional(),
    // Office Inventory, Workstream 7 — `office_inventory_stocktake` is
    // explicitly named in the frozen plan's own §40 sequence-key
    // enumeration.
    stocktakeNumber: officeInventoryItemNumberConfigSchema.optional(),
    repeatRequestReviewWindowDays: z.number().int().min(0).max(365).optional(),
    costTrackingEnabled: z.boolean().optional(),
    directIssueEnabled: z.boolean().optional(),
    receiptConfirmationRequired: z.boolean().optional(),
  })
  .passthrough();

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
  branding: {
    schemaVersion: 1,
    schema: brandingConfigSchema,
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
  // Phase 3C, W73 — Performance Foundation. scoringPrecision defaults to 0
  // decimal places (a whole-number 0-100 score); acknowledgementRequired
  // defaults to true, per Owner Decision 2's approved answer ("Yes" —
  // acknowledgement is required by default). An organization can override
  // either once a later workstream builds the settings UI.
  performance: {
    schemaVersion: 1,
    schema: performanceConfigSchema,
    defaults: () => ({
      scoringPrecision: 0,
      acknowledgementRequired: true,
    }),
    moduleKey: "performance",
  },
  // Phase 3H, W114 — Numbering & Identifier History. No moduleKey: staff
  // numbering is part of the always-on Employee Management foundation, never
  // a toggleable module (mirrors general/terminology, not
  // attendance/performance). Defaults reproduce the exact pre-existing
  // hardcoded EMP-0001 format byte-for-byte, so an organization that never
  // touches this namespace sees zero behavioral change from before W114.
  numbering: {
    schemaVersion: 1,
    schema: numberingConfigSchema,
    defaults: () => ({
      employeeNumber: {
        prefix: "EMP",
        separator: "-",
        sequenceLength: 4,
        startingSequence: 1,
        includeBranchToken: false,
        includeDepartmentToken: false,
        includeYearToken: false,
        includeMonthToken: false,
        resetPolicy: "never",
        reuseEnabled: false,
      },
      // Phase 3H, W115 — Personnel File Registry & PIF Linkage. Independent
      // of employeeNumber's own config (frozen plan §6): changing one never
      // affects the other's format or already-issued values. No
      // `reuseEnabled` field exists here at all — PIF numbers are never
      // reusable by design (Decision 4), not merely defaulted off.
      pifNumber: {
        prefix: "PIF",
        separator: "-",
        sequenceLength: 3,
        startingSequence: 1,
        includeBranchToken: false,
        includeDepartmentToken: false,
        includeYearToken: false,
        includeMonthToken: false,
        resetPolicy: "never",
      },
    }),
  },
  payroll: {
    schemaVersion: 1,
    schema: payrollConfigSchema,
    defaults: () => ({
      payFrequency: "monthly",
      defaultCurrency: "GHS",
      roundingRule: "round",
    }),
    moduleKey: "payroll",
  },
  office_inventory: {
    schemaVersion: 1,
    schema: officeInventoryConfigSchema,
    defaults: () => ({
      itemNumber: {
        prefix: "INV",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      receiptNumber: {
        prefix: "RCV",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      requestNumber: {
        prefix: "REQ",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      issueNumber: {
        prefix: "ISS",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      returnNumber: {
        prefix: "RET",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      handoverNumber: {
        prefix: "HAN",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      transferNumber: {
        prefix: "TRF",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      writeoffNumber: {
        prefix: "WOF",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      adjustmentNumber: {
        prefix: "ADJ",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      stocktakeNumber: {
        prefix: "STK",
        separator: "-",
        sequenceLength: 5,
        startingSequence: 1,
        resetPolicy: "never",
      },
      repeatRequestReviewWindowDays: 30,
      costTrackingEnabled: false,
      directIssueEnabled: false,
      receiptConfirmationRequired: true,
    }),
    moduleKey: "office_inventory",
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursive JSON-merge-patch-style merge (RFC 7386 shape, minus null-means-
 * delete, which no namespace here needs): a plain-object value in `patch` is
 * merged key-by-key into the matching plain-object value in `base`; every
 * other value type — including arrays — replaces the base value outright.
 * Needed because `numbering` (Phase 3H, W114) is this engine's first
 * namespace with a nested sub-object (employeeNumber/pifNumber) — every
 * prior namespace (general/terminology/attendance/performance) is flat, so a
 * plain shallow `{...base, ...patch}` merge was indistinguishable from this
 * for all of them. Without this, `PATCH .../config/numbering` with
 * `{employeeNumber: {reuseEnabled: true}}` would silently discard
 * employeeNumber's own already-configured prefix/separator/sequenceLength/
 * etc. — a genuine defect this workstream's own live QA caught, not a
 * hypothetical one.
 */
function deepMergeConfig(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMergeConfig(base[key], value) : value;
  }
  return result;
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
  const merged = deepMergeConfig(existing.data, patch);

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
