/**
 * WS-17 Restore Governance — physical restore, governed end to end.
 *
 * THE HRMS GOVERNS. INFRASTRUCTURE EXECUTES.
 *
 * Nothing in this file runs `pg_restore`, triggers PITR, rolls back a snapshot,
 * opens an SSH session or executes a command. There is no provider credential
 * and no callback secret. What it produces is governed intent, recorded
 * authority, explicit risk acceptance, and evidence — and it refuses to let any
 * of those be faked.
 *
 * FIVE INVARIANTS THIS MODULE EXISTS TO ENFORCE
 *
 *  1. **Production maker-checker is not configurable.** `requester.userId !==
 *     approver.userId`, compared on immutable user ids — never names, emails or
 *     memberships, because platform authority is user-scoped.
 *  2. **A partial recovery point is blocked** unless the missing component is
 *     named and explicitly accepted, and the approver sees that acceptance.
 *     `unknown` is never `complete`.
 *  3. **An approver approves a blast radius, not an id.** If the affected
 *     organization set changes after approval, the approval is invalidated.
 *  4. **Execution success is not validation success.** They are separate states
 *     with separate evidence, and one never implies the other.
 *  5. **Nothing pretends.** Unsupported is never "completed", unknown is never
 *     "healthy", and the control plane never claims it stopped traffic or
 *     cancelled infrastructure work it does not control.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  installationsTable,
  installationBackupRunsTable,
  installationRestoreRequestsTable,
  installationRestoreApprovalsTable,
  installationRestoreExecutionsTable,
  installationRestoreValidationsTable,
  type InstallationRestoreRequest,
  type InstallationRestoreApproval,
  type InstallationRestoreExecution,
  type InstallationRestoreValidation,
  type RestoreCompleteness,
  type RestorePurpose,
  type PreRestoreCheckpointState,
  type QuiescenceState,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { deriveBackupRunResult, listAffectedOrganizations, InstallationNotFoundError } from "./operations";
import { PLATFORM_OPERATION_PERMISSIONS, RESERVED_RESTORE_PERMISSIONS, hasPlatformAuthority } from "./authority";
import type { User } from "../membership";

export class RestoreAuthorityError extends Error {
  constructor(message = "Restore authority required") {
    super(message);
    this.name = "RestoreAuthorityError";
  }
}
export class RestoreGovernanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreGovernanceError";
  }
}
export class RestoreNotFoundError extends Error {
  constructor() {
    super("Restore request not found");
    this.name = "RestoreNotFoundError";
  }
}

/** The exact phrase an operator must type. Bound to the target, never generic. */
export function expectedConfirmationPhrase(installationKey: string, environment: string): string {
  return `RESTORE ${installationKey} ${environment.toUpperCase()}`;
}

/** Legal request transitions. Everything else is refused, never silently applied. */
const TRANSITIONS: Record<InstallationRestoreRequest["status"], readonly InstallationRestoreRequest["status"][]> = {
  submitted: ["approved", "rejected", "cancelled", "expired"],
  approved: ["dispatched", "cancelled", "expired", "submitted"], // back to submitted when drift invalidates approval
  rejected: [],
  dispatched: ["executing", "failed", "cancelled"],
  executing: ["succeeded", "failed"],
  succeeded: ["validated", "validation_failed"],
  failed: ["dispatched"], // a retry creates a NEW attempt; both are preserved
  validated: [],
  validation_failed: [],
  cancelled: [],
  expired: [],
};

function assertTransition(from: InstallationRestoreRequest["status"], to: InstallationRestoreRequest["status"]): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new RestoreGovernanceError(`Cannot move a restore request from ${from} to ${to}`);
  }
}

async function requireRequest(requestId: number): Promise<InstallationRestoreRequest> {
  const [row] = await db
    .select()
    .from(installationRestoreRequestsTable)
    .where(eq(installationRestoreRequestsTable.id, requestId));
  if (!row) throw new RestoreNotFoundError();
  return row;
}

/**
 * Does this installation demand a second approver?
 *
 * Production is ALWAYS true and never consults the column, so no
 * misconfiguration can switch it off. Environment naming is never used to infer
 * relaxation — only the explicit column, and only outside production. An
 * unconfigured installation defaults to `always_required`, so absence fails safe.
 */
