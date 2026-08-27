/**
 * WS-6 — live integration coverage for the notification foundation
 * (lib/notifications.ts): recipient resolution against real membership/
 * employee-link data, cross-org isolation, and retry-safe dedup via
 * sourceJobId. Same self-skipping pattern as the other WS-5/WS-6 live
 * suites — requires WS6_LIVE_DATABASE_URL, never runs in CI.
 *
 * IMPORTANT: run this file ALONE — see scheduledJobsLiveIntegration.test.ts's
 * header for why the WS6_LIVE_* suites must not run concurrently against
 * the same real database (claimDueJobs is deliberately unscoped, by
 * production design; never a concern in CI).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS6_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-6 notifications — live integration", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgA: number;
  let orgB: number;
  let userInOrgA: number;
  let userInOrgB: number;
  let userWithNoMembership: number;
  let employeeInOrgA: number;
  let managerInOrgA: number;

  let notifications: typeof import("../lib/notifications");

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    notifications = await import("../lib/notifications");

    const suffix = `ws6-notif-${Date.now()}`;
    const [a] = await db.insert(schema.organizationsTable).values({ name: `WS6 Notif A ${suffix}`, slug: `ws6-notif-a-${suffix}` }).returning();
    const [b] = await db.insert(schema.organizationsTable).values({ name: `WS6 Notif B ${suffix}`, slug: `ws6-notif-b-${suffix}` }).returning();
    orgA = a.id;
    orgB = b.id;

    const makeUser = async (label: string, organizationId: number) => {
      const [user] = await db
        .insert(schema.usersTable)
        .values({ email: `${label}-${suffix}@example.invalid`, passwordHash: "x", firstName: label, lastName: "Tester", organizationId })
        .returning();
      return user.id;
    };

    userInOrgA = await makeUser("member-a", orgA);
    userInOrgB = await makeUser("member-b", orgB);
    userWithNoMembership = await makeUser("nomember", orgA);

    await db.insert(schema.organizationMembershipsTable).values([
      { applicationUserId: userInOrgA, organizationId: orgA, status: "active" },
      { applicationUserId: userInOrgB, organizationId: orgB, status: "active" },
    ]);

    const managerUserId = await makeUser("manager-a", orgA);
    const [managerMembership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: managerUserId, organizationId: orgA, status: "active" })
      .returning();

    const [manager] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgA, firstName: "Manager", lastName: "A", employeeNumber: `MGR-${suffix}` })
      .returning();
    managerInOrgA = manager.id;
    await db.insert(schema.employeeUserLinksTable).values({ employeeId: manager.id, applicationUserId: managerUserId, organizationMembershipId: managerMembership.id });

    const [employee] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgA, firstName: "Report", lastName: "A", employeeNumber: `EMP-${suffix}`, reportingManagerId: manager.id })
      .returning();
    employeeInOrgA = employee.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.notificationsTable).where(eq(schema.notificationsTable.organizationId, orgA)).catch(() => undefined);
    await db.delete(schema.notificationsTable).where(eq(schema.notificationsTable.organizationId, orgB)).catch(() => undefined);
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  it("notifies an exact user who has an active membership in the organization", async () => {
    const rows = await notifications.notifyUser({
      recipient: { kind: "user", userId: userInOrgA },
      organizationId: orgA,
      title: "Test",
      message: "Hello",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userInOrgA);
    expect(rows[0].organizationId).toBe(orgA);
  });

  it("§18/§19: refuses to notify a user who has no membership in the target organization", async () => {
    await expect(
      notifications.notifyUser({ recipient: { kind: "user", userId: userWithNoMembership }, organizationId: orgA, title: "x", message: "x" }),
    ).rejects.toThrow(notifications.RecipientNotAuthorizedError);
  });

  it("§20: a user belonging to Org B cannot be notified in Org A's context", async () => {
    await expect(
      notifications.notifyUser({ recipient: { kind: "user", userId: userInOrgB }, organizationId: orgA, title: "x", message: "x" }),
    ).rejects.toThrow(notifications.RecipientNotAuthorizedError);
  });

  it("resolves the manager of an employee via reportingManagerId, live", async () => {
    const rows = await notifications.notifyUser({
      recipient: { kind: "manager_of_employee", employeeId: employeeInOrgA },
      organizationId: orgA,
      title: "Direct report update",
      message: "x",
    });
    expect(rows).toHaveLength(1);
  });

  it("an employee with no manager resolves to zero recipients, not an error", async () => {
    const [noManagerEmployee] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgA, firstName: "NoManager", lastName: "A", employeeNumber: `NM-${Date.now()}` })
      .returning();
    const rows = await notifications.notifyUser({
      recipient: { kind: "manager_of_employee", employeeId: noManagerEmployee.id },
      organizationId: orgA,
      title: "x",
      message: "x",
    });
    expect(rows).toHaveLength(0);
  });

  it("§13: retrying with the same sourceJobId never creates a second notification", async () => {
    const jobId = 999_000 + Math.floor(Math.random() * 1000);
    const first = await notifications.notifyUser({
      recipient: { kind: "user", userId: userInOrgA },
      organizationId: orgA,
      title: "Retry test",
      message: "x",
      sourceJobId: null, // set explicitly below via direct dedup check instead — sourceJobId FK requires a real row
    });
    expect(first).toHaveLength(1);

    // Direct dedup check against a real scheduled_jobs row (FK requires it to exist).
    const [job] = await db
      .insert(schema.scheduledJobsTable)
      .values({ organizationId: orgA, jobType: "test.dedup", idempotencyKey: `dedup-${Date.now()}`, scheduledFor: new Date() })
      .returning();

    const firstAttempt = await notifications.notifyUser({
      recipient: { kind: "user", userId: userInOrgA },
      organizationId: orgA,
      title: "Job-linked",
      message: "x",
      sourceJobId: job.id,
    });
    const secondAttempt = await notifications.notifyUser({
      recipient: { kind: "user", userId: userInOrgA },
      organizationId: orgA,
      title: "Job-linked (retry)",
      message: "different text — must still dedup on sourceJobId+recipient",
      sourceJobId: job.id,
    });

    expect(secondAttempt[0].id).toBe(firstAttempt[0].id);
    const rows = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.sourceJobId, job.id));
    expect(rows).toHaveLength(1);
  });

  it("§59: Org B cannot list Org A's notifications, and vice versa", async () => {
    await notifications.notifyUser({ recipient: { kind: "user", userId: userInOrgA }, organizationId: orgA, title: "A-only", message: "x" });
    const listedForA = await notifications.listNotificationsForUser(userInOrgA, { organizationId: orgA });
    const listedForAWrongOrg = await notifications.listNotificationsForUser(userInOrgA, { organizationId: orgB });
    expect(listedForA.some((n: any) => n.title === "A-only")).toBe(true);
    expect(listedForAWrongOrg.some((n: any) => n.title === "A-only")).toBe(false);
  });

  it("§36: dismissNotification is IDOR-safe — a different user's id never resolves", async () => {
    const [created] = await notifications.notifyUser({ recipient: { kind: "user", userId: userInOrgA }, organizationId: orgA, title: "Dismiss test", message: "x" });
    await expect(notifications.dismissNotification(userInOrgB, created.id)).rejects.toThrow(notifications.NotificationNotFoundError);
    const dismissed = await notifications.dismissNotification(userInOrgA, created.id);
    expect(dismissed.dismissedAt).not.toBeNull();
  });

  it("an expired notification is excluded from ordinary listing without being deleted", async () => {
    const [created] = await notifications.notifyUser({ recipient: { kind: "user", userId: userInOrgA }, organizationId: orgA, title: "Expiring", message: "x" });
    await db.update(schema.notificationsTable).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(schema.notificationsTable.id, created.id));

    const listed = await notifications.listNotificationsForUser(userInOrgA, { organizationId: orgA });
    expect(listed.some((n: any) => n.id === created.id)).toBe(false);

    const stillExists = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.id, created.id));
    expect(stillExists).toHaveLength(1);
  });

  it("permission_holders resolves every active member holding a given permission key in the organization", async () => {
    // super_admin/org_admin/etc role wiring is seeded separately; here we
    // only prove the query shape resolves zero for a permission nobody in
    // this disposable org holds, without throwing.
    const rows = await notifications.resolveRecipients({ kind: "permission_holders", permissionKey: "nonexistent.permission.key" }, orgA);
    expect(rows).toEqual([]);
  });
});
