/**
 * WS-17 Slice 1 — platform operations routes.
 *
 * Every route is gated by TWO things: `requireSuperAdmin` (platform boundary)
 * and `requirePlatformOperation(<key>)` (the specific authority). The
 * conjunction is written out on every route rather than bundled into one
 * helper, so a reader can see exactly what each endpoint demands and nobody can
 * widen authority by editing a shared default.
 *
 * WHAT THESE ROUTES DO NOT DO
 *
 * There is no restore endpoint — restore is a separately gated pass, and
 * shipping a route for it "ready to wire up later" would be shipping the
 * dangerous half without the governance. There is no command execution, no
 * shell, no path parameter that reaches a filesystem, and no endpoint that
 * returns a credential. Backup/telemetry ingestion is authenticated as an
 * ordinary platform operator action; there is deliberately no unauthenticated
 * agent ingestion endpoint, because that would require an installation
 * credential subsystem this slice does not build.
 */
import { Router, type IRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { requirePlatformOperation } from "../middlewares/requirePlatformOperation";
import {
  PLATFORM_OPERATION_PERMISSIONS as P,
  InstallationNotFoundError,
  InvalidOperationalStateError,
  recordDeployment,
  listDeployments,
  upsertBackupPolicy,
  getBackupPolicy,
  requestBackup,
  updateBackupRequestStatus,
  listBackupRequests,
  recordBackupRun,
  listBackupRuns,
  recordTelemetry,
  getInstallationHealth,
  getFleetHealth,
} from "../lib/platformOperations";

const router: IRouter = Router();

function parseId(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? null : d;
}

/** Maps domain errors to responses without leaking internals. */
function handle(err: unknown, res: import("express").Response): void {
  if (err instanceof InstallationNotFoundError) {
    res.status(404).json({ error: "Installation not found" });
    return;
  }
  if (err instanceof InvalidOperationalStateError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// --- Fleet Health ----------------------------------------------------------

router.get(
  "/platform/fleet",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (_req: AuthenticatedRequest, res): Promise<void> => {
    res.json({ installations: await getFleetHealth() });
  },
);

router.get(
  "/platform/installations/:installationId/health",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const health = await getInstallationHealth(id);
    if (!health) {
      res.status(404).json({ error: "Installation not found" });
      return;
    }
    res.json(health);
  },
);

// --- Deployment history ----------------------------------------------------

router.get(
  "/platform/installations/:installationId/deployments",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    res.json({ deployments: await listDeployments(id) });
  },
);

router.post(
  "/platform/installations/:installationId/deployments",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.DEPLOYMENT_MANAGE),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const body = req.body ?? {};
    const result = String(body.result ?? "");
    if (!["in_progress", "succeeded", "failed", "rolled_back"].includes(result)) {
      res.status(400).json({ error: "result must be in_progress, succeeded, failed or rolled_back" });
      return;
    }
    const executorType = String(body.executorType ?? "");
    if (!["operator", "ci_cd", "installation_agent", "provider", "imported_evidence"].includes(executorType)) {
      res.status(400).json({ error: "Invalid executorType" });
      return;
    }
    try {
      const record = await recordDeployment({
        installationId: id,
        applicationVersion: body.applicationVersion ?? null,
        gitCommit: body.gitCommit ?? null,
        migrationVersion: body.migrationVersion ?? null,
        result: result as "in_progress" | "succeeded" | "failed" | "rolled_back",
        startedAt: parseDate(body.startedAt),
        completedAt: parseDate(body.completedAt),
        executorType: executorType as never,
        externalReference: body.externalReference ?? null,
        notes: body.notes ?? null,
        actor: { userId: req.userId ?? null },
      });
      res.status(201).json(record);
    } catch (err) {
      handle(err, res);
    }
  },
);

// --- Backup policy ---------------------------------------------------------

router.get(
  "/platform/installations/:installationId/backup-policy",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const policy = await getBackupPolicy(id);
    if (!policy) {
      res.status(404).json({ error: "No backup policy configured" });
      return;
    }
    res.json(policy);
  },
);