export function requiresMakerChecker(installation: {
  environmentType: string;
  restoreApprovalPolicy: string;
}): boolean {
  if (installation.environmentType === "production") return true;
  return installation.restoreApprovalPolicy !== "single_operator_non_production";
}

/**
 * Assesses a recovery point's coverage from RECORDED backup evidence, never
 * from a caller-supplied flag.
 *
 * A PITR point or a provider snapshot has no component evidence in this
 * platform at all, so it is `unknown` — honestly, rather than optimistically.
 */
export async function assessRestorePoint(params: {
  restorePointType: "backup_run" | "pitr" | "provider_snapshot";
  backupRunId?: number | null;
}): Promise<{ completeness: RestoreCompleteness; incompleteComponents: string[]; recoveryPointAt: Date | null }> {
  if (params.restorePointType !== "backup_run") {
    return {
      completeness: "unknown",
      incompleteComponents: ["database", "binary_storage"],
      recoveryPointAt: null,
    };
  }

  if (!params.backupRunId) throw new RestoreGovernanceError("A backup run reference is required for this restore point type");

  const [run] = await db
    .select()
    .from(installationBackupRunsTable)
    .where(eq(installationBackupRunsTable.id, params.backupRunId));
  if (!run) throw new RestoreGovernanceError("Backup run not found");

  const derived = deriveBackupRunResult(run.databaseResult, run.binaryStorageResult);
  const incomplete: string[] = [];
  if (run.databaseResult !== "succeeded") incomplete.push(`database:${run.databaseResult}`);
  if (run.binaryStorageResult !== "succeeded") incomplete.push(`binary_storage:${run.binaryStorageResult}`);

  return {
    completeness: derived === "succeeded" ? "complete" : derived === "failed" ? "unknown" : "partial",
    incompleteComponents: incomplete,
    recoveryPointAt: run.recoveryPointAt,
  };
}

export interface SubmitRestoreParams {
  actor: User;
  installationId: number;
  purpose: RestorePurpose;
  restorePointType: "backup_run" | "pitr" | "provider_snapshot";
  backupRunId?: number | null;
  pitrTimestamp?: Date | null;
  providerReference?: string | null;
  reason: string;
  confirmationPhrase: string;
  /** Required when the recovery point is not `complete`. Names what is being accepted. */
  incompleteAcknowledgementNote?: string | null;
  /** Required when production cannot take a fresh checkpoint. */
  preRestoreExceptionNote?: string | null;
  preRestoreBackupRunId?: number | null;
  quiescenceRequired?: boolean;
}

/**
 * Submits a restore request. Every material field, both risk acceptances and
 * the target-bound confirmation are required here — there is deliberately no
 * `draft` state in which a half-formed production restore can sit.
 */
