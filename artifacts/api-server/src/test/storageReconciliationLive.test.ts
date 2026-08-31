/**
 * WS-17 File Storage Durability, Pass 2 — reconciliation and migration,
 * proved in isolation.
 *
 * Every fixture is synthetic and built in a temporary directory. No real
 * document is read, no Production path is enumerated, no live object store is
 * contacted: the "S3" destination is an in-memory backend that satisfies the
 * same contract, which is enough because what is under test is the
 * copy/verify/switch protocol, not a vendor's SDK.
 *
 * The assertions are deliberately about the DANGEROUS cases — mismatch,
 * interruption, races, orphans, missing binaries — because the safe path
 * working is not the part that keeps data alive.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createHash } from "crypto";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS17_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-17 Pass 2 — storage reconciliation and migration", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let storage: typeof import("../lib/storage");
  let recon: typeof import("../lib/storageReconciliation");
  let fileStorage: typeof import("../lib/fileStorage");

  let orgId: number;
  let otherOrgId: number;
  let currentRoot: string;
  let legacyRoot: string;
  let employeeId: number;

  const actor = { actorApplicationUserId: null, actorMembershipId: null };
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const suffix = `ws17p2-${Date.now()}`;

  /** An in-memory backend satisfying the same contract — stands in for S3. */
  function makeMemoryBackend(kind: "s3" = "s3") {
    const objects = new Map<string, Buffer>();
    const id = (o: number, k: string) => `${o}::${k}`;
    return {
      kind,
      objects,
      async write(o: number, k: string, d: Buffer) {
        objects.set(id(o, k), Buffer.from(d));
      },
      async read(o: number, k: string) {
        const f = objects.get(id(o, k));
        if (!f) throw new storage.StorageObjectNotFoundError();
        return f;
      },
      async delete(o: number, k: string) {
        return objects.delete(id(o, k));
      },
      async stat(o: number, k: string) {
        const f = objects.get(id(o, k));
        return f ? { sizeBytes: f.length } : null;
      },
      async health() {
        return { healthy: true, detail: "in-memory" };
      },
    } as any;
  }

  /** Places bytes directly on disk in the pre-Pass-1 layout — no metadata. */
  async function placeLegacyFile(root: string, organizationId: number, key: string, content: string) {
    const full = path.join(root, "organizations", String(organizationId), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  async function insertEmployeeDocument(organizationId: number, storageKey: string) {
    const [row] = await db
      .insert(schema.employeeDocumentsTable)
      .values({
        organizationId,
        employeeId,
        categoryCode: "contract",
        title: `doc ${storageKey}`,
        storageKey,
        fileName: "synthetic.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
        uploadedBy: null,
      })
      .returning();
    return row.id;
  }

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

    currentRoot = await mkdtemp(path.join(tmpdir(), "ws17p2-current-"));
    legacyRoot = await mkdtemp(path.join(tmpdir(), "ws17p2-legacy-"));
    process.env.UPLOADS_DIR = currentRoot;

    storage = await import("../lib/storage");
    recon = await import("../lib/storageReconciliation");
    fileStorage = await import("../lib/fileStorage");
    storage.__setStorageBackendForTests(new storage.FilesystemStorageBackend(currentRoot));

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS17P2 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS17P2 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Recon", lastName: "Subject" })
      .returning();
    employeeId = emp.id;
  });

  beforeEach(() => {
    storage.__setStorageBackendForTests(new storage.FilesystemStorageBackend(currentRoot));
  });

  // =======================================================================
  // Read-only reconciliation
  // =======================================================================
  describe("read-only reconciliation", () => {
    it("classifies healthy, historical, missing and orphaned metadata — and mutates NOTHING", async () => {
      // 1. modern healthy file (written through Pass 1's path)
      const healthyKey = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("modern healthy"));
      await insertEmployeeDocument(orgId, healthyKey);

      // 2. historical file: on disk + referenced, but no stored_objects row
      const historicalKey = "documents/" + "a".repeat(48) + ".pdf";
      await placeLegacyFile(currentRoot, orgId, historicalKey, "historical content");
      await insertEmployeeDocument(orgId, historicalKey);

      // 3. missing binary: referenced, nothing on disk
      const missingKey = "documents/" + "b".repeat(48) + ".pdf";
      await insertEmployeeDocument(orgId, missingKey);

      const before = await db
        .select()
        .from(schema.storedObjectsTable)
        .where(eq(schema.storedObjectsTable.organizationId, orgId));

      const report = await recon.reconcileStorage({ organizationId: orgId });

      expect(report.mutated).toBe(false);
      const byKey = new Map(report.items.map((i: any) => [i.storageKey, i]));
      expect(byKey.get(healthyKey).status).toBe("healthy");
      expect(byKey.get(historicalKey).status).toBe("historical_unregistered");
      expect(byKey.get(missingKey).status).toBe("missing_binary");
      // An authoritative loss is called what it is.
      expect(byKey.get(missingKey).criticality).toBe("authoritative");

      // Read-only means read-only: not one row changed.
      const after = await db
        .select()
        .from(schema.storedObjectsTable)
        .where(eq(schema.storedObjectsTable.organizationId, orgId));
      expect(after).toEqual(before);
    });

    it("never reports an unknown state as healthy", async () => {
      const report = await recon.reconcileStorage({ organizationId: orgId });
      for (const item of report.items) {
        if (item.status === "healthy") expect(item.registered).toBe(true);
      }
    });

    it("detects a checksum mismatch when bytes change underneath a recorded digest", async () => {
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("original bytes"));
      await insertEmployeeDocument(orgId, key);

      // Tamper with the object on disk, leaving the recorded digest stale.
      await writeFile(path.join(currentRoot, "organizations", String(orgId), key), "TAMPERED");

      const report = await recon.reconcileStorage({ organizationId: orgId, verifyChecksums: true });
      const item = report.items.find((i: any) => i.storageKey === key);
      expect(item!.status).toBe("checksum_mismatch");
    });

    it("reports orphan binaries without deleting them", async () => {
      const orphanKey = "documents/" + "c".repeat(48) + ".pdf";
      await placeLegacyFile(currentRoot, orgId, orphanKey, "nobody references me");

      const orphans = await recon.findOrphanBinaries({ organizationId: orgId, root: currentRoot });
      expect(orphans.map((o: any) => o.storageKey)).toContain(orphanKey);

      // Still there. Cleanup is a separately authorized operation that does
      // not exist yet, because an "orphan" may just be an unknown reference.
      const backend = new storage.FilesystemStorageBackend(currentRoot);
      await expect(backend.stat(orgId, orphanKey)).resolves.not.toBeNull();
    });

    it("surfaces metadata whose business reference has gone, distinctly from a disk orphan", async () => {
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("no reference"));
      // Registered by the write, but deliberately never referenced.
      const report = await recon.reconcileStorage({ organizationId: orgId });
      const item = report.items.find((i: any) => i.storageKey === key);
      expect(item!.status).toBe("metadata_without_business_reference");
    });
  });

  // =======================================================================
  // Historical registration
  // =======================================================================
  describe("historical registration", () => {
    it("registers a historical file with a correct digest, and is idempotent", async () => {
      const key = "documents/" + "d".repeat(48) + ".pdf";
      const content = "historical personnel record";
      await placeLegacyFile(currentRoot, orgId, key, content);
      await insertEmployeeDocument(orgId, key);

      const first = await recon.registerHistoricalObjects({ organizationId: orgId, actor });
      expect(first.registered).toBeGreaterThanOrEqual(1);

      const row = await storedObject(orgId, key);
      expect(row.checksumSha256).toBe(sha(content));
      expect(row.sizeBytes).toBe(content.length);
      expect(row.backend).toBe("filesystem");

      // Running again must not duplicate or corrupt.
      const second = await recon.registerHistoricalObjects({ organizationId: orgId, actor });
      const rowsNow = await db
        .select()
        .from(schema.storedObjectsTable)
        .where(
          and(eq(schema.storedObjectsTable.organizationId, orgId), eq(schema.storedObjectsTable.storageKey, key)),
        );
      expect(rowsNow).toHaveLength(1);
      expect(second.details.find((d: any) => d.storageKey === key)).toBeUndefined();
    });

    it("preserves the business key exactly and leaves the source binary untouched", async () => {
      const key = "documents/" + "e".repeat(48) + ".pdf";
      await placeLegacyFile(currentRoot, orgId, key, "untouched source");
      const recordId = await insertEmployeeDocument(orgId, key);

      await recon.registerHistoricalObjects({ organizationId: orgId, actor });

      const [doc] = await db
        .select()
        .from(schema.employeeDocumentsTable)
        .where(eq(schema.employeeDocumentsTable.id, recordId));
      expect(doc.storageKey).toBe(key);

      const backend = new storage.FilesystemStorageBackend(currentRoot);
      await expect(backend.read(orgId, key)).resolves.toEqual(Buffer.from("untouched source"));
    });

    it("dry run registers nothing", async () => {
      const key = "documents/" + "f".repeat(48) + ".pdf";
      await placeLegacyFile(currentRoot, orgId, key, "dry run only");
      await insertEmployeeDocument(orgId, key);

      const result = await recon.registerHistoricalObjects({ organizationId: orgId, actor, dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(await storedObject(orgId, key)).toBeNull();
    });

    it("never fabricates a replacement for a missing binary", async () => {
      const key = "documents/" + "0".repeat(48) + ".pdf";
      await insertEmployeeDocument(orgId, key);

      const result = await recon.registerHistoricalObjects({ organizationId: orgId, actor });
      expect(result.details.find((d: any) => d.storageKey === key)?.outcome).toBe("missing_binary");
      expect(await storedObject(orgId, key)).toBeNull();
    });
  });

  // =======================================================================
  // Migration
  // =======================================================================
  describe("migration", () => {
    it("COPIES rather than moves, verifies, then switches authority", async () => {
      const dest = makeMemoryBackend();
      const content = Buffer.from("contract to migrate");
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", content);
      await insertEmployeeDocument(orgId, key);

      const result = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });
      expect(result.details.find((d: any) => d.storageKey === key)?.outcome).toBe("migrated");

      // Destination has a byte-identical copy...
      await expect(dest.read(orgId, key)).resolves.toEqual(content);
      // ...authority switched...
      expect((await storedObject(orgId, key)).backend).toBe("s3");
      // ...and THE SOURCE IS STILL THERE. Nothing was moved.
      const fs = new storage.FilesystemStorageBackend(currentRoot);
      await expect(fs.read(orgId, key)).resolves.toEqual(content);
    });

    it("preserves the opaque key, so no business record is rewritten", async () => {
      const dest = makeMemoryBackend();
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("stable key"));
      const recordId = await insertEmployeeDocument(orgId, key);

      await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });

      const [doc] = await db
        .select()
        .from(schema.employeeDocumentsTable)
        .where(eq(schema.employeeDocumentsTable.id, recordId));
      expect(doc.storageKey).toBe(key);
      expect([...dest.objects.keys()].some((k: string) => k.endsWith(key))).toBe(true);
    });

    it("resumes safely after an interruption between copy and switch", async () => {
      const dest = makeMemoryBackend();
      const content = Buffer.from("interrupted copy");
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", content);
      await insertEmployeeDocument(orgId, key);

      // Simulate a crash after the copy landed but before authority moved.
      await dest.write(orgId, key, content);
      expect((await storedObject(orgId, key)).backend).toBe("filesystem");

      const result = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });
      expect(result.details.find((d: any) => d.storageKey === key)?.outcome).toBe("resumed_and_switched");
      expect((await storedObject(orgId, key)).backend).toBe("s3");
      // No duplicate copy was made.
      expect(result.bytesCopied).toBe(0);
    });

    it("refuses to switch when the destination already holds DIFFERENT content", async () => {
      const dest = makeMemoryBackend();
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("the real bytes"));
      await insertEmployeeDocument(orgId, key);

      await dest.write(orgId, key, Buffer.from("something else entirely"));

      const result = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });
      expect(result.details.find((d: any) => d.storageKey === key)?.outcome).toBe("destination_conflict");
      // Authority stays put. Size matching is never accepted as equivalence.
      expect((await storedObject(orgId, key)).backend).toBe("filesystem");
    });

    it("blocks migration when the source no longer matches its recorded digest", async () => {
      const dest = makeMemoryBackend();
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("registered bytes"));
      await insertEmployeeDocument(orgId, key);

      await writeFile(path.join(currentRoot, "organizations", String(orgId), key), "REPLACED AFTER REGISTRATION");

      const result = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });
      expect(result.details.find((d: any) => d.storageKey === key)?.outcome).toBe("checksum_mismatch");
      expect((await storedObject(orgId, key)).backend).toBe("filesystem");
      // Scoped to THIS key: the run legitimately migrates the organization's
      // other eligible objects, so asserting an empty destination would be
      // asserting the wrong thing.
      expect(await dest.stat(orgId, key)).toBeNull();
    });

    it("is idempotent and retry-safe across repeated runs", async () => {
      const dest = makeMemoryBackend();
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("retry me"));
      await insertEmployeeDocument(orgId, key);

      const first = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });
      const second = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });

      expect(first.details.find((d: any) => d.storageKey === key)?.outcome).toBe("migrated");
      expect(second.details.find((d: any) => d.storageKey === key)?.outcome).toBe("already_migrated");
      expect(second.bytesCopied).toBe(0);
    });

    it("two concurrent migrators cannot double-switch one object", async () => {
      const dest = makeMemoryBackend();
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("contended"));
      await insertEmployeeDocument(orgId, key);

      const [a, b] = await Promise.all([
        recon.migrateObjects({ organizationId: orgId, actor, destination: dest }),
        recon.migrateObjects({ organizationId: orgId, actor, destination: dest }),
      ]);

      const outcomes = [a, b].map((r) => r.details.find((d: any) => d.storageKey === key)?.outcome);
      // Exactly one switch; the other observes the row already moved.
      expect(outcomes.filter((o) => o === "migrated" || o === "resumed_and_switched")).toHaveLength(1);
      expect((await storedObject(orgId, key)).backend).toBe("s3");
    });

    it("skips unregistered objects rather than copying unverifiable bytes", async () => {
      const dest = makeMemoryBackend();
      const key = "documents/" + "9".repeat(48) + ".pdf";
      await placeLegacyFile(currentRoot, orgId, key, "no digest recorded");
      await insertEmployeeDocument(orgId, key);

      const result = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });
      expect(result.details.find((d: any) => d.storageKey === key)?.outcome).toBe("skipped_unregistered");
      expect(dest.objects.has(`${orgId}::${key}`)).toBe(false);
    });

    it("dry run copies nothing and switches nothing", async () => {
      const dest = makeMemoryBackend();
      const key = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("dry"));
      await insertEmployeeDocument(orgId, key);

      const result = await recon.migrateObjects({ organizationId: orgId, actor, destination: dest, dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(dest.objects.size).toBe(0);
      expect((await storedObject(orgId, key)).backend).toBe("filesystem");
    });

    it("refuses to run against an unhealthy destination", async () => {
      const dest = makeMemoryBackend();
      dest.health = async () => ({ healthy: false, detail: "bucket unreachable" });
      await expect(
        recon.migrateObjects({ organizationId: orgId, actor, destination: dest }),
      ).rejects.toThrow(/not healthy/);
    });
  });

  // =======================================================================
  // Legacy /app/uploads upgrade route, and the replaceable-object race
  // =======================================================================
  describe("legacy source root and mutable objects", () => {
    it("reconciles and migrates from an explicitly configured legacy root", async () => {
      const dest = makeMemoryBackend();
      const key = "documents/" + "1".repeat(48) + ".pdf";
      // Stands in for a pre-Pass-0 /app/uploads tree.
      await placeLegacyFile(legacyRoot, orgId, key, "left behind at the old path");
      await insertEmployeeDocument(orgId, key);

      const legacy = new storage.FilesystemStorageBackend(legacyRoot);

      // Not visible to the current backend at all...
      const report = await recon.reconcileStorage({ organizationId: orgId });
      expect(report.items.find((i: any) => i.storageKey === key)!.status).toBe("missing_binary");

      // ...but fully reconcilable when the operator names the legacy root.
      const legacyReport = await recon.reconcileStorage({ organizationId: orgId, source: legacy });
      expect(legacyReport.items.find((i: any) => i.storageKey === key)!.status).toBe("historical_unregistered");

      await recon.registerHistoricalObjects({ organizationId: orgId, actor, source: legacy });
      expect((await storedObject(orgId, key)).checksumSha256).toBe(sha("left behind at the old path"));

      const migrated = await recon.migrateObjects({
        organizationId: orgId,
        actor,
        source: legacy,
        destination: dest,
      });
      expect(migrated.details.find((d: any) => d.storageKey === key)?.outcome).toBe("migrated");
      // The legacy source is retained — the operator deletes it later, deliberately.
      await expect(legacy.read(orgId, key)).resolves.toEqual(Buffer.from("left behind at the old path"));
    });

    it("an older avatar copy cannot overwrite a newer current one", async () => {
      const dest = makeMemoryBackend();
      const oldKey = await fileStorage.writeOrgFile(orgId, "avatars", "jpg", Buffer.from("old avatar"));
      await db
        .update(schema.employeesTable)
        .set({ profilePictureKey: oldKey })
        .where(eq(schema.employeesTable.id, employeeId));

      // The employee replaces their picture: a NEW key becomes current.
      const newKey = await fileStorage.writeOrgFile(orgId, "avatars", "jpg", Buffer.from("new avatar"));
      await db
        .update(schema.employeesTable)
        .set({ profilePictureKey: newKey })
        .where(eq(schema.employeesTable.id, employeeId));

      await recon.migrateObjects({ organizationId: orgId, actor, destination: dest });

      // Only the CURRENT key is referenced, so only it migrates — the old key
      // is no longer a reference and cannot overwrite the new object.
      expect(await dest.stat(orgId, newKey)).not.toBeNull();
      expect((await dest.read(orgId, newKey)).toString()).toBe("new avatar");
      expect(await dest.stat(orgId, oldKey)).toBeNull();
    });
  });

  // =======================================================================
  // Tenant isolation
  // =======================================================================
  describe("tenant isolation", () => {
    it("reconciliation for one organization never reports another's objects", async () => {
      const mineKey = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("mine"));
      await insertEmployeeDocument(orgId, mineKey);

      const report = await recon.reconcileStorage({ organizationId: otherOrgId });
      expect(report.organizationId).toBe(otherOrgId);
      expect(report.items.every((i: any) => i.organizationId === otherOrgId)).toBe(true);
      expect(report.items.find((i: any) => i.storageKey === mineKey)).toBeUndefined();
    });

    it("migration scoped to one organization does not touch another's binaries", async () => {
      const dest = makeMemoryBackend();
      const mineKey = await fileStorage.writeOrgFile(orgId, "documents", "pdf", Buffer.from("org A"));
      await insertEmployeeDocument(orgId, mineKey);

      await recon.migrateObjects({ organizationId: otherOrgId, actor, destination: dest });

      // Org A's object was never copied by an Org B migration.
      expect(await dest.stat(orgId, mineKey)).toBeNull();
      expect((await storedObject(orgId, mineKey)).backend).toBe("filesystem");
    });
  });
});
