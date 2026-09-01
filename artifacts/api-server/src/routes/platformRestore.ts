/**
 * WS-17 Restore Governance routes.
 *
 * Every route requires `requireSuperAdmin` (platform boundary) plus a specific
 * platform grant, written out per route so nobody can widen authority by
 * editing a shared default. The service re-checks authority itself as well —
 * the middleware is defence in depth, not the only gate.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No shell route. No command route. No provider-credential route. No
 * unauthenticated executor callback — that needs a per-installation credential
 * lifecycle which does not exist yet, and a shared secret would be exactly the
 * unsafe shortcut the freeze warned against. Until then a trusted platform
 * operator records external evidence through these authenticated endpoints, and
 * the data model is shaped so a future callback can use it unchanged.
 *
 * No tenant routes: a physical restore belongs to an installation, and no
 * organization-scoped caller may see or touch one.
 */
import { Router, type IRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { requirePlatformOperation } from "../middlewares/requirePlatformOperation";
import {
  PLATFORM_OPERATION_PERMISSIONS as P,
  RESERVED_RESTORE_PERMISSIONS as R,
  RestoreAuthorityError,
  RestoreGovernanceError,
  RestoreNotFoundError,
  InstallationNotFoundError,
  submitRestoreRequest,
  decideRestoreRequest,
  precheckDispatch,
  invalidateApproval,
  dispatchRestore,
  recordExecutionEvidence,
  recordValidation,
  concludeValidation,
  cancelRestoreRequest,
  recordQuiescence,
  acknowledgeDrift,
  getRestoreRequest,
  listRestoreRequests,
  listApprovals,
  listExecutions,
  listValidations,
  getObservedRecoveryMetrics,
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

function handle(err: unknown, res: import("express").Response): void {
  if (err instanceof RestoreAuthorityError) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (err instanceof RestoreNotFoundError || err instanceof InstallationNotFoundError) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (err instanceof RestoreGovernanceError) {
    // The governance reason is genuinely useful to a platform operator — it
    // names the blocker (blast radius changed, checkpoint unresolved) without
    // exposing infrastructure internals.
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// --- Reads -----------------------------------------------------------------

router.get(
  "/platform/installations/:installationId/restore-requests",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    res.json({ requests: await listRestoreRequests(id) });
  },
);

router.get(
  "/platform/restore-requests/:requestId",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.FLEET_READ),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const request = await getRestoreRequest(id);
    if (!request) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Everything an approver must see before deciding, in one payload: the
    // request, what was approved before, every execution attempt, validation
    // evidence, the live precheck (blast-radius drift included) and observed
    // metrics. A one-click blind approval is not possible against this API.
    const [approvals, executions, validations, precheck, metrics] = await Promise.all([
      listApprovals(id),
      listExecutions(id),
      listValidations(id),
      precheckDispatch(id),
      getObservedRecoveryMetrics(id),
    ]);
    res.json({ request, approvals, executions, validations, precheck, metrics });
  },
);

// --- Request lifecycle -----------------------------------------------------

router.post(
  "/platform/installations/:installationId/restore-requests",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(R.RESTORE_REQUEST),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.installationId);
    if (id === null) {
      res.status(400).json({ error: "Invalid installation id" });
      return;
    }
    const b = req.body ?? {};
    if (!["recovery", "test"].includes(String(b.purpose))) {
      res.status(400).json({ error: "purpose must be recovery or test" });
      return;
    }
    if (!["backup_run", "pitr", "provider_snapshot"].includes(String(b.restorePointType))) {
      res.status(400).json({ error: "Invalid restorePointType" });
      return;
    }
    try {
      const created = await submitRestoreRequest({
        actor: req.user!,
        installationId: id,
        purpose: b.purpose,
        restorePointType: b.restorePointType,
        backupRunId: b.backupRunId ?? null,
        pitrTimestamp: parseDate(b.pitrTimestamp),
        providerReference: b.providerReference ?? null,
        reason: String(b.reason ?? ""),
        confirmationPhrase: String(b.confirmationPhrase ?? ""),
        incompleteAcknowledgementNote: b.incompleteAcknowledgementNote ?? null,
        preRestoreExceptionNote: b.preRestoreExceptionNote ?? null,
        preRestoreBackupRunId: b.preRestoreBackupRunId ?? null,
        quiescenceRequired: b.quiescenceRequired === true,
      });
      res.status(201).json(created);
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/decision",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(R.RESTORE_APPROVE),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const decision = String(req.body?.decision ?? "");
    if (!["approved", "rejected"].includes(decision)) {
      res.status(400).json({ error: "decision must be approved or rejected" });
      return;
    }
    try {
      const approval = await decideRestoreRequest({
        actor: req.user!,
        requestId: id,
        decision: decision as "approved" | "rejected",
        comment: req.body?.comment ?? null,
        expiresAt: parseDate(req.body?.expiresAt),
      });
      res.status(201).json(approval);
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/cancel",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(R.RESTORE_REQUEST),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    try {
      res.json(
        await cancelRestoreRequest({ actor: req.user!, requestId: id, reason: String(req.body?.reason ?? "") }),
      );
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/acknowledge-drift",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(R.RESTORE_REQUEST),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    try {
      res.json(await acknowledgeDrift({ actor: req.user!, requestId: id }));
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/invalidate-approval",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(R.RESTORE_APPROVE),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    await invalidateApproval(id, String(req.body?.reason ?? "manually invalidated"));
    res.json(await getRestoreRequest(id));
  },
);

// --- Quiescence, dispatch, evidence, validation ----------------------------

router.post(
  "/platform/restore-requests/:requestId/quiescence",
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
      res.json(
        await recordQuiescence({
          actor: req.user!,
          requestId: id,
          state: req.body?.state,
          evidence: req.body?.evidence ?? null,
        }),
      );
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/dispatch",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(R.RESTORE_REQUEST),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const idempotencyKey = String(req.body?.idempotencyKey ?? "");
    if (!idempotencyKey.trim()) {
      // Required, not generated server-side: the caller owns the identity of
      // its intent, which is what makes a retried request safe.
      res.status(400).json({ error: "idempotencyKey is required" });
      return;
    }
    try {
      // Produces governed execution INTENT. It runs nothing.
      const execution = await dispatchRestore({
        actor: req.user!,
        requestId: id,
        idempotencyKey,
        executorType: req.body?.executorType ?? null,
      });
      res.status(201).json(execution);
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-executions/:executionId/evidence",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_EVIDENCE_RECORD),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.executionId);
    if (id === null) {
      res.status(400).json({ error: "Invalid execution id" });
      return;
    }
    const status = String(req.body?.status ?? "");
    if (!["accepted", "started", "succeeded", "failed"].includes(status)) {
      res.status(400).json({ error: "Invalid execution status" });
      return;
    }
    try {
      res.json(
        await recordExecutionEvidence({
          actor: req.user!,
          executionId: id,
          status: status as "accepted" | "started" | "succeeded" | "failed",
          externalReference: req.body?.externalReference ?? null,
          failureCategory: req.body?.failureCategory ?? null,
          statusDetail: req.body?.statusDetail ?? null,
        }),
      );
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/validations",
  requireAuth as any,
  requireSuperAdmin,
  requirePlatformOperation(P.BACKUP_EVIDENCE_RECORD),
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const id = parseId(req.params.requestId);
    if (id === null) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const b = req.body ?? {};
    if (!["passed", "failed", "unknown", "not_applicable"].includes(String(b.result))) {
      res.status(400).json({ error: "Invalid validation result" });
      return;
    }
    if (!["automated", "operator_attestation"].includes(String(b.source))) {
      res.status(400).json({ error: "Invalid validation source" });
      return;
    }
    try {
      res.status(201).json(
        await recordValidation({
          actor: req.user!,
          requestId: id,
          executionId: b.executionId ?? null,
          checkKey: String(b.checkKey ?? ""),
          result: b.result,
          source: b.source,
          detail: b.detail ?? null,
        }),
      );
    } catch (err) {
      handle(err, res);
    }
  },
);

router.post(
  "/platform/restore-requests/:requestId/conclude-validation",
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
      res.json(await concludeValidation({ actor: req.user!, requestId: id }));
    } catch (err) {
      handle(err, res);
    }
  },
);

export default router;