export async function submitRestoreRequest(params: SubmitRestoreParams): Promise<InstallationRestoreRequest> {
  if (!(await hasPlatformAuthority(params.actor, RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST))) {
    throw new RestoreAuthorityError("platform.restore.request is required to submit a restore");
  }

  const [installation] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, params.installationId));
  if (!installation) throw new InstallationNotFoundError();

  const reason = params.reason?.trim() ?? "";
  if (!reason) throw new RestoreGovernanceError("A reason is required");

  // A rehearsal must never touch production, and this is enforced here rather
  // than hidden in a UI: a test that can hit production is not a test.
  if (params.purpose === "test" && installation.environmentType === "production") {
    throw new RestoreGovernanceError("A restore test may never target a production installation");
  }

  // Target-bound confirmation. A generic "RESTORE" or a checkbox proves the
  // operator clicked something; this proves they knew which installation and
  // which environment they were about to roll back.
  const expected = expectedConfirmationPhrase(installation.installationKey, installation.environmentType);
  if ((params.confirmationPhrase ?? "").trim() !== expected) {
    throw new RestoreGovernanceError(`Confirmation phrase must be exactly: ${expected}`);
  }

  const assessment = await assessRestorePoint({
    restorePointType: params.restorePointType,
    backupRunId: params.backupRunId,
  });

  // BLOCK BY DEFAULT on an incomplete recovery point. Proceeding is a recorded
  // risk acceptance naming the missing component — never a dismissed banner and
  // never a bare `allowPartial=true`.
  const acknowledgement = params.incompleteAcknowledgementNote?.trim() ?? "";
  if (assessment.completeness !== "complete" && !acknowledgement) {
    throw new RestoreGovernanceError(
      `Recovery point is ${assessment.completeness} (${assessment.incompleteComponents.join(", ")}). ` +
        "An explicit acknowledgement naming the incomplete component is required.",
    );
  }

  // Production wants a fresh safety checkpoint. If the executor cannot take
  // one, that is an exception to be acknowledged — never silently treated as
  // satisfied, and never satisfied by pointing at an old backup.
  let checkpointState: PreRestoreCheckpointState = "not_required";
  if (installation.environmentType === "production" && params.purpose === "recovery") {
    if (params.preRestoreBackupRunId) {
      checkpointState = "satisfied";
    } else if (params.preRestoreExceptionNote?.trim()) {
      checkpointState = "unsupported_acknowledged";
    } else {
      checkpointState = "required";
    }
  }

  const affected = await listAffectedOrganizations(params.installationId);
  const quiescence: QuiescenceState = params.quiescenceRequired ? "required" : "not_required";

  const [record] = await db
    .insert(installationRestoreRequestsTable)
    .values({
      installationId: params.installationId,
      environmentSnapshot: installation.environmentType,
      purpose: params.purpose,
      status: "submitted",
      restorePointType: params.restorePointType,
      backupRunId: params.backupRunId ?? null,
      pitrTimestamp: params.pitrTimestamp ?? null,
      providerReference: params.providerReference ?? null,
      recoveryPointAt: assessment.recoveryPointAt ?? params.pitrTimestamp ?? null,
      completeness: assessment.completeness,
      incompleteComponents: assessment.incompleteComponents,
      incompleteAcknowledgedAt: acknowledgement ? new Date() : null,
      incompleteAcknowledgementNote: acknowledgement || null,
      preRestoreCheckpointState: checkpointState,
      preRestoreBackupRunId: params.preRestoreBackupRunId ?? null,
      preRestoreExceptionNote: params.preRestoreExceptionNote?.trim() || null,
      quiescenceState: quiescence,
      affectedOrganizationIdsSnapshot: affected.map((a) => a.organizationId),
      reason,
      confirmationVerifiedAt: new Date(),
      requestedByUserId: params.actor.id,
      applicationVersionAtRequest: installation.applicationVersion,
      gitCommitAtRequest: installation.gitCommit,
      migrationVersionAtRequest: installation.migrationVersion,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: "platform_restore.submitted",
    targetType: "installation_restore_request",
    targetId: String(record.id),
    afterState: {
      installationId: params.installationId,
      environment: installation.environmentType,
      purpose: params.purpose,
      completeness: assessment.completeness,
      incompleteComponents: assessment.incompleteComponents,
      riskAccepted: acknowledgement.length > 0,
      preRestoreCheckpointState: checkpointState,
      affectedOrganizationCount: affected.length,
    },
  });

  return record;
}

/**
 * Approves or rejects. The approval row is APPEND-ONLY and freezes what the
 * approver actually saw — blast radius and both risk acceptances — so the
 * evidence survives every later state change.
 */
