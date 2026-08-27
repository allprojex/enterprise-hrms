import app from "./app";
import { logger } from "./lib/logger";
// WS-6: the web process only ever schedules jobs (never claims/executes
// them — see src/worker.ts), but scheduleJob() validates jobType against
// this same registry before inserting, so it must be populated here too.
import { registerShippedJobHandlers } from "./lib/jobHandlers";
// WS-7: entity adapters must also be registered in the web process — the
// migration routes validate `entityType` against this same registry before
// creating a migration_sources row.
import { registerShippedEntityAdapters } from "./lib/migrations/registerEntityAdapters";

registerShippedJobHandlers();
registerShippedEntityAdapters();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
