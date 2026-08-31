/**
 * WS-17 File Storage Durability, Pass 1 — the provider-neutral storage
 * contract.
 *
 * Deliberately tiny. It carries only the four operations this platform
 * actually performs today, plus a health probe the operational surface will
 * need. It is not an abstraction over "cloud storage" — it is an abstraction
 * over "where this application's bytes live", which is a much smaller thing.
 *
 * WHAT NEVER CROSSES THIS BOUNDARY
 *
 * Buckets, prefixes, endpoints, regions, credentials, filesystem paths,
 * presigned URLs, SDK command objects. A business module knows an
 * organization id and an opaque storage key, exactly as it did before this
 * pass, and that is the whole of its storage vocabulary. If a provider
 * concept ever appears in an HR module, this boundary has failed.
 *
 * WHY organizationId IS A SEPARATE ARGUMENT, NOT PART OF THE KEY
 *
 * The physical location is derived server-side from (organizationId, key).
 * A caller cannot address another tenant's bytes by presenting a key alone,
 * because the key does not encode where it lives. That property predates this
 * pass and is preserved exactly.
 */

/** Which implementation is serving storage. Matches `stored_object_backend`. */
export type StorageBackendKind = "filesystem" | "s3";

/** Raised when the object is genuinely absent. Distinct from a transport failure. */
export class StorageObjectNotFoundError extends Error {
  constructor(message = "Stored object not found") {
    super(message);
    this.name = "StorageObjectNotFoundError";
  }
}

/**
 * Raised for an operational failure — unreachable backend, permission denied,
 * disk full, transport error. Deliberately distinct from
 * `StorageObjectNotFoundError`, because "the bytes are gone" and "we could not
 * reach the store" must never be collapsed into one another: the first is a
 * fact about data, the second is a fact about infrastructure.
 */
export class StorageOperationError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StorageOperationError";
    this.cause = cause;
  }
}

export interface StorageObjectStat {
  sizeBytes: number;
}

export interface StorageBackend {
  readonly kind: StorageBackendKind;

  /** Persists bytes at (organizationId, key). Overwrites are never intended — keys are freshly generated per write. */
  write(organizationId: number, key: string, data: Buffer): Promise<void>;

  /** Reads bytes. Throws `StorageObjectNotFoundError` if absent, `StorageOperationError` if unreachable. */
  read(organizationId: number, key: string): Promise<Buffer>;

  /**
   * Removes bytes. Returns `true` if the object was removed, `false` if it was
   * already absent — an already-absent object is a satisfied intent, not a
   * failure. Throws `StorageOperationError` only when deletion genuinely could
   * not be carried out, which is the distinction the pre-Pass-1
   * `.catch(() => undefined)` destroyed.
   */
  delete(organizationId: number, key: string): Promise<boolean>;

  /** Size and existence, for reconciliation. Returns null when absent. */
  stat(organizationId: number, key: string): Promise<StorageObjectStat | null>;

  /**
   * Is the backend configured and reachable? Never touches business objects
   * and never writes or deletes anything real. An unreachable backend must
   * report unhealthy — never a fabricated green.
   */
  health(): Promise<{ healthy: boolean; detail: string }>;
}
