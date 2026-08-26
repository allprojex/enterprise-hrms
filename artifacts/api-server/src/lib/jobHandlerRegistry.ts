/**
 * WS-6 (§11) — the central job-handler registry.
 *
 * A `jobType` string on a `scheduled_jobs` row is never itself executable —
 * it is only ever a lookup key into this registry, which is populated
 * exclusively by server-side module code at boot (see jobHandlers/index.ts).
 * There is no dynamic `import(jobType)` or any other mechanism anywhere in
 * this codebase that turns database content into code; a `jobType` value a
 * caller invents (or an attacker injects via a compromised payload) that
 * isn't already registered here simply has no handler and fails safely as
 * `UnknownJobTypeError` — a permanent, non-retryable failure (see
 * lib/scheduledJobs.ts's `classifyError`).
 */
import { z } from "zod/v4";

export interface JobExecutionContext<TPayload> {
  jobId: number;
  organizationId: number | null;
  sourceReferenceType: string | null;
  sourceReferenceId: number | null;
  payload: TPayload;
  attemptCount: number;
}

/**
 * Thrown by a handler to mark its own failure as retry-worthy (a transient
 * dependency failure) or not (bad/obsolete input, authorization no longer
 * valid). Handlers that throw an unclassified error are treated as
 * transient by default — see lib/scheduledJobs.ts's `classifyError` — so a
 * handler only needs to reach for `PermanentJobError` when it has positively
 * determined retrying cannot help.
 */
export class TransientJobError extends Error {}
export class PermanentJobError extends Error {}

export interface JobHandlerDefinition<TPayload = unknown> {
  /**
   * Parses/validates the raw JSON payload before `execute` ever sees it.
   * A payload that fails validation is a `PermanentJobError` — retrying an
   * already-malformed payload can never succeed.
   */
  parsePayload: (raw: unknown) => TPayload;
  execute: (ctx: JobExecutionContext<TPayload>) => Promise<void>;
  /** Overrides scheduled_jobs.maxAttempts' table default (5) for this job type, when justified. */
  defaultMaxAttempts?: number;
}

const registry = new Map<string, JobHandlerDefinition<any>>();

export class DuplicateJobHandlerError extends Error {
  constructor(jobType: string) {
    super(`Job type "${jobType}" is already registered`);
    this.name = "DuplicateJobHandlerError";
  }
}

/** Registers a handler for `jobType`. Throws if that type is already registered — a handler is never silently replaced. */
export function registerJobHandler<TPayload>(jobType: string, definition: JobHandlerDefinition<TPayload>): void {
  if (registry.has(jobType)) throw new DuplicateJobHandlerError(jobType);
  registry.set(jobType, definition);
}

export function getJobHandler(jobType: string): JobHandlerDefinition<unknown> | undefined {
  return registry.get(jobType);
}

export function listRegisteredJobTypes(): string[] {
  return [...registry.keys()];
}

/** Test-only escape hatch: removes a handler so a test can register its own without colliding with a prior run. Never called by production code. */
export function unregisterJobHandlerForTests(jobType: string): void {
  registry.delete(jobType);
}

/** Shared helper for handlers built on zod: wraps `.parse` so a schema failure surfaces as the correct permanent-failure class. */
export function zodPayloadParser<T extends z.ZodType>(schema: T): (raw: unknown) => z.infer<T> {
  return (raw: unknown) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new PermanentJobError(`Invalid job payload: ${result.error.issues.map((i) => i.message).join("; ")}`);
    }
    return result.data;
  };
}