export async function decideRestoreRequest(params: {
  actor: User;
  requestId: number;
  decision: "approved" | "rejected";
  comment?: string | null;
  /** Policy-driven only. No platform default duration is ever invented. */
  expiresAt?: Date | null;
}): Promise<InstallationRestoreApproval> {
  if (!(await hasPlatformAuthority(params.actor, RESERVED_RESTORE_PERMISSIONS.RESTORE_APPROVE))) {
    throw new RestoreAuthorityError("platform.restore.approve is required to decide a restore");
  }

  const request = await requireRequest(params.requestId);
  if (request.status !== "submitted") {
    throw new RestoreGovernanceError(`Only a submitted restore request can be decided (is ${request.status})`);
  }

  const [installation] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, request.installationId));
  if (!installation) throw new InstallationNotFoundError();

  // MAKER-CHECKER. Compared on immutable user id — never a name, an email or a
  // membership. Production can never switch this off.
  if (requiresMakerChecker(installation) && request.requestedByUserId === params.actor.id) {
    throw new RestoreGovernanceError("The requester of a restore may not approve it");
  }

  // What the approver is looking at, right now — not what was true at submission.
  const currentAffected = (await listAffectedOrganizations(request.installationId)).map((a) => a.organizationId);

  const [approval] = await db
    .insert(installationRestoreApprovalsTable)
    .values({
      requestId: params.requestId,
      decision: params.decision,
      approverUserId: params.actor.id,
      comment: params.comment ?? null,
      affectedOrganizationIdsAtDecision: currentAffected,
      completenessAtDecision: request.completeness,
      preRestoreCheckpointAtDecision: request.preRestoreCheckpointState,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  const next = params.decision === "approved" ? "approved" : "rejected";
  assertTransition(request.status, next);
  await db
    .update(installationRestoreRequestsTable)
    .set({ status: next, statusChangedAt: new Date() })
    .where(eq(installationRestoreRequestsTable.id, params.requestId));

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: params.decision === "approved" ? "platform_restore.approved" : "platform_restore.rejected",
    targetType: "installation_restore_request",
    targetId: String(params.requestId),
    afterState: {
      approvalId: approval.id,
      approverUserId: params.actor.id,
      requesterUserId: request.requestedByUserId,
      affectedOrganizationIds: currentAffected,
      completeness: request.completeness,
      expiresAt: approval.expiresAt,
    },
  });

  return approval;
}

/** The live approval for a request, if one stands. */
export async function getStandingApproval(requestId: number): Promise<InstallationRestoreApproval | null> {
  const [row] = await db
    .select()
    .from(installationRestoreApprovalsTable)
    .where(
      and(
        eq(installationRestoreApprovalsTable.requestId, requestId),
        eq(installationRestoreApprovalsTable.decision, "approved"),
        isNull(installationRestoreApprovalsTable.invalidatedAt),
      ),
    )
    .orderBy(desc(installationRestoreApprovalsTable.decidedAt))
    .limit(1);
  return row ?? null;
}

export interface DispatchPrecheck {
  ok: boolean;
  blockers: string[];
  /** Non-invalidating drift the operator must re-acknowledge before dispatch. */
  driftRequiringAcknowledgement: string[];
}

/**
 * Revalidates every precondition immediately before dispatch.
 *
 * This is where an approval stops being a rubber stamp. Approval-invalidating
 * drift — a changed blast radius above all — sends the request back for renewed
 * approval, because the approver consented to a specific set of affected
 * customers. Softer drift (a new deployment) leaves the approval standing but
 * demands a fresh acknowledgement of the current operational state.
 */
export async function precheckDispatch(requestId: number): Promise<DispatchPrecheck> {
  const request = await requireRequest(requestId);
  const blockers: string[] = [];
  const drift: string[] = [];

  if (request.status !== "approved" && request.status !== "failed") {
    blockers.push(`request status is ${request.status}`);
  }

  const [installation] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, request.installationId));
  if (!installation) return { ok: false, blockers: ["installation no longer exists"], driftRequiringAcknowledgement: [] };

  const approval = await getStandingApproval(requestId);
  if (requiresMakerChecker(installation) || request.status === "approved") {
    if (!approval) blockers.push("no standing approval");
    else if (approval.expiresAt && approval.expiresAt.getTime() <= Date.now()) blockers.push("approval has expired");
  }

  // The blast radius the approver agreed to.
  const current = (await listAffectedOrganizations(request.installationId)).map((a) => a.organizationId).sort();
  const approved = ((approval?.affectedOrganizationIdsAtDecision as number[] | null) ?? []).slice().sort();
  if (approval && JSON.stringify(current) !== JSON.stringify(approved)) {
    blockers.push("affected organizations changed since approval");
  }

  if (installation.environmentType !== request.environmentSnapshot) blockers.push("installation environment changed");

  // Production requires the safety checkpoint to be resolved one way or the
  // other — satisfied, or an acknowledged exception. `required` is unresolved.
  if (request.preRestoreCheckpointState === "required") {
    blockers.push("pre-restore checkpoint is required but not satisfied");
  }
  if (request.quiescenceState === "required") {
    blockers.push("quiescence is required but not confirmed");
  }

  if (installation.applicationVersion !== request.applicationVersionAtRequest) drift.push("application version changed");
  if (installation.gitCommit !== request.gitCommitAtRequest) drift.push("git commit changed");
  if (installation.migrationVersion !== request.migrationVersionAtRequest) drift.push("migration version changed");
  if (drift.length > 0 && !request.driftAcknowledgedAt) {
    blockers.push("operational state changed since request; re-acknowledgement required");
  }

  return { ok: blockers.length === 0, blockers, driftRequiringAcknowledgement: drift };
}

