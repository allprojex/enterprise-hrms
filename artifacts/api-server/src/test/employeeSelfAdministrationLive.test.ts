/**
 * Self-administration boundary (owner policy, 2026-10-09) — live proof on a
 * real Postgres of everything the mocked route suite cannot express:
 *
 *   - identity resolves through employee_user_links JOIN employees scoped to
 *     the organization (a link in another tenant never counts; a link held by
 *     a different user never counts);
 *   - the service layer refuses update/transfer/promote/confirm/separate/
 *     rehire on the actor's own record, writes nothing, records a "denied"
 *     audit row and no success row;
 *   - WS-13: an HR user may RAISE a request about themselves, may not APPROVE
 *     or APPLY it, and a request raised by a colleague ABOUT the actor can be
 *     neither approved nor applied by the actor; the requester may not apply
 *     their own request either; an independent HR user completes the flow;
 *   - cross-tenant: an actor cannot reach another tenant's employee at all.
 *
 * Opt-in via EMPLOYEE_HARDENING_LIVE_DATABASE_URL (local only — liveDbGuard).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("EMPLOYEE_HARDENING_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("employee self-administration boundary — live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let employees: typeof import("../lib/employees");
  let selfAdmin: typeof import("../lib/employeeSelfAdministration");
  let dataChange: typeof import("../lib/employeeRequests/dataChange");

  let orgId: number;
  let otherOrgId: number;
  // Two HR actors in the organization: A (the subject) and B (independent).
  let userA: number;
  let membershipA: number;
  let employeeA: number;
  let userB: number;
  let membershipB: number;
  let employeeB: number;
  let positionId: number;
  const FULL = { canWriteSensitive: true, canWriteNotes: true };
  const suffix = `selfadm-${Date.now()}`;

  async function mkUser(label: string, organizationId: number) {
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${label}-${suffix}@example.invalid`, passwordHash: "x", firstName: label, lastName: suffix, organizationId })
      .returning();
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: user.id, organizationId, status: "active" }).returning();
    return { userId: user.id as number, membershipId: m.id as number };
  }

  async function mkEmployee(fields: Record<string, unknown>, organizationId = orgId) {
    return employees.createEmployee(db, {
      organizationId,
      fields: { firstName: "E", lastName: suffix, ...fields } as any,
      actorApplicationUserId: userB,
      actorMembershipId: membershipB,
      authorization: FULL,
    });
  }

  async function link(employeeId: number, userId: number, membershipId: number) {
    await db.insert(schema.employeeUserLinksTable).values({ employeeId, applicationUserId: userId, organizationMembershipId: membershipId });
  }

  async function audits(employeeId: number, eventType: string) {
    return db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.targetId, String(employeeId)), eq(schema.auditEventsTable.eventType, eventType)));
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    employees = await import("../lib/employees");
    selfAdmin = await import("../lib/employeeSelfAdministration");
    dataChange = await import("../lib/employeeRequests/dataChange");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `SelfAdm ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `SelfAdm other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    const b = await mkUser("hrB", orgId);
    userB = b.userId;
    membershipB = b.membershipId;
    const a = await mkUser("hrA", orgId);
    userA = a.userId;
    membershipA = a.membershipId;

    const [pos] = await db.insert(schema.positionsTable).values({ organizationId: orgId, title: `Pos ${suffix}`, code: `P-${suffix}` }).returning();
    positionId = pos.id;

    employeeA = (await mkEmployee({ firstName: "A", employmentStatus: "probation", hireDate: new Date("2026-01-15") })).id;
    employeeB = (await mkEmployee({ firstName: "B" })).id;
    await link(employeeA, userA, membershipA);
    await link(employeeB, userB, membershipB);
  });

  describe("identity", () => {
    it("resolves the actor's own record only through the link, scoped to the organization", async () => {
      expect(await selfAdmin.resolveActorEmployeeId(orgId, userA)).toBe(employeeA);
      expect(await selfAdmin.resolveActorEmployeeId(orgId, userB)).toBe(employeeB);
      // Same user, other tenant: no record there.
      expect(await selfAdmin.resolveActorEmployeeId(otherOrgId, userA)).toBeNull();
      // A user with no link anywhere.
      const c = await mkUser("noLink", orgId);
      expect(await selfAdmin.resolveActorEmployeeId(orgId, c.userId)).toBeNull();
    });

    it("a link held in ANOTHER organization never makes a same-id record 'own' here", async () => {
      const foreign = await mkUser("foreign", otherOrgId);
      const foreignEmp = await mkEmployee({ firstName: "F" }, otherOrgId);
      await link(foreignEmp.id, foreign.userId, foreign.membershipId);
      expect(await selfAdmin.resolveActorEmployeeId(orgId, foreign.userId)).toBeNull();
    });
  });

  describe("service layer refuses own-record administration, permits others", () => {
    const asA = (employeeId: number, fields: Record<string, unknown>) =>
      employees.updateEmployee({ organizationId: orgId, employeeId, fields: fields as any, actorApplicationUserId: userA, actorMembershipId: membershipA, authorization: FULL });

    it("update / sensitive / status / manager on own record: refused, nothing written, denial audited, no success audit", async () => {
      const before = (await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, employeeA)))[0];
      for (const fields of [{ workLocation: "Kumasi" }, { phoneNumber: "+233200000001" }, { employmentStatus: "on_leave" }, { reportingManagerId: employeeB }]) {
        await expect(asA(employeeA, fields)).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      }
      const after = (await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, employeeA)))[0];
      expect(after).toEqual(before);
      const denied = await audits(employeeA, "employee.self_administration_denied");
      expect(denied.length).toBeGreaterThanOrEqual(4);
      expect(denied.every((d: any) => d.outcome === "denied" && d.actorApplicationUserId === userA)).toBe(true);
      expect(await audits(employeeA, "employee.updated")).toHaveLength(0);
      expect(await audits(employeeA, "employee.status_changed")).toHaveLength(0);
    });

    it("transfer / promote / confirm / separate on own record: refused; rehire after a colleague separates: refused", async () => {
      const actor = { organizationId: orgId, employeeId: employeeA, actorApplicationUserId: userA, actorMembershipId: membershipA };
      await expect(employees.transferEmployee({ ...actor, effectiveDate: new Date(), positionId })).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      await expect(employees.promoteEmployee({ ...actor, effectiveDate: new Date(), positionId })).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      await expect(employees.confirmEmployee({ ...actor, effectiveDate: new Date() })).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      await expect(employees.separateEmployee({ ...actor, separationDate: new Date("2026-10-01") })).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      const periods = await db.select().from(schema.employmentPeriodsTable).where(eq(schema.employmentPeriodsTable.employeeId, employeeA));
      expect(periods).toHaveLength(0);

      // The independent HR user B can do all of it to A.
      const byB = { organizationId: orgId, employeeId: employeeA, actorApplicationUserId: userB, actorMembershipId: membershipB };
      expect((await employees.confirmEmployee({ ...byB, effectiveDate: new Date("2026-07-15") })).employmentStatus).toBe("active");
      expect((await employees.separateEmployee({ ...byB, separationDate: new Date("2026-10-01") })).employmentStatus).toBe("terminated");
      await expect(employees.rehireEmployee(actor)).rejects.toBeInstanceOf(selfAdmin.SelfAdministrationForbiddenError);
      expect((await employees.rehireEmployee(byB)).employmentStatus).toBe("active");
    });

    it("the same actor administers a colleague normally, and an unlinked HR user administers everyone", async () => {
      const ok = await asA(employeeB, { workLocation: "Tamale" });
      expect(ok.workLocation).toBe("Tamale");
      const c = await mkUser("hrC", orgId);
      const byC = await employees.updateEmployee({ organizationId: orgId, employeeId: employeeA, fields: { workLocation: "Ho" } as any, actorApplicationUserId: c.userId, actorMembershipId: c.membershipId, authorization: FULL });
      expect(byC.workLocation).toBe("Ho");
    });

    it("cross-tenant: another tenant's employee is unreachable, own or not", async () => {
      const foreignEmp = await mkEmployee({ firstName: "FX" }, otherOrgId);
      await expect(asA(foreignEmp.id, { workLocation: "X" })).rejects.toBeInstanceOf(employees.EmployeeNotFoundError);
    });
  });

  describe("WS-13 governed path: raise yes, decide/apply no", () => {
    it("HR A raises a request about A; A cannot approve or apply it; B can; B cannot apply a request B raised; A cannot apply a request B raised about A", async () => {
      // A raises about self (hr_originated) — permitted.
      const { request: raised } = await dataChange.createRequest({
        organizationId: orgId,
        employeeId: employeeA,
        origin: "hr_originated",
        fields: [{ fieldKey: "workEmail", requestedValue: `a-new-${suffix}@example.invalid` }],
        reason: "correction",
        actorApplicationUserId: userA,
        actorMembershipId: membershipA,
      } as any);
      expect(raised.status).toBe("pending");

      // A may not approve own request (maker-checker, pre-existing) ...
      await expect(dataChange.approve({ organizationId: orgId, requestId: raised.id, actorApplicationUserId: userA, actorMembershipId: membershipA } as any)).rejects.toBeInstanceOf(
        dataChange.SelfApprovalForbiddenError,
      );
      // ... B approves ...
      const approved = await dataChange.approve({ organizationId: orgId, requestId: raised.id, actorApplicationUserId: userB, actorMembershipId: membershipB } as any);
      expect(approved.status).toBe("approved");
      // ... A may not apply it (requester AND subject) ...
      await expect(dataChange.applyRequest({ organizationId: orgId, requestId: raised.id, actorApplicationUserId: userA, actorMembershipId: membershipA })).rejects.toBeInstanceOf(
        dataChange.SelfApprovalForbiddenError,
      );
      // ... B applies.
      const applied = await dataChange.applyRequest({ organizationId: orgId, requestId: raised.id, actorApplicationUserId: userB, actorMembershipId: membershipB });
      expect(applied.status).toBe("applied");
      const row = (await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, employeeA)))[0];
      expect(row.workEmail).toBe(`a-new-${suffix}@example.invalid`);

      // B raises about A: A (the subject) may neither approve nor apply, even though A did not raise it.
      const { request: aboutA } = await dataChange.createRequest({
        organizationId: orgId,
        employeeId: employeeA,
        origin: "hr_originated",
        fields: [{ fieldKey: "preferredName", requestedValue: "Ace" }],
        reason: "nickname",
        actorApplicationUserId: userB,
        actorMembershipId: membershipB,
      } as any);
      await expect(dataChange.approve({ organizationId: orgId, requestId: aboutA.id, actorApplicationUserId: userA, actorMembershipId: membershipA } as any)).rejects.toBeInstanceOf(
        dataChange.SelfApprovalForbiddenError,
      );
      // B may not approve what B raised; a third HR user C approves ...
      const c = await mkUser("hrC2", orgId);
      await expect(dataChange.approve({ organizationId: orgId, requestId: aboutA.id, actorApplicationUserId: userB, actorMembershipId: membershipB } as any)).rejects.toBeInstanceOf(
        dataChange.SelfApprovalForbiddenError,
      );
      expect((await dataChange.approve({ organizationId: orgId, requestId: aboutA.id, actorApplicationUserId: c.userId, actorMembershipId: c.membershipId } as any)).status).toBe("approved");
      // ... A (subject) and B (requester) may not apply; C applies.
      await expect(dataChange.applyRequest({ organizationId: orgId, requestId: aboutA.id, actorApplicationUserId: userA, actorMembershipId: membershipA })).rejects.toBeInstanceOf(
        dataChange.SelfApprovalForbiddenError,
      );
      await expect(dataChange.applyRequest({ organizationId: orgId, requestId: aboutA.id, actorApplicationUserId: userB, actorMembershipId: membershipB })).rejects.toBeInstanceOf(
        dataChange.SelfApprovalForbiddenError,
      );
      expect((await dataChange.applyRequest({ organizationId: orgId, requestId: aboutA.id, actorApplicationUserId: c.userId, actorMembershipId: c.membershipId })).status).toBe("applied");
    });
  });
});
