/**
 * Organization-scoped private storage for authoritative binaries — employee
 * and organization documents, evidence files, generated PDFs, résumés,
 * avatars, bulk-import sources. Twelve modules write through it.
 *
 * The three exported functions keep the exact signatures they have always
 * had, so no business module changed in WS-17 Pass 1. What changed is what
 * sits underneath: instead of calling `fs` directly, they now delegate to the
 * configured provider-neutral backend (`lib/storage`), which is a filesystem
 * by default and can be an S3-compatible object store by installation
 * configuration. Callers still know only an organization id and an opaque
 * key, and still never see a path, bucket, endpoint or credential.
 *
 * Files are never served directly by static middleware; they are readable
 * only through authenticated, permission-checked routes. Storage access is
 * not authorization and never becomes it.
 *
 * WS-17 Pass 1 additions, both of which exist to make failure and corruption
 * VISIBLE rather than to change any business behaviour:
 *
 *   - every new write records a `stored_objects` row carrying the backend,
 *     size and a SHA-256 computed once from the buffer already in memory;
 *   - a physical delete that FAILS is now recorded instead of swallowed.
 *
 * Files written before Pass 1 have no `stored_objects` row. They remain fully
 * readable, they are never backfilled, and nothing here writes to the database
 * during a read — their integrity is honestly reported as unknown rather than
 * invented.
 */
import { createHash, randomBytes } from "crypto";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, storedObjectsTable } from "@workspace/db";
import { getStorageBackend, StorageOperationError } from "./storage";
import { logger } from "./logger";

/** Random, unguessable filename — never derived from user-supplied input. */
export function generateStorageFilename(extension: string): string {
  return `${randomBytes(24).toString("hex")}.${extension}`;
}

/** Lower-case hex SHA-256 of a buffer already in memory. Never re-reads the object. */
export function computeSha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Records the persistence facts for a freshly written object. Deliberately
 * best-effort: the bytes are already safely stored, so failing the caller's
 * upload because bookkeeping failed would turn a healthy write into a user-
 * visible error and lose the file to the compensating-delete path. The
 * failure is logged loudly instead, and reconciliation can find the object by
 * its absence here.
 */
async function recordStoredObject(params: {
  organizationId: number;
  storageKey: string;
  sizeBytes: number;
  checksumSha256: string;
}): Promise<void> {
  try {
    await db
      .insert(storedObjectsTable)
      .values({
        organizationId: params.organizationId,
        storageKey: params.storageKey,
        backend: getStorageBackend().kind,
        sizeBytes: params.sizeBytes,
        checksumSha256: params.checksumSha256,
        status: "stored",
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.error({ err, organizationId: params.organizationId }, "failed to record stored object metadata");
  }
}

/** Moves an object's recorded status, if it has a record. Never creates one. */
async function markStoredObject(
  organizationId: number,
  storageKey: string,
  status: "deleted" | "delete_failed" | "orphaned",
  detail: string,
): Promise<void> {
  try {
    await db
      .update(storedObjectsTable)
      .set({ status, statusChangedAt: new Date(), statusDetail: detail })
      .where(
        and(eq(storedObjectsTable.organizationId, organizationId), eq(storedObjectsTable.storageKey, storageKey)),
      );
  } catch (err) {
    logger.error({ err, organizationId }, "failed to update stored object status");
  }
}

/**
 * Writes a buffer under an organization's private storage and returns the
 * storage key to persist in the database. `subdir` must be a fixed,
 * code-controlled literal (e.g. "avatars") — never client input; the filename
 * itself is always freshly generated, so there is no path-traversal surface
 * as long as callers respect that.
 *
 * Throws if the bytes could not be stored, so a caller never records metadata
 * for an object that does not exist.
 */
export async function writeOrgFile(
  organizationId: number,
  subdir: string,
  extension: string,
  data: Buffer,
): Promise<string> {
  const key = path.posix.join(subdir, generateStorageFilename(extension));
  await getStorageBackend().write(organizationId, key, data);
  await recordStoredObject({
    organizationId,
    storageKey: key,
    sizeBytes: data.length,
    checksumSha256: computeSha256(data),
  });
  return key;
}

/** Reads a previously-stored file by its key (as read from the database, never from a request param). */
export async function readOrgFile(organizationId: number, key: string): Promise<Buffer> {
  return getStorageBackend().read(organizationId, key);
}

/**
 * Deletes a stored file.
 *
 * Business semantics are unchanged and deliberately so: this does not throw,
 * because every caller treats deletion as best-effort cleanup and a module
 * that has already removed its own record must not be left in an
 * inconsistent state by a storage error. WS-5's visible deletion behaviour is
 * exactly what it was.
 *
 * What changed is that a failure is no longer INVISIBLE. The pre-Pass-1
 * `.catch(() => undefined)` made "deleted" and "could not delete" the same
 * outcome, so bytes could survive a deletion forever with nothing recording
 * it. Now a genuine failure is logged and the object is marked
 * `delete_failed`, which is a state reconciliation can find and act on.
 */
export async function deleteOrgFile(organizationId: number, key: string): Promise<void> {
  try {
    await getStorageBackend().delete(organizationId, key);
    await markStoredObject(organizationId, key, "deleted", "physical delete succeeded");
  } catch (err) {
    const detail = err instanceof StorageOperationError ? err.message : "physical delete failed";
    logger.error({ err, organizationId }, "physical storage delete failed — object retained for reconciliation");
    await markStoredObject(organizationId, key, "delete_failed", detail);
  }
}

/**
 * The compensating cleanup for "binary written, business transaction failed".
 * Identical intent to `deleteOrgFile`, but records `orphaned` rather than
 * `deleted` when cleanup fails, because in this path nothing references the
 * bytes at all — a distinction reconciliation needs, since an orphan can be
 * removed safely while a `delete_failed` object may still be referenced by a
 * record whose module already considers it gone.
 */
export async function discardOrphanedFile(organizationId: number, key: string): Promise<void> {
  try {
    await getStorageBackend().delete(organizationId, key);
    await markStoredObject(organizationId, key, "deleted", "discarded after failed business transaction");
  } catch (err) {
    logger.error({ err, organizationId }, "failed to discard orphaned object after transaction failure");
    await markStoredObject(organizationId, key, "orphaned", "business transaction failed and cleanup failed");
  }
}