/**
 * Invalidates a standing approval — used when blast radius or another material
 * field drifted. The approval ROW is never rewritten; it is stamped and the
 * request returns to `submitted` for renewed approval.
 */
export async function invalidateApproval(requestId: number, reason: string): Promise<void> {
  const approval = await getStandingApproval(requestId);
  if (!approval) return;
  await db
    .update(installationRestoreApprovalsTable)
    .set({ invalidatedAt: new Date(), invalidationReason: reason })
    .where(eq(installationRestoreApprovalsTable.id, approval.id));
  await db
    .update(installationRestoreRequestsTable)
    .set({ status: "submitted", statusChangedAt: new Date(), statusDetail: reason })
    .where(eq(installationRestoreRequestsTable.id, requestId));

  await recordAuditEvent({
    actorApplicationUserId: null,
    organizationId: null,
    eventType: "platform_restore.approval_invalidated",
    targetType: "installation_restore_request",
    targetId: String(requestId),
    afterState: { approvalId: approval.id, reason },
  });
}

/**
 * Produces governed execution INTENT. It dispatches nothing itself — no
 * command, no provider call — and dispatch never means the restore succeeded.
 *
 * Idempotent by key: a double-click or a retried HTTP call cannot start a
 * second physical restore.
 */
export async function dispatchRestore(params: {
  actor: User;
  requestId: number;
  idempotencyKey: string;
  executorType?: string | null;
}): Promise<InstallationRestoreExecution> {
  // Authority is re-checked live at dispatch: a grant revoked since approval
  // must not still let someone start a production restore.
  if (!(await hasPlatformAuthority(params.actor, RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST))) {
    throw new RestoreAuthorityError("platform.restore.request is required to dispatch a restore");
  }

  const key = params.idempotencyKey?.trim() ?? "";
  if (!key) throw new RestoreGovernanceError("An idempotency key is required to dispatch a restore");

  const [existing] = await db
    .select()
    .from(installationRestoreExecutionsTable)
    .where(eq(installationRestoreExecutionsTable.idempotencyKey, key));
  if (existing) return existing; // exactly one execution per dispatch intent

  const precheck = await precheckDispatch(params.requestId);
  if (!precheck.ok) throw new RestoreGovernanceError(`Dispatch blocked: ${precheck.blockers.join("; ")}`);

  const request = await requireRequest(params.requestId);
  const attempts = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(installationRestoreExecutionsTable)
    .where(eq(installationRestoreExecutionsTable.requestId, params.requestId));
  const attemptNumber = (attempts[0]?.n ?? 0) + 1;

  const [execution] = await db
    .insert(installationRestoreExecutionsTable)
    .values({
      requestId: params.requestId,
      attemptNumber,
      status: "dispatched",
      idempotencyKey: key,
      dispatchedByUserId: params.actor.id,
      executorType: params.executorType ?? null,
    })
    .returning();

  assertTransition(request.status, "dispatched");
  await db
    .update(installationRestoreRequestsTable)
    .set({ status: "dispatched", statusChangedAt: new Date() })
    .where(eq(installationRestoreRequestsTable.id, params.requestId));

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: "platform_restore.dispatched",
    targetType: "installation_restore_request",
    targetId: String(params.requestId),
    afterState: { executionId: execution.id, attemptNumber, executorType: params.executorType ?? null },
  });

  return execution;
}

