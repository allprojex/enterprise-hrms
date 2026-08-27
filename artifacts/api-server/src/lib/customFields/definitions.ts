/**
 * WS-8 — custom field definition service (§24.11, §24.13).
 *
 * The rule this file exists to enforce: a definition's identity is stable and
 * its configuration is immutable-per-version. Editing never rewrites a version;
 * it creates the next one and moves `isCurrent`. That is what makes a value
 * captured under version 1 still mean what it meant, after version 7 ships.
 *
 * Change classification (§24.13) is enforced, not advisory: a change that would
 * reinterpret existing data is refused outright rather than warned about.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  customFieldDefinitionsTable,
  customFieldDefinitionVersionsTable,
  customFieldValuesTable,
  masterDataItemsTable,
  type CustomFieldDefinition,
  type CustomFieldDefinitionVersion,
} from "@workspace/db";
import { isUniqueViolation } from "../dbErrors";
import { assertValidFieldConfig, CustomFieldValidationError, getFieldTypeSpec, type OptionsConfig, type ValidationConfig } from "./fieldTypes";
import { assertValidVisibilityRule, parseStoredVisibility, type VisibilityRule } from "./visibility";
import { requireScopeSpec } from "./scopes";

export type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CustomFieldNotFoundError extends Error {
  constructor() {
    super("Custom field not found");
    this.name = "CustomFieldNotFoundError";
  }
}

export class DuplicateCustomFieldKeyError extends Error {
  constructor(fieldKey: string) {
    super(`A custom field with key "${fieldKey}" already exists for this scope`);
    this.name = "DuplicateCustomFieldKeyError";
  }
}

export class BreakingCustomFieldChangeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BreakingCustomFieldChangeError";
  }
}

export class CustomFieldArchivedError extends Error {
  constructor() {
    super("This custom field is archived and no longer accepts new data");
    this.name = "CustomFieldArchivedError";
  }
}

/** A definition joined to its current version — the shape every read path returns. */
export interface CustomFieldWithVersion {
  definition: CustomFieldDefinition;
  version: CustomFieldDefinitionVersion;
}

const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Stable, organization-local keys (§24.19) — lowercase snake_case so a
 * definition can be exported and recreated in another organization by key
 * without carrying ids or values.
 */
function assertValidFieldKey(fieldKey: string): string {
  const key = fieldKey.trim().toLowerCase();
  if (!FIELD_KEY_RE.test(key)) {
    throw new CustomFieldValidationError(
      "Field key must start with a letter and contain only lowercase letters, numbers and underscores",
    );
  }
  return key;
}

async function assertMasterDataDomainExists(domainKey: string, organizationId: number): Promise<void> {
  // Mirrors assertComponentTypeKnown's own shape: the org check sits outside
  // the WHERE so a cross-organization domain is indistinguishable from one
  // that does not exist.
  const rows = await db
    .select({ organizationId: masterDataItemsTable.organizationId })
    .from(masterDataItemsTable)
    .where(and(eq(masterDataItemsTable.domain, domainKey), eq(masterDataItemsTable.status, "active")))
    .limit(50);
  const usable = rows.some((r) => r.organizationId === null || r.organizationId === organizationId);
  if (!usable) throw new CustomFieldValidationError(`Master data domain "${domainKey}" has no items available to this organization`);
}

export interface CreateCustomFieldParams {
  organizationId: number;
  scope: string;
  fieldKey: string;
  label: string;
  helpText?: string | null;
  fieldType: string;
  required?: boolean;
  sensitivity?: "normal" | "sensitive";
  displayOrder?: number;
  validation?: unknown;
  options?: unknown;
  visibility?: unknown;
  actorMembershipId: number | null;
}

