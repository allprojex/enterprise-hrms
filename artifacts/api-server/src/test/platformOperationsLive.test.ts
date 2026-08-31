/**
 * WS-17 Slice 1 — platform operations control plane, live.
 *
 * The assertions concentrate on the claims that would be dangerous if wrong:
 * that authority cannot be obtained by being a tenant admin or merely by being
 * a super-admin; that one physical backup is one record no matter how many
 * tenants it protects; that a database-only backup can never be reported as a
 * complete one; and that absence of evidence renders as unknown rather than
 * healthy.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS17_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-17 Slice 1 — platform operations control plane", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;

  let ops: typeof import("../lib/platformOperations");

  let orgId: number;
  let superAdminUser: any;
  let plainSuperAdmin: any;
  let tenantAdminUser: any;

  const suffix = `ws17s1-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  async function makeUser(role: "super_admin" | "employee"): Promise<any> {
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq("u")}@example.test`,
        passwordHash: "x",
        firstName: "Ops",
        lastName: uniq("User"),
        role,
        organizationId: orgId,
      })
      .returning();
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

  async function grant(userId: number, key: string) {
    await db
      .insert(schema.platformOperationGrantsTable)
      .values({ userId, permissionKey: key, reason: "test" })
      .onConflictDoNothing();
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
      .values({ name: `WS17S1 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;

    superAdminUser = await makeUser("super_admin");
    plainSuperAdmin = await makeUser("super_admin");
    tenantAdminUser = await makeUser("employee");

    for (const key of Object.values(ops.PLATFORM_OPERATION_PERMISSIONS)) {
      await grant(superAdminUser.id, key);
    }
  });

  // =======================================================================
  // §45 — Authority
  // =======================================================================
  describe("authority", () => {
    it("an ordinary tenant user holds no platform authority, whatever their org role", async () => {
      for (const key of Object.values(ops.PLATFORM_OPERATION_PERMISSIONS)) {
        expect(await ops.hasPlatformAuthority(tenantAdminUser, key)).toBe(false);
      }
    });

    it("a tenant user cannot gain platform authority by being granted the key", async () => {
      // Even with a grant row, the platform-context half of the conjunction
      // fails — authority is never the grant alone.
      await grant(tenantAdminUser.id, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ);
      expect(await ops.hasPlatformPermission(tenantAdminUser.id, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ)).toBe(
        true,
      );
      expect(await ops.hasPlatformAuthority(tenantAdminUser, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ)).toBe(false);
    });

    it("SUPER-ADMIN ALONE IS NOT ENOUGH — the whole point of the grant table", async () => {
      for (const key of Object.values(ops.PLATFORM_OPERATION_PERMISSIONS)) {
        expect(await ops.hasPlatformAuthority(plainSuperAdmin, key)).toBe(false);
      }
    });

    it("a super-admin holding the specific grant is authorized", async () => {
      expect(await ops.hasPlatformAuthority(superAdminUser, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ)).toBe(true);
    });

    it("grants are separable: backup-request authority does not confer evidence or policy authority", async () => {
      const narrow = await makeUser("super_admin");
      await grant(narrow.id, ops.PLATFORM_OPERATION_PERMISSIONS.BACKUP_REQUEST);

      expect(await ops.hasPlatformAuthority(narrow, ops.PLATFORM_OPERATION_PERMISSIONS.BACKUP_REQUEST)).toBe(true);
      expect(await ops.hasPlatformAuthority(narrow, ops.PLATFORM_OPERATION_PERMISSIONS.BACKUP_POLICY_MANAGE)).toBe(false);
      expect(await ops.hasPlatformAuthority(narrow, ops.PLATFORM_OPERATION_PERMISSIONS.BACKUP_EVIDENCE_RECORD)).toBe(
        false,
      );
    });

    it("backup authority never implies future restore approval", async () => {
      // Restore keys are reserved, never granted and never checked in this
      // slice. This asserts the separation exists before restore is built.
      expect(ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_REQUEST).not.toBe(
        ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_APPROVE,
      );
      expect(ops.GRANTABLE_PLATFORM_PERMISSIONS).not.toContain(ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_APPROVE);
      expect(await ops.hasPlatformAuthority(superAdminUser, ops.RESERVED_RESTORE_PERMISSIONS.RESTORE_APPROVE)).toBe(
        false,
      );
    });

    it("a revoked grant stops working immediately, with no job", async () => {
      const temp = await makeUser("super_admin");
      await grant(temp.id, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ);
      expect(await ops.hasPlatformAuthority(temp, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ)).toBe(true);

      await db
        .update(schema.platformOperationGrantsTable)
        .set({ revokedAt: new Date() })
        .where(eq(schema.platformOperationGrantsTable.userId, temp.id));

      expect(await ops.hasPlatformAuthority(temp, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ)).toBe(false);
    });

    it("an expired grant stops working by pure date evaluation", async () => {
      const temp = await makeUser("super_admin");
      await db.insert(schema.platformOperationGrantsTable).values({
        userId: temp.id,
        permissionKey: ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ,
        expiresAt: new Date(Date.now() - 60_000),
      });
      expect(await ops.hasPlatformAuthority(temp, ops.PLATFORM_OPERATION_PERMISSIONS.FLEET_READ)).toBe(false);
    });
  });

  // =======================================================================
  // §46 — Shared hosting
  // =======================================================================
  describe("shared hosting", () => {
    it("one installation serving three organizations produces ONE of each operational record", async () => {
      const inst = await makeInstallation({ hostingModel: "shared" });
      const orgs = [];
      for (let i = 0; i < 3; i += 1) {
        const [o] = await db
          .insert(schema.organizationsTable)
          .values({ name: uniq("Tenant"), slug: uniq("tenant") })
          .returning();
        orgs.push(o);
        await db
          .insert(schema.installationOrganizationsTable)
          .values({ installationId: inst.id, organizationId: o.id });
      }

      await ops.recordDeployment({
        installationId: inst.id,
        applicationVersion: "1.0.0",
        result: "succeeded",
        executorType: "ci_cd",
        actor: { userId: superAdminUser.id },
      });
      await ops.recordBackupRun({
        installationId: inst.id,
        databaseResult: "succeeded",
        binaryStorageResult: "succeeded",
        recoveryPointAt: new Date(),
        executorType: "provider",
        actor: { userId: superAdminUser.id },
      });

      // ONE deployment, ONE backup — not three of each.
      expect(await ops.listDeployments(inst.id)).toHaveLength(1);
      expect(await ops.listBackupRuns(inst.id)).toHaveLength(1);

      // ...and all three tenants are discoverable through the link table.
      const affected = await ops.listAffectedOrganizations(inst.id);
      expect(affected).toHaveLength(3);
      expect(affected.map((a: any) => a.organizationId).sort()).toEqual(orgs.map((o) => o.id).sort());

      const health = await ops.getInstallationHealth(inst.id);
      expect(health!.affectedOrganizations).toHaveLength(3);
    });

    it("operational records carry no organizationId at all", async () => {
      const inst = await makeInstallation();
      const dep = await ops.recordDeployment({
        installationId: inst.id,
        result: "succeeded",
        executorType: "operator",
        actor: { userId: superAdminUser.id },
      });
      expect(dep).not.toHaveProperty("organizationId");
    });
  });

  // =======================================================================
  // §47 — Deployment
  // =======================================================================
  describe("deployment history", () => {
    it("a SUCCEEDED deployment advances installation current state", async () => {
      const inst = await makeInstallation();
      await ops.recordDeployment({
        installationId: inst.id,
        applicationVersion: "2.0.0",
        gitCommit: "abc123",
        migrationVersion: "0073",
        result: "succeeded",
        completedAt: new Date(),
        executorType: "ci_cd",
        actor: { userId: superAdminUser.id },
      });

      const [after] = await db.select().from(schema.installationsTable).where(eq(schema.installationsTable.id, inst.id));
      expect(after.applicationVersion).toBe("2.0.0");
      expect(after.gitCommit).toBe("abc123");
      expect(after.deployedAt).not.toBeNull();
    });

    it("a FAILED deployment does NOT make the attempted version look current", async () => {
      const inst = await makeInstallation();
      await ops.recordDeployment({
        installationId: inst.id,
        applicationVersion: "3.0.0",
        result: "succeeded",
        executorType: "ci_cd",
        actor: { userId: superAdminUser.id },
      });
      await ops.recordDeployment({
        installationId: inst.id,
        applicationVersion: "4.0.0-broken",
        result: "failed",
        executorType: "ci_cd",
        actor: { userId: superAdminUser.id },
      });

      const [after] = await db.select().from(schema.installationsTable).where(eq(schema.installationsTable.id, inst.id));
      // Still on the last good version.
      expect(after.applicationVersion).toBe("3.0.0");

      // But the failure is retained as history — evidence is never discarded.
      const history = await ops.listDeployments(inst.id);
      expect(history).toHaveLength(2);
      expect(history[0].applicationVersion).toBe("4.0.0-broken");
      expect(history[0].result).toBe("failed");
      expect(history[0].previousApplicationVersion).toBe("3.0.0");
    });

    it("rejects an unknown installation rather than inventing one", async () => {
      await expect(
        ops.recordDeployment({
          installationId: 2_000_000_000,
          result: "succeeded",
          executorType: "operator",
          actor: { userId: superAdminUser.id },
        }),
      ).rejects.toBeInstanceOf(ops.InstallationNotFoundError);
    });
  });

  // =======================================================================
  // §48 — Backup
  // =======================================================================
  describe("backup policy and evidence", () => {
    it("invents no RPO/RTO default — unconfigured stays null", async () => {
      const inst = await makeInstallation();
      const policy = await ops.upsertBackupPolicy({
        installationId: inst.id,
        enabled: true,
        actor: { userId: superAdminUser.id },
      });
      expect(policy.targetRpoMinutes).toBeNull();
      expect(policy.targetRtoMinutes).toBeNull();
      // Coverage defaults to unknown, never "covered".
      expect(policy.databaseCoverage).toBe("unknown");
      expect(policy.binaryStorageCoverage).toBe("unknown");
    });

    it("A DATABASE-ONLY BACKUP IS NEVER COMPLETE", async () => {
      const inst = await makeInstallation();
      const run = await ops.recordBackupRun({
        installationId: inst.id,
        databaseResult: "succeeded",
        binaryStorageResult: "unknown",
        recoveryPointAt: new Date(),
        executorType: "provider",
        actor: { userId: superAdminUser.id },
      });
      // Derived, never supplied by the caller.
      expect(run.result).toBe("partial");
      expect(ops.deriveBackupRunResult("succeeded", "not_covered" as any)).toBe("partial");
      expect(ops.deriveBackupRunResult("succeeded", "succeeded")).toBe("succeeded");
      expect(ops.deriveBackupRunResult("failed", "succeeded")).toBe("failed");
    });

    it("a request is not a backup, and cannot be made on an executor that accepts none", async () => {
      const inst = await makeInstallation();
      await ops.upsertBackupPolicy({
        installationId: inst.id,
        enabled: true,
        supportsBackupRequests: false,
        actor: { userId: superAdminUser.id },
      });
      await expect(
        ops.requestBackup({ installationId: inst.id, reason: "audit", actor: { userId: superAdminUser.id } }),
      ).rejects.toBeInstanceOf(ops.InvalidOperationalStateError);

      await ops.upsertBackupPolicy({
        installationId: inst.id,
        supportsBackupRequests: true,
        actor: { userId: superAdminUser.id },
      });
      const req = await ops.requestBackup({
        installationId: inst.id,
        reason: "pre-upgrade",
        actor: { userId: superAdminUser.id },
      });
      expect(req.status).toBe("requested");
      // A request produces NO evidence.
      expect(await ops.listBackupRuns(inst.id)).toHaveLength(0);
    });

    it("refuses an illegal request transition instead of silently applying it", async () => {
      const inst = await makeInstallation();
      await ops.upsertBackupPolicy({
        installationId: inst.id,
        enabled: true,
        supportsBackupRequests: true,
        actor: { userId: superAdminUser.id },
      });
      const req = await ops.requestBackup({
        installationId: inst.id,
        reason: "test",
        actor: { userId: superAdminUser.id },
      });
      await expect(
        ops.updateBackupRequestStatus({
          requestId: req.id,
          status: "succeeded",
          actor: { userId: superAdminUser.id },
        }),
      ).rejects.toBeInstanceOf(ops.InvalidOperationalStateError);

      await ops.updateBackupRequestStatus({ requestId: req.id, status: "accepted", actor: { userId: null } });
      await ops.updateBackupRequestStatus({ requestId: req.id, status: "executing", actor: { userId: null } });
      const done = await ops.updateBackupRequestStatus({
        requestId: req.id,
        status: "succeeded",
        actor: { userId: null },
      });
      expect(done.status).toBe("succeeded");
    });

    it("a correction appends and supersedes rather than rewriting history", async () => {
      const inst = await makeInstallation();
      const original = await ops.recordBackupRun({
        installationId: inst.id,
        databaseResult: "succeeded",
        binaryStorageResult: "succeeded",
        recoveryPointAt: new Date(),
        executorType: "provider",
        actor: { userId: superAdminUser.id },
      });
      const correction = await ops.recordBackupRun({
        installationId: inst.id,
        databaseResult: "failed",
        binaryStorageResult: "failed",
        executorType: "provider",
        failureCategory: "provider_reported_late_failure",
        supersedesRunId: original.id,
        actor: { userId: superAdminUser.id },
      });

      // The original report still exists, exactly as it was reported.
      const runs = await ops.listBackupRuns(inst.id);
      expect(runs).toHaveLength(2);
      expect(runs.find((r: any) => r.id === original.id)!.result).toBe("succeeded");
      // But the effective latest is the correction.
      expect((await ops.getLatestBackupRun(inst.id))!.id).toBe(correction.id);
    });
  });

  // =======================================================================
  // §49 / §16-19 — Telemetry and health derivation
  // =======================================================================
  describe("fleet health", () => {
    it("no telemetry and no evidence renders UNKNOWN, never healthy", async () => {
      const inst = await makeInstallation({ hostingModel: "dedicated_customer_managed" });
      const health = await ops.getInstallationHealth(inst.id);
      const byKey = new Map(health!.signals.map((s: any) => [s.key, s]));

      expect(byKey.get("telemetry")!.state).toBe("unknown");
      expect(byKey.get("application")!.state).toBe("unknown");
      expect(byKey.get("storage")!.state).toBe("unknown");
      expect(byKey.get("backup_freshness")!.state).toBe("unknown");
      // A customer-managed installation we cannot observe is UNKNOWN, not failed.
      expect(health!.overall).not.toBe("healthy");
      expect(health!.overall).not.toBe("unhealthy");
    });

    it("old telemetry renders STALE, distinct from unknown", async () => {
      const inst = await makeInstallation();
      await ops.recordTelemetry({
        installationId: inst.id,
        observedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        applicationHealthy: true,
        executorType: "installation_agent",
        actor: { userId: superAdminUser.id },
      });
      const health = await ops.getInstallationHealth(inst.id);
      expect(health!.signals.find((s: any) => s.key === "telemetry")!.state).toBe("stale");
    });

    it("fresh positive telemetry renders healthy; a negative report renders unhealthy", async () => {
      const good = await makeInstallation();
      await ops.recordTelemetry({
        installationId: good.id,
        observedAt: new Date(),
        applicationHealthy: true,
        databaseReady: true,
        storageBackend: "filesystem",
        storageHealthy: true,
        executorType: "installation_agent",
        actor: { userId: superAdminUser.id },
      });
      const goodHealth = await ops.getInstallationHealth(good.id);
      expect(goodHealth!.signals.find((s: any) => s.key === "application")!.state).toBe("healthy");
      expect(goodHealth!.signals.find((s: any) => s.key === "storage")!.state).toBe("healthy");

      const bad = await makeInstallation();
      await ops.recordTelemetry({
        installationId: bad.id,
        observedAt: new Date(),
        applicationHealthy: false,
        storageHealthy: false,
        executorType: "installation_agent",
        actor: { userId: superAdminUser.id },
      });
      const badHealth = await ops.getInstallationHealth(bad.id);
      expect(badHealth!.signals.find((s: any) => s.key === "application")!.state).toBe("unhealthy");
      expect(badHealth!.overall).toBe("unhealthy");
    });

    it("an out-of-order telemetry replay never overwrites fresher truth", async () => {
      const inst = await makeInstallation();
      const fresh = new Date();
      await ops.recordTelemetry({
        installationId: inst.id,
        observedAt: fresh,
        reportedApplicationVersion: "5.0.0",
        executorType: "installation_agent",
        actor: { userId: null },
      });
      await ops.recordTelemetry({
        installationId: inst.id,
        observedAt: new Date(fresh.getTime() - 60_000),
        reportedApplicationVersion: "4.0.0-old",
        executorType: "installation_agent",
        actor: { userId: null },
      });
      const current = await ops.getTelemetry(inst.id);
      expect(current!.reportedApplicationVersion).toBe("5.0.0");
    });

    it("telemetry is current-state only — one row per installation, never a snapshot lake", async () => {
      const inst = await makeInstallation();
      for (let i = 1; i <= 5; i += 1) {
        await ops.recordTelemetry({
          installationId: inst.id,
          observedAt: new Date(Date.now() + i * 1000),
          executorType: "installation_agent",
          actor: { userId: null },
        });
      }
      const rows = await db
        .select()
        .from(schema.installationTelemetryTable)
        .where(eq(schema.installationTelemetryTable.installationId, inst.id));
      expect(rows).toHaveLength(1);
    });

    it("overdue backup evidence is degraded only when a cadence is configured", async () => {
      const noCadence = await makeInstallation();
      await ops.upsertBackupPolicy({ installationId: noCadence.id, enabled: true, actor: { userId: null } });
      await ops.recordBackupRun({
        installationId: noCadence.id,
        databaseResult: "succeeded",
        binaryStorageResult: "succeeded",
        recoveryPointAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        executorType: "provider",
        actor: { userId: null },
      });
      const a = await ops.getInstallationHealth(noCadence.id);
      // No expectation configured, so nothing can be late.
      expect(a!.signals.find((s: any) => s.key === "backup_freshness")!.state).toBe("healthy");

      const withCadence = await makeInstallation();
      await ops.upsertBackupPolicy({
        installationId: withCadence.id,
        enabled: true,
        expectedFrequencyHours: 24,
        actor: { userId: null },
      });
      await ops.recordBackupRun({
        installationId: withCadence.id,
        databaseResult: "succeeded",
        binaryStorageResult: "succeeded",
        recoveryPointAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        executorType: "provider",
        actor: { userId: null },
      });
      const b = await ops.getInstallationHealth(withCadence.id);
      const sig = b!.signals.find((s: any) => s.key === "backup_freshness");
      expect(sig!.state).toBe("degraded");
      expect(sig!.detail).toContain("overdue");
    });

    it("partial coverage degrades the coverage signal and names what was missing", async () => {
      const inst = await makeInstallation();
      await ops.upsertBackupPolicy({ installationId: inst.id, enabled: true, actor: { userId: null } });
      await ops.recordBackupRun({
        installationId: inst.id,
        databaseResult: "succeeded",
        binaryStorageResult: "not_attempted",
        recoveryPointAt: new Date(),
        executorType: "provider",
        actor: { userId: null },
      });
      const health = await ops.getInstallationHealth(inst.id);
      const sig = health!.signals.find((s: any) => s.key === "backup_coverage");
      expect(sig!.state).toBe("degraded");
      expect(sig!.detail).toContain("binary storage");
    });

    it("every signal carries a readable reason, so state never depends on colour alone", async () => {
      const inst = await makeInstallation();
      const health = await ops.getInstallationHealth(inst.id);
      for (const signal of health!.signals) {
        expect(typeof signal.detail).toBe("string");
        expect(signal.detail.length).toBeGreaterThan(0);
      }
    });

    it("exposes NO composite numeric score", async () => {
      const inst = await makeInstallation();
      const health: any = await ops.getInstallationHealth(inst.id);
      expect(health).not.toHaveProperty("score");
      expect(health).not.toHaveProperty("healthPercent");
      expect(typeof health.overall).toBe("string");
    });
  });

  // =======================================================================
  // §50 — Storage integration stays aggregate
  // =======================================================================
  describe("storage integration", () => {
    it("health exposes only aggregate storage facts — no keys, filenames or documents", async () => {
      const inst = await makeInstallation();
      await ops.recordTelemetry({
        installationId: inst.id,
        observedAt: new Date(),
        storageBackend: "s3",
        storageHealthy: true,
        executorType: "installation_agent",
        actor: { userId: null },
      });
      const health = await ops.getInstallationHealth(inst.id);
      const serialized = JSON.stringify(health);

      expect(health!.signals.find((s: any) => s.key === "storage")!.detail).toContain("s3");
      // Nothing document-shaped may cross this boundary.
      for (const forbidden of ["storageKey", "fileName", "checksumSha256", "employeeId", "documents/"]) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });
});