/**
 * Records what an external executor reported. Append-only in effect: a failed
 * attempt is never rewritten into a success — a retry produces a new attempt,
 * and both remain visible.
 */
export async function recordExecutionEvidence(params: {
  actor: User;
  executionId: number;
  status: "accepted" | "started" | "succeeded" | "failed";
  externalReference?: string | null;
  failureCategory?: string | null;
  statusDetail?: string | null;
  at?: Date;
}): Promise<InstallationRestoreExecution> {
  if (!(await hasPlatformAuthority(params.actor, PLATFORM_OPERATION_PERMISSIONS.BACKUP_EVIDENCE_RECORD))) {
    throw new RestoreAuthorityError("Evidence-recording authority is required");
  }

  const [execution] = await db
    .select()
    .from(installationRestoreExecutionsTable)
    .where(eq(installationRestoreExecutionsTable.id, params.executionId));
  if (!execution) throw new RestoreNotFoundError();
  if (execution.status === "succeeded" || execution.status === "failed") {
    throw new RestoreGovernanceError("A completed execution attempt cannot be rewritten");
  }

  const now = params.at ?? new Date();
  const [updated] = await db
    .update(installationRestoreExecutionsTable)
    .set({
      status: params.status,
      startedAt: params.status === "started" ? now : execution.startedAt,
      completedAt: params.status === "succeeded" || params.status === "failed" ? now : execution.completedAt,
      externalReference: params.externalReference ?? execution.externalReference,
      failureCategory: params.failureCategory ?? execution.failureCategory,
      statusDetail: params.statusDetail ?? execution.statusDetail,
    })
    .where(eq(installationRestoreExecutionsTable.id, params.executionId))
    .returning();

  const request = await requireRequest(execution.requestId);
  // NOTE: `succeeded` here means the INFRASTRUCTURE finished. It deliberately
  // does not advance the request to `validated` — that requires evidence this
  // application can actually run on what came back.
  const nextStatus =
    params.status === "started"
      ? "executing"
      : params.status === "succeeded"
        ? "succeeded"
        : params.status === "failed"
          ? "failed"
          : null;
  if (nextStatus && request.status !== nextStatus) {
    assertTransition(request.status, nextStatus);
    await db
      .update(installationRestoreRequestsTable)
      .set({ status: nextStatus, statusChangedAt: now })
      .where(eq(installationRestoreRequestsTable.id, request.id));
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: "platform_restore.execution_evidence",
    targetType: "installation_restore_execution",
    targetId: String(params.executionId),
    afterState: { status: params.status, attemptNumber: execution.attemptNumber, requestId: execution.requestId },
  });

  return updated;
}

/**
 * Records one post-restore validation check.
 *
 * An operator attestation may NOT overturn an automated failure. Attestation
 * exists for checks no automation can perform in a given environment — not as a
 * way to declare a failed restore healthy.
 */
export async function recordValidation(params: {
  actor: User;
  requestId: number;
  executionId?: number | null;
  checkKey: string;
  result: "passed" | "failed" | "unknown" | "not_applicable";
  source: "automated" | "operator_attestation";
  detail?: string | null;
}): Promise<InstallationRestoreValidation> {
  if (!(await hasPlatformAuthority(params.actor, PLATFORM_OPERATION_PERMISSIONS.BACKUP_EVIDENCE_RECORD))) {
    throw new RestoreAuthorityError("Evidence-recording authority is required");
  }

  if (params.source === "operator_attestation" && params.result === "passed") {
    const [automatedFailure] = await db
      .select()
      .from(installationRestoreValidationsTable)
      .where(
        and(
          eq(installationRestoreValidationsTable.requestId, params.requestId),
          eq(installationRestoreValidationsTable.checkKey, params.checkKey),
          eq(installationRestoreValidationsTable.source, "automated"),
          eq(installationRestoreValidationsTable.result, "failed"),
        ),
      );
    if (automatedFailure) {
      throw new RestoreGovernanceError(
        `An operator attestation cannot override the automated failure recorded for ${params.checkKey}`,
      );
    }
  }

  const [row] = await db
    .insert(installationRestoreValidationsTable)
    .values({
      requestId: params.requestId,
      executionId: params.executionId ?? null,
      checkKey: params.checkKey,
      result: params.result,
      source: params.source,
      detail: params.detail ?? null,
      recordedByUserId: params.actor.id,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: "platform_restore.validation_recorded",
    targetType: "installation_restore_request",
    targetId: String(params.requestId),
    afterState: { checkKey: params.checkKey, result: params.result, source: params.source },
  });

  return row;
}

