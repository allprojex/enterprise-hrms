/**
 * WS-17 File Storage Durability, Pass 2 — the canonical registry of business
 * records that reference a stored binary.
 *
 * ONE registry, deliberately. Nine tables across a dozen modules hold storage
 * keys, and the alternative — a bespoke migration query per module — would
 * scatter twelve subtly different definitions of "which files matter" that
 * would then drift apart. Every reconciliation and migration operation in this
 * pass reads from here, so adding a tenth source is one entry, not a new
 * migration script.
 *
 * WHAT THIS REGISTRY DOES NOT DO
 *
 * It does not duplicate business records. It resolves the minimum needed to
 * find a binary and decide how carefully to treat it — organization, storage
 * key, which source it came from, and whether losing the bytes is recoverable.
 * Titles, owners, categories, confidentiality classifications and retention
 * bases stay in the owning module's tables, exactly as WS-5 and every module
 * freeze require.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * How much a missing binary costs.
 *
 *   authoritative  — the bytes ARE the record. A signed contract, an uploaded
 *                    résumé, a piece of disciplinary evidence. Losing them
 *                    loses business/legal data that cannot be recreated.
 *   reconstructable — deterministically producible again from data still in
 *                    the database (a generated PDF from a template plus its
 *                    source record). Still worth migrating; not a catastrophe
 *                    if absent. Regeneration is NOT performed by this pass —
 *                    only the owning module may decide that is safe.
 *   replaceable     — a convenience asset whose absence degrades presentation
 *                    only (avatar, logo). Notably these can CHANGE under a
 *                    stable business record, which is why §20's race matters.
 */
export type ReferenceCriticality = "authoritative" | "reconstructable" | "replaceable";

export interface StorageReferenceSource {
  /** Stable identifier used in reports and scoping. */
  readonly key: string;
  readonly table: string;
  readonly criticality: ReferenceCriticality;
  /**
   * True when the binary a record points at may be REPLACED while the record
   * keeps its identity — the logo and avatar cases. Migration must never let
   * an older copy overwrite a newer current one (§20).
   */
  readonly mutableBinary: boolean;
  /** Resolves every (organizationId, storageKey) this source currently references. */
  list(scope: ReferenceScope): Promise<StorageReference[]>;
}

export interface ReferenceScope {
  /** Required. There is deliberately no platform-wide "everything" mode (§6). */
  organizationId: number;
  /** Optional narrowing to one source, by its `key`. */
  sourceKey?: string;
  limit?: number;
}

export interface StorageReference {
  organizationId: number;
  storageKey: string;
  sourceKey: string;
  /** The owning row's id, for operator diagnostics. Never its contents. */
  recordId: string;
  criticality: ReferenceCriticality;
  mutableBinary: boolean;
}

/**
 * Raw SQL per source rather than the query builder: this reads NINE unrelated
 * tables that share no Drizzle relation, and each needs only two columns. A
 * uniform `select ... where organization_id = $1 and <key> is not null` keeps
 * every source's definition visible on one line and identical in shape.
 * Identifiers are hard-coded literals in this file — never interpolated from
 * caller input — and the only bound value is the organization id.
 */
function simpleSource(config: {
  key: string;
  table: string;
  keyColumn: string;
  idColumn?: string;
  criticality: ReferenceCriticality;
  mutableBinary?: boolean;
  /** Extra fixed predicate, e.g. excluding soft-deleted rows. */
  extraWhere?: string;
}): StorageReferenceSource {
  const idColumn = config.idColumn ?? "id";
  return {
    key: config.key,
    table: config.table,
    criticality: config.criticality,
    mutableBinary: config.mutableBinary ?? false,
    async list(scope) {
      const limitClause = scope.limit ? ` limit ${Math.max(1, Math.floor(scope.limit))}` : "";
      const extra = config.extraWhere ? ` and ${config.extraWhere}` : "";
      const rows = await db.execute(
        sql.raw(
          `select ${idColumn}::text as record_id, ${config.keyColumn} as storage_key ` +
            `from ${config.table} ` +
            `where organization_id = ${Math.floor(scope.organizationId)} ` +
            `and ${config.keyColumn} is not null and ${config.keyColumn} <> ''${extra}` +
            limitClause,
        ),
      );
      const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
      return (list as { record_id: string; storage_key: string }[]).map((row) => ({
        organizationId: scope.organizationId,
        storageKey: row.storage_key,
        sourceKey: config.key,
        recordId: row.record_id,
        criticality: config.criticality,
        mutableBinary: config.mutableBinary ?? false,
      }));
    },
  };
}

