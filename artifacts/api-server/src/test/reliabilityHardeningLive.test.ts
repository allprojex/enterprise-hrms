/**
 * P0 reliability hardening — live proof against a REAL PostgreSQL database.
 *
 * Each race is forced deterministically rather than hoped for: a second
 * transaction locks the row and changes it, the code under test reads the
 * still-committed (old) state and blocks on its write, and the lock holder
 * then commits. The write must notice the row moved instead of overwriting it.
 *
 *   - WS-13 data-change and service-request transitions are compare-and-set;
 *   - a concurrent apply of one data-change request writes exactly once;
 *   - cancelling leave cannot overwrite a final approval that landed first;
 *   - a job outcome is written only while the worker still holds its claim;
 *   - a job for a module the organization has not enabled is not run;
 *   - scheduleJob and notifyUser join a caller's transaction.
 *
 * Skips itself unless RELIABILITY_LIVE_DATABASE_URL is set (local hosts only,
 * see liveDbGuard). Run it ALONE: it claims due jobs platform-wide.
 *
 *   RELIABILITY_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5446/hrms \
 *     pnpm --filter @workspace/api-server exec vitest run reliabilityHardeningLive
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("RELIABILITY_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("P0 reliability hardening — live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let sql: any;
  let getTableName: (table: any) => string;

  let dataChange: typeof import("../lib/employeeRequests/dataChange");
  let serviceRequests: typeof import("../lib/employeeRequests/serviceRequests");
  let concurrency: typeof import("../lib/employeeRequests/concurrency");
  let leaveRequests: typeof import("../lib/leaveRequests");
  let scheduledJobs: typeof import("../lib/scheduledJobs");
  let registry: typeof import("../lib/jobHandlerRegistry");
  let notifications: typeof import("../lib/notifications");

  let orgId: number;
  let otherOrgId: number;
  let requesterUserId: number;
  let requesterMembershipId: number;
  let approverUserId: number;
  let approverMembershipId: number;

  const suffix = `p0-${Date.now()}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    sql = drizzle.sql;
    getTableName = drizzle.getTableName;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    dataChange = await import("../lib/employeeRequests/dataChange");
    serviceRequests = await import("../lib/employeeRequests/serviceRequests");
    concurrency = await import("../lib/employeeRequests/concurrency");
    leaveRequests = await import("../lib/leaveRequests");
    scheduledJobs = await import("../lib/scheduledJobs");
    registry = await import("../lib/jobHandlerRegistry");
    notifications = await import("../lib/notifications");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `P0 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `P0 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const requester = await mkUser("requester", orgId);
    requesterUserId = requester.userId;
    requesterMembershipId = requester.membershipId;
    const approver = await mkUser("approver", orgId);
    approverUserId = approver.userId;
    approverMembershipId = approver.membershipId;
  });

  async function mkUser(tag: string, organizationId: number, client: any = db) {
    const [u] = await client
      .insert(schema.usersTable)
      .values({
        email: `${tag}-${suffix}-${Math.random().toString(36).slice(2, 8)}@example.invalid`,
        passwordHash: "x",
        firstName: tag,
        lastName: "Actor",
        organizationId,
      })
      .returning();
    const [m] = await client
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId, status: "active" })
      .returning();
    return { userId: u.id, membershipId: m.id };
  }

  const asRequester = () => ({ actorApplicationUserId: requesterUserId, actorMembershipId: requesterMembershipId });
  const asApprover = () => ({ actorApplicationUserId: approverUserId, actorMembershipId: approverMembershipId });

  async function makeEmployee(tag: string) {
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: tag, lastName: "Subject" })
      .returning();
    return emp;
  }

  /**
   * Resolves once the code under test is blocked on a row lock while writing
   * `tableName` — matched by its own UPDATE statement, not just any waiter.
   * Throws after 10s: a race that never happened must fail the test, not let
   * it pass vacuously (e.g. a write that read the row only after the holder
   * committed).
   */
  async function waitForBlockedUpdate(tableName: string, waiters = 1): Promise<void> {
    await waitForLockWaiters(`update "${tableName}"%`, waiters, `writing "${tableName}"`);
  }

  /** As waitForBlockedUpdate, for any statement matching `pattern` (ILIKE). */
  async function waitForLockWaiters(pattern: string, waiters: number, what: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = await db.execute(
        sql`select count(*)::int as n from pg_stat_activity
            where wait_event_type = 'Lock' and datname = current_database() and query ilike ${pattern}`,
      );
      if (Number(result.rows[0].n) >= waiters) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`the code under test never blocked ${what} (${waiters} expected): the race was not forced`);
  }

  /** Audit rows recorded for one data-change request, by event type. */
  async function auditEventTypes(requestId: number): Promise<string[]> {
    const rows = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.targetType, "data_change_request"),
          eq(schema.auditEventsTable.targetId, String(requestId)),
        ),
      );
    return rows.map((r: any) => r.eventType);
  }

  /** The message of an error and of everything it wraps (drizzle wraps driver errors). */
  function fullMessage(err: unknown): string {
    const parts: string[] = [];
    for (let e: any = err; e; e = e.cause) parts.push(String(e.message ?? e));
    return parts.join(" <- ");
  }

  async function approvedRequest(tag: string, requestedValue: string) {
    const emp = await makeEmployee(tag);
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue }],
      ...asRequester(),
    });
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    return { emp, request };
  }

  async function preferredNameOf(employeeId: number): Promise<string | null> {
    const [row] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, employeeId));
    return row.preferredName;
  }

  /**
   * Forces the race: a second transaction locks `id` and applies `patch`
   * without committing; `run` starts, reads the old committed state, and
   * blocks on its own write; then the holder commits and `run` resumes.
   */
  async function raceAgainst(table: any, id: number, patch: Record<string, unknown>, run: () => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));

    const holder = db.transaction(async (tx: any) => {
      await tx.select().from(table).where(eq(table.id, id)).for("update");
      await tx.update(table).set(patch).where(eq(table.id, id));
      signalLocked();
      await gate;
    });

    await locked;
    const outcome = run().then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    try {
      await waitForBlockedUpdate(getTableName(table));
    } finally {
      release();
      await holder;
    }
    return outcome;
  }

  // -- WS-13 compare-and-set -------------------------------------------------

  it("a data-change approval that loses a race with withdrawal is refused, and nothing is recorded for it", async () => {
    const emp = await makeEmployee("DcRace");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue: "Race" }],
      ...asRequester(),
    });

    const outcome = await raceAgainst(
      schema.dataChangeRequestsTable,
      request.id,
      { status: "withdrawn", currentStageOrder: null },
      () => dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() }),
    );

    expect(outcome.ok).toBe(false);
    expect((outcome as any).error).toBeInstanceOf(concurrency.RequestChangedConcurrentlyError);
    // The withdrawal stands: the approval did not revive the request.
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("withdrawn");
    const events = await dataChange.listRequestEvents(orgId, request.id);
    expect(events.map((e: any) => e.eventType)).not.toContain("approved");
  });

  it("concurrent applies of one approved data-change request write exactly once", async () => {
    const emp = await makeEmployee("DcApply");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue: "Once" }],
      ...asRequester(),
    });
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });

    const results = await Promise.allSettled([
      dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() }),
      dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() }),
    ]);

    const events = await dataChange.listRequestEvents(orgId, request.id);
    expect(events.filter((e: any) => e.eventType === "applied")).toHaveLength(1);
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("applied");
    // One call applied; the other either saw it applied (idempotent return) or
    // was refused — never a second write.
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(dataChange.RequestNotActionableError);
    }
  });

  it("an audit-write failure during apply rolls the application back and is recorded as application_failed, not as a concurrent change", async () => {
    const { emp, request } = await approvedRequest("DcAuditFail", "Audited");
    // Rejects exactly one insert: this request's "applied" audit row.
    const fn = `p0_fail_applied_audit_${request.id}`;
    await db.execute(
      sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
        begin
          if new.event_type = 'data_change_request.applied' and new.target_id = '${request.id}' then
            raise exception 'p0 injected audit failure';
          end if;
          return new;
        end $$`),
    );
    await db.execute(sql.raw(`create trigger ${fn} before insert on audit_events for each row execute function ${fn}()`));
    let failure: unknown;
    try {
      failure = await dataChange
        .applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() })
        .then(() => undefined, (err) => err);
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${fn} on audit_events`));
      await db.execute(sql.raw(`drop function if exists ${fn}()`));
    }

    // The caller is told the truth: the apply failed, with its own cause.
    expect(failure).toBeDefined();
    expect(failure).not.toBeInstanceOf(concurrency.RequestChangedConcurrentlyError);
    expect(fullMessage(failure)).toMatch(/p0 injected audit failure/);
    // Nothing was applied without its audit row.
    expect(await preferredNameOf(emp.id)).toBeNull();
    const failed = (await dataChange.getRequest(orgId, request.id))!;
    expect(failed.status).toBe("application_failed");
    const events = (await dataChange.listRequestEvents(orgId, request.id)).map((e: any) => e.eventType);
    expect(events).toContain("application_failed");
    expect(events).not.toContain("applied");
    expect(await auditEventTypes(request.id)).toContain("data_change_request.application_failed");
    expect(await auditEventTypes(request.id)).not.toContain("data_change_request.applied");

    // Recoverable: once the audit log accepts writes, applying again succeeds.
    const applied = await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(applied.status).toBe("applied");
    expect(await preferredNameOf(emp.id)).toBe("Audited");
    expect((await auditEventTypes(request.id)).filter((t) => t === "data_change_request.applied")).toHaveLength(1);
  });

  it("a failing apply that loses the race to a successful apply does not record a failure over it", async () => {
    const { emp, request } = await approvedRequest("DcFailRace", "Winner");
    // The FIRST employee write for this subject waits on an advisory lock the
    // test holds, then fails. Every later write passes. A sequence, because
    // nextval survives the failing transaction's rollback.
    const fn = `p0_fail_first_apply_${request.id}`;
    const lockKey = 380_000_000 + request.id;
    await db.execute(sql.raw(`create sequence ${fn}_seq`));
    await db.execute(
      sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
        begin
          if new.id = ${emp.id} and nextval('${fn}_seq') = 1 then
            perform pg_advisory_xact_lock(${lockKey});
            raise exception 'p0 injected apply failure';
          end if;
          return new;
        end $$`),
    );
    await db.execute(sql.raw(`create trigger ${fn} before update on employees for each row execute function ${fn}()`));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const holder = db.transaction(async (tx: any) => {
      await tx.execute(sql.raw(`select pg_advisory_xact_lock(${lockKey})`));
      signalLocked();
      await gate;
    });
    const settle = (p: Promise<unknown>) =>
      p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));

    let failing: Awaited<ReturnType<typeof settle>>;
    let winning: Awaited<ReturnType<typeof settle>>;
    try {
      await locked;
      // 1. The failing attempt holds the request's row lock and waits inside its write.
      const failingRun = settle(dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() }));
      await waitForLockWaiters(`update "employees"%`, 1, "inside the failing apply's employee write");
      // 2. The winning attempt queues behind that row lock.
      const winningRun = settle(dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() }));
      await waitForLockWaiters(`select%from "data_change_requests"%for update%`, 1, "the winning apply on the row lock");
      // 3. The failing attempt rolls back; the winner applies while the loser
      //    is about to record its failure.
      release();
      await holder;
      [failing, winning] = await Promise.all([failingRun, winningRun]);
    } finally {
      release();
      await holder.catch(() => undefined);
      await db.execute(sql.raw(`drop trigger if exists ${fn} on employees`));
      await db.execute(sql.raw(`drop function if exists ${fn}()`));
      await db.execute(sql.raw(`drop sequence if exists ${fn}_seq`));
    }

    expect(winning.ok).toBe(true);
    expect(failing.ok).toBe(false);
    expect((failing as any).error).toBeInstanceOf(concurrency.RequestChangedConcurrentlyError);
    // The successful application stands, and its record is not contradicted.
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("applied");
    expect(await preferredNameOf(emp.id)).toBe("Winner");
    const events = (await dataChange.listRequestEvents(orgId, request.id)).map((e: any) => e.eventType);
    expect(events.filter((t: string) => t === "applied")).toHaveLength(1);
    expect(events).not.toContain("application_failed");
    const audits = await auditEventTypes(request.id);
    expect(audits.filter((t) => t === "data_change_request.applied")).toHaveLength(1);
    expect(audits).not.toContain("data_change_request.application_failed");
  });

  it("two concurrent applies of the same stale request both report it stale, and it is marked stale once", async () => {
    const { emp, request } = await approvedRequest("DcDoubleStale", "Requested");
    // The live value moves after approval: the request's basis is now stale.
    await db.update(schema.employeesTable).set({ preferredName: "Moved" }).where(eq(schema.employeesTable.id, emp.id));

    // Hold the request's field rows so both callers pass every check, detect
    // the staleness, and block inside markStale before either can mark it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const fields = schema.dataChangeRequestFieldsTable;
    const holder = db.transaction(async (tx: any) => {
      await tx.select().from(fields).where(eq(fields.requestId, request.id)).for("update");
      signalLocked();
      await gate;
    });

    let results: PromiseSettledResult<unknown>[];
    try {
      await locked;
      const both = Promise.allSettled([
        dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() }),
        dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() }),
      ]);
      await waitForBlockedUpdate(getTableName(fields), 2);
      release();
      await holder;
      results = await both;
    } finally {
      release();
      await holder.catch(() => undefined);
    }

    // Each caller is told the request is stale; neither is told it changed concurrently.
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(dataChange.RequestStaleError);
    }
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("stale");
    const events = (await dataChange.listRequestEvents(orgId, request.id)).map((e: any) => e.eventType);
    expect(events.filter((t: string) => t === "stale_detected")).toHaveLength(1);
    expect((await auditEventTypes(request.id)).filter((t) => t === "data_change_request.stale_detected")).toHaveLength(1);
    expect(await preferredNameOf(emp.id)).toBe("Moved");
  });

  it("a service-request approval that loses a race with withdrawal is refused, and nothing is recorded for it", async () => {
    const emp = await makeEmployee("SrRace");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `race-${suffix}`,
      name: "Race",
      approvalRequired: true,
      ...asRequester(),
    });
    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: type.id,
      employeeId: emp.id,
      subject: "Race",
      viaSelfService: false,
      ...asRequester(),
    });

    const outcome = await raceAgainst(
      schema.serviceRequestsTable,
      request.id,
      { status: "withdrawn", closedAt: new Date() },
      () => serviceRequests.approve({ organizationId: orgId, requestId: request.id, ...asApprover() }),
    );

    expect(outcome.ok).toBe(false);
    expect((outcome as any).error).toBeInstanceOf(concurrency.RequestChangedConcurrentlyError);
    const after = (await serviceRequests.getRequest(orgId, request.id))!;
    expect(after.status).toBe("withdrawn");
    expect(after.approvalStatus).toBe("pending");
    const events = await serviceRequests.listEvents(orgId, request.id);
    expect(events.map((e: any) => e.eventType)).not.toContain("approved");
  });

  it("an uncontended service-request transition still succeeds", async () => {
    const emp = await makeEmployee("SrPlain");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `plain-${suffix}`,
      name: "Plain",
      approvalRequired: false,
      ...asRequester(),
    });
    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: type.id,
      employeeId: emp.id,
      subject: "Plain",
      viaSelfService: false,
      ...asRequester(),
    });
    const acknowledged = await serviceRequests.acknowledge({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(acknowledged.status).toBe("acknowledged");
    const assigned = await serviceRequests.assign({
      organizationId: orgId,
      requestId: request.id,
      assignedMembershipId: approverMembershipId,
      ...asApprover(),
    });
    expect(assigned.status).toBe("in_progress");
    const closed = await serviceRequests.close({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(closed.status).toBe("closed");
  });

  // -- Leave cancellation ----------------------------------------------------

  it("cancelling leave cannot overwrite a final approval that landed first", async () => {
    const emp = await makeEmployee("LeaveRace");
    const [type] = await db
      .insert(schema.leaveTypesTable)
      .values({ organizationId: orgId, name: `Annual ${suffix}`, code: `AL-${suffix}` })
      .returning();
    const [policy] = await db
      .insert(schema.leavePoliciesTable)
      .values({
        organizationId: orgId,
        leaveTypeId: type.id,
        name: `Policy ${suffix}`,
        annualEntitlementDays: "20",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      })
      .returning();
    const [leave] = await db
      .insert(schema.leaveRequestsTable)
      .values({
        organizationId: orgId,
        employeeId: emp.id,
        leaveTypeId: type.id,
        leavePolicyId: policy.id,
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        daysRequested: "2",
        status: "pending_hr",
      })
      .returning();

    const outcome = await raceAgainst(
      schema.leaveRequestsTable,
      leave.id,
      { status: "approved", approvedAt: new Date(), approvedBy: approverUserId },
      () =>
        leaveRequests.cancelLeaveRequest({
          organizationId: orgId,
          employeeId: emp.id,
          leaveRequestId: leave.id,
          ...asRequester(),
        }),
    );

    expect(outcome.ok).toBe(false);
    expect((outcome as any).error).toBeInstanceOf(leaveRequests.LeaveRequestNotCancellableError);
    const [after] = await db.select().from(schema.leaveRequestsTable).where(eq(schema.leaveRequestsTable.id, leave.id));
    expect(after.status).toBe("approved");
    expect(after.cancelledAt).toBeNull();
  });

  // -- Job engine --------------------------------------------------------------

  /**
   * claimDueJobs is platform-wide by design. Claims as "p0-worker-A", then
   * hands every claimed job that is not one of `ids` straight back to the
   * queue, so the test never strands someone else's due job as "running".
   */
  async function claimOnly(ids: number[]) {
    const claimed = await scheduledJobs.claimDueJobs({ workerId: "p0-worker-A", limit: 50 });
    const foreign = claimed.filter((j) => !ids.includes(j.id)).map((j) => j.id);
    if (foreign.length > 0) {
      const { inArray } = await import("drizzle-orm");
      await db
        .update(schema.scheduledJobsTable)
        .set({ status: "scheduled", lockedAt: null, lockedBy: null })
        .where(inArray(schema.scheduledJobsTable.id, foreign));
    }
    const mine = claimed.filter((j) => ids.includes(j.id));
    expect(mine.map((j) => j.id).sort()).toEqual([...ids].sort());
    return mine;
  }

  it("a slow attempt whose claim was reclaimed does not write its outcome over the new claim", async () => {
    const jobType = `p0.lease_${Date.now()}`;
    let ran = 0;
    registry.registerJobHandler(jobType, { parsePayload: (raw) => raw, execute: async () => void ran++ });
    try {
      const job = await scheduledJobs.scheduleJob({
        organizationId: orgId,
        jobType,
        idempotencyKey: `lease-${suffix}`,
        scheduledFor: new Date(Date.now() - 1000),
      });
      const claimed = (await claimOnly([job.id]))[0];
      expect(claimed?.lockedBy).toBe("p0-worker-A");

      // The lease expired and worker B claimed the job while A was still running.
      await db
        .update(schema.scheduledJobsTable)
        .set({ status: "running", lockedBy: "p0-worker-B", lockedAt: new Date() })
        .where(eq(schema.scheduledJobsTable.id, job.id));

      await scheduledJobs.executeClaimedJob(claimed!);

      expect(ran).toBe(1);
      const row = await scheduledJobs.getScheduledJob(job.id);
      expect(row!.status).toBe("running");
      expect(row!.lockedBy).toBe("p0-worker-B");
      expect(row!.completedAt).toBeNull();
    } finally {
      registry.unregisterJobHandlerForTests(jobType);
      // The simulated worker B never finishes, so the row would stay "running"
      // and be reclaimed by the next suite's platform-wide reclaim. Retire it.
      await db
        .update(schema.scheduledJobsTable)
        .set({ status: "cancelled", cancelledAt: new Date(), lockedAt: null, lockedBy: null })
        .where(eq(schema.scheduledJobsTable.jobType, jobType));
    }
  });

  it("an attempt that still holds its claim records its outcome as before", async () => {
    const jobType = `p0.held_${Date.now()}`;
    registry.registerJobHandler(jobType, { parsePayload: (raw) => raw, execute: async () => undefined });
    try {
      const job = await scheduledJobs.scheduleJob({
        organizationId: orgId,
        jobType,
        idempotencyKey: `held-${suffix}`,
        scheduledFor: new Date(Date.now() - 1000),
      });
      const claimed = (await claimOnly([job.id]))[0];
      await scheduledJobs.executeClaimedJob(claimed!);
      const row = await scheduledJobs.getScheduledJob(job.id);
      expect(row!.status).toBe("completed");
      expect(row!.lockedBy).toBeNull();
      expect(row!.attemptCount).toBe(1);
    } finally {
      registry.unregisterJobHandlerForTests(jobType);
    }
  });

  it("a job for a module the organization has not enabled is cancelled with the reason, not run", async () => {
    const moduleKey = `p0mod${Date.now()}`;
    const [mod] = await db
      .insert(schema.modulesTable)
      .values({ key: moduleKey, name: "P0 test module", category: "test", status: "active", defaultEnabled: false })
      .returning();
    // Enabled for the other organization only.
    await db.insert(schema.organizationModulesTable).values({ organizationId: otherOrgId, moduleId: mod.id, enabled: true });

    const jobType = `p0.module_${Date.now()}`;
    const ranFor: number[] = [];
    registry.registerJobHandler(jobType, {
      moduleKey,
      parsePayload: (raw) => raw,
      execute: async (ctx) => void ranFor.push(ctx.organizationId!),
    });
    try {
      const disabledJob = await scheduledJobs.scheduleJob({
        organizationId: orgId,
        jobType,
        idempotencyKey: `module-off-${suffix}`,
        scheduledFor: new Date(Date.now() - 1000),
      });
      const enabledJob = await scheduledJobs.scheduleJob({
        organizationId: otherOrgId,
        jobType,
        idempotencyKey: `module-on-${suffix}`,
        scheduledFor: new Date(Date.now() - 1000),
      });
      for (const j of await claimOnly([disabledJob.id, enabledJob.id])) {
        await scheduledJobs.executeClaimedJob(j);
      }

      expect(ranFor).toEqual([otherOrgId]);
      const off = await scheduledJobs.getScheduledJob(disabledJob.id);
      expect(off!.status).toBe("cancelled");
      expect(off!.cancelledAt).not.toBeNull();
      expect(off!.lastErrorMessage).toMatch(/module is not enabled/);
      expect(off!.lockedBy).toBeNull();
      expect((await scheduledJobs.getScheduledJob(enabledJob.id))!.status).toBe("completed");
    } finally {
      registry.unregisterJobHandlerForTests(jobType);
      // The module registry is platform-wide: leave no test module behind.
      await db.delete(schema.organizationModulesTable).where(eq(schema.organizationModulesTable.moduleId, mod.id));
      await db.delete(schema.modulesTable).where(eq(schema.modulesTable.id, mod.id));
    }
  });

  it("a handler declaring a module the registry does not know fails loudly instead of cancelling quietly", async () => {
    const jobType = `p0.badmodule_${Date.now()}`;
    let ran = false;
    registry.registerJobHandler(jobType, {
      moduleKey: `no_such_module_${Date.now()}`,
      parsePayload: (raw) => raw,
      execute: async () => void (ran = true),
    });
    try {
      const job = await scheduledJobs.scheduleJob({
        organizationId: orgId,
        jobType,
        idempotencyKey: `badmodule-${suffix}`,
        scheduledFor: new Date(Date.now() - 1000),
      });
      const [claimed] = await claimOnly([job.id]);
      await scheduledJobs.executeClaimedJob(claimed);
      expect(ran).toBe(false);
      const row = await scheduledJobs.getScheduledJob(job.id);
      expect(row!.status).toBe("failed");
      expect(row!.lastErrorClass).toBe("permanent");
      expect(row!.lastErrorMessage).toMatch(/Unknown module/);
    } finally {
      registry.unregisterJobHandlerForTests(jobType);
    }
  });

  it("scheduleJob joins the caller's transaction: a duplicate does not abort it, and a rollback removes the job", async () => {
    const jobType = `p0.tx_${Date.now()}`;
    registry.registerJobHandler(jobType, { parsePayload: (raw) => raw, execute: async () => undefined });
    try {
      const committedKey = `tx-commit-${suffix}`;
      const ids = await db.transaction(async (tx: any) => {
        const a = await scheduledJobs.scheduleJob(
          { organizationId: orgId, jobType, idempotencyKey: committedKey, scheduledFor: new Date(Date.now() + 3_600_000) },
          tx,
        );
        const b = await scheduledJobs.scheduleJob(
          { organizationId: orgId, jobType, idempotencyKey: committedKey, scheduledFor: new Date(Date.now() + 3_600_000) },
          tx,
        );
        // The transaction is still usable after the duplicate.
        await tx.select().from(schema.organizationsTable).where(eq(schema.organizationsTable.id, orgId));
        return [a.id, b.id];
      });
      expect(ids[0]).toBe(ids[1]);

      const rolledBackKey = `tx-rollback-${suffix}`;
      await expect(
        db.transaction(async (tx: any) => {
          await scheduledJobs.scheduleJob(
            { organizationId: orgId, jobType, idempotencyKey: rolledBackKey, scheduledFor: new Date(Date.now() + 3_600_000) },
            tx,
          );
          throw new Error("domain change failed");
        }),
      ).rejects.toThrow("domain change failed");

      const rows = await db
        .select()
        .from(schema.scheduledJobsTable)
        .where(and(eq(schema.scheduledJobsTable.jobType, jobType)));
      expect(rows.map((r: any) => r.idempotencyKey)).toEqual([committedKey]);
    } finally {
      registry.unregisterJobHandlerForTests(jobType);
    }
  });

  it("notifyUser joins the caller's transaction: it sees the transaction's own rows and rolls back with it", async () => {
    // A recipient whose membership exists only inside the transaction is
    // resolvable through `tx` — proof the resolver reads the same transaction.
    const delivered = await db.transaction(async (tx: any) => {
      const fresh = await mkUser("txrecipient", orgId, tx);
      return notifications.notifyUser(
        { recipient: { kind: "user", userId: fresh.userId }, organizationId: orgId, title: "In tx", message: "Visible" },
        tx,
      );
    });
    expect(delivered).toHaveLength(1);

    const title = `Rolled back ${suffix}`;
    await expect(
      db.transaction(async (tx: any) => {
        await notifications.notifyUser(
          { recipient: { kind: "user", userId: approverUserId }, organizationId: orgId, title, message: "Never" },
          tx,
        );
        throw new Error("domain change failed");
      }),
    ).rejects.toThrow("domain change failed");
    const rows = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.title, title));
    expect(rows).toHaveLength(0);
  });
});
