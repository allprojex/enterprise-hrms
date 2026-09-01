/**
 * WS-17 Restore Governance — the invariants that keep a physical restore from
 * becoming a catastrophe.
 *
 * Every test here is about a way this could go wrong: approving your own
 * production rollback, restoring from a backup that never covered the files,
 * rolling back three customers when an approver only ever saw two, a
 * double-click starting a second restore, or an operator declaring a failed
 * restore healthy. The happy path is the least interesting part.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS17_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-17 Restore Governance", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let ops: typeof import("../lib/platformOperations");

  let orgId: number;
  let requester: any;
  let approver: any;
  let evidenceRecorder: any;
  let tenantUser: any;
  let ungrantedSuperAdmin: any;

  const suffix = `ws17r-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;
  const R = () => ops.RESERVED_RESTORE_PERMISSIONS;
  const P = () => ops.PLATFORM_OPERATION_PERMISSIONS;

  async function makeUser(role: "super_admin" | "employee", keys: string[] = []): Promise<any> {
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq("u")}@example.test`,
        passwordHash: "x",
        firstName: "Rest",
        lastName: uniq("Ore"),
        role,
        organizationId: orgId,
      })
      .returning();
    for (const k of keys) {
      await db
        .insert(schema.platformOperationGrantsTable)
        .values({ userId: u.id, permissionKey: k, reason: "test" })
        .onConflictDoNothing();
    }
    return u;
  }

  async function makeInstallation(over: Record<string, unknown> = {}): Promise<any> {
    const [row] = await db
      .insert(schema.installationsTable)
      .values({
        installationKey: uniq("inst"),
        name: uniq("Installation"),
        environmentType: "production",
        hostingModel: "shared",
        ...over,
      })
      .returning();
    return row;
  }

  async function linkOrg(installationId: number): Promise<number> {
    const [o] = await db
      .insert(schema.organizationsTable)
      .values({ name: uniq("Tenant"), slug: uniq("tenant") })
      .returning();
    await db.insert(schema.installationOrganizationsTable).values({ installationId, organizationId: o.id });
    return o.id;
  }

  /** A complete recovery point: both components succeeded. */
  async function makeCompleteBackup(installationId: number): Promise<any> {
    return ops.recordBackupRun({
      installationId,
      databaseResult: "succeeded",
      binaryStorageResult: "succeeded",
      recoveryPointAt: new Date(Date.now() - 3600_000),
      executorType: "provider",
      actor: { userId: null },
    });
  }

  /** A database-only backup — the case the storage work proved is not complete. */
  async function makePartialBackup(installationId: number): Promise<any> {
    return ops.recordBackupRun({
      installationId,
      databaseResult: "succeeded",
      binaryStorageResult: "unknown",
      recoveryPointAt: new Date(Date.now() - 3600_000),
      executorType: "provider",
      actor: { userId: null },
    });
  }

  const confirm = (inst: any) => ops.expectedConfirmationPhrase(inst.installationKey, inst.environmentType);

  async function submit(inst: any, over: Record<string, unknown> = {}) {
    const run = (over as any).backupRunId !== undefined ? null : await makeCompleteBackup(inst.id);
    return ops.submitRestoreRequest({
      actor: requester,
      installationId: inst.id,
      purpose: "recovery",
      restorePointType: "backup_run",
      backupRunId: run ? run.id : (over as any).backupRunId,
      reason: "verified data loss incident",
      confirmationPhrase: confirm(inst),
      preRestoreExceptionNote: inst.environmentType === "production" ? "executor cannot checkpoint" : null,
      ...(over as any),
    } as any);
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    ops = await import("../lib/platformOperations");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS17R ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;

    requester = await makeUser("super_admin", [
      ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST,
      ops.PLATFORM_OPERATION_PERMISSIONS.BACKUP_EVIDENCE_RECORD,
    ]);
    approver = await makeUser("super_admin", [ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_APPROVE]);
    evidenceRecorder = requester;
    tenantUser = await makeUser("employee", [
      ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST,
      ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_APPROVE,
    ]);
    ungrantedSuperAdmin = await makeUser("super_admin");
  });

  // =======================================================================
  // Authority
  // =======================================================================
  describe("authority", () => {
    it("a tenant user holds no restore authority even when granted the keys", async () => {
      const inst = await makeInstallation();
      await expect(
        ops.submitRestoreRequest({
          actor: tenantUser,
          installationId: inst.id,
          purpose: "recovery",
          restorePointType: "pitr",
          pitrTimestamp: new Date(),
          reason: "x",
          confirmationPhrase: confirm(inst),
        } as any),
      ).rejects.toBeInstanceOf(ops.RestoreAuthorityError);
    });

    it("an ungranted super-admin cannot request", async () => {
      const inst = await makeInstallation();
      await expect(
        ops.submitRestoreRequest({
          actor: ungrantedSuperAdmin,
          installationId: inst.id,
          purpose: "recovery",
          restorePointType: "pitr",
          pitrTimestamp: new Date(),
          reason: "x",
          confirmationPhrase: confirm(inst),
        } as any),
      ).rejects.toBeInstanceOf(ops.RestoreAuthorityError);
    });

    it("restore.approve alone cannot request, and restore.request alone cannot approve", async () => {
      const inst = await makeInstallation();
      // approver holds only RESTORE_APPROVE
      await expect(
        ops.submitRestoreRequest({
          actor: approver,
          installationId: inst.id,
          purpose: "recovery",
          restorePointType: "pitr",
          pitrTimestamp: new Date(),
          reason: "x",
          confirmationPhrase: confirm(inst),
          incompleteAcknowledgementNote: "unknown components accepted",
        } as any),
      ).rejects.toBeInstanceOf(ops.RestoreAuthorityError);

      const req = await submit(inst);
      // requester holds only RESTORE_REQUEST (plus evidence), not APPROVE
      await expect(
        ops.decideRestoreRequest({ actor: requester, requestId: req.id, decision: "approved" }),
      ).rejects.toBeInstanceOf(ops.RestoreAuthorityError);
    });

    it("a revoked grant stops dispatch even though the approval remains valid history", async () => {
      // A DEDICATED user, so revoking their grant cannot disturb any other
      // test's authority — shared fixtures plus revocation is how suites start
      // failing for reasons that have nothing to do with the code under test.
      const temp = await makeUser("super_admin", [R().RESTORE_REQUEST]);
      const inst = await makeInstallation({ environmentType: "staging" });
      const run = await makeCompleteBackup(inst.id);
      const req = await ops.submitRestoreRequest({
        actor: temp,
        installationId: inst.id,
        purpose: "recovery",
        restorePointType: "backup_run",
        backupRunId: run.id,
        reason: "revocation scenario",
        confirmationPhrase: confirm(inst),
      } as any);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });

      await db
        .update(schema.platformOperationGrantsTable)
        .set({ revokedAt: new Date() })
        .where(eq(schema.platformOperationGrantsTable.userId, temp.id));

      await expect(
        ops.dispatchRestore({ actor: temp, requestId: req.id, idempotencyKey: uniq("k") }),
      ).rejects.toBeInstanceOf(ops.RestoreAuthorityError);

      // History is not rewritten: the approval still stands as evidence.
      const approvals = await ops.listApprovals(req.id);
      expect(approvals[0].decision).toBe("approved");
      expect(approvals[0].invalidatedAt).toBeNull();
    });
  });

  // =======================================================================
  // Production maker-checker
  // =======================================================================
  describe("production maker-checker", () => {
    it("THE REQUESTER MAY NEVER APPROVE THEIR OWN PRODUCTION RESTORE", async () => {
      const inst = await makeInstallation({ environmentType: "production" });
      const req = await submit(inst);

      // Give the requester approval authority too — they still must not.
      await db
        .insert(schema.platformOperationGrantsTable)
        .values({ userId: requester.id, permissionKey: R().RESTORE_APPROVE, reason: "test" })
        .onConflictDoNothing();

      await expect(
        ops.decideRestoreRequest({ actor: requester, requestId: req.id, decision: "approved" }),
      ).rejects.toThrow(/requester of a restore may not approve it/);

      // A different authorized person can.
      const approval = await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      expect(approval.approverUserId).toBe(approver.id);
      expect(approval.approverUserId).not.toBe(req.requestedByUserId);
    });

    it("maker-checker is compared on immutable user id, not on any relaxable policy, in production", async () => {
      // Even with the relaxed policy explicitly set, production ignores it.
      const inst = await makeInstallation({
        environmentType: "production",
        restoreApprovalPolicy: "single_operator_non_production",
      });
      expect(ops.requiresMakerChecker(inst)).toBe(true);

      const req = await submit(inst);
      await expect(
        ops.decideRestoreRequest({ actor: requester, requestId: req.id, decision: "approved" }),
      ).rejects.toThrow(/may not approve it/);
    });

    it("non-production defaults to maker-checker required when unconfigured", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      expect(inst.restoreApprovalPolicy).toBe("always_required");
      expect(ops.requiresMakerChecker(inst)).toBe(true);
    });

    it("non-production may be explicitly relaxed, and only then", async () => {
      const relaxed = await makeInstallation({
        environmentType: "staging",
        restoreApprovalPolicy: "single_operator_non_production",
      });
      expect(ops.requiresMakerChecker(relaxed)).toBe(false);

      const req = await submit(relaxed);
      await db
        .insert(schema.platformOperationGrantsTable)
        .values({ userId: requester.id, permissionKey: R().RESTORE_APPROVE, reason: "test" })
        .onConflictDoNothing();
      const approval = await ops.decideRestoreRequest({ actor: requester, requestId: req.id, decision: "approved" });
      expect(approval.approverUserId).toBe(requester.id);
    });
  });

  // =======================================================================
  // Recovery point completeness
  // =======================================================================
  describe("recovery point completeness", () => {
    it("BLOCKS a database-only recovery point by default", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const partial = await makePartialBackup(inst.id);

      await expect(
        ops.submitRestoreRequest({
          actor: requester,
          installationId: inst.id,
          purpose: "recovery",
          restorePointType: "backup_run",
          backupRunId: partial.id,
          reason: "incident",
          confirmationPhrase: confirm(inst),
        } as any),
      ).rejects.toThrow(/acknowledgement naming the incomplete component is required/);
    });

    it("permits it only as a recorded, immutable risk acceptance naming the component", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const partial = await makePartialBackup(inst.id);

      const req = await ops.submitRestoreRequest({
        actor: requester,
        installationId: inst.id,
        purpose: "recovery",
        restorePointType: "backup_run",
        backupRunId: partial.id,
        reason: "incident",
        confirmationPhrase: confirm(inst),
        incompleteAcknowledgementNote: "binary storage coverage unknown; accepted by platform lead",
      } as any);

      expect(req.completeness).toBe("partial");
      // The missing component is NAMED, not hand-waved.
      expect(JSON.stringify(req.incompleteComponents)).toContain("binary_storage");
      expect(req.incompleteAcknowledgedAt).not.toBeNull();
      // And it is never labelled complete.
      expect(req.completeness).not.toBe("complete");
    });

    it("treats a PITR or provider point as UNKNOWN, never complete", async () => {
      const assessment = await ops.assessRestorePoint({ restorePointType: "pitr" });
      expect(assessment.completeness).toBe("unknown");
      const snap = await ops.assessRestorePoint({ restorePointType: "provider_snapshot" });
      expect(snap.completeness).toBe("unknown");
    });

    it("the approver sees the completeness that was accepted, frozen on the approval", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const partial = await makePartialBackup(inst.id);
      const req = await ops.submitRestoreRequest({
        actor: requester,
        installationId: inst.id,
        purpose: "recovery",
        restorePointType: "backup_run",
        backupRunId: partial.id,
        reason: "incident",
        confirmationPhrase: confirm(inst),
        incompleteAcknowledgementNote: "accepted",
      } as any);
      const approval = await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      expect(approval.completenessAtDecision).toBe("partial");
    });
  });

  // =======================================================================
  // Typed confirmation
  // =======================================================================
  describe("typed confirmation", () => {
    it("requires the exact target-bound phrase, not a generic one", async () => {
      const inst = await makeInstallation({ environmentType: "production" });
      const run = await makeCompleteBackup(inst.id);
      for (const bad of ["RESTORE", "I understand", "restore production", `RESTORE ${inst.installationKey}`, ""]) {
        await expect(
          ops.submitRestoreRequest({
            actor: requester,
            installationId: inst.id,
            purpose: "recovery",
            restorePointType: "backup_run",
            backupRunId: run.id,
            reason: "x",
            confirmationPhrase: bad,
            preRestoreExceptionNote: "n/a",
          } as any),
        ).rejects.toThrow(/Confirmation phrase must be exactly/);
      }
    });

    it("binds to the actual installation — another installation's phrase is refused", async () => {
      const a = await makeInstallation({ environmentType: "production" });
      const b = await makeInstallation({ environmentType: "production" });
      const run = await makeCompleteBackup(a.id);
      await expect(
        ops.submitRestoreRequest({
          actor: requester,
          installationId: a.id,
          purpose: "recovery",
          restorePointType: "backup_run",
          backupRunId: run.id,
          reason: "x",
          confirmationPhrase: confirm(b),
          preRestoreExceptionNote: "n/a",
        } as any),
      ).rejects.toThrow(/Confirmation phrase must be exactly/);
    });
  });

  // =======================================================================
  // Blast radius
  // =======================================================================
  describe("blast radius", () => {
    it("one shared installation is ONE request covering every affected tenant", async () => {
      const inst = await makeInstallation({ environmentType: "production", hostingModel: "shared" });
      const a = await linkOrg(inst.id);
      const b = await linkOrg(inst.id);
      const c = await linkOrg(inst.id);

      const req = await submit(inst);
      const snapshot = req.affectedOrganizationIdsSnapshot as number[];
      expect(snapshot.sort()).toEqual([a, b, c].sort());

      // One request, one approval, one execution — never three fake per-tenant rows.
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      expect(await ops.listRestoreRequests(inst.id)).toHaveLength(1);
      expect(await ops.listApprovals(req.id)).toHaveLength(1);
    });

    it("LINKING A NEW ORGANIZATION AFTER APPROVAL BLOCKS DISPATCH until reapproval", async () => {
      const inst = await makeInstallation({ environmentType: "production", hostingModel: "shared" });
      await linkOrg(inst.id);
      await linkOrg(inst.id);

      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      expect((await ops.precheckDispatch(req.id)).ok).toBe(true);

      // Organization D appears after approval — the approver never saw it.
      await linkOrg(inst.id);

      const precheck = await ops.precheckDispatch(req.id);
      expect(precheck.ok).toBe(false);
      expect(precheck.blockers.join(" ")).toContain("affected organizations changed");

      await expect(
        ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("k") }),
      ).rejects.toThrow(/Dispatch blocked/);

      // Invalidation returns the request for renewed approval, preserving the
      // original approval row as history.
      await ops.invalidateApproval(req.id, "affected organizations changed");
      const after = await ops.getRestoreRequest(req.id);
      expect(after!.status).toBe("submitted");
      const approvals = await ops.listApprovals(req.id);
      expect(approvals[0].invalidatedAt).not.toBeNull();
      expect(approvals[0].decision).toBe("approved");
    });
  });

  // =======================================================================
  // Pre-restore checkpoint, quiescence, drift
  // =======================================================================
  describe("preconditions", () => {
    it("production without a checkpoint or an exception is blocked at dispatch", async () => {
      const inst = await makeInstallation({ environmentType: "production" });
      const run = await makeCompleteBackup(inst.id);
      const req = await ops.submitRestoreRequest({
        actor: requester,
        installationId: inst.id,
        purpose: "recovery",
        restorePointType: "backup_run",
        backupRunId: run.id,
        reason: "incident",
        confirmationPhrase: confirm(inst),
      } as any);
      expect(req.preRestoreCheckpointState).toBe("required");

      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      const precheck = await ops.precheckDispatch(req.id);
      expect(precheck.ok).toBe(false);
      expect(precheck.blockers.join(" ")).toContain("pre-restore checkpoint");
    });

    it("an unsupported checkpoint is an acknowledged EXCEPTION, never silently satisfied", async () => {
      const inst = await makeInstallation({ environmentType: "production" });
      const req = await submit(inst); // supplies preRestoreExceptionNote
      expect(req.preRestoreCheckpointState).toBe("unsupported_acknowledged");
      expect(req.preRestoreCheckpointState).not.toBe("satisfied");
      expect(req.preRestoreExceptionNote).toBeTruthy();
    });

    it("required quiescence blocks dispatch until confirmed", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst, { quiescenceRequired: true });
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      expect((await ops.precheckDispatch(req.id)).blockers.join(" ")).toContain("quiescence");

      await ops.recordQuiescence({
        actor: evidenceRecorder,
        requestId: req.id,
        state: "confirmed",
        evidence: "operator confirmed writes stopped",
      });
      expect((await ops.precheckDispatch(req.id)).ok).toBe(true);
    });

    it("a new deployment after approval requires re-acknowledgement but not reapproval", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });

      await ops.recordDeployment({
        installationId: inst.id,
        applicationVersion: "9.9.9",
        result: "succeeded",
        executorType: "ci_cd",
        actor: { userId: null },
      });

      const precheck = await ops.precheckDispatch(req.id);
      expect(precheck.ok).toBe(false);
      expect(precheck.driftRequiringAcknowledgement.join(" ")).toContain("application version");

      await ops.acknowledgeDrift({ actor: requester, requestId: req.id });
      expect((await ops.precheckDispatch(req.id)).ok).toBe(true);
    });

    it("an expired approval cannot dispatch", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({
        actor: approver,
        requestId: req.id,
        decision: "approved",
        expiresAt: new Date(Date.now() - 60_000),
      });
      const precheck = await ops.precheckDispatch(req.id);
      expect(precheck.blockers.join(" ")).toContain("expired");
    });
  });

  // =======================================================================
  // Dispatch, idempotency, execution evidence
  // =======================================================================
  describe("dispatch and execution", () => {
    async function approvedRequest() {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      return { inst, req };
    }

    it("A REPEATED DISPATCH NEVER STARTS A SECOND RESTORE", async () => {
      const { req } = await approvedRequest();
      const key = uniq("idem");
      const first = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: key });
      const second = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: key });

      expect(second.id).toBe(first.id);
      expect(await ops.listExecutions(req.id)).toHaveLength(1);
    });

    it("dispatch is not success — the request is dispatched, not succeeded", async () => {
      const { req } = await approvedRequest();
      await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });
      expect((await ops.getRestoreRequest(req.id))!.status).toBe("dispatched");
    });

    it("a completed attempt cannot be rewritten into a different outcome", async () => {
      const { req } = await approvedRequest();
      const exec = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "failed" });

      await expect(
        ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "succeeded" }),
      ).rejects.toThrow(/cannot be rewritten/);
    });

    it("a retry preserves both attempts", async () => {
      const { req } = await approvedRequest();
      const first = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: first.id, status: "failed" });

      const retry = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem2") });
      const executions = await ops.listExecutions(req.id);
      expect(executions).toHaveLength(2);
      expect(executions[0].status).toBe("failed");
      expect(retry.attemptNumber).toBe(2);
    });
  });

  // =======================================================================
  // Validation
  // =======================================================================
  describe("validation", () => {
    async function executedRequest() {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      const exec = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "started" });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "succeeded" });
      return { inst, req, exec };
    }

    it("EXECUTION SUCCESS IS NOT VALIDATION SUCCESS", async () => {
      const { req } = await executedRequest();
      // The infrastructure finished, and the request stops at `succeeded`.
      expect((await ops.getRestoreRequest(req.id))!.status).toBe("succeeded");
      expect((await ops.getRestoreRequest(req.id))!.status).not.toBe("validated");
    });

    it("reaches validated only on positive evidence", async () => {
      const { req, exec } = await executedRequest();
      for (const key of ["database_reachable", "migration_version", "application_ready", "storage_reconciliation"]) {
        await ops.recordValidation({
          actor: evidenceRecorder,
          requestId: req.id,
          executionId: exec.id,
          checkKey: key,
          result: "passed",
          source: "automated",
        });
      }
      const done = await ops.concludeValidation({ actor: evidenceRecorder, requestId: req.id });
      expect(done.status).toBe("validated");
    });

    it("any failed check fails the whole validation", async () => {
      const { req } = await executedRequest();
      await ops.recordValidation({
        actor: evidenceRecorder,
        requestId: req.id,
        checkKey: "database_reachable",
        result: "passed",
        source: "automated",
      });
      await ops.recordValidation({
        actor: evidenceRecorder,
        requestId: req.id,
        checkKey: "storage_reconciliation",
        result: "failed",
        source: "automated",
        detail: "12 referenced binaries missing",
      });
      const done = await ops.concludeValidation({ actor: evidenceRecorder, requestId: req.id });
      expect(done.status).toBe("validation_failed");
    });

    it("AN OPERATOR CANNOT ATTEST AWAY AN AUTOMATED FAILURE", async () => {
      const { req } = await executedRequest();
      await ops.recordValidation({
        actor: evidenceRecorder,
        requestId: req.id,
        checkKey: "application_ready",
        result: "failed",
        source: "automated",
      });
      await expect(
        ops.recordValidation({
          actor: evidenceRecorder,
          requestId: req.id,
          checkKey: "application_ready",
          result: "passed",
          source: "operator_attestation",
        }),
      ).rejects.toThrow(/cannot override the automated failure/);
    });

    it("unknown stays unknown and never counts as passed", async () => {
      const { req } = await executedRequest();
      await ops.recordValidation({
        actor: evidenceRecorder,
        requestId: req.id,
        checkKey: "storage_health",
        result: "unknown",
        source: "automated",
        detail: "customer-managed installation reports nothing",
      });
      const checks = await ops.listValidations(req.id);
      expect(checks[0].result).toBe("unknown");
      expect(checks[0].result).not.toBe("passed");
    });

    it("validation evidence carries operational aggregates, never document detail", async () => {
      const { req } = await executedRequest();
      await ops.recordValidation({
        actor: evidenceRecorder,
        requestId: req.id,
        checkKey: "storage_reconciliation",
        result: "passed",
        source: "automated",
        detail: "0 missing, 0 orphaned across 1,204 objects",
      });
      const serialized = JSON.stringify(await ops.listValidations(req.id));
      for (const forbidden of ["storageKey", "fileName", "employeeId", "documents/"]) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  // =======================================================================
  // Restore tests, metrics, health
  // =======================================================================
  describe("restore tests and health", () => {
    it("A RESTORE TEST MAY NEVER TARGET PRODUCTION — enforced server-side", async () => {
      const prod = await makeInstallation({ environmentType: "production" });
      const run = await makeCompleteBackup(prod.id);
      await expect(
        ops.submitRestoreRequest({
          actor: requester,
          installationId: prod.id,
          purpose: "test",
          restorePointType: "backup_run",
          backupRunId: run.id,
          reason: "rehearsal",
          confirmationPhrase: confirm(prod),
        } as any),
      ).rejects.toThrow(/may never target a production installation/);
    });

    it("a restore test uses the same workflow on a non-production target", async () => {
      const staging = await makeInstallation({ environmentType: "staging" });
      const run = await makeCompleteBackup(staging.id);
      const req = await ops.submitRestoreRequest({
        actor: requester,
        installationId: staging.id,
        purpose: "test",
        restorePointType: "backup_run",
        backupRunId: run.id,
        reason: "quarterly recovery rehearsal",
        confirmationPhrase: confirm(staging),
      } as any);
      expect(req.purpose).toBe("test");
      expect(req.status).toBe("submitted");
    });

    it("an in-flight restore stops Fleet Health reading healthy from stale telemetry", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      // Fresh, entirely positive telemetry from BEFORE the restore.
      await ops.recordTelemetry({
        installationId: inst.id,
        observedAt: new Date(),
        applicationHealthy: true,
        databaseReady: true,
        storageBackend: "filesystem",
        storageHealthy: true,
        executorType: "installation_agent",
        actor: { userId: null },
      });

      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });

      const health = await ops.getInstallationHealth(inst.id);
      const restoreSignal = health!.signals.find((s: any) => s.key === "restore");
      expect(restoreSignal!.state).toBe("degraded");
      expect(health!.overall).not.toBe("healthy");
    });

    it("a failed restore renders unhealthy", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      const exec = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "failed" });

      const health = await ops.getInstallationHealth(inst.id);
      expect(health!.signals.find((s: any) => s.key === "restore")!.state).toBe("unhealthy");
      expect(health!.overall).toBe("unhealthy");
    });

    it("observed metrics are facts about an execution, not an SLA claim", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      const exec = await ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("idem") });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "started" });
      await ops.recordExecutionEvidence({ actor: evidenceRecorder, executionId: exec.id, status: "succeeded" });

      const metrics: any = await ops.getObservedRecoveryMetrics(req.id);
      expect(metrics.recoveryPointAgeMs).toBeGreaterThan(0);
      expect(metrics.executionDurationMs).not.toBeNull();
      // No compliance verdict is offered anywhere.
      expect(metrics).not.toHaveProperty("rpoCompliant");
      expect(metrics).not.toHaveProperty("rtoCompliant");
      expect(metrics).not.toHaveProperty("slaMet");
    });
  });

  // =======================================================================
  // Isolation and immutability
  // =======================================================================
  describe("isolation and immutability", () => {
    it("restore records carry no organizationId", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      expect(req).not.toHaveProperty("organizationId");
      const approval = await ops.decideRestoreRequest({ actor: approver, requestId: req.id, decision: "approved" });
      expect(approval).not.toHaveProperty("organizationId");
    });

    it("a request is scoped to its own installation — cross-installation reads do not leak", async () => {
      const a = await makeInstallation({ environmentType: "staging" });
      const b = await makeInstallation({ environmentType: "staging" });
      const req = await submit(a);
      const listedForB = await ops.listRestoreRequests(b.id);
      expect(listedForB.find((r: any) => r.id === req.id)).toBeUndefined();
    });

    it("a rejected request is terminal and keeps its rejection as evidence", async () => {
      const inst = await makeInstallation({ environmentType: "staging" });
      const req = await submit(inst);
      await ops.decideRestoreRequest({
        actor: approver,
        requestId: req.id,
        decision: "rejected",
        comment: "insufficient justification",
      });
      expect((await ops.getRestoreRequest(req.id))!.status).toBe("rejected");
      await expect(
        ops.dispatchRestore({ actor: requester, requestId: req.id, idempotencyKey: uniq("k") }),
      ).rejects.toThrow(/Dispatch blocked/);
      const approvals = await ops.listApprovals(req.id);
      expect(approvals[0].decision).toBe("rejected");
      expect(approvals[0].comment).toBe("insufficient justification");
    });
  });
});
