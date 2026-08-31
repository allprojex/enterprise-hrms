/**
 * WS-17 Pass 2 — reconciliation: comparing what the database references,
 * what storage actually holds, and what `stored_objects` records about it.
 *
 * STRICTLY READ-ONLY. Nothing in this file writes a row, registers metadata,
 * copies bytes or deletes anything. That is the point: an operator must be
 * able to see the truth before authorizing any mutation, and a reporting tool
 * that quietly repairs things is a tool nobody can trust to tell them what was
 * wrong.
 *
 * Every classification is derived from LIVE state on each run rather than
 * persisted. That is why this pass needs no migration-tracking table and no
 * migration `0073`: a previously failed copy simply shows up as pending again,
 * a half-finished one shows up as verifiable, and a crash leaves nothing stale
 * to clean up. State that is recomputed cannot go out of date.
 */
import { and, eq } from "drizzle-orm";
import { db, storedObjectsTable, type StoredObject } from "@workspace/db";
import { getStorageBackend, StorageObjectNotFoundError, type StorageBackend } from "../storage";
import { computeSha256 } from "../fileStorage";
import { listStorageReferences, type ReferenceScope, type StorageReference } from "./references";

/**
 * What reconciliation concluded about one object. Names are chosen so that
 * nothing unknown can be mistaken for healthy.
 */
export type ReconciliationStatus =
  /** Referenced, present in the authoritative backend, and registered with a checksum. */
  | "healthy"
  /** Referenced and present, but written before Pass 1 so it has no metadata. Registerable. */
  | "historical_unregistered"
  /** A business record points at bytes that are not there. Never fabricated. */
  | "missing_binary"
  /** Bytes exist with no business record pointing at them. Never auto-deleted. */
  | "orphan_binary"
  /** `stored_objects` knows an object no live business record references. */
  | "metadata_without_business_reference"
  /** Registered, but the digest has not been re-verified against the bytes. */
  | "checksum_unknown"
  /** Bytes re-read and matched the recorded digest. */
  | "checksum_verified"
  /** Bytes re-read and did NOT match. Blocks every migration. */
  | "checksum_mismatch"
  /** Eligible to copy to the destination backend; not yet copied or unverified. */
  | "migration_pending"
  /** Destination holds a byte-identical copy and is now authoritative. */
  | "migration_verified"
  /** A copy exists at the destination but does not match. Authority not switched. */
  | "migration_failed";

export interface ReconciliationItem {
  organizationId: number;
  storageKey: string;
  status: ReconciliationStatus;
  sourceKey: string | null;
  recordId: string | null;
  criticality: StorageReference["criticality"] | null;
  backend: StoredObject["backend"] | null;
  sizeBytes: number | null;
  registered: boolean;
  detail: string;
}

export interface ReconciliationReport {
  organizationId: number;
  /** The backend currently configured for this installation. */
  authoritativeBackend: string;
  destinationBackendKind: string | null;
  destinationHealthy: boolean | null;
  totals: Record<ReconciliationStatus, number>;
  totalReferences: number;
  totalRegistered: number;
  estimatedMigrationBytes: number;
  items: ReconciliationItem[];
  /** Always false here. Reconciliation never mutates. */
  mutated: false;
}

export interface ReconcileOptions extends ReferenceScope {
  /**
   * Re-read each present object and compare its bytes to the recorded digest.
   * Off by default because it is O(bytes), not O(rows).
   */
  verifyChecksums?: boolean;
  /**
   * A second backend to assess migration readiness against. Supplying it makes
   * reconciliation report migration_* statuses; omitting it keeps the report
   * purely about the current backend.
   */
  destination?: StorageBackend;
  /**
   * An alternate SOURCE backend for the legacy-upgrade case — e.g. a
   * filesystem rooted at a pre-Pass-0 `/app/uploads`. Operator configuration
   * only; never derived from tenant input.
   */
  source?: StorageBackend;
}

function emptyTotals(): Record<ReconciliationStatus, number> {
  return {
    healthy: 0,
    historical_unregistered: 0,
    missing_binary: 0,
    orphan_binary: 0,
    metadata_without_business_reference: 0,
    checksum_unknown: 0,
    checksum_verified: 0,
    checksum_mismatch: 0,
    migration_pending: 0,
    migration_verified: 0,
    migration_failed: 0,
  };
}