/**
 * Closes validation. Any failed check fails the whole validation; a check that
 * is merely `unknown` does NOT count as passed, so a request only reaches
 * `validated` on positive evidence.
 */
export async function concludeValidation(params: { actor: User; requestId: number }): Promise<InstallationRestoreRequest> {
  if (!(await hasPlatformAuthority(params.actor, PLATFORM_OPERATION_PERMISSIONS.BACKUP_EVIDENCE_RECORD))) {
    throw new RestoreAuthorityError("Evidence-recording authority is required");
  }
  const request = await requireRequest(params.requestId);
  const checks = await db
    .select()
    .from(installationRestoreValidationsTable)
    .where(eq(installationRestoreValidationsTable.requestId, params.requestId));

  if (checks.length === 0) throw new RestoreGovernanceError("No validation evidence has been recorded");

  const failed = checks.some((c) => c.result === "failed");
  const next = failed ? "validation_failed" : "validated";
  assertTransition(request.status, next);

  const [updated] = await db
    .update(installationRestoreRequestsTable)
    .set({ status: next, statusChangedAt: new Date() })
    .where(eq(installationRestoreRequestsTable.id, params.requestId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: failed ? "platform_restore.validation_failed" : "platform_restore.validated",
    targetType: "installation_restore_request",
    targetId: String(params.requestId),
    afterState: { checks: checks.length, failed },
  });

  return updated;
}

/** Cancels before dispatch. After dispatch the control plane does not claim it stopped anything. */
export async function cancelRestoreRequest(params: {
  actor: User;
  requestId: number;
  reason: string;
}): Promise<InstallationRestoreRequest> {
  if (!(await hasPlatformAuthority(params.actor, RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST))) {
    throw new RestoreAuthorityError("platform.restore.request is required to cancel a restore");
  }
  const request = await requireRequest(params.requestId);
  assertTransition(request.status, "cancelled");

  const [updated] = await db
    .update(installationRestoreRequestsTable)
    .set({ status: "cancelled", statusChangedAt: new Date(), statusDetail: params.reason })
    .where(eq(installationRestoreRequestsTable.id, params.requestId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: "platform_restore.cancelled",
    targetType: "installation_restore_request",
    targetId: String(params.requestId),
    afterState: { reason: params.reason, fromStatus: request.status },
  });

  return updated;
}

/** Records quiescence evidence. The platform never claims it stopped traffic itself. */
export async function recordQuiescence(params: {
  actor: User;
  requestId: number;
  state: QuiescenceState;
  evidence?: string | null;
}): Promise<InstallationRestoreRequest> {
  if (!(await hasPlatformAuthority(params.actor, PLATFORM_OPERATION_PERMISSIONS.BACKUP_EVIDENCE_RECORD))) {
    throw new RestoreAuthorityError("Evidence-recording authority is required");
  }
  const [updated] = await db
    .update(installationRestoreRequestsTable)
    .set({
      quiescenceState: params.state,
      quiescenceConfirmedByUserId: params.state === "confirmed" ? params.actor.id : null,
      quiescenceConfirmedAt: params.state === "confirmed" ? new Date() : null,
      quiescenceEvidence: params.evidence ?? null,
    })
    .where(eq(installationRestoreRequestsTable.id, params.requestId))
    .returning();
  if (!updated) throw new RestoreNotFoundError();

  await recordAuditEvent({
    actorApplicationUserId: params.actor.id,
    organizationId: null,
    eventType: "platform_restore.quiescence_recorded",
    targetType: "installation_restore_request",
    targetId: String(params.requestId),
    afterState: { state: params.state },
  });

  return updated;
}