export async function createCustomField(params: CreateCustomFieldParams): Promise<CustomFieldWithVersion> {
  const scopeSpec = requireScopeSpec(params.scope);
  const fieldKey = assertValidFieldKey(params.fieldKey);
  const label = params.label?.trim();
  if (!label) throw new CustomFieldValidationError("Label is required");
  if (!getFieldTypeSpec(params.fieldType)) throw new CustomFieldValidationError(`"${params.fieldType}" is not a supported field type`);

  const { validation, options } = assertValidFieldConfig({
    fieldType: params.fieldType,
    validation: params.validation,
    options: params.options,
  });
  if (options?.masterDataDomain) await assertMasterDataDomainExists(options.masterDataDomain, params.organizationId);

  const siblings = await listCustomFields(params.organizationId, scopeSpec.scope, { includeArchived: true });
  const knownKeys = new Set(siblings.map((s) => s.definition.fieldKey));
  const visibility = assertValidVisibilityRule(params.visibility, knownKeys, fieldKey);

  try {
    return await db.transaction(async (tx) => {
      const [definition] = await tx
        .insert(customFieldDefinitionsTable)
        .values({
          organizationId: params.organizationId,
          scope: scopeSpec.scope,
          fieldKey,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      const [version] = await tx
        .insert(customFieldDefinitionVersionsTable)
        .values({
          organizationId: params.organizationId,
          definitionId: definition.id,
          versionNumber: 1,
          label,
          helpText: params.helpText?.trim() || null,
          fieldType: params.fieldType as CustomFieldDefinitionVersion["fieldType"],
          required: params.required ?? false,
          sensitivity: params.sensitivity ?? "normal",
          displayOrder: params.displayOrder ?? 0,
          validation,
          options,
          visibility,
          isCurrent: true,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      return { definition, version };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateCustomFieldKeyError(fieldKey);
    throw err;
  }
}

export interface UpdateCustomFieldParams {
  organizationId: number;
  definitionId: number;
  label: string;
  helpText?: string | null;
  fieldType: string;
  required?: boolean;
  sensitivity?: "normal" | "sensitive";
  displayOrder?: number;
  validation?: unknown;
  options?: unknown;
  visibility?: unknown;
  actorMembershipId: number | null;
}

/**
 * Creates the next version of a field. Safe changes (§24.13) go through;
 * breaking ones are refused with the reason, so the organization creates a new
 * field instead of silently reinterpreting captured data.
 */
export async function createCustomFieldVersion(params: UpdateCustomFieldParams): Promise<CustomFieldWithVersion> {
  const current = await getCustomField(params.organizationId, params.definitionId);
  if (current.definition.status === "archived") throw new CustomFieldArchivedError();

  const label = params.label?.trim();
  if (!label) throw new CustomFieldValidationError("Label is required");

  const { validation, options } = assertValidFieldConfig({
    fieldType: params.fieldType,
    validation: params.validation,
    options: params.options,
  });
  if (options?.masterDataDomain) await assertMasterDataDomainExists(options.masterDataDomain, params.organizationId);

  const valueCount = await countValues(params.definitionId);
  assertChangeIsSafe(current.version, { fieldType: params.fieldType, options }, valueCount);

  const siblings = await listCustomFields(params.organizationId, current.definition.scope, { includeArchived: true });
  const knownKeys = new Set(siblings.map((s) => s.definition.fieldKey));
  const visibility = assertValidVisibilityRule(params.visibility, knownKeys, current.definition.fieldKey);

  return db.transaction(async (tx) => {
    // Clearing first keeps the partial unique index satisfied at every instant.
    await tx
      .update(customFieldDefinitionVersionsTable)
      .set({ isCurrent: false })
      .where(eq(customFieldDefinitionVersionsTable.definitionId, params.definitionId));

    const [{ maxVersion }] = await tx
      .select({ maxVersion: sql<number>`COALESCE(MAX(${customFieldDefinitionVersionsTable.versionNumber}), 0)::int` })
      .from(customFieldDefinitionVersionsTable)
      .where(eq(customFieldDefinitionVersionsTable.definitionId, params.definitionId));

    const [version] = await tx
      .insert(customFieldDefinitionVersionsTable)
      .values({
        organizationId: params.organizationId,
        definitionId: params.definitionId,
        versionNumber: maxVersion + 1,
        label,
        helpText: params.helpText?.trim() || null,
        fieldType: params.fieldType as CustomFieldDefinitionVersion["fieldType"],
        required: params.required ?? false,
        sensitivity: params.sensitivity ?? current.version.sensitivity,
        displayOrder: params.displayOrder ?? current.version.displayOrder,
        validation,
        options,
        visibility,
        isCurrent: true,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();

    return { definition: current.definition, version };
  });
}

/**
 * §24.13 — refuses changes that would reinterpret data already captured.
 * Only applied once values exist: before that, there is nothing to break.
 */
function assertChangeIsSafe(
  currentVersion: CustomFieldDefinitionVersion,
  next: { fieldType: string; options: OptionsConfig | null },
  existingValueCount: number,
): void {
  if (existingValueCount === 0) return;

  if (next.fieldType !== currentVersion.fieldType) {
    throw new BreakingCustomFieldChangeError(
      `This field already holds ${existingValueCount} value(s), so its type cannot change from "${currentVersion.fieldType}" to "${next.fieldType}". Create a new field instead.`,
    );
  }

  const currentOptions = (currentVersion.options as OptionsConfig | null) ?? null;
  if (currentOptions?.masterDataDomain && next.options?.masterDataDomain !== currentOptions.masterDataDomain) {
    throw new BreakingCustomFieldChangeError(
      "This field already holds values, so its master data domain cannot change. Create a new field instead.",
    );
  }

  if (currentOptions?.choices && next.options?.choices) {
    const nextValues = new Set(next.options.choices.map((c) => c.value));
    const removed = currentOptions.choices.filter((c) => !nextValues.has(c.value)).map((c) => c.value);
    if (removed.length > 0) {
      // Only actually-used options are protected: removing an option nobody
      // ever selected is a safe tidy-up, removing one in use would orphan data.
      throw new BreakingCustomFieldChangeError(
        `Cannot remove choice(s) ${removed.map((r) => `"${r}"`).join(", ")} — this field already holds values. Add new choices instead, or create a new field.`,
      );
    }
  }
}

async function countValues(definitionId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customFieldValuesTable)
    .where(eq(customFieldValuesTable.definitionId, definitionId));
  return row?.count ?? 0;
}

/** Which of a select field's choices are actually referenced by stored values — used by the UI to warn before an edit. */
export async function listUsedChoiceValues(definitionId: number): Promise<string[]> {
  const rows = await db
    .select({ value: customFieldValuesTable.value })
    .from(customFieldValuesTable)
    .where(eq(customFieldValuesTable.definitionId, definitionId));
  const used = new Set<string>();
  for (const r of rows) {
    const inner = (r.value as { value?: unknown } | null)?.value;
    if (typeof inner === "string") used.add(inner);
    else if (Array.isArray(inner)) inner.forEach((v) => typeof v === "string" && used.add(v));
  }
  return [...used];
}

export async function getCustomField(organizationId: number, definitionId: number): Promise<CustomFieldWithVersion> {
  const [row] = await db
    .select({ definition: customFieldDefinitionsTable, version: customFieldDefinitionVersionsTable })
    .from(customFieldDefinitionsTable)
    .innerJoin(
      customFieldDefinitionVersionsTable,
      and(
        eq(customFieldDefinitionVersionsTable.definitionId, customFieldDefinitionsTable.id),
        eq(customFieldDefinitionVersionsTable.isCurrent, true),
      ),
    )
    .where(and(eq(customFieldDefinitionsTable.id, definitionId), eq(customFieldDefinitionsTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new CustomFieldNotFoundError();
  return row;
}

export async function listCustomFields(
  organizationId: number,
  scope: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CustomFieldWithVersion[]> {
  const conditions = [
    eq(customFieldDefinitionsTable.organizationId, organizationId),
    eq(customFieldDefinitionsTable.scope, scope as CustomFieldDefinition["scope"]),
    eq(customFieldDefinitionVersionsTable.isCurrent, true),
  ];
  if (!opts.includeArchived) conditions.push(eq(customFieldDefinitionsTable.status, "active"));

  return db
    .select({ definition: customFieldDefinitionsTable, version: customFieldDefinitionVersionsTable })
    .from(customFieldDefinitionsTable)
    .innerJoin(
      customFieldDefinitionVersionsTable,
      eq(customFieldDefinitionVersionsTable.definitionId, customFieldDefinitionsTable.id),
    )
    .where(and(...conditions))
    .orderBy(asc(customFieldDefinitionVersionsTable.displayOrder), asc(customFieldDefinitionsTable.id));
}

export async function listCustomFieldVersions(organizationId: number, definitionId: number): Promise<CustomFieldDefinitionVersion[]> {
  await getCustomField(organizationId, definitionId); // org-scope check
  return db
    .select()
    .from(customFieldDefinitionVersionsTable)
    .where(eq(customFieldDefinitionVersionsTable.definitionId, definitionId))
    .orderBy(desc(customFieldDefinitionVersionsTable.versionNumber));
}

/** Loads several definitions by id, org-scoped — used when validating a form submission's field membership. */
export async function getCustomFieldsByIds(organizationId: number, ids: number[]): Promise<CustomFieldWithVersion[]> {
  if (ids.length === 0) return [];
  return db
    .select({ definition: customFieldDefinitionsTable, version: customFieldDefinitionVersionsTable })
    .from(customFieldDefinitionsTable)
    .innerJoin(
      customFieldDefinitionVersionsTable,
      and(
        eq(customFieldDefinitionVersionsTable.definitionId, customFieldDefinitionsTable.id),
        eq(customFieldDefinitionVersionsTable.isCurrent, true),
      ),
    )
    .where(and(eq(customFieldDefinitionsTable.organizationId, organizationId), inArray(customFieldDefinitionsTable.id, ids)));
}

/**
 * §24.13 — archiving removes a field from new entry and never deletes values.
 * There is deliberately no delete path once values exist.
 */
export async function setCustomFieldArchived(params: {
  organizationId: number;
  definitionId: number;
  archived: boolean;
}): Promise<CustomFieldDefinition> {
  await getCustomField(params.organizationId, params.definitionId);
  const [updated] = await db
    .update(customFieldDefinitionsTable)
    .set({ status: params.archived ? "archived" : "active", archivedAt: params.archived ? new Date() : null })
    .where(eq(customFieldDefinitionsTable.id, params.definitionId))
    .returning();
  return updated;
}

export function parsedVisibility(version: CustomFieldDefinitionVersion): VisibilityRule | null {
  return parseStoredVisibility(version.visibility);
}

export function parsedValidation(version: CustomFieldDefinitionVersion): ValidationConfig | null {
  return (version.validation as ValidationConfig | null) ?? null;
}

export function parsedOptions(version: CustomFieldDefinitionVersion): OptionsConfig | null {
  return (version.options as OptionsConfig | null) ?? null;
}