/**
 * Compares references, storage and metadata for one organization.
 *
 * Deliberately organization-scoped: there is no platform-wide sweep, so a
 * mistake is bounded by a tenant and an operator must name what they are
 * touching (§6).
 */
export async function reconcileStorage(options: ReconcileOptions): Promise<ReconciliationReport> {
  const source = options.source ?? getStorageBackend();
  const destination = options.destination ?? null;

  const references = await listStorageReferences(options);
  const registeredRows = await db
    .select()
    .from(storedObjectsTable)
    .where(eq(storedObjectsTable.organizationId, options.organizationId));

  const registeredByKey = new Map(registeredRows.map((row) => [row.storageKey, row]));
  const referencedKeys = new Set(references.map((r) => r.storageKey));

  const items: ReconciliationItem[] = [];
  const totals = emptyTotals();
  let estimatedMigrationBytes = 0;

  const record = (item: ReconciliationItem) => {
    items.push(item);
    totals[item.status] += 1;
  };

  for (const ref of references) {
    const registered = registeredByKey.get(ref.storageKey) ?? null;
    const stat = await source.stat(ref.organizationId, ref.storageKey);

    if (!stat) {
      // A record points somewhere empty. This is reported, never repaired and
      // never regenerated — only the owning module could decide a replacement
      // is legally equivalent, and this tool is not that module.
      record({
        organizationId: ref.organizationId,
        storageKey: ref.storageKey,
        status: "missing_binary",
        sourceKey: ref.sourceKey,
        recordId: ref.recordId,
        criticality: ref.criticality,
        backend: registered?.backend ?? null,
        sizeBytes: null,
        registered: registered !== null,
        detail:
          ref.criticality === "authoritative"
            ? "authoritative binary is absent — business/legal data may be lost"
            : `binary is absent (${ref.criticality})`,
      });
      continue;
    }

    if (!registered) {
      record({
        organizationId: ref.organizationId,
        storageKey: ref.storageKey,
        status: "historical_unregistered",
        sourceKey: ref.sourceKey,
        recordId: ref.recordId,
        criticality: ref.criticality,
        backend: null,
        sizeBytes: stat.sizeBytes,
        registered: false,
        detail: "present and referenced, but written before Pass 1 — no checksum recorded",
      });
      continue;
    }

    // Optional deep verification of the object against its recorded digest.
    let checksumStatus: ReconciliationStatus | null = null;
    let checksumDetail = "digest recorded but not re-verified in this run";
    if (options.verifyChecksums) {
      try {
        const bytes = await source.read(ref.organizationId, ref.storageKey);
        const actual = computeSha256(bytes);
        if (actual === registered.checksumSha256) {
          checksumStatus = "checksum_verified";
          checksumDetail = "bytes match the recorded digest";
        } else {
          checksumStatus = "checksum_mismatch";
          checksumDetail = "bytes DO NOT match the recorded digest — content has changed or is corrupt";
        }
      } catch (err) {
        checksumStatus = err instanceof StorageObjectNotFoundError ? "missing_binary" : "checksum_unknown";
        checksumDetail = "could not read object to verify digest";
      }
    }

    // A mismatch outranks everything: it must never migrate, and it must never
    // be reported as healthy just because a copy happens to exist somewhere.
    if (checksumStatus === "checksum_mismatch" || checksumStatus === "missing_binary") {
      record({
        organizationId: ref.organizationId,
        storageKey: ref.storageKey,
        status: checksumStatus,
        sourceKey: ref.sourceKey,
        recordId: ref.recordId,
        criticality: ref.criticality,
        backend: registered.backend,
        sizeBytes: stat.sizeBytes,
        registered: true,
        detail: checksumDetail,
      });
      continue;
    }

    if (destination) {
      const alreadyThere = registered.backend === destination.kind;
      if (alreadyThere) {
        record({
          organizationId: ref.organizationId,
          storageKey: ref.storageKey,
          status: "migration_verified",
          sourceKey: ref.sourceKey,
          recordId: ref.recordId,
          criticality: ref.criticality,
          backend: registered.backend,
          sizeBytes: stat.sizeBytes,
          registered: true,
          detail: "already authoritative on the destination backend",
        });
        continue;
      }

      // A copy may already exist from an interrupted run. Its presence alone
      // proves nothing — only a digest match does.
      const destStat = await destination.stat(ref.organizationId, ref.storageKey);
      if (destStat) {
        const destBytes = await destination.read(ref.organizationId, ref.storageKey);
        const destDigest = computeSha256(destBytes);
        const matches = destDigest === registered.checksumSha256;
        record({
          organizationId: ref.organizationId,
          storageKey: ref.storageKey,
          status: matches ? "migration_pending" : "migration_failed",
          sourceKey: ref.sourceKey,
          recordId: ref.recordId,
          criticality: ref.criticality,
          backend: registered.backend,
          sizeBytes: stat.sizeBytes,
          registered: true,
          detail: matches
            ? "verified copy exists at destination; authority not yet switched (resumable)"
            : "destination copy does NOT match the source digest — authority must not switch",
        });
        if (matches) estimatedMigrationBytes += stat.sizeBytes;
        continue;
      }

      record({
        organizationId: ref.organizationId,
        storageKey: ref.storageKey,
        status: "migration_pending",
        sourceKey: ref.sourceKey,
        recordId: ref.recordId,
        criticality: ref.criticality,
        backend: registered.backend,
        sizeBytes: stat.sizeBytes,
        registered: true,
        detail: "eligible to copy to the destination backend",
      });
      estimatedMigrationBytes += stat.sizeBytes;
      continue;
    }

    record({
      organizationId: ref.organizationId,
      storageKey: ref.storageKey,
      status: checksumStatus ?? "healthy",
      sourceKey: ref.sourceKey,
      recordId: ref.recordId,
      criticality: ref.criticality,
      backend: registered.backend,
      sizeBytes: stat.sizeBytes,
      registered: true,
      detail: checksumStatus ? checksumDetail : "referenced, present and registered",
    });
  }

  // Metadata rows whose business reference has gone. Distinct from an orphan
  // binary: here the platform knows about an object nothing points at, which
  // is a different investigation from finding unexplained bytes on disk.
  for (const row of registeredRows) {
    if (referencedKeys.has(row.storageKey)) continue;
    if (row.status === "deleted") continue; // intentionally removed; not a finding
    record({
      organizationId: row.organizationId,
      storageKey: row.storageKey,
      status: "metadata_without_business_reference",
      sourceKey: null,
      recordId: null,
      criticality: null,
      backend: row.backend,
      sizeBytes: row.sizeBytes,
      registered: true,
      detail:
        row.status === "delete_failed"
          ? "physical deletion previously failed — bytes may still exist"
          : row.status === "orphaned"
            ? "written but its business transaction failed — nothing references it"
            : "registered object with no live business reference",
    });
  }

  const destinationHealth = destination ? await destination.health() : null;

  return {
    organizationId: options.organizationId,
    authoritativeBackend: source.kind,
    destinationBackendKind: destination?.kind ?? null,
    destinationHealthy: destinationHealth?.healthy ?? null,
    totals,
    totalReferences: references.length,
    totalRegistered: registeredRows.length,
    estimatedMigrationBytes,
    items,
    mutated: false,
  };
}