/** Acknowledges non-invalidating operational drift so dispatch may proceed. */
export async function acknowledgeDrift(params: { actor: User; requestId: number }): Promise<InstallationRestoreRequest> {
  if (!(await hasPlatformAuthority(params.actor, RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST))) {
    throw new RestoreAuthorityError("platform.restore.request is required");
  }
  const [updated] = await db
    .update(installationRestoreRequestsTable)
    .set({ driftAcknowledgedAt: new Date() })
    .where(eq(installationRestoreRequestsTable.id, params.requestId))
    .returning();
  if (!updated) throw new RestoreNotFoundError();
  return updated;
}

// --- Reads -----------------------------------------------------------------

export async function getRestoreRequest(requestId: number): Promise<InstallationRestoreRequest | null> {
  const [row] = await db
    .select()
    .from(installationRestoreRequestsTable)
    .where(eq(installationRestoreRequestsTable.id, requestId));
  return row ?? null;
}

export async function listRestoreRequests(installationId: number, limit = 50): Promise<InstallationRestoreRequest[]> {
  return db
    .select()
    .from(installationRestoreRequestsTable)
    .where(eq(installationRestoreRequestsTable.installationId, installationId))
    .orderBy(desc(installationRestoreRequestsTable.submittedAt))
    .limit(limit);
}

export async function listApprovals(requestId: number): Promise<InstallationRestoreApproval[]> {
  return db
    .select()
    .from(installationRestoreApprovalsTable)
    .where(eq(installationRestoreApprovalsTable.requestId, requestId))
    .orderBy(installationRestoreApprovalsTable.decidedAt);
}

export async function listExecutions(requestId: number): Promise<InstallationRestoreExecution[]> {
  return db
    .select()
    .from(installationRestoreExecutionsTable)
    .where(eq(installationRestoreExecutionsTable.requestId, requestId))
    .orderBy(installationRestoreExecutionsTable.attemptNumber);
}

export async function listValidations(requestId: number): Promise<InstallationRestoreValidation[]> {
  return db
    .select()
    .from(installationRestoreValidationsTable)
    .where(eq(installationRestoreValidationsTable.requestId, requestId))
    .orderBy(installationRestoreValidationsTable.observedAt);
}

/**
 * OBSERVED metrics, kept strictly separate from configured targets. No
 * compliance is asserted: an observed duration is a fact about one execution,
 * not a statement that an SLA was met.
 */
export async function getObservedRecoveryMetrics(requestId: number): Promise<{
  recoveryPointAgeMs: number | null;
  executionDurationMs: number | null;
  validationCompletedAt: Date | null;
}> {
  const request = await requireRequest(requestId);
  const executions = await listExecutions(requestId);
  const last = executions[executions.length - 1] ?? null;
  const validations = await listValidations(requestId);

  return {
    recoveryPointAgeMs:
      request.recoveryPointAt && last?.dispatchedAt
        ? last.dispatchedAt.getTime() - request.recoveryPointAt.getTime()
        : null,
    executionDurationMs:
      last?.startedAt && last?.completedAt ? last.completedAt.getTime() - last.startedAt.getTime() : null,
    validationCompletedAt: validations.length ? validations[validations.length - 1].observedAt : null,
  };
}

/**
 * Whether an installation currently has a restore in flight, and what that
 * means for its health. A restore in progress must never read `healthy` from
 * telemetry gathered before the rollback began.
 */
export async function getRestoreHealthOverlay(
  installationId: number,
): Promise<{ state: "degraded" | "unhealthy"; detail: string } | null> {
  const [row] = await db
    .select()
    .from(installationRestoreRequestsTable)
    .where(eq(installationRestoreRequestsTable.installationId, installationId))
    .orderBy(desc(installationRestoreRequestsTable.submittedAt))
    .limit(1);
  if (!row) return null;

  switch (row.status) {
    case "dispatched":
    case "executing":
      return { state: "degraded", detail: "A restore is in progress on this installation" };
    case "succeeded":
      return { state: "degraded", detail: "Restore executed; post-restore validation has not concluded" };
    case "failed":
      return { state: "unhealthy", detail: "The most recent restore execution failed" };
    case "validation_failed":
      return { state: "unhealthy", detail: "Post-restore validation failed" };
    default:
      return null;
  }
}
