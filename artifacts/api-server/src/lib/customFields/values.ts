/**
 * WS-8 — custom field values (§24.4, §24.7, §24.10, §24.14).
 *
 * Values are business data. Every write proves four things before storing
 * anything (§24.24):
 *
 *   1. the definition belongs to this organization and is active
 *   2. the target record exists and belongs to this organization
 *   3. the value is valid for the definition's CURRENT version's type
 *   4. the field is actually visible under server-evaluated conditions
 *
 * (4) is the one that is easy to leave out and expensive to omit: without it,
 * a hidden field is writable by anyone willing to hand-craft a request.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  customFieldValuesTable,
  customFieldDefinitionVersionsTable,
  masterDataItemsTable,
  type CustomFieldValue,
} from "@workspace/db";
import { maskIdentifier } from "../sensitiveData";
import {
  coerceAndValidateValue,
  typedValueToReportCell,
  CustomFieldValidationError,
  type TypedValue,
} from "./fieldTypes";
import { isFieldVisible } from "./visibility";
import {
  getCustomField,
  listCustomFields,
  parsedOptions,
  parsedValidation,
  parsedVisibility,
  CustomFieldArchivedError,
  type CustomFieldWithVersion,
} from "./definitions";
import { assertEmployeeReferenceValid, assertEntityInOrganization, requireScopeSpec } from "./scopes";

export class HiddenCustomFieldWriteError extends Error {
  constructor(label: string) {
    super(`"${label}" is not applicable for this record and cannot be set`);
    this.name = "HiddenCustomFieldWriteError";
  }
}

/** What a caller sees for one field on one record. */
export interface ResolvedCustomFieldValue {
  definitionId: number;
  fieldKey: string;
  label: string;
  helpText: string | null;
  fieldType: string;
  required: boolean;
  sensitivity: "normal" | "sensitive";
  displayOrder: number;
  options: unknown;
  visibility: unknown;
  /** The stored envelope, masked when sensitive and not revealed. */
  value: unknown;
  /** True when a sensitive value was masked for this response. */
  masked: boolean;
  /** False when the field's own conditions exclude it for this record. */
  visible: boolean;
  /** §24.7 — required, visible, and nothing captured. Never fabricated, only reported. */
  missingRequired: boolean;
  /** The definition version this stored value was captured under. */
  capturedVersionId: number | null;
  capturedVersionNumber: number | null;
}

async function assertMasterDataValueValid(domainKey: string, code: string, organizationId: number): Promise<void> {
  const [row] = await db
    .select({ organizationId: masterDataItemsTable.organizationId })
    .from(masterDataItemsTable)
    .where(and(eq(masterDataItemsTable.domain, domainKey), eq(masterDataItemsTable.code, code), eq(masterDataItemsTable.status, "active")))
    .limit(1);
  if (!row || (row.organizationId !== null && row.organizationId !== organizationId)) {
    throw new CustomFieldValidationError(`"${code}" is not an available option for this field`);
  }
}

/** Loads current values for one record, keyed by fieldKey — the input to visibility evaluation. */
async function loadValueMap(organizationId: number, scope: string, entityId: number): Promise<Map<number, CustomFieldValue>> {
  const rows = await db
    .select()
    .from(customFieldValuesTable)
    .where(
      and(
        eq(customFieldValuesTable.organizationId, organizationId),
        eq(customFieldValuesTable.scope, scope as CustomFieldValue["scope"]),
        eq(customFieldValuesTable.entityId, entityId),
      ),
    );
  return new Map(rows.map((r) => [r.definitionId, r]));
}

function buildVisibilityInput(fields: CustomFieldWithVersion[], values: Map<number, CustomFieldValue>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const f of fields) map.set(f.definition.fieldKey, values.get(f.definition.id)?.value ?? null);
  return map;
}

export interface ReadValuesOptions {
  /** Include full sensitive values. The caller is responsible for the permission check and its audit. */
  revealSensitive?: boolean;
  includeArchived?: boolean;
}

/**
 * Reads every custom field for one record, in display order, with visibility
 * and missing-required status resolved server-side.
 */
