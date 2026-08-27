/**
 * WS-7 (§10) — column mapping between a source file's own headers and an
 * entity adapter's canonical fields.
 *
 * Auto-mapping is deliberately conservative ("auto-map only when
 * confident"): a source header maps automatically only when its normalized
 * form matches exactly ONE canonical field's key or alias. An ambiguous
 * header (matching two fields) or an unrecognized one is left unmapped for
 * a human to resolve in the mapping UI — never guessed, never fuzzy-matched.
 * A wrong silent mapping in a bulk import is far more damaging than an
 * unmapped column the user must click once.
 */
import type { EntityAdapter } from "./adapterRegistry";

/** Source header -> canonical field key. A header absent from this map is ignored at staging time. */
export type ColumnMapping = Record<string, string>;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export interface AutoMapResult {
  mapping: ColumnMapping;
  /** Headers that matched nothing, or matched more than one field — surfaced to the user, never auto-resolved. */
  unmappedHeaders: string[];
  /** Canonical fields marked `required` that no header mapped to. */
  missingRequiredFields: string[];
}

export function autoMapColumns(adapter: EntityAdapter, headers: readonly string[]): AutoMapResult {
  // Build normalized-token -> field keys. A token owned by more than one
  // field is ambiguous and is excluded from auto-mapping entirely.
  const candidatesByToken = new Map<string, Set<string>>();
  for (const field of adapter.fields) {
    for (const token of [field.key, field.label, ...field.aliases]) {
      const normalized = normalizeHeader(token);
      if (!normalized) continue;
      const existing = candidatesByToken.get(normalized);
      if (existing) existing.add(field.key);
      else candidatesByToken.set(normalized, new Set([field.key]));
    }
  }

  const mapping: ColumnMapping = {};
  const unmappedHeaders: string[] = [];
  const claimedFields = new Set<string>();

  for (const header of headers) {
    const candidates = candidatesByToken.get(normalizeHeader(header));
    // Unrecognized, ambiguous across fields, or the field is already claimed
    // by an earlier column (a duplicate header) — all left for the human.
    if (!candidates || candidates.size !== 1) {
      unmappedHeaders.push(header);
      continue;
    }
    const fieldKey = [...candidates][0];
    if (claimedFields.has(fieldKey)) {
      unmappedHeaders.push(header);
      continue;
    }
    claimedFields.add(fieldKey);
    mapping[header] = fieldKey;
  }

  const missingRequiredFields = adapter.fields.filter((f) => f.required && !claimedFields.has(f.key)).map((f) => f.key);

  return { mapping, unmappedHeaders, missingRequiredFields };
}

export class InvalidColumnMappingError extends Error {}

/**
 * Validates a user-supplied mapping before it is persisted: every target
 * must be a real canonical field of THIS adapter (never arbitrary
 * client-chosen text, which would otherwise flow into `normalizeRow`'s
 * input object), no field may be mapped twice, and every required field
 * must be covered.
 */
export function assertValidColumnMapping(adapter: EntityAdapter, headers: readonly string[], mapping: ColumnMapping): void {
  const fieldKeys = new Set(adapter.fields.map((f) => f.key));
  const headerSet = new Set(headers);
  const seenFields = new Set<string>();

  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!headerSet.has(header)) throw new InvalidColumnMappingError(`Column "${header}" is not present in this file`);
    if (!fieldKeys.has(fieldKey)) throw new InvalidColumnMappingError(`"${fieldKey}" is not a valid field for ${adapter.label}`);
    if (seenFields.has(fieldKey)) throw new InvalidColumnMappingError(`Field "${fieldKey}" is mapped from more than one column`);
    seenFields.add(fieldKey);
  }

  const missing = adapter.fields.filter((f) => f.required && !seenFields.has(f.key)).map((f) => f.label);
  if (missing.length > 0) throw new InvalidColumnMappingError(`These required fields are not mapped: ${missing.join(", ")}`);
}

/** Projects one raw file row into `{ canonicalFieldKey: cellValue }` for `normalizeRow`. Unmapped columns are dropped. */
export function applyMapping(headers: readonly string[], row: readonly string[], mapping: ColumnMapping): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((header, index) => {
    const fieldKey = mapping[header];
    if (fieldKey) result[fieldKey] = row[index] ?? "";
  });
  return result;
}
