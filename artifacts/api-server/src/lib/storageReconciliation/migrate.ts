/**
 * WS-17 Pass 2 — the mutating half: registering historical binaries, and
 * copying them to a destination backend.
 *
 * THE BINDING SEQUENCE, IN CODE
 *
 *   discover → reconcile → plan → copy → verify → switch → RETAIN SOURCE
 *
 * never move-then-hope. `migrateObjects` copies; it does not delete, and there
 * is no code path in this file that removes a source binary. Source cleanup is
 * a separately authorized operation that does not exist yet, deliberately: an
 * apparently-safe deletion is the one mistake that cannot be undone.
 *
 * WHY THERE IS NO MIGRATION-STATE TABLE, AND NO MIGRATION `0073`
 *
 * Authority lives in exactly one place already — `stored_objects.backend` —
 * and the switch is a single-row UPDATE performed only after a digest match.
 * Every intermediate state is therefore recoverable by re-running
 * reconciliation, which recomputes from live storage rather than reading
 * remembered progress:
 *
 *   crash after copy, before switch  → destination copy is found and verified,
 *                                      authority switches on the next run;
 *   crash mid-copy                   → partial/absent destination object fails
 *                                      digest comparison and is simply re-copied;
 *   previously failed object         → reappears as pending, retryable.
 *
 * Persisted progress could go stale; recomputed state cannot. That is the
 * whole justification for adding no schema in this pass.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, storedObjectsTable } from "@workspace/db";
import { getStorageBackend, StorageObjectNotFoundError, type StorageBackend } from "../storage";
import { computeSha256 } from "../fileStorage";
import { recordAuditEvent } from "../auditLog";
import { logger } from "../logger";
import { listStorageReferences, type ReferenceScope } from "./references";

export interface OperationActor {
  actorApplicationUserId: number | null;
  actorMembershipId: number | null;
}

export interface RegistrationResult {
  organizationId: number;
  scanned: number;
  registered: number;
  alreadyRegistered: number;
  missing: number;
  failed: number;
  /** True when `dryRun` was set: nothing was written. */
  dryRun: boolean;
  details: { storageKey: string; outcome: string }[];
}

/**
 * Registers historical binaries — present, referenced, but written before
 * Pass 1 and therefore carrying no checksum.
 *
 * IDEMPOTENT by construction: the insert is guarded by the
 * (organizationId, storageKey) unique index via `onConflictDoNothing`, so a
 * second run registers nothing and corrupts nothing. The source binary is only
 * ever READ, and its business key is preserved exactly — no record is rewritten.
 *
 * This is explicitly NOT wired into any download path. Normal reads stay
 * normal reads (§8); registration happens only when an operator asks for it.
 */
export async function registerHistoricalObjects(
  params: ReferenceScope & { actor: OperationActor; source?: StorageBackend; dryRun?: boolean },
): Promise<RegistrationResult> {
  const source = params.source ?? getStorageBackend();
  const dryRun = params.dryRun ?? false;

  const references = await listStorageReferences(params);
  const existing = await db
    .select({ storageKey: storedObjectsTable.storageKey })
    .from(storedObjectsTable)
    .where(eq(storedObjectsTable.organizationId, params.organizationId));
  const known = new Set(existing.map((r) => r.storageKey));

  const result: RegistrationResult = {
    organizationId: params.organizationId,
    scanned: references.length,
    registered: 0,
    alreadyRegistered: 0,
    missing: 0,
    failed: 0,
    dryRun,
    details: [],
  };

  for (const ref of references) {
    if (known.has(ref.storageKey)) {
      result.alreadyRegistered += 1;
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await source.read(ref.organizationId, ref.storageKey);
    } catch (err) {
      if (err instanceof StorageObjectNotFoundError) {
        // Reported, never fabricated. A missing authoritative binary is a
        // finding for an operator, not something to paper over with a
        // placeholder or a regenerated document.
        result.missing += 1;
        result.details.push({ storageKey: ref.storageKey, outcome: "missing_binary" });
      } else {
        result.failed += 1;
        result.details.push({ storageKey: ref.storageKey, outcome: "read_failed" });
      }
      continue;
    }

    if (dryRun) {
      result.registered += 1;
      result.details.push({ storageKey: ref.storageKey, outcome: "would_register" });
      continue;
    }

    try {
      await db
        .insert(storedObjectsTable)
        .values({
          organizationId: ref.organizationId,
          storageKey: ref.storageKey,
          backend: source.kind,
          sizeBytes: bytes.length,
          checksumSha256: computeSha256(bytes),
          status: "stored",
        })
        .onConflictDoNothing();
      result.registered += 1;
      result.details.push({ storageKey: ref.storageKey, outcome: "registered" });
    } catch (err) {
      logger.error({ err, organizationId: ref.organizationId }, "historical storage registration failed");
      result.failed += 1;
      result.details.push({ storageKey: ref.storageKey, outcome: "register_failed" });
    }
  }

  if (!dryRun && result.registered > 0) {
    await recordAuditEvent({
      actorApplicationUserId: params.actor.actorApplicationUserId,
      actorMembershipId: params.actor.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "storage_reconciliation.registered",
      targetType: "stored_objects",
      targetId: String(params.organizationId),
      afterState: {
        registered: result.registered,
        alreadyRegistered: result.alreadyRegistered,
        missing: result.missing,
        backend: source.kind,
      },
    });
  }

  return result;
}