/**
 * Physical objects with no business reference at all.
 *
 * Separated from `reconcileStorage` because it needs to enumerate storage
 * rather than the database, which only the filesystem backend can do cheaply
 * and safely. **Nothing is ever deleted here** — an apparently orphaned file
 * may simply reflect a reference source this registry does not yet know about,
 * which is exactly why cleanup requires its own authorization (§17).
 */
export async function findOrphanBinaries(params: {
  organizationId: number;
  /** Absolute root to enumerate. Operator configuration, never tenant input. */
  root: string;
}): Promise<{ storageKey: string; sizeBytes: number }[]> {
  const { readdir, stat } = await import("fs/promises");
  const path = await import("path");

  const orgRoot = path.join(params.root, "organizations", String(params.organizationId));
  const found: { storageKey: string; sizeBytes: number }[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // no tree for this organization is a valid, empty answer
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const info = await stat(full);
      const key = prefix ? `${prefix}/${entry}` : entry;
      if (info.isDirectory()) await walk(full, key);
      else found.push({ storageKey: key, sizeBytes: info.size });
    }
  }

  await walk(orgRoot, "");

  const references = await listStorageReferences({ organizationId: params.organizationId });
  const referenced = new Set(references.map((r) => r.storageKey));
  return found.filter((f) => !referenced.has(f.storageKey));
}
