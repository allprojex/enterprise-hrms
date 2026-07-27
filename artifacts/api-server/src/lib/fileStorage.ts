import { randomBytes } from "crypto";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import path from "path";

// Private local-disk storage, organization-scoped by directory — portable
// across VPS/Docker/on-prem without a cloud-storage dependency (mount
// UPLOADS_DIR as a volume in Docker). Never served directly by static
// middleware; files are only readable through an authenticated, permission
// checked route (see routes/employees.ts).
const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");

/** Random, unguessable filename — never derived from user-supplied input. */
export function generateStorageFilename(extension: string): string {
  return `${randomBytes(24).toString("hex")}.${extension}`;
}

function resolveOrgScopedPath(organizationId: number, key: string): string {
  return path.join(UPLOADS_ROOT, "organizations", String(organizationId), key);
}

/**
 * Writes a buffer under an organization's private storage tree and returns
 * the storage key to persist in the database. `subdir` must be a fixed,
 * code-controlled literal (e.g. "avatars") — never client input; the
 * filename itself is always freshly generated, so there is no path-
 * traversal surface as long as callers respect that.
 */
export async function writeOrgFile(
  organizationId: number,
  subdir: string,
  extension: string,
  data: Buffer,
): Promise<string> {
  const key = path.posix.join(subdir, generateStorageFilename(extension));
  const fullPath = resolveOrgScopedPath(organizationId, key);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
  return key;
}

/** Reads a previously-stored file by its key (as read from the database, never from a request param). */
export async function readOrgFile(organizationId: number, key: string): Promise<Buffer> {
  return readFile(resolveOrgScopedPath(organizationId, key));
}

/** Deletes a stored file; a no-op if it's already gone. */
export async function deleteOrgFile(organizationId: number, key: string): Promise<void> {
  await unlink(resolveOrgScopedPath(organizationId, key)).catch(() => undefined);
}