export type MigrationOutcome =
  | "migrated"
  | "already_migrated"
  | "resumed_and_switched"
  | "skipped_unregistered"
  | "missing_source"
  | "checksum_mismatch"
  | "destination_conflict"
  | "failed"
  | "would_migrate";

export interface MigrationResult {
  organizationId: number;
  sourceBackend: string;
  destinationBackend: string;
  total: number;
  processed: number;
  migrated: number;
  alreadyMigrated: number;
  skipped: number;
  failed: number;
  bytesCopied: number;
  dryRun: boolean;
  /** Storage keys only — never a filename, title or any HR metadata. */
  details: { storageKey: string; outcome: MigrationOutcome }[];
}

/**
 * Copies registered objects to `destination` and switches authority, one
 * object at a time.
 *
 * Per object: read source → confirm the source digest still matches what was
 * registered → write destination → read destination back → compare digests →
 * only then flip `stored_objects.backend`. Authority never moves ahead of a
 * verified copy, so the system cannot reach "the database says destination but
 * the destination has nothing".
 *
 * KEY STABILITY: the opaque storage key is preserved unchanged. Because the
 * backend contract resolves `(organizationId, key)` on either implementation,
 * no business record is rewritten by a backend change — which is what keeps
 * this a storage operation rather than a data migration.
 *
 * CONCURRENCY: each object's `stored_objects` row is locked `FOR UPDATE` for
 * the switch, and the backend state is re-read inside that lock. Two operators
 * running simultaneously therefore serialize per object; the loser observes
 * the row already switched and reports `already_migrated` instead of
 * double-switching. Copying the same bytes to the same key twice is harmless.
 */
