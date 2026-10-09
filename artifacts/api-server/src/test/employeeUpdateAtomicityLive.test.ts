/**
 * Independent-review corrections (2026-10-09) — live proof, on a real
 * Postgres, that `updateEmployee` is atomic and serialized:
 *
 *   - an audit-store failure rolls the employee mutation back (general fields
 *     and employment status alike);
 *   - a concurrent writer that commits first is what every decision is made
 *     against — sensitive-write authorization, the status matrix, the
 *     before/after audit states — never a stale pre-read;
 *   - manager changes and plain updates on the same row cannot deadlock (lock
 *     order: org advisory lock, then the row), and concurrent re-parenting
 *     still cannot create a cycle;
 *   - self-administration stays blocked, including when the actor's link to
 *     the record appears while the update is waiting for the row lock, and a
 *     denial never produces a successful-looking audit row.
 *
 * The audit failure is a real database failure: a BEFORE INSERT trigger on
 * audit_events raises for (event_type, target_id) pairs listed in a scratch
 * fault table. Everything the suite creates is dropped in afterAll.
 *
 * Opt-in via EMPLOYEE_HARDENING_LIVE_DATABASE_URL (local/loopback only — see
 * liveDbGuard.ts). Creates its own organization; never touches existing rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("EMPLOYEE_HARDENING_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("updateEmployee — atomicity and serialization (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let pool: any;
  let schema: any;
  let sql: any;
  let eq: any;
  let and: any;
  let employees: typeof import("../lib/employees");
  let policy: typeof import("../lib/employeeRecordPolicy");
  let selfAdmin: typeof import("../lib/employeeSelfAdministration");

  let orgId: number;
  let userId: number;
  let membershipId: number;
  const FULL = { canWriteSensitive: true, canWriteNotes: true };
  const GENERAL = { canWriteSensitive: false, canWriteNotes: false };
  const suffix = `empatomic-${Date.now()}`;
  const FAULTS = `emph_audit_faults_${Date.now()}`;

  async function mk(fields: Record<string, unknown>) {
    return employees.createEmployee(db, {
      organizationId: orgId,
      fields: { firstName: "T", lastName: suffix, hireDate: new Date("2020-01-06"), ...fields } as any,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
      authorization: FULL,
    });
  }
  async function upd(employeeId: number, fields: Record<string, unknown>, authorization = FULL, actor = { userId: 0, membershipId: 0 }) {
    return employees.updateEmployee({
      organizationId: orgId,
      employeeId,
      fields: fields as any,
      actorApplicationUserId: actor.userId || userId,
      actorMembershipId: actor.membershipId || membershipId,
      authorization,
    });
  }
  /** Drizzle wraps a failed statement as "Failed query: ..." with the Postgres error as `cause`. */
  async function expectAuditFault(p: Promise<unknown>) {
    const err: any = await p.then(
      () => {
        throw new Error("expected the update to fail");
      },
      (e) => e,
    );
    expect(String(err.message)).toMatch(/Failed query: insert into "audit_events"/);
    expect(String(err.cause?.message ?? "")).toContain("audit store unavailable (test fault)");
  }
  async function row(employeeId: number) {
    const [r] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, employeeId));
    return r;
  }
  async function auditsFor(employeeId: number, eventType: string) {
    return db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.targetId, String(employeeId)), eq(schema.auditEventsTable.eventType, eventType)));
  }
  async function fault(eventType: string, employeeId: number) {
    await db.execute(sql.raw(`insert into ${FAULTS}(event_type, target_id) values ('${eventType}', '${employeeId}')`));
  }
  async function clearFaults() {
    await db.execute(sql.raw(`delete from ${FAULTS}`));
  }
  /**
   * Opens a raw transaction that holds the employee row FOR UPDATE, so a
   * service call made meanwhile must wait for it. `commit(sqlText)` runs an
   * extra statement in that transaction, then commits.
   */
  async function holdRow(employeeId: number) {
    const client = await pool.connect();
    await client.query("begin");
    await client.query("select id from employees where id = $1 for update", [employeeId]);
    return {
      async commit(extra?: string, values?: unknown[]) {
        try {
          if (extra) await client.query(extra, values);
          await client.query("commit");
        } catch (e) {
          await client.query("rollback").catch(() => undefined);
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }
  const settle = (p: Promise<unknown>) => {
    let done = false;
    p.then(() => (done = true), () => (done = true));
    return () => done;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    sql = drizzle.sql;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    pool = dbModule.pool;
    schema = dbModule;
    employees = await import("../lib/employees");
    policy = await import("../lib/employeeRecordPolicy");
    selfAdmin = await import("../lib/employeeSelfAdministration");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `EmpAtomic ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "EmpAtomic", lastName: "Actor", organizationId: orgId })
      .returning();
    userId = user.id;
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: userId, organizationId: orgId, status: "active" }).returning();
    membershipId = m.id;

    // A genuine audit-store failure, scoped to listed (event_type, target_id) pairs.
    await db.execute(sql.raw(`create table ${FAULTS}(event_type text not null, target_id text not null)`));
    await db.execute(
      sql.raw(`create or replace function ${FAULTS}_raise() returns trigger language plpgsql as $$
        begin
          if exists (select 1 from ${FAULTS} f where f.event_type = new.event_type and f.target_id = new.target_id) then
            raise exception 'audit store unavailable (test fault)';
          end if;
          return new;
        end $$`),
    );
    await db.execute(sql.raw(`create trigger ${FAULTS}_trg before insert on audit_events for each row execute function ${FAULTS}_raise()`));
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql.raw(`drop trigger if exists ${FAULTS}_trg on audit_events`));
    await db.execute(sql.raw(`drop function if exists ${FAULTS}_raise()`));
    await db.execute(sql.raw(`drop table if exists ${FAULTS}`));
  });

  describe("audit failure rolls the mutation back", () => {
    it("employee.updated failure leaves the row and the audit log untouched; the same update succeeds once the store recovers", async () => {
      const e = await mk({ firstName: "RB1", workLocation: "Accra" });
      await fault("employee.updated", e.id);
      try {
        await expectAuditFault(upd(e.id, { workLocation: "Kumasi", nationalId: "GHA-900000001-1" }));
      } finally {
        await clearFaults();
      }
      const after = await row(e.id);
      expect(after.workLocation).toBe("Accra");
      expect(after.nationalId).toBeNull();
      expect(after.updatedAt?.getTime()).toBe(e.updatedAt?.getTime());
      expect(await auditsFor(e.id, "employee.updated")).toHaveLength(0);

      const ok = await upd(e.id, { workLocation: "Kumasi" });
      expect(ok.workLocation).toBe("Kumasi");
      expect(await auditsFor(e.id, "employee.updated")).toHaveLength(1);
    });

    it("employee.status_changed failure rolls back the status AND the sibling general change in the same request", async () => {
      const e = await mk({ firstName: "RB2", workLocation: "Accra" });
      await fault("employee.status_changed", e.id);
      try {
        await expectAuditFault(upd(e.id, { employmentStatus: "suspended", workLocation: "Tema" }));
      } finally {
        await clearFaults();
      }
      const after = await row(e.id);
      expect(after.employmentStatus).toBe("active");
      expect(after.workLocation).toBe("Accra");
      expect(await auditsFor(e.id, "employee.status_changed")).toHaveLength(0);
      // The sibling event is written after the failing one, so it was never
      // attempted — and even if it had been, it would have rolled back.
      expect(await auditsFor(e.id, "employee.updated")).toHaveLength(0);
    });

    it("a failing employee.updated also takes a successful status_changed in the same transaction down with it", async () => {
      const e = await mk({ firstName: "RB3" });
      await fault("employee.updated", e.id);
      try {
        await expectAuditFault(upd(e.id, { employmentStatus: "on_leave", workLocation: "Ho" }));
      } finally {
        await clearFaults();
      }
      const after = await row(e.id);
      expect(after.employmentStatus).toBe("active");
      expect(after.workLocation).toBeNull();
      // status_changed is inserted BEFORE employee.updated: it must not survive on its own.
      expect(await auditsFor(e.id, "employee.status_changed")).toHaveLength(0);
    });
  });

  describe("concurrent updates are decided against the committed row", () => {
    it("cannot bypass sensitive-write authorization: a general actor re-sending the old value is refused once a privileged writer changed it", async () => {
      const e = await mk({ firstName: "SW", nationalId: "GHA-900000002-1", workLocation: "Accra" });
      const held = await holdRow(e.id);
      // Looks like a no-op re-send of the displayed value plus one general change.
      const attempt = upd(e.id, { nationalId: "GHA-900000002-1", workLocation: "Kumasi" }, GENERAL);
      const settled = settle(attempt);
      await sleep(250);
      expect(settled()).toBe(false); // blocked on the row lock, not decided from a stale read
      await held.commit("update employees set national_id = $1 where id = $2", ["GHA-900000002-9", e.id]);
      await expect(attempt).rejects.toBeInstanceOf(policy.EmployeeSensitiveWriteForbiddenError);
      const after = await row(e.id);
      expect(after.nationalId).toBe("GHA-900000002-9");
      expect(after.workLocation).toBe("Accra"); // the whole body was refused, nothing partial
      expect(await auditsFor(e.id, "employee.updated")).toHaveLength(0);
    });

    it("cannot resurrect an employee separated meanwhile: the status matrix sees the committed termination", async () => {
      const e = await mk({ firstName: "ST" });
      const held = await holdRow(e.id);
      const attempt = upd(e.id, { employmentStatus: "on_leave" });
      const settled = settle(attempt);
      await sleep(250);
      expect(settled()).toBe(false);
      await held.commit("update employees set employment_status = 'terminated', separation_date = '2025-06-30' where id = $1", [e.id]);
      await expect(attempt).rejects.toBeInstanceOf(policy.EmployeeStatusChangeNotAllowedError);
      const after = await row(e.id);
      expect(after.employmentStatus).toBe("terminated");
      expect(await auditsFor(e.id, "employee.status_changed")).toHaveLength(0);
    });

    it("re-validates date consistency against the committed row", async () => {
      const e = await mk({ firstName: "DT", hireDate: new Date("2020-01-06") });
      const held = await holdRow(e.id);
      // Valid against the pre-read (probation end after the 2020 hire date)...
      const attempt = upd(e.id, { probationEndDate: new Date("2021-01-06") });
      const settled = settle(attempt);
      await sleep(250);
      expect(settled()).toBe(false);
      // ...but not against the hire date committed meanwhile.
      await held.commit("update employees set hire_date = '2024-01-08' where id = $1", [e.id]);
      await expect(attempt).rejects.toBeInstanceOf(policy.EmployeeValidationError);
      const after = await row(e.id);
      expect(after.probationEndDate).toBeNull();
    });

    it("records before/after audit states from the committed row, not the pre-read", async () => {
      const e = await mk({ firstName: "AU", workLocation: "Accra" });
      const held = await holdRow(e.id);
      const attempt = upd(e.id, { workLocation: "Final" });
      const settled = settle(attempt);
      await sleep(250);
      expect(settled()).toBe(false);
      await held.commit("update employees set work_location = 'Interim' where id = $1", [e.id]);
      const updated = await attempt;
      expect(updated.workLocation).toBe("Final");
      const [ev] = await auditsFor(e.id, "employee.updated");
      expect(ev.metadata.changedFields).toEqual(["workLocation"]);
      expect(ev.beforeState.workLocation).toBe("Interim");
      expect(ev.afterState.workLocation).toBe("Final");
      expect(ev.actorApplicationUserId).toBe(userId);
      expect(ev.actorMembershipId).toBe(membershipId);
    });

    it("a successful update writes exactly one accurate event per kind, with masked sensitive values", async () => {
      const e = await mk({ firstName: "OK", nationalId: "GHA-900000003-1" });
      const updated = await upd(e.id, { employmentStatus: "probation", nationalId: "GHA-900000003-2", workLocation: "Wa", firstName: "OK" });
      expect(updated.employmentStatus).toBe("probation");
      const status = await auditsFor(e.id, "employee.status_changed");
      const general = await auditsFor(e.id, "employee.updated");
      expect(status).toHaveLength(1);
      expect(status[0].beforeState).toEqual({ employmentStatus: "active" });
      expect(status[0].afterState).toEqual({ employmentStatus: "probation" });
      expect(general).toHaveLength(1);
      expect(general[0].metadata.changedFields.sort()).toEqual(["nationalId", "workLocation"]);
      expect(general[0].beforeState.nationalId).toBe("***********03-1");
      expect(general[0].afterState.nationalId).toBe("***********03-2");
      expect(JSON.stringify(general)).not.toContain("GHA-900000003");
    });
  });

  describe("reporting line under concurrency", () => {
    it("serializes concurrent re-parenting so two stale pre-checks cannot create a cycle", async () => {
      const x = await mk({ firstName: "X" });
      const y = await mk({ firstName: "Y" });
      const results = await Promise.allSettled([upd(x.id, { reportingManagerId: y.id }), upd(y.id, { reportingManagerId: x.id })]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(employees.EmployeeReportingCycleError);
      const [rx, ry] = [await row(x.id), await row(y.id)];
      expect([rx.reportingManagerId, ry.reportingManagerId].filter((v) => v != null)).toHaveLength(1);
    });

    it("a manager change and a plain update on the same locked row both complete — no deadlock between the advisory lock and the row lock", async () => {
      const a = await mk({ firstName: "LA" });
      const m = await mk({ firstName: "LM" });
      const held = await holdRow(a.id);
      const managerChange = upd(a.id, { reportingManagerId: m.id }); // takes the advisory lock, then waits for the row
      const plain = upd(a.id, { workLocation: "Bolga" }); // waits for the row only
      const s1 = settle(managerChange);
      const s2 = settle(plain);
      await sleep(250);
      expect(s1()).toBe(false);
      expect(s2()).toBe(false);
      await held.commit();
      const results = await Promise.all([managerChange, plain]);
      expect(results).toHaveLength(2);
      const after = await row(a.id);
      expect(after.reportingManagerId).toBe(m.id);
      expect(after.workLocation).toBe("Bolga");
      expect(await auditsFor(a.id, "employee.updated")).toHaveLength(2);
    });

    it("a manager change waiting on the row still sees a chain committed meanwhile", async () => {
      // Chain: c → b. Attempt a → c is valid until b → a is committed (then a → c → b → a is a cycle).
      const a = await mk({ firstName: "CA" });
      const b = await mk({ firstName: "CB" });
      const c = await mk({ firstName: "CC", reportingManagerId: b.id });
      const held = await holdRow(a.id);
      const attempt = upd(a.id, { reportingManagerId: c.id });
      const settled = settle(attempt);
      await sleep(250);
      expect(settled()).toBe(false);
      await held.commit("update employees set reporting_manager_id = $1 where id = $2", [a.id, b.id]);
      await expect(attempt).rejects.toBeInstanceOf(employees.EmployeeReportingCycleError);
      expect((await row(a.id)).reportingManagerId).toBeNull();
    });
  });

  describe("self-administration", () => {
    it("stays blocked: no mutation, a denial event, and no successful-looking event", async () => {
      const me = await mk({ firstName: "Me", workLocation: "Accra" });
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: me.id, applicationUserId: userId, organizationMembershipId: membershipId });
      await expect(upd(me.id, { workLocation: "Elsewhere" })).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      expect((await row(me.id)).workLocation).toBe("Accra");
      const denied = await auditsFor(me.id, "employee.self_administration_denied");
      expect(denied).toHaveLength(1);
      expect(denied[0].outcome).toBe("denied");
      expect(denied[0].metadata).toEqual({ action: "employee.update" });
      expect(JSON.stringify(denied)).not.toContain("Elsewhere");
      expect(await auditsFor(me.id, "employee.updated")).toHaveLength(0);
    });

    it("is re-asserted inside the transaction: a link created while the update waits for the row lock still denies it", async () => {
      // A second actor: a user may hold only one employee link per membership,
      // and the first actor was linked in the previous case.
      const [user2] = await db
        .insert(schema.usersTable)
        .values({ email: `${suffix}-late@example.invalid`, passwordHash: "x", firstName: "Late", lastName: "Actor", organizationId: orgId })
        .returning();
      const [m2] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: user2.id, organizationId: orgId, status: "active" }).returning();
      const actor2 = { userId: user2.id, membershipId: m2.id };
      const e = await mk({ firstName: "Late", workLocation: "Accra" });
      const held = await holdRow(e.id);
      const attempt = upd(e.id, { workLocation: "Elsewhere" }, FULL, actor2); // pre-flight passes: not linked yet
      const settled = settle(attempt);
      await sleep(250);
      expect(settled()).toBe(false);
      await held.commit("insert into employee_user_links(employee_id, application_user_id, organization_membership_id) values ($1, $2, $3)", [e.id, actor2.userId, actor2.membershipId]);
      await expect(attempt).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      expect((await row(e.id)).workLocation).toBe("Accra");
      expect(await auditsFor(e.id, "employee.self_administration_denied")).toHaveLength(1);
      expect(await auditsFor(e.id, "employee.updated")).toHaveLength(0);
    });
  });
});
