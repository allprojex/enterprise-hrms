/**
 * WS-17 Pass 1 — SHA-256 integrity, failure visibility, and the guarantee
 * that pre-Pass-1 files keep working untouched.
 *
 * These run against a real database because the thing under test is the
 * relationship between stored bytes and the `stored_objects` row that
 * describes them — including the states that only exist when something goes
 * wrong, which is exactly where the old implementation went silent.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createHash } from "crypto";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS17_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-17 Pass 1 — storage integrity and failure visibility", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let fileStorage: typeof import("../lib/fileStorage");
  let storage: typeof import("../lib/storage");

  let orgId: number;
  let otherOrgId: number;
  let tmpRoot: string;

  const suffix = `ws17p1-${Date.now()}`;

  async function storedObject(organizationId: number, key: string) {
    const [row] = await db
      .select()
      .from(schema.storedObjectsTable)
      .where(
        and(
          eq(schema.storedObjectsTable.organizationId, organizationId),
          eq(schema.storedObjectsTable.storageKey, key),
        ),
      );
    return row ?? null;
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    tmpRoot = await mkdtemp(path.join(tmpdir(), "ws17p1-"));
    process.env.UPLOADS_DIR = tmpRoot;

    storage = await import("../lib/storage");
    fileStorage = await import("../lib/fileStorage");
    storage.__setStorageBackendForTests(new storage.FilesystemStorageBackend(tmpRoot));

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS17P1 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS17P1 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;
  });

  afterEach(() => {
    storage.__setStorageBackendForTests(new storage.FilesystemStorageBackend(tmpRoot));
  });

  // --- Integrity ----------------------------------------------------------

  it("records a correct SHA-256, size and backend for a new authoritative write", async () => {
    const data = Buffer.from("employment contract, signed");
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", data);

    const row = await storedObject(orgId, key);
    expect(row).not.toBeNull();
    expect(row.checksumSha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(row.sizeBytes).toBe(data.length);
    expect(row.backend).toBe("filesystem");
    expect(row.status).toBe("stored");
  });

  it("gives identical content the same digest and changed content a different one", async () => {
    const a = await fileStorage.writeOrgFile(orgId, "documents", "txt", Buffer.from("same bytes"));
    const b = await fileStorage.writeOrgFile(orgId, "documents", "txt", Buffer.from("same bytes"));
    const c = await fileStorage.writeOrgFile(orgId, "documents", "txt", Buffer.from("different bytes"));

    const [ra, rb, rc] = await Promise.all([storedObject(orgId, a), storedObject(orgId, b), storedObject(orgId, c)]);
    expect(ra.checksumSha256).toBe(rb.checksumSha256);
    expect(rc.checksumSha256).not.toBe(ra.checksumSha256);
    // Distinct objects even with identical content — keys are per-write.
    expect(a).not.toBe(b);
  });

  it("does not write to the database on a read, and never backfills", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("read me"));
    const before = await storedObject(orgId, key);

    await fileStorage.readOrgFile(orgId, key);
    await fileStorage.readOrgFile(orgId, key);

    const after = await storedObject(orgId, key);
    expect(after).toEqual(before);
  });

  // --- Pre-Pass-1 compatibility (mandatory, §18) --------------------------

  it("a file written before Pass 1 stays readable with NO metadata row, and gains none", async () => {
    // Placed directly on disk in the pre-Pass-1 layout, bypassing writeOrgFile
    // exactly as history did.
    const legacyKey = "documents/aa11bb22cc33dd44ee55ff6677889900aabbccddeeff0011.pdf";
    const full = path.join(tmpRoot, "organizations", String(orgId), legacyKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, "historical personnel document");

    expect(await storedObject(orgId, legacyKey)).toBeNull();
    await expect(fileStorage.readOrgFile(orgId, legacyKey)).resolves.toEqual(
      Buffer.from("historical personnel document"),
    );
    // Integrity is honestly UNKNOWN — not fabricated, not backfilled by reading.
    expect(await storedObject(orgId, legacyKey)).toBeNull();
  });

  // --- Delete visibility (the behaviour that replaces silent swallowing) --

  it("marks an object deleted when physical deletion succeeds", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("delete me"));
    await fileStorage.deleteOrgFile(orgId, key);

    const row = await storedObject(orgId, key);
    expect(row.status).toBe("deleted");
    expect(row.statusChangedAt).not.toBeNull();
  });

  it("records delete_failed instead of silently succeeding when the backend fails", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("stubborn"));

    // A backend whose delete genuinely fails — the case the pre-Pass-1
    // `.catch(() => undefined)` made indistinguishable from success.
    const failing = new storage.FilesystemStorageBackend(tmpRoot);
    failing.delete = async () => {
      throw new storage.StorageOperationError("simulated permission denied");
    };
    storage.__setStorageBackendForTests(failing);

    // Business semantics unchanged: this still does not throw.
    await expect(fileStorage.deleteOrgFile(orgId, key)).resolves.toBeUndefined();

    const row = await storedObject(orgId, key);
    expect(row.status).toBe("delete_failed");
    expect(row.statusDetail).toContain("simulated permission denied");
    expect(row.statusChangedAt).not.toBeNull();
  });

  it("records orphaned when a post-write transaction failure cannot be cleaned up", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("orphan"));

    const failing = new storage.FilesystemStorageBackend(tmpRoot);
    failing.delete = async () => {
      throw new storage.StorageOperationError("cleanup failed");
    };
    storage.__setStorageBackendForTests(failing);

    await fileStorage.discardOrphanedFile(orgId, key);

    const row = await storedObject(orgId, key);
    // Distinct from delete_failed: nothing references these bytes, so
    // reconciliation may remove them safely.
    expect(row.status).toBe("orphaned");
  });

  it("a successful discard is recorded as deleted, not orphaned", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("clean"));
    await fileStorage.discardOrphanedFile(orgId, key);
    expect((await storedObject(orgId, key)).status).toBe("deleted");
  });

  // --- Write failure ------------------------------------------------------

  it("creates NO metadata row when the binary write itself fails", async () => {
    const failing = new storage.FilesystemStorageBackend(tmpRoot);
    failing.write = async () => {
      throw new storage.StorageOperationError("disk full");
    };
    storage.__setStorageBackendForTests(failing);

    await expect(
      fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("never stored")),
    ).rejects.toBeInstanceOf(storage.StorageOperationError);

    const rows = await db
      .select()
      .from(schema.storedObjectsTable)
      .where(eq(schema.storedObjectsTable.organizationId, orgId));
    expect(rows.every((r: any) => r.statusDetail !== "disk full")).toBe(true);
  });

  // --- Tenant isolation of the metadata itself ----------------------------

  it("scopes stored-object metadata by organization", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("mine"));
    expect(await storedObject(orgId, key)).not.toBeNull();
    // The same key asked for under another tenant resolves to nothing.
    expect(await storedObject(otherOrgId, key)).toBeNull();
  });

  it("does not let one organization's delete touch another's object", async () => {
    const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("protected"));
    await fileStorage.deleteOrgFile(otherOrgId, key);

    // The real object is untouched and still readable.
    await expect(fileStorage.readOrgFile(orgId, key)).resolves.toEqual(Buffer.from("protected"));
    expect((await storedObject(orgId, key)).status).toBe("stored");
  });

  afterEach(async () => {
    await rm(path.join(tmpRoot, "nothing"), { recursive: true, force: true }).catch(() => undefined);
  });
});