export async function getValuesForEntity(
  organizationId: number,
  scope: string,
  entityId: number,
  opts: ReadValuesOptions = {},
): Promise<ResolvedCustomFieldValue[]> {
  requireScopeSpec(scope);
  const fields = await listCustomFields(organizationId, scope, { includeArchived: opts.includeArchived ?? true });
  const values = await loadValueMap(organizationId, scope, entityId);
  const visibilityInput = buildVisibilityInput(fields, values);

  const versionIds = [...values.values()].map((v) => v.definitionVersionId);
  const versionNumbers = new Map<number, number>();
  if (versionIds.length > 0) {
    const rows = await db
      .select({ id: customFieldDefinitionVersionsTable.id, versionNumber: customFieldDefinitionVersionsTable.versionNumber })
      .from(customFieldDefinitionVersionsTable)
      .where(inArray(customFieldDefinitionVersionsTable.id, versionIds));
    rows.forEach((r) => versionNumbers.set(r.id, r.versionNumber));
  }

  return fields.map((f) => {
    const stored = values.get(f.definition.id);
    const visible = isFieldVisible(parsedVisibility(f.version), visibilityInput);
    const isSensitive = f.version.sensitivity === "sensitive";
    const hasValue = stored?.value != null;
    const masked = isSensitive && hasValue && !opts.revealSensitive;

    return {
      definitionId: f.definition.id,
      fieldKey: f.definition.fieldKey,
      label: f.version.label,
      helpText: f.version.helpText,
      fieldType: f.version.fieldType,
      required: f.version.required,
      sensitivity: f.version.sensitivity,
      displayOrder: f.version.displayOrder,
      options: f.version.options,
      visibility: f.version.visibility,
      value: masked ? maskTypedValue(stored!.value) : (stored?.value ?? null),
      masked,
      visible,
      // Only meaningful for an ACTIVE, VISIBLE field: an archived field or one
      // excluded by its conditions is not something the record is missing.
      missingRequired: f.version.required && visible && f.definition.status === "active" && !hasValue,
      capturedVersionId: stored?.definitionVersionId ?? null,
      capturedVersionNumber: stored ? (versionNumbers.get(stored.definitionVersionId) ?? null) : null,
    };
  });
}

/** Masks a stored envelope while keeping its type tag, so a client still renders the right control. */
function maskTypedValue(stored: unknown): unknown {
  const envelope = stored as TypedValue | null;
  if (!envelope || typeof envelope !== "object") return null;
  const inner = envelope.value;
  if (typeof inner === "string") return { type: envelope.type, value: maskIdentifier(inner) };
  if (Array.isArray(inner)) return { type: envelope.type, value: inner.map(() => "••••") };
  return { type: envelope.type, value: "••••" };
}

export interface SetValuesParams {
  organizationId: number;
  scope: string;
  entityId: number;
  /** definitionId -> raw submitted value. Absent keys are left untouched; explicit null clears. */
  values: Record<number, unknown>;
  actorMembershipId: number | null;
}

export interface SetValuesResult {
  written: number;
  cleared: number;
}

/**
 * Writes values for one record, atomically. Every field in the payload must be
 * a real, active, in-scope field of this organization, and must be visible
 * under the record's post-write state.
 */
export async function setValuesForEntity(params: SetValuesParams): Promise<SetValuesResult> {
  requireScopeSpec(params.scope);
  await assertEntityInOrganization(params.scope, params.entityId, params.organizationId);

  const fields = await listCustomFields(params.organizationId, params.scope, { includeArchived: true });
  const byId = new Map(fields.map((f) => [f.definition.id, f]));

  // Reject unknown ids rather than ignoring them — silently dropping a field
  // the caller believed it was setting is worse than a clear error (§24.24).
  for (const rawId of Object.keys(params.values)) {
    const id = Number(rawId);
    if (!byId.has(id)) throw new CustomFieldValidationError(`Unknown custom field ${rawId} for this record`);
  }

  const existing = await loadValueMap(params.organizationId, params.scope, params.entityId);

  // Validate/coerce first, so nothing is written if any field fails.
  const prepared: { field: CustomFieldWithVersion; typed: TypedValue | null }[] = [];
  for (const [rawId, raw] of Object.entries(params.values)) {
    const field = byId.get(Number(rawId))!;
    if (field.definition.status === "archived") throw new CustomFieldArchivedError();

    const typed = coerceAndValidateValue({
      fieldType: field.version.fieldType,
      label: field.version.label,
      required: field.version.required,
      validation: parsedValidation(field.version),
      options: parsedOptions(field.version),
      raw,
    });

    if (typed) {
      if (typed.type === "employee_reference") {
        await assertEmployeeReferenceValid(Number(typed.value), params.organizationId);
      } else if (typed.type === "master_data_reference") {
        const domain = parsedOptions(field.version)?.masterDataDomain;
        if (!domain) throw new CustomFieldValidationError(`${field.version.label} has no master data domain configured`);
        await assertMasterDataValueValid(domain, String(typed.value), params.organizationId);
      }
    }
    prepared.push({ field, typed });
  }

  // Evaluate visibility against the state the record will be in AFTER this
  // write, so a field made applicable by another value in the same request is
  // accepted, and one made inapplicable is refused.
  const projected = new Map<string, unknown>();
  for (const f of fields) projected.set(f.definition.fieldKey, existing.get(f.definition.id)?.value ?? null);
  for (const p of prepared) projected.set(p.field.definition.fieldKey, p.typed);

  for (const p of prepared) {
    if (p.typed == null) continue; // clearing an inapplicable field is always fine
    if (!isFieldVisible(parsedVisibility(p.field.version), projected)) {
      throw new HiddenCustomFieldWriteError(p.field.version.label);
    }
  }

  let written = 0;
  let cleared = 0;
  await db.transaction(async (tx) => {
    for (const { field, typed } of prepared) {
      const current = existing.get(field.definition.id);
      if (typed == null) {
        if (current) {
          await tx.delete(customFieldValuesTable).where(eq(customFieldValuesTable.id, current.id));
          cleared += 1;
        }
        continue;
      }
      if (current) {
        await tx
          .update(customFieldValuesTable)
          .set({
            value: typed,
            // Re-stamp to the version in force at capture time.
            definitionVersionId: field.version.id,
            updatedByMembershipId: params.actorMembershipId,
          })
          .where(eq(customFieldValuesTable.id, current.id));
      } else {
        await tx.insert(customFieldValuesTable).values({
          organizationId: params.organizationId,
          definitionId: field.definition.id,
          definitionVersionId: field.version.id,
          scope: params.scope as CustomFieldValue["scope"],
          entityId: params.entityId,
          value: typed,
          createdByMembershipId: params.actorMembershipId,
          updatedByMembershipId: params.actorMembershipId,
        });
      }
      written += 1;
    }
  });

  return { written, cleared };
}