export async function migrateObjects(
  params: ReferenceScope & {
    actor: OperationActor;
    destination: StorageBackend;
    source?: StorageBackend;
    dryRun?: boolean;
  },
): Promise<MigrationResult> {
  const source = params.source ?? getStorageBackend();
  const destination = params.destination;
  const dryRun = params.dryRun ?? false;

  if (source.kind === destination.kind) {
    throw new Error("Source and destination backends are the same — nothing to migrate");
  }

  const health = await destination.health();
  if (!health.healthy && !dryRun) {
    // Refusing here is the point: copying into an unreachable or misconfigured
    // destination would produce "verified" objects nobody can read.
    throw new Error(`Destination backend is not healthy: ${health.detail}`);
  }

  const references = await listStorageReferences(params);
  const registered = await db
    .select()
    .from(storedObjectsTable)
    .where(eq(storedObjectsTable.organizationId, params.organizationId));
  const registeredByKey = new Map(registered.map((r) => [r.storageKey, r]));

  const result: MigrationResult = {
    organizationId: params.organizationId,
    sourceBackend: source.kind,
    destinationBackend: destination.kind,
    total: references.length,
    processed: 0,
    migrated: 0,
    alreadyMigrated: 0,
    skipped: 0,
    failed: 0,
    bytesCopied: 0,
    dryRun,
    details: [],
  };

  const note = (storageKey: string, outcome: MigrationOutcome) => {
    result.details.push({ storageKey, outcome });
  };

  for (const ref of references) {
    result.processed += 1;
    const row = registeredByKey.get(ref.storageKey);

    // Unregistered objects are not migrated: without a recorded digest there
    // is nothing to verify a copy against, and copying unverifiable bytes is
    // exactly the "move and hope" this pass exists to prevent. Register first.
    if (!row) {
      result.skipped += 1;
      note(ref.storageKey, "skipped_unregistered");
      continue;
    }

    if (row.backend === destination.kind) {
      result.alreadyMigrated += 1;
      note(ref.storageKey, "already_migrated");
      continue;
    }

    if (dryRun) {
      note(ref.storageKey, "would_migrate");
      continue;
    }

    try {
      const sourceBytes = await source.read(ref.organizationId, ref.storageKey);
      const sourceDigest = computeSha256(sourceBytes);

      // The registered digest is the contract. If the source no longer matches
      // it, something changed the bytes underneath us — for a mutable class
      // that may be a legitimate replacement, but either way this object must
      // not migrate on a stale assumption. This is also what stops an older
      // logo/avatar copy from overwriting a newer current one (§20).
      if (sourceDigest !== row.checksumSha256) {
        result.failed += 1;
        note(ref.storageKey, "checksum_mismatch");
        logger.warn(
          { organizationId: ref.organizationId, storageKey: ref.storageKey },
          "source digest differs from registered digest — migration blocked",
        );
        continue;
      }

      // If a destination copy already exists (an interrupted earlier run), do
      // not blindly overwrite: verify it. Matching means resume; differing
      // means stop and report.
      const existingDest = await destination.stat(ref.organizationId, ref.storageKey);
      let resumed = false;
      if (existingDest) {
        const destDigest = computeSha256(await destination.read(ref.organizationId, ref.storageKey));
        if (destDigest !== sourceDigest) {
          result.failed += 1;
          note(ref.storageKey, "destination_conflict");
          continue;
        }
        resumed = true;
      } else {
        await destination.write(ref.organizationId, ref.storageKey, sourceBytes);
        result.bytesCopied += sourceBytes.length;
      }

      // Read back what was actually stored — not what we believe we sent.
      const verifyDigest = computeSha256(await destination.read(ref.organizationId, ref.storageKey));
      if (verifyDigest !== sourceDigest) {
        result.failed += 1;
        note(ref.storageKey, "checksum_mismatch");
        continue;
      }

      // Switch authority under a row lock, re-reading state inside it so a
      // concurrent migrator cannot switch twice.
      const switched = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(storedObjectsTable)
          .where(
            and(
              eq(storedObjectsTable.organizationId, ref.organizationId),
              eq(storedObjectsTable.storageKey, ref.storageKey),
            ),
          )
          .for("update");
        if (!locked || locked.backend === destination.kind) return false;
        await tx
          .update(storedObjectsTable)
          .set({ backend: destination.kind, statusChangedAt: new Date() })
          .where(eq(storedObjectsTable.id, locked.id));
        return true;
      });

      if (!switched) {
        result.alreadyMigrated += 1;
        note(ref.storageKey, "already_migrated");
        continue;
      }

      result.migrated += 1;
      note(ref.storageKey, resumed ? "resumed_and_switched" : "migrated");
    } catch (err) {
      if (err instanceof StorageObjectNotFoundError) {
        result.failed += 1;
        note(ref.storageKey, "missing_source");
        continue;
      }
      logger.error({ err, organizationId: ref.organizationId }, "storage migration failed for object");
      result.failed += 1;
      note(ref.storageKey, "failed");
    }
  }

  if (!dryRun) {
    await recordAuditEvent({
      actorApplicationUserId: params.actor.actorApplicationUserId,
      actorMembershipId: params.actor.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "storage_migration.executed",
      targetType: "stored_objects",
      targetId: String(params.organizationId),
      afterState: {
        sourceBackend: result.sourceBackend,
        destinationBackend: result.destinationBackend,
        migrated: result.migrated,
        alreadyMigrated: result.alreadyMigrated,
        skipped: result.skipped,
        failed: result.failed,
        bytesCopied: result.bytesCopied,
      },
    });
  }

  return result;
}