router.put(
  "/platform/installations/:installationId/backup-policy",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_POLICY_MANAGE),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const body = req.body ?? {};
    try {
      const policy = await upsertBackupPolicy({
        installationId: id,
        enabled: body.enabled,
        strategy: body.strategy,
        expectedFrequencyHours: body.expectedFrequencyHours,
        targetRpoMinutes: body.targetRpoMinutes,
        targetRtoMinutes: body.targetRtoMinutes,
        retentionPolicyReference: body.retentionPolicyReference,
        databaseCoverage: body.databaseCoverage,
        binaryStorageCoverage: body.binaryStorageCoverage,
        executorType: body.executorType,
        supportsBackupRequests: body.supportsBackupRequests,
        actor: { userId: req.userId ?? null },
      });
      res.json(policy);
    } catch (err) {
      handle(err, res);
    }
  },
);

// --- Backup requests -------------------------------------------------------

router.get(
  "/platform/installations/:installationId/backup-requests",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    res.json({ requests: await listBackupRequests(id) });
  },
);

router.post(
  "/platform/installations/:installationId/backup-requests",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_REQUEST),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    try {
      const request = await requestBackup({
        installationId: id,
        reason: String(req.body?.reason ?? ""),
        backupType: req.body?.backupType,
        actor: { userId: req.userId ?? null },
      });
      res.status(201).json(request);
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/backup-requests/:requestId/status",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_EVIDENCE_RECORD),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    try {
      const updated = await updateBackupRequestStatus({
        requestId: id,
        status: req.body?.status,
        externalReference: req.body?.externalReference ?? null,
        statusDetail: req.body?.statusDetail ?? null,
        actor: { userId: req.userId ?? null },
      });
      res.json(updated);
    } catch (err) {
      handle(err, res);
    }
  },
);

// --- Backup evidence -------------------------------------------------------

router.get(
  "/platform/installations/:installationId/backup-runs",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    res.json({ runs: await listBackupRuns(id) });
  },
);

router.post(
  "/platform/installations/:installationId/backup-runs",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_EVIDENCE_RECORD),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const body = req.body ?? {};
    const component = ["succeeded", "failed", "not_attempted", "unknown"];
    if (!component.includes(String(body.databaseResult)) || !component.includes(String(body.binaryStorageResult))) {
      res.status(400).json({ error: "databaseResult and binaryStorageResult are required component results" });
      return;
    }
    try {
      // Note: `result` is never taken from the caller — it is derived from the
      // components, so a database-only backup cannot be reported as complete.
      const run = await recordBackupRun({
        installationId: id,
        requestId: body.requestId ?? null,
        backupType: body.backupType,
        databaseResult: body.databaseResult,
        binaryStorageResult: body.binaryStorageResult,
        startedAt: parseDate(body.startedAt),
        completedAt: parseDate(body.completedAt),
        recoveryPointAt: parseDate(body.recoveryPointAt),
        sizeBytes: body.sizeBytes ?? null,
        executorType: body.executorType ?? "operator",
        externalReference: body.externalReference ?? null,
        failureCategory: body.failureCategory ?? null,
        supersedesRunId: body.supersedesRunId ?? null,
        actor: { userId: req.userId ?? null },
      });
      res.status(201).json(run);
    } catch (err) {
      handle(err, res);
    }
  },
);

// --- Telemetry -------------------------------------------------------------

router.post(
  "/platform/installations/:installationId/telemetry",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_EVIDENCE_RECORD),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const observedAt = parseDate(req.body?.observedAt);
    if (!observedAt) {
      res.status(400).json({ error: "observedAt is required" });
      return;
    }
    try {
      const telemetry = await recordTelemetry({
        installationId: id,
        observedAt,
        reportedApplicationVersion: req.body?.reportedApplicationVersion ?? null,
        reportedGitCommit: req.body?.reportedGitCommit ?? null,
        reportedMigrationVersion: req.body?.reportedMigrationVersion ?? null,
        applicationHealthy: req.body?.applicationHealthy ?? null,
        databaseReady: req.body?.databaseReady ?? null,
        storageBackend: req.body?.storageBackend ?? null,
        storageHealthy: req.body?.storageHealthy ?? null,
        executorType: req.body?.executorType ?? "operator",
        actor: { userId: req.userId ?? null },
      });
      res.status(201).json(telemetry);
    } catch (err) {
      handle(err, res);
    }
  },
);

export default router;