/**
 * The organization logo is the one source whose storage key is not stored in a
 * key column. `organizations.logoUrl` encodes it as
 * `/api/organizations/:id/logo/:filename`, and the physical key is
 * `branding/<filename>` — see routes/organizationLogo.ts, which is the
 * authority for both facts. Reconstructing it here rather than adding a column
 * keeps that route's own deliberate decision intact.
 */
const LOGO_SUBDIR = "branding";

const logoSource: StorageReferenceSource = {
  key: "organization_logo",
  table: "organizations",
  criticality: "replaceable",
  mutableBinary: true,
  async list(scope) {
    const rows = await db.execute(
      sql.raw(
        `select id::text as record_id, logo_url from organizations ` +
          `where id = ${Math.floor(scope.organizationId)} and logo_url is not null and logo_url <> ''`,
      ),
    );
    const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return (list as { record_id: string; logo_url: string }[])
      .map((row): StorageReference | null => {
        const filename = row.logo_url.split("/").pop() ?? "";
        // Only the exact shape that route produces and serves. Anything else
        // is not a logo key and is left alone rather than guessed at.
        if (!/^[a-f0-9]{48}\.(png|webp|jpg)$/.test(filename)) return null;
        return {
          organizationId: scope.organizationId,
          storageKey: `${LOGO_SUBDIR}/${filename}`,
          sourceKey: "organization_logo",
          recordId: row.record_id,
          criticality: "replaceable" as const,
          mutableBinary: true,
        };
      })
      .filter((r): r is StorageReference => r !== null);
  },
};

/**
 * Every business source that references a stored binary at HEAD, verified
 * against the schema rather than remembered.
 *
 * `employee_documents` is deliberately one entry even though Assets, Learning
 * evidence and Performance evidence all write through it — they share that
 * table, so they share one reference source. `pre_employment_requirements`
 * appears nowhere: it holds no storage key, despite an earlier grep suggesting
 * otherwise.
 */
export const STORAGE_REFERENCE_SOURCES: readonly StorageReferenceSource[] = [
  simpleSource({
    key: "organization_document_version",
    table: "organization_document_versions",
    keyColumn: "storage_key",
    criticality: "authoritative",
  }),
  simpleSource({
    key: "employee_document",
    table: "employee_documents",
    keyColumn: "storage_key",
    criticality: "authoritative",
  }),
  simpleSource({
    key: "candidate_document",
    table: "candidate_documents",
    keyColumn: "storage_key",
    criticality: "authoritative",
  }),
  simpleSource({
    key: "background_check",
    table: "background_checks",
    keyColumn: "document_storage_key",
    criticality: "authoritative",
  }),
  // Generated from a template plus a live record, so reproducible in
  // principle — but this pass never regenerates anything, because only the
  // owning module may decide regeneration is safe and legally equivalent.
  simpleSource({
    key: "generated_document",
    table: "generated_documents",
    keyColumn: "storage_key",
    criticality: "reconstructable",
  }),
  simpleSource({
    key: "offer_version",
    table: "offer_versions",
    keyColumn: "generated_document_storage_key",
    criticality: "reconstructable",
  }),
  // The bulk-import source file. Operational rather than HR content, and the
  // only class that already carries its own sha256 digest (WS-7).
  simpleSource({
    key: "migration_source",
    table: "migration_sources",
    keyColumn: "storage_key",
    criticality: "reconstructable",
  }),
  simpleSource({
    key: "employee_profile_picture",
    table: "employees",
    keyColumn: "profile_picture_key",
    criticality: "replaceable",
    mutableBinary: true,
  }),
  logoSource,
];

/** Every reference in scope, deduplicated by (organizationId, storageKey). */
export async function listStorageReferences(scope: ReferenceScope): Promise<StorageReference[]> {
  const sources = scope.sourceKey
    ? STORAGE_REFERENCE_SOURCES.filter((s) => s.key === scope.sourceKey)
    : STORAGE_REFERENCE_SOURCES;

  const collected: StorageReference[] = [];
  for (const source of sources) {
    collected.push(...(await source.list(scope)));
  }

  // A key referenced twice is one binary. Keep the most critical view of it,
  // so a file shared between a reconstructable and an authoritative reference
  // is never treated as the lesser of the two.
  const rank: Record<ReferenceCriticality, number> = { replaceable: 0, reconstructable: 1, authoritative: 2 };
  const byKey = new Map<string, StorageReference>();
  for (const ref of collected) {
    const id = `${ref.organizationId}::${ref.storageKey}`;
    const existing = byKey.get(id);
    if (!existing || rank[ref.criticality] > rank[existing.criticality]) byKey.set(id, ref);
  }
  return [...byKey.values()];
}
