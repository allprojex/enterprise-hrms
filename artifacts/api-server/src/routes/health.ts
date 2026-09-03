import { APP_VERSION } from "../lib/releaseInfo";
import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Deploy-time release identification (Operational Foundation): optional,
// injected by whatever deploys this build (CI, a Dockerfile ARG, a manual
// `export` before `pnpm start`) — never required, never guessed. Falls back
// to "unknown" rather than fabricating a value, so a healthz response never
// implies a release identity that wasn't actually set.
// Single source of release identity, shared with the logger and the Super
// Admin tenant identity surface (lib/releaseInfo.ts).
const RELEASE_VERSION = APP_VERSION;

// Liveness only — is the process itself up and serving requests. Never
// touches the database, so it stays cheap and can't be dragged down by a
// database outage (that's what /readyz is for). A load balancer or
// orchestrator restarts the process on a failing liveness check; it must
// never restart a healthy process just because its database is briefly
// unreachable.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok", version: RELEASE_VERSION });
  res.json(data);
});

// Readiness — is this instance ready to accept traffic that needs the
// database. A load balancer/orchestrator should stop routing traffic here
// (not restart the process) on a failing readiness check; the same
// distinction resolveTenantHost's own fail-closed design relies on
// elsewhere — an infrastructure failure is data to react to, not a crash.
router.get("/readyz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json(ReadinessCheckResponse.parse({ status: "ready", database: "ok" }));
  } catch (err) {
    logger.error({ err }, "readiness check: database unreachable");
    res.status(503).json(ReadinessCheckResponse.parse({ status: "not_ready", database: "error" }));
  }
});

export default router;
