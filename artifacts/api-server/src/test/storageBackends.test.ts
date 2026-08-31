/**
 * WS-17 File Storage Durability, Pass 1 — backend contract parity, tenant
 * isolation and key safety.
 *
 * The filesystem backend is exercised against a real temporary directory. The
 * S3-compatible backend is exercised against an in-memory fake of the four S3
 * commands it uses, because the point of these tests is that BOTH backends
 * satisfy one contract — not that the AWS SDK works. A parity suite runs the
 * identical assertions against each, so a future backend cannot quietly
 * behave differently where it matters: what "already absent" means, what
 * "unreachable" means, and whether a tenant boundary can be crossed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { FilesystemStorageBackend } from "../lib/storage/filesystemBackend";
import { S3StorageBackend } from "../lib/storage/s3Backend";
import { StorageObjectNotFoundError, StorageOperationError, type StorageBackend } from "../lib/storage/types";

// --- An in-memory S3-compatible server, wired into the real backend --------

interface FakeS3 {
  objects: Map<string, Buffer>;
  fail: boolean;
}

function makeS3Backend(state: FakeS3): StorageBackend {
  // The real S3StorageBackend, with only its transport replaced — so the
  // key-derivation, tenant-scoping and error-mapping logic under test is the
  // genuine shipped code.
  const notFound = () => Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });

  const send = vi.fn(async (command: any) => {
    if (state.fail) throw Object.assign(new Error("network"), { $metadata: { httpStatusCode: 500 } });
    const name = command.constructor.name;
    const key = command.input.Key as string;

    if (name === "PutObjectCommand") {
      state.objects.set(key, Buffer.from(command.input.Body));
      return {};
    }
    if (name === "GetObjectCommand") {
      const found = state.objects.get(key);
      if (!found) throw notFound();
      return { Body: (async function* () { yield found; })() };
    }
    if (name === "HeadObjectCommand") {
      const found = state.objects.get(key);
      if (!found) throw notFound();
      return { ContentLength: found.length };
    }
    if (name === "DeleteObjectCommand") {
      state.objects.delete(key);
      return {};
    }
    throw new Error(`unexpected command ${name}`);
  });

  const backend = new S3StorageBackend({
    bucket: "test-bucket",
    region: "us-east-1",
    accessKeyId: "test",
    secretAccessKey: "test",
    forcePathStyle: true,
  });
  (backend as any).client = { send };
  return backend;
}

describe("WS-17 Pass 1 — storage backend contract", () => {
  let tmpRoot: string;
  let fsBackend: StorageBackend;
  let s3State: FakeS3;
  let s3Backend: StorageBackend;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), "ws17-storage-"));
    fsBackend = new FilesystemStorageBackend(tmpRoot);
    s3State = { objects: new Map(), fail: false };
    s3Backend = makeS3Backend(s3State);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // --- Parity: identical assertions against both implementations ----------
  const backends = () => [
    ["filesystem", () => fsBackend] as const,
    ["s3", () => s3Backend] as const,
  ];

  for (const [name, get] of backends()) {
    describe(`${name} backend`, () => {
      it("writes then reads back identical bytes", async () => {
        const backend = get();
        const data = Buffer.from("confidential payroll letter");
        await backend.write(7, "documents/aaaa.pdf", data);
        await expect(backend.read(7, "documents/aaaa.pdf")).resolves.toEqual(data);
      });

      it("reports a missing object as NOT FOUND, never as an operational failure", async () => {
        await expect(get().read(7, "documents/missing.pdf")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
      });

      it("stat returns null for a missing object and a size for a present one", async () => {
        const backend = get();
        await expect(backend.stat(7, "documents/none.pdf")).resolves.toBeNull();
        await backend.write(7, "documents/x.pdf", Buffer.from("1234567890"));
        await expect(backend.stat(7, "documents/x.pdf")).resolves.toEqual({ sizeBytes: 10 });
      });

      it("delete returns true when it removed something, false when already gone", async () => {
        const backend = get();
        await backend.write(7, "documents/y.pdf", Buffer.from("y"));
        await expect(backend.delete(7, "documents/y.pdf")).resolves.toBe(true);
        // Already absent is a SATISFIED intent, not a failure — the
        // distinction the old `.catch(() => undefined)` erased.
        await expect(backend.delete(7, "documents/y.pdf")).resolves.toBe(false);
      });

      it("keeps tenants apart: the same key in another organization is a different object", async () => {
        const backend = get();
        await backend.write(1, "documents/shared-name.pdf", Buffer.from("org one"));
        await backend.write(2, "documents/shared-name.pdf", Buffer.from("org two"));

        expect((await backend.read(1, "documents/shared-name.pdf")).toString()).toBe("org one");
        expect((await backend.read(2, "documents/shared-name.pdf")).toString()).toBe("org two");
      });

      it("org A cannot read org B's object by presenting B's key", async () => {
        const backend = get();
        await backend.write(2, "documents/secret.pdf", Buffer.from("org two secret"));
        // The key alone does not address the object — organization scope is a
        // separate, unavoidable argument.
        await expect(backend.read(1, "documents/secret.pdf")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
      });

      it("org A cannot delete org B's object", async () => {
        const backend = get();
        await backend.write(2, "documents/keepme.pdf", Buffer.from("still here"));
        await expect(backend.delete(1, "documents/keepme.pdf")).resolves.toBe(false);
        await expect(backend.read(2, "documents/keepme.pdf")).resolves.toEqual(Buffer.from("still here"));
      });
    });
  }

  // --- Key safety, S3 backend (where keys are composed into one string) ---
  describe("s3 object key safety", () => {
    it("rejects traversal and malformed keys instead of normalizing them", async () => {
      for (const bad of ["../escape.pdf", "documents/../../etc/passwd", "/absolute.pdf", "", "documents//x.pdf", "a/./b.pdf"]) {
        await expect(s3Backend.write(1, bad, Buffer.from("x"))).rejects.toBeInstanceOf(StorageOperationError);
      }
    });

    it("rejects a forged organization scope", async () => {
      for (const bad of [0, -1, 1.5, NaN]) {
        await expect(s3Backend.write(bad, "documents/x.pdf", Buffer.from("x"))).rejects.toBeInstanceOf(
          StorageOperationError,
        );
      }
    });

    it("derives the object key server-side, always under the organization prefix", async () => {
      await s3Backend.write(42, "documents/file.pdf", Buffer.from("x"));
      expect([...s3State.objects.keys()]).toEqual(["organizations/42/documents/file.pdf"]);
    });
  });

  // --- Operational failure is never confused with absence -----------------
  describe("operational failure", () => {
    it("s3: an unreachable backend raises StorageOperationError, not NOT FOUND", async () => {
      s3State.fail = true;
      await expect(s3Backend.read(1, "documents/x.pdf")).rejects.toBeInstanceOf(StorageOperationError);
      await expect(s3Backend.write(1, "documents/x.pdf", Buffer.from("x"))).rejects.toBeInstanceOf(
        StorageOperationError,
      );
      await expect(s3Backend.delete(1, "documents/x.pdf")).rejects.toBeInstanceOf(StorageOperationError);
    });

    it("filesystem: an unwritable root raises StorageOperationError", async () => {
      const broken = new FilesystemStorageBackend(path.join(tmpRoot, "file-not-a-dir"));
      await writeFile(path.join(tmpRoot, "file-not-a-dir"), "not a directory");
      await expect(broken.write(1, "documents/x.pdf", Buffer.from("x"))).rejects.toBeInstanceOf(StorageOperationError);
    });
  });

  // --- Health never fabricates green --------------------------------------
  describe("health", () => {
    it("filesystem: healthy for a usable root, unhealthy for a missing one", async () => {
      await expect(fsBackend.health()).resolves.toMatchObject({ healthy: true });
      const missing = new FilesystemStorageBackend(path.join(tmpRoot, "does-not-exist"));
      await expect(missing.health()).resolves.toMatchObject({ healthy: false });
    });

    it("s3: a 404 on the probe key is HEALTHY; an unreachable bucket is not", async () => {
      await expect(s3Backend.health()).resolves.toMatchObject({ healthy: true });
      s3State.fail = true;
      await expect(s3Backend.health()).resolves.toMatchObject({ healthy: false });
    });

    it("s3 health never lists or touches business objects", async () => {
      await s3Backend.write(1, "documents/private.pdf", Buffer.from("secret"));
      await s3Backend.health();
      expect(s3State.objects.has("organizations/1/documents/private.pdf")).toBe(true);
    });
  });

  // --- Existing pre-Pass-1 files remain readable --------------------------
  describe("backward compatibility", () => {
    it("reads a file written before Pass 1, with no metadata row and no checksum", async () => {
      // Exactly the pre-Pass-1 layout: UPLOADS_DIR/organizations/<id>/<key>.
      const legacyKey = "documents/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.pdf";
      const full = path.join(tmpRoot, "organizations", "9", legacyKey);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, "written before WS-17 Pass 1");

      await expect(fsBackend.read(9, legacyKey)).resolves.toEqual(Buffer.from("written before WS-17 Pass 1"));
      await expect(fsBackend.stat(9, legacyKey)).resolves.toMatchObject({ sizeBytes: 27 });
    });
  });
});