/**
 * Batch-loads values for MANY records in one query (§24.27's N+1 requirement) —
 * the path an employee list uses to render custom columns without one query
 * per field per row.
 */
export async function getValuesForEntities(
  organizationId: number,
  scope: string,
  entityIds: number[],
): Promise<Map<number, Map<number, CustomFieldValue>>> {
  const out = new Map<number, Map<number, CustomFieldValue>>();
  if (entityIds.length === 0) return out;

  const rows = await db
    .select()
    .from(customFieldValuesTable)
    .where(
      and(
        eq(customFieldValuesTable.organizationId, organizationId),
        eq(customFieldValuesTable.scope, scope as CustomFieldValue["scope"]),
        inArray(customFieldValuesTable.entityId, entityIds),
      ),
    );

  for (const row of rows) {
    let perEntity = out.get(row.entityId);
    if (!perEntity) {
      perEntity = new Map();
      out.set(row.entityId, perEntity);
    }
    perEntity.set(row.definitionId, row);
  }
  return out;
}

/**
 * §24.17 — report/export rows for a set of records. Sensitive fields are
 * excluded entirely unless the caller is authorized; there is no half-measure
 * where a masked value silently lands in a spreadsheet looking authoritative.
 */
export async function buildCustomFieldReport(params: {
  organizationId: number;
  scope: string;
  entityIds: number[];
  includeSensitive: boolean;
  definitionIds?: number[];
}): Promise<{ columns: { key: string; label: string }[]; rowsByEntity: Map<number, Record<string, string | number | boolean | null>> }> {
  requireScopeSpec(params.scope);
  let fields = await listCustomFields(params.organizationId, params.scope, { includeArchived: true });
  if (params.definitionIds?.length) {
    const wanted = new Set(params.definitionIds);
    fields = fields.filter((f) => wanted.has(f.definition.id));
  }
  if (!params.includeSensitive) fields = fields.filter((f) => f.version.sensitivity !== "sensitive");

  const values = await getValuesForEntities(params.organizationId, params.scope, params.entityIds);
  const columns = fields.map((f) => ({ key: `cf_${f.definition.fieldKey}`, label: f.version.label }));

  const rowsByEntity = new Map<number, Record<string, string | number | boolean | null>>();
  for (const entityId of params.entityIds) {
    const perEntity = values.get(entityId);
    const row: Record<string, string | number | boolean | null> = {};
    for (const f of fields) {
      row[`cf_${f.definition.fieldKey}`] = typedValueToReportCell(perEntity?.get(f.definition.id)?.value ?? null);
    }
    rowsByEntity.set(entityId, row);
  }
  return { columns, rowsByEntity };
}

/** Convenience for a single field read — used by the sensitive-reveal route. */
export async function getSingleValue(
  organizationId: number,
  definitionId: number,
  scope: string,
  entityId: number,
): Promise<{ field: CustomFieldWithVersion; stored: CustomFieldValue | null }> {
  const field = await getCustomField(organizationId, definitionId);
  const [stored] = await db
    .select()
    .from(customFieldValuesTable)
    .where(
      and(
        eq(customFieldValuesTable.definitionId, definitionId),
        eq(customFieldValuesTable.scope, scope as CustomFieldValue["scope"]),
        eq(customFieldValuesTable.entityId, entityId),
        eq(customFieldValuesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return { field, stored: stored ?? null };
}
