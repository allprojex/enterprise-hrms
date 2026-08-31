/**
 * WS-17 Pass 1 — the S3-COMPATIBLE backend.
 *
 * One backend, speaking standard S3 object semantics: PutObject, GetObject,
 * DeleteObject, HeadObject. That vocabulary is implemented by AWS S3, MinIO,
 * Ceph, Backblaze B2, DigitalOcean Spaces, Cloudflare R2, Supabase Storage's
 * S3 endpoint and others — so this is deliberately NOT an AWS adapter with
 * siblings to follow. There is no per-provider branch anywhere in this file,
 * and adding one would defeat the point.
 *
 * PUBLIC OBJECTS ARE NOT NEEDED, INCLUDING FOR THE LOGO
 *
 * The organization logo is the platform's one publicly-readable class, but its
 * "public" lives at the HTTP route, not in the object store: the route reads
 * the bytes server-side and serves them itself, after checking the requested
 * key against `organizations.logoUrl`. Nothing about it requires a public
 * object, a public bucket, or a presigned URL — so this backend never creates
 * any of those, and every object it stores stays private. Private HR content
 * is protected by the application authorization layer exactly as before;
 * storage access is not, and never becomes, authorization.
 */
import { Readable } from "stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { StorageObjectNotFoundError, StorageOperationError, type StorageBackend, type StorageObjectStat } from "./types";

export interface S3StorageConfig {
  bucket: string;
  region: string;
  /** Set for any non-AWS S3-compatible provider; omitted for AWS itself. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Most self-hosted S3-compatible servers need path-style addressing. */
  forcePathStyle: boolean;
}

/**
 * Reads configuration from the environment. Credentials live here and ONLY
 * here — never in a tenant table, never in an API response, never in a log
 * line, never in the frontend. Returns null when the backend is not
 * configured, so the caller can fail loudly rather than construct a client
 * that would fail later at an unhelpful moment.
 */
export function readS3ConfigFromEnv(): S3StorageConfig | null {
  const bucket = process.env.STORAGE_S3_BUCKET;
  const accessKeyId = process.env.STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    bucket,
    region: process.env.STORAGE_S3_REGION ?? "us-east-1",
    endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === "true",
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}

export class S3StorageBackend implements StorageBackend {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /**
   * The physical object key, derived SERVER-SIDE from the organization and the
   * application's own opaque key. A caller supplies neither bucket, nor
   * prefix, nor path — so organization scoping is unavoidable by construction,
   * and a key from one tenant cannot address another tenant's object.
   *
   * `..` and absolute-looking segments are rejected rather than normalized:
   * every real key is a server-generated `<subdir>/<48-hex>.<ext>`, so
   * anything else is a bug or an attack, and quietly cleaning it up would hide
   * both. RLS protects rows, never objects — this is where the object-side
   * tenant boundary is enforced.
   */
  private objectKey(organizationId: number, key: string): string {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new StorageOperationError("Invalid organization scope for object key");
    }
    const normalized = key.replace(/\\/g, "/");
    if (
      normalized.length === 0 ||
      normalized.startsWith("/") ||
      normalized.includes("//") ||
      normalized.split("/").some((segment) => segment === "." || segment === ".." || segment.length === 0)
    ) {
      throw new StorageOperationError("Invalid storage key");
    }
    return `organizations/${organizationId}/${normalized}`;
  }

  async write(organizationId: number, key: string, data: Buffer): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(organizationId, key), Body: data }),
      );
    } catch (err) {
      if (err instanceof StorageOperationError) throw err;
      throw new StorageOperationError("Failed to write object to S3-compatible storage", err);
    }
  }

  async read(organizationId: number, key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(organizationId, key) }),
      );
      const body = result.Body;
      if (!body) throw new StorageObjectNotFoundError();

      const chunks: Buffer[] = [];
      for await (const chunk of body as Readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err instanceof StorageObjectNotFoundError || err instanceof StorageOperationError) throw err;
      if (isNotFound(err)) throw new StorageObjectNotFoundError();
      throw new StorageOperationError("Failed to read object from S3-compatible storage", err);
    }
  }

  async delete(organizationId: number, key: string): Promise<boolean> {
    const objectKey = this.objectKey(organizationId, key);
    // S3 DeleteObject is idempotent and reports success for an absent key, so
    // existence is checked first to keep this backend's contract identical to
    // the filesystem one: `false` means "was already gone", never "failed".
    let existed: boolean;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      existed = true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw new StorageOperationError("Failed to check object before deletion in S3-compatible storage", err);
    }

    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return existed;
    } catch (err) {
      throw new StorageOperationError("Failed to delete object from S3-compatible storage", err);
    }
  }

  async stat(organizationId: number, key: string): Promise<StorageObjectStat | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(organizationId, key) }),
      );
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch (err) {
      if (err instanceof StorageOperationError) throw err;
      if (isNotFound(err)) return null;
      throw new StorageOperationError("Failed to stat object in S3-compatible storage", err);
    }
  }

  async health(): Promise<{ healthy: boolean; detail: string }> {
    // A HEAD against a key that is never expected to exist: it proves the
    // bucket is addressable and the credentials are accepted, without listing
    // business objects and without writing or deleting anything. A 404 is a
    // HEALTHY answer here — it means the request was authorized and served.
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: "__storage_health_probe__/never-written" }),
      );
      return { healthy: true, detail: "bucket reachable" };
    } catch (err) {
      if (isNotFound(err)) return { healthy: true, detail: "bucket reachable" };
      return { healthy: false, detail: "bucket unreachable or credentials rejected" };
    }
  }
}
