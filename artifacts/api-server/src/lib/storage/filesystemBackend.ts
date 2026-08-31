/**
 * WS-17 Pass 1 — the filesystem backend.
 *
 * This is the pre-Pass-1 implementation, moved behind the shared interface
 * with its path semantics preserved byte-for-byte: `UPLOADS_DIR` (honouring
 * WS-17 Pass 0's mounted volume), then `organizations/<id>/<key>`. Existing
 * stored files therefore resolve exactly as they always did — that is the
 * whole point, and it is what makes Pass 1 backward compatible with every
 * file written before it.
 *
 * It remains the default backend, so development, tests and self-managed
 * installations continue to work with no object storage anywhere in sight.
 */
import { mkdir, writeFile, readFile, unlink, stat, access } from "fs/promises";
import { constants } from "fs";
import path from "path";
import { StorageObjectNotFoundError, StorageOperationError, type StorageBackend, type StorageObjectStat } from "./types";

/** Node's fs errors carry a string `code`; narrowing it is how we tell "absent" from "broken". */
function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}

export class FilesystemStorageBackend implements StorageBackend {
  readonly kind = "filesystem" as const;
  private readonly root: string;

  constructor(root?: string) {
    // Identical default to the pre-Pass-1 module, so an installation that
    // sets nothing behaves exactly as before.
    this.root = root ?? process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");
  }

  private resolve(organizationId: number, key: string): string {
    return path.join(this.root, "organizations", String(organizationId), key);
  }

  async write(organizationId: number, key: string, data: Buffer): Promise<void> {
    const full = this.resolve(organizationId, key);
    try {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data);
    } catch (err) {
      throw new StorageOperationError("Failed to write object to filesystem storage", err);
    }
  }

  async read(organizationId: number, key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(organizationId, key));
    } catch (err) {
      if (errorCode(err) === "ENOENT") throw new StorageObjectNotFoundError();
      throw new StorageOperationError("Failed to read object from filesystem storage", err);
    }
  }

  async delete(organizationId: number, key: string): Promise<boolean> {
    try {
      await unlink(this.resolve(organizationId, key));
      return true;
    } catch (err) {
      // Already gone is a satisfied intent, not a failure. Anything else —
      // permissions, a read-only mount, I/O error — is a real failure and is
      // now raised rather than swallowed.
      if (errorCode(err) === "ENOENT") return false;
      throw new StorageOperationError("Failed to delete object from filesystem storage", err);
    }
  }

  async stat(organizationId: number, key: string): Promise<StorageObjectStat | null> {
    try {
      const s = await stat(this.resolve(organizationId, key));
      return { sizeBytes: s.size };
    } catch (err) {
      if (errorCode(err) === "ENOENT") return null;
      throw new StorageOperationError("Failed to stat object in filesystem storage", err);
    }
  }

  async health(): Promise<{ healthy: boolean; detail: string }> {
    // Checks the configured ROOT only — never a business object, and nothing
    // is written or removed. A missing or unwritable upload root is the exact
    // condition WS-17 Pass 0 existed to prevent, so it must surface as
    // unhealthy rather than be discovered when someone's document vanishes.
    try {
      await access(this.root, constants.R_OK | constants.W_OK);
      return { healthy: true, detail: "upload root is readable and writable" };
    } catch {
      return { healthy: false, detail: "upload root is missing or not writable" };
    }
  }
}
