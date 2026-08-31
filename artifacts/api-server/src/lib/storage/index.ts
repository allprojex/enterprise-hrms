/**
 * WS-17 Pass 1 — backend selection.
 *
 * The backend is an INSTALLATION/ENVIRONMENT decision, read from
 * `STORAGE_BACKEND`. It is deliberately not a tenant setting, not an
 * organization column and not a user preference: letting a tenant choose where
 * its bytes live would mean letting a tenant influence infrastructure, and
 * credentials would have to become tenant data to make it work. Neither is
 * acceptable, so there is no table to change and no API to call.
 *
 * Default is `filesystem`, so development, tests and existing self-managed
 * installations keep working with nothing configured and no object storage
 * anywhere.
 */
import { FilesystemStorageBackend } from "./filesystemBackend";
import { S3StorageBackend, readS3ConfigFromEnv } from "./s3Backend";
import { StorageOperationError, type StorageBackend, type StorageBackendKind } from "./types";

export * from "./types";
export { FilesystemStorageBackend } from "./filesystemBackend";
export { S3StorageBackend, readS3ConfigFromEnv, type S3StorageConfig } from "./s3Backend";

let cached: StorageBackend | null = null;

function build(): StorageBackend {
  const configured = (process.env.STORAGE_BACKEND ?? "filesystem").trim().toLowerCase();

  if (configured === "filesystem") return new FilesystemStorageBackend();

  if (configured === "s3") {
    const config = readS3ConfigFromEnv();
    if (!config) {
      // Fail loudly and immediately. Silently falling back to the filesystem
      // would write authoritative business data somewhere the operator did
      // not intend and does not back up — the precise failure mode WS-17
      // exists to eliminate.
      throw new StorageOperationError(
        "STORAGE_BACKEND=s3 requires STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY",
      );
    }
    return new S3StorageBackend(config);
  }

  throw new StorageOperationError(`Unsupported STORAGE_BACKEND: ${configured}`);
}

/** The configured backend, constructed once per process. */
export function getStorageBackend(): StorageBackend {
  if (!cached) cached = build();
  return cached;
}

/** The configured backend's kind, for metadata and operational reporting. */
export function getStorageBackendKind(): StorageBackendKind {
  return getStorageBackend().kind;
}

/** Test seam only — lets a suite install a backend without touching env or module state elsewhere. */
export function __setStorageBackendForTests(backend: StorageBackend | null): void {
  cached = backend;
}
