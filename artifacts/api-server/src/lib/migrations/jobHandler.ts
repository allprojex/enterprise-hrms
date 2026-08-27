/**
 * WS-7 (§40) — optional WS-6 integration: executing a large migration in the
 * worker process instead of holding an HTTP request open for minutes.
 *
 * Registered as an allow-listed WS-6 job type, following that workstream's
 * own rules rather than inventing a parallel background mechanism:
 *
 *  - The payload is deliberately narrow — batch id and actor ids only. It
 *    carries no HR content, no file contents, and no pre-resolved decisions:
 *    the handler re-fetches authoritative state from the database every
 *    time, so a job row sitting in the queue can never encode a stale plan.
 *  - Execution is chunked and resumable. `executeBatch` only ever picks up
 *    staged rows still `pending`, so a crashed/retried attempt continues
 *    where it stopped and can never re-import a committed row.
 *  - The job re-schedules itself while rows remain, rather than running an
 *    unbounded loop inside one job execution — a long-running handler
 *    would be reclaimed mid-flight by the worker's own lock timeout.
 *  - A batch in a state that can no longer execute is a `PermanentJobError`
 *    (retrying cannot help), not a transient failure.
 */
import { z } from "zod/v4";
import { PermanentJobError, registerJobHandler, zodPayloadParser } from "../jobHandlerRegistry";
import { scheduleJob } from "../scheduledJobs";
import { InvalidMigrationStateError, MigrationNotFoundError, SourceIntegrityError } from "./batchService";
import { executeBatch } from "./executionService";

export const MIGRATION_EXECUTE_JOB_TYPE = "migration.execute_chunk";

/** Rows per job execution — bounded so a single execution stays comfortably inside the worker's lock timeout. */
const ROWS_PER_JOB = 500;

const payloadSchema = z.object({
  batchId: z.number().int().positive(),
  actorApplicationUserId: z.number().int().positive(),
  actorMembershipId: z.number().int().positive(),
});

export type MigrationExecuteChunkPayload = z.infer<typeof payloadSchema>;

let registered = false;

export function registerMigrationJobHandler(): void {
  if (registered) return;
  registered = true;

  registerJobHandler<MigrationExecuteChunkPayload>(MIGRATION_EXECUTE_JOB_TYPE, {
    parsePayload: zodPayloadParser(payloadSchema),
    execute: async (ctx) => {
      if (ctx.organizationId == null) {
        throw new PermanentJobError("A migration execution job must be scoped to an organization");
      }

      let progress;
      try {
        progress = await executeBatch({
          organizationId: ctx.organizationId,
          batchId: ctx.payload.batchId,
          actorApplicationUserId: ctx.payload.actorApplicationUserId,
          actorMembershipId: ctx.payload.actorMembershipId,
          maxRows: ROWS_PER_JOB,
        });
      } catch (err) {
        // These three are all "this migration can never execute as it
        // stands" — a human has to act, so retrying is pure noise.
        if (err instanceof MigrationNotFoundError || err instanceof InvalidMigrationStateError || err instanceof SourceIntegrityError) {
          throw new PermanentJobError(err.message);
        }
        throw err;
      }

      if (progress.remaining > 0) {
        // Chain the next chunk. The idempotency key encodes how far we've
        // got, so a retry of THIS job cannot queue two successors.
        await scheduleJob({
          organizationId: ctx.organizationId,
          jobType: MIGRATION_EXECUTE_JOB_TYPE,
          idempotencyKey: `migration:${ctx.payload.batchId}:remaining:${progress.remaining}`,
          scheduledFor: new Date(),
          sourceReferenceType: "migration_batch",
          sourceReferenceId: ctx.payload.batchId,
          payload: ctx.payload,
        });
      }
    },
  });
}

/** Queues the first chunk of a large migration. Idempotent per batch. */
export async function enqueueMigrationExecution(params: {
  organizationId: number;
  batchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  await scheduleJob({
    organizationId: params.organizationId,
    jobType: MIGRATION_EXECUTE_JOB_TYPE,
    idempotencyKey: `migration:${params.batchId}:start`,
    scheduledFor: new Date(),
    sourceReferenceType: "migration_batch",
    sourceReferenceId: params.batchId,
    payload: {
      batchId: params.batchId,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    },
  });
}
