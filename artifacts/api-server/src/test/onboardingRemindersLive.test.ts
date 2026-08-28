/**
 * WS-10 — live proof of the WS-6 reminder contract (§26.14) and the
 * Recruitment conversion handoff (§26.34).
 *
 * The properties under test are the stale-safety ones: a reminder for a task
 * that has since been completed, or whose onboarding was cancelled, must
 * no-op permanently rather than nag or retry, and it must never be delivered
 * by email or SMS (no such capability exists).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS10_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-10 — reminders and conversion handoff, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let orgId: number;
  let userId: number;
  let membershipId: number;

  let templates: typeof import("../lib/onboarding/templates");
  let instances: typeof import("../lib/onboarding/instances");
  let reminders: typeof import("../lib/onboarding/reminders");
  let jobHandlers: typeof import("../lib/jobHandlers");
  let registry: typeof import("../lib/jobHandlerRegistry");
  let scheduledJobs: typeof import("../lib/scheduledJobs");

  const suffix = `ws10r-${Date.now()}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    templates = await import("../lib/onboarding/templates");
    instances = await import("../lib/onboarding/instances");
    reminders = await import("../lib/onboarding/reminders");
    jobHandlers = await import("../lib/jobHandlers");
    registry = await import("../lib/jobHandlerRegistry");
    scheduledJobs = await import("../lib/scheduledJobs");

    jobHandlers.registerShippedJobHandlers();

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS10R ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "R", lastName: "Actor", organizationId: orgId })
      .returning();
    userId = user.id;
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId: orgId, status: "active" })
      .returning();
    membershipId = m.id;
  });

  const actor = () => ({ actorApplicationUserId: userId, actorMembershipId: membershipId });

  async function onboardingWithTask(name: string, resolver?: { responsibleResolver: any; responsibleMembershipId?: number; responsiblePermissionKey?: string }) {
    const { version } = await templates.createTemplate({ organizationId: orgId, name, ...actor() });
    await templates.addVersionTask({
      organizationId: orgId,
      versionId: version.id,
      definition: {
        title: "Reminder subject",
        required: true,
        // Defaults to a permission holder that nobody in this disposable
        // organization holds, which is itself the safe-no-op case; tests that
        // need a reachable recipient name one explicitly.
        responsibleResolver: resolver?.responsibleResolver ?? "permission_holder",
        responsiblePermissionKey: resolver?.responsiblePermissionKey ?? "onboarding.manage",
        responsibleMembershipId: resolver?.responsibleMembershipId ?? null,
      },
      ...actor(),
    });
    await templates.activateVersion({ organizationId: orgId, versionId: version.id, ...actor() });
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Rem", lastName: name.slice(0, 8) })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const task = (await instances.listInstanceTasks(orgId, instance.id))[0];
    return { instance, task, employeeId: emp.id };
  }

  it("registers exactly the three allow-listed onboarding job types", () => {
    expect(registry.getJobHandler("onboarding.task_reminder")).toBeDefined();
    expect(registry.getJobHandler("onboarding.overdue_reminder")).toBeDefined();
    expect(registry.getJobHandler("onboarding.acknowledgement_reminder")).toBeDefined();
    // Nothing else was smuggled in under an onboarding name.
    expect(registry.getJobHandler("onboarding.email")).toBeUndefined();
    expect(registry.getJobHandler("onboarding.sms")).toBeUndefined();
  });

  it("schedules due and overdue reminders idempotently, keyed on the due date", async () => {
    const { task } = await onboardingWithTask(`Sched ${suffix}`);
    const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await reminders.scheduleTaskReminders({ organizationId: orgId, taskId: task.id, dueAt, createdBy: userId });
    await reminders.scheduleTaskReminders({ organizationId: orgId, taskId: task.id, dueAt, createdBy: userId });

    const jobs = await scheduledJobs.listScheduledJobs({ organizationId: orgId });
    const forTask = jobs.filter((j: any) => j.sourceReferenceType === "onboarding_task" && j.sourceReferenceId === task.id);
    // Two job types, one each — the second call deduped rather than duplicating.
    expect(forTask).toHaveLength(2);
    expect(new Set(forTask.map((j: any) => j.jobType))).toEqual(
      new Set(["onboarding.task_reminder", "onboarding.overdue_reminder"]),
    );
    // Payloads carry a narrow identifier only, never a domain snapshot.
    expect(forTask[0].payload).toEqual({ taskId: task.id });
  });

  it("a reminder for an already-completed task no-ops permanently instead of notifying", async () => {
    const { task, instance } = await onboardingWithTask(`Done ${suffix}`);
    await instances.completeTask({ organizationId: orgId, taskId: task.id, ...actor() });

    const handler = registry.getJobHandler("onboarding.task_reminder")!;
    const before = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.organizationId, orgId));

    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "onboarding_task",
        sourceReferenceId: task.id,
        payload: handler.parsePayload({ taskId: task.id }),
        attemptCount: 0,
      }),
    ).rejects.toBeInstanceOf(registry.PermanentJobError);

    const after = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.organizationId, orgId));
    expect(after).toHaveLength(before.length);
    expect(instance.id).toBeGreaterThan(0);
  });

  it("a reminder for a cancelled onboarding no-ops, and cancellation clears its queued jobs", async () => {
    const { task, instance } = await onboardingWithTask(`Cancelled ${suffix}`);
    await reminders.scheduleTaskReminders({
      organizationId: orgId,
      taskId: task.id,
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdBy: userId,
    });

    await instances.cancelOnboarding({ organizationId: orgId, instanceId: instance.id, reason: "Deferred", ...actor() });
    const cancelledJobs = await reminders.cancelRemindersForInstance({
      organizationId: orgId,
      instanceId: instance.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(cancelledJobs).toBeGreaterThan(0);

    const remaining = (await scheduledJobs.listScheduledJobs({ organizationId: orgId, status: "scheduled" })).filter(
      (j: any) => j.sourceReferenceId === task.id && j.sourceReferenceType === "onboarding_task",
    );
    expect(remaining).toHaveLength(0);

    // Even if one had already been claimed, the handler refuses to fire.
    const handler = registry.getJobHandler("onboarding.overdue_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "onboarding_task",
        sourceReferenceId: task.id,
        payload: handler.parsePayload({ taskId: task.id }),
        attemptCount: 0,
      }),
    ).rejects.toBeInstanceOf(registry.PermanentJobError);
  });

  it("an overdue reminder does not fire when the due date is still in the future", async () => {
    const { task } = await onboardingWithTask(`Future ${suffix}`);
    await db
      .update(schema.onboardingTasksTable)
      .set({ dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.onboardingTasksTable.id, task.id));

    const handler = registry.getJobHandler("onboarding.overdue_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "onboarding_task",
        sourceReferenceId: task.id,
        payload: handler.parsePayload({ taskId: task.id }),
        attemptCount: 0,
      }),
    ).rejects.toThrow(/not overdue/i);
  });

  it("a reminder with nobody currently responsible is a safe no-op, not a failure", async () => {
    // The default fixture resolver is a permission nobody in this organization
    // holds. WS-6's own recipient resolution takes the same stance: an empty
    // relationship notifies nobody rather than erroring.
    const { task } = await onboardingWithTask(`Nobody ${suffix}`);
    await db
      .update(schema.onboardingTasksTable)
      .set({ dueAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.onboardingTasksTable.id, task.id));

    const handler = registry.getJobHandler("onboarding.overdue_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "onboarding_task",
        sourceReferenceId: task.id,
        payload: handler.parsePayload({ taskId: task.id }),
        attemptCount: 0,
      }),
    ).resolves.toBeUndefined();

    const notifications = await db
      .select()
      .from(schema.notificationsTable)
      .where(
        and(
          eq(schema.notificationsTable.sourceReferenceType, "onboarding_task"),
          eq(schema.notificationsTable.sourceReferenceId, task.id),
        ),
      );
    expect(notifications).toHaveLength(0);
  });

  it("a genuinely due reminder creates an in-app notification and nothing else", async () => {
    const { task } = await onboardingWithTask(`Live ${suffix}`, {
      responsibleResolver: "specific_membership",
      responsibleMembershipId: membershipId,
    });
    await db
      .update(schema.onboardingTasksTable)
      .set({ dueAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.onboardingTasksTable.id, task.id));

    // A real queued job, because a notification carries a genuine sourceJobId
    // (which is also what makes a retried job idempotent).
    const job = await scheduledJobs.scheduleJob({
      organizationId: orgId,
      jobType: "onboarding.overdue_reminder",
      idempotencyKey: `onboarding:task:${task.id}:overdue:live-${suffix}`,
      scheduledFor: new Date(Date.now() - 1000),
      sourceReferenceType: "onboarding_task",
      sourceReferenceId: task.id,
      payload: { taskId: task.id },
      createdBy: userId,
    });

    const handler = registry.getJobHandler("onboarding.overdue_reminder")!;
    await handler.execute({
      jobId: job.id,
      organizationId: orgId,
      sourceReferenceType: "onboarding_task",
      sourceReferenceId: task.id,
      payload: handler.parsePayload({ taskId: task.id }),
      attemptCount: 0,
    });

    const notifications = await db
      .select()
      .from(schema.notificationsTable)
      .where(
        and(
          eq(schema.notificationsTable.organizationId, orgId),
          eq(schema.notificationsTable.sourceReferenceType, "onboarding_task"),
          eq(schema.notificationsTable.sourceReferenceId, task.id),
        ),
      );
    expect(notifications.length).toBeGreaterThan(0);
    // In-app only: a path fragment, never an email address or external URL.
    expect(notifications[0].actionPath).toMatch(/^\/onboarding\//);
    expect(notifications[0].title).toMatch(/overdue/i);
  });

  it("a reminder cannot be aimed at a task in another organization", async () => {
    const { task } = await onboardingWithTask(`Cross ${suffix}`);
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS10R other ${suffix}`, slug: `${suffix}-o` })
      .returning();

    const handler = registry.getJobHandler("onboarding.task_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        // A forged job claiming another organization must not resolve the task.
        organizationId: other.id,
        sourceReferenceType: "onboarding_task",
        sourceReferenceId: task.id,
        payload: handler.parsePayload({ taskId: task.id }),
        attemptCount: 0,
      }),
    ).rejects.toThrow(/no longer exists/i);
  });

  it("§26.34: conversion starts onboarding once, and a retry does not create a second", async () => {
    // Exercised directly against the handoff helper with reuseExisting, which
    // is exactly how convertApplicationToEmployee calls it.
    const { version } = await templates.createTemplate({ organizationId: orgId, name: `Handoff ${suffix}`, ...actor() });
    await templates.addVersionTask({ organizationId: orgId, versionId: version.id, definition: { title: "t" }, ...actor() });
    await templates.activateVersion({ organizationId: orgId, versionId: version.id, ...actor() });

    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Handoff", lastName: "Subject" })
      .returning();
    const [candidate] = await db
      .insert(schema.candidatesTable)
      .values({ organizationId: orgId, firstName: "Handoff", lastName: "Cand", email: `hc-${suffix}@example.invalid` })
      .returning();

    const first = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      candidateId: candidate.id,
      reuseExisting: true,
      ...actor(),
    });
    const second = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      candidateId: candidate.id,
      reuseExisting: true,
      ...actor(),
    });

    expect(second.reused).toBe(true);
    expect(second.instance.id).toBe(first.instance.id);
    // Candidate provenance is carried, and candidate history is untouched.
    expect(first.instance.candidateId).toBe(candidate.id);

    const all = await db
      .select()
      .from(schema.onboardingInstancesTable)
      .where(and(eq(schema.onboardingInstancesTable.organizationId, orgId), eq(schema.onboardingInstancesTable.employeeId, emp.id)));
    expect(all).toHaveLength(1);
  });
});
