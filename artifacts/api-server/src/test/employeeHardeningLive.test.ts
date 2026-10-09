/**
 * Employee backend hardening, Phase 1 (2026-10-08) — live proof of the rules
 * that need a real Postgres: reporting-line cycles of any length, the
 * concurrency guard (two updates that each pass a stale pre-check must not
 * both commit), separated/foreign managers, identifier uniqueness, tenant
 * isolation of the service layer, the search-leak fix, the lifecycle refusals
 * against real rows, and the audit rows actually written.
 *
 * Opt-in via EMPLOYEE_HARDENING_LIVE_DATABASE_URL (local/loopback only — see
 * liveDbGuard.ts). Creates its own organizations; never touches existing rows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("EMPLOYEE_HARDENING_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("employee backend hardening — live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let employees: typeof import("../lib/employees");
  let policy: typeof import("../lib/employeeRecordPolicy");

  let orgId: number;
  let otherOrgId: number;
  let userId: number;
  let membershipId: number;
  let foreignEmployeeId: number;

  const FULL = { canWriteSensitive: true, canWriteNotes: true };
  const GENERAL = { canWriteSensitive: false, canWriteNotes: false };
  const suffix = `emph-${Date.now()}`;

  async function mk(fields: Record<string, unknown>, organizationId = orgId) {
    return employees.createEmployee(db, {
      organizationId,
      fields: { firstName: "T", lastName: suffix, ...fields } as any,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
      authorization: FULL,
    });
  }

  async function upd(employeeId: number, fields: Record<string, unknown>, authorization = FULL, organizationId = orgId) {
    return employees.updateEmployee({ organizationId, employeeId, fields: fields as any, actorApplicationUserId: userId, actorMembershipId: membershipId, authorization });
  }

  async function auditsFor(employeeId: number, eventType: string) {
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
    policy = await import("../lib/employeeRecordPolicy");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `EmpH ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `EmpH other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "EmpH", lastName: "Actor", organizationId: orgId })
      .returning();
    userId = user.id;
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: userId, organizationId: orgId, status: "active" }).returning();
    membershipId = m.id;
    const foreign = await mk({ firstName: "Foreign" }, otherOrgId);
    foreignEmployeeId = foreign.id;
  });

  describe("reporting line", () => {
    it("rejects self, a direct cycle and an indirect cycle, and leaves the rows untouched", async () => {
      const a = await mk({ firstName: "A" });
      const b = await mk({ firstName: "B", reportingManagerId: a.id });
      const c = await mk({ firstName: "C", reportingManagerId: b.id });
      const d = await mk({ firstName: "D", reportingManagerId: c.id });

      await expect(upd(a.id, { reportingManagerId: a.id })).rejects.toBeInstanceOf(employees.EmployeeSelfManagerError);
      await expect(upd(a.id, { reportingManagerId: b.id })).rejects.toBeInstanceOf(employees.EmployeeReportingCycleError);
      await expect(upd(a.id, { reportingManagerId: d.id })).rejects.toBeInstanceOf(employees.EmployeeReportingCycleError);

      const [row] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, a.id));
      expect(row.reportingManagerId).toBeNull();
      // A legitimate re-parent on the same chain still works.
      const moved = await upd(d.id, { reportingManagerId: a.id });
      expect(moved.reportingManagerId).toBe(a.id);
    });

    it("rejects a manager from another organization and a nonexistent one with the same message", async () => {
      const a = await mk({ firstName: "A2" });
      await expect(upd(a.id, { reportingManagerId: foreignEmployeeId })).rejects.toThrow(/Reporting manager does not belong/);
      await expect(upd(a.id, { reportingManagerId: 999999999 })).rejects.toThrow(/Reporting manager does not belong/);
      await expect(mk({ firstName: "A3", reportingManagerId: foreignEmployeeId })).rejects.toThrow(/Reporting manager does not belong/);
    });

    it("rejects a separated manager, on create and on update", async () => {
      const gone = await mk({ firstName: "Gone", hireDate: new Date("2020-01-01") });
      await employees.separateEmployee({ organizationId: orgId, employeeId: gone.id, separationDate: new Date("2025-01-01"), actorApplicationUserId: userId, actorMembershipId: membershipId });
      const a = await mk({ firstName: "A4" });
      await expect(upd(a.id, { reportingManagerId: gone.id })).rejects.toBeInstanceOf(employees.EmployeeManagerIneligibleError);
      await expect(mk({ firstName: "A5", reportingManagerId: gone.id })).rejects.toBeInstanceOf(employees.EmployeeManagerIneligibleError);
    });

    it("serializes concurrent reparenting so two stale pre-checks cannot create a cycle", async () => {
      const x = await mk({ firstName: "X" });
      const y = await mk({ firstName: "Y" });
      // Each side, checked alone, is valid: X→Y and Y→X. Run together, exactly
      // one may win; the advisory lock makes the second see the first.
      const results = await Promise.allSettled([upd(x.id, { reportingManagerId: y.id }), upd(y.id, { reportingManagerId: x.id })]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(employees.EmployeeReportingCycleError);

      const rows = await db.select().from(schema.employeesTable).where(and(eq(schema.employeesTable.organizationId, orgId)));
      const rx = rows.find((r: any) => r.id === x.id);
      const ry = rows.find((r: any) => r.id === y.id);
      expect([rx.reportingManagerId, ry.reportingManagerId].filter((v) => v != null)).toHaveLength(1);
    });
  });

  describe("identifiers", () => {
    it("rejects a duplicate national ID or passport within the organization, case- and space-insensitively, but not across organizations", async () => {
      await mk({ firstName: "N1", nationalId: "GHA-700000000-1", passportNumber: "G7000001" });
      await expect(mk({ firstName: "N2", nationalId: " gha-700000000-1 " })).rejects.toBeInstanceOf(employees.DuplicateEmployeeIdentifierError);
      await expect(mk({ firstName: "N3", passportNumber: "g7000001" })).rejects.toBeInstanceOf(employees.DuplicateEmployeeIdentifierError);
      const n4 = await mk({ firstName: "N4" });
      await expect(upd(n4.id, { nationalId: "GHA-700000000-1" })).rejects.toBeInstanceOf(employees.DuplicateEmployeeIdentifierError);
      // Same value in a different tenant is not a collision.
      await expect(mk({ firstName: "N5", nationalId: "GHA-700000000-1" }, otherOrgId)).resolves.toBeDefined();
      // Re-saving an employee's own value is not a collision either.
      const n1 = (await db.select().from(schema.employeesTable).where(and(eq(schema.employeesTable.organizationId, orgId), eq(schema.employeesTable.firstName, "N1"))))[0];
      await expect(upd(n1.id, { nationalId: "GHA-700000000-1" })).resolves.toBeDefined();
    });
  });

  describe("lifecycle refusals and governed actions", () => {
    it("refuses termination/reactivation/confirmation through updateEmployee and keeps the governed actions working", async () => {
      const e = await mk({ firstName: "L1", employmentStatus: "probation", hireDate: new Date("2026-01-15") });
      await expect(upd(e.id, { employmentStatus: "terminated" })).rejects.toBeInstanceOf(policy.EmployeeStatusChangeNotAllowedError);
      await expect(upd(e.id, { employmentStatus: "active" })).rejects.toBeInstanceOf(policy.EmployeeStatusChangeNotAllowedError);
      await expect(mk({ firstName: "L0", employmentStatus: "terminated" as any })).rejects.toBeInstanceOf(policy.EmployeeStatusChangeNotAllowedError);

      const confirmed = await employees.confirmEmployee({ organizationId: orgId, employeeId: e.id, effectiveDate: new Date("2026-07-15"), actorApplicationUserId: userId, actorMembershipId: membershipId });
      expect(confirmed.employmentStatus).toBe("active");

      await expect(
        employees.separateEmployee({ organizationId: orgId, employeeId: e.id, separationDate: new Date("2020-01-01"), actorApplicationUserId: userId, actorMembershipId: membershipId }),
      ).rejects.toBeInstanceOf(policy.EmployeeValidationError);
      const separated = await employees.separateEmployee({ organizationId: orgId, employeeId: e.id, separationDate: new Date("2026-09-30"), actorApplicationUserId: userId, actorMembershipId: membershipId });
      expect(separated.employmentStatus).toBe("terminated");
      await expect(upd(e.id, { employmentStatus: "active" })).rejects.toThrow(/rehire action/);
      // An unchanged status alongside a real edit is still fine for a separated record.
      const renamed = await upd(e.id, { employmentStatus: "terminated", lastName: `${suffix}-x` });
      expect(renamed.lastName).toBe(`${suffix}-x`);

      const periods = await db.select().from(schema.employmentPeriodsTable).where(eq(schema.employmentPeriodsTable.employeeId, e.id));
      expect(periods.map((p: any) => p.eventType).sort()).toEqual(["confirmation", "separation"]);
    });
  });

  describe("authorization and tenant isolation at the service layer", () => {
    it("refuses a sensitive write without the key, whole body, nothing applied; applies it with the key", async () => {
      const e = await mk({ firstName: "S1", lastName: "Before" });
      await expect(upd(e.id, { lastName: "After", phoneNumber: "+233200000000" }, GENERAL)).rejects.toBeInstanceOf(policy.EmployeeSensitiveWriteForbiddenError);
      const [row] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, e.id));
      expect(row.lastName).toBe("Before");
      expect(row.phoneNumber).toBeNull();
      const ok = await upd(e.id, { lastName: "After", phoneNumber: "+233200000000" }, FULL);
      expect(ok.lastName).toBe("After");
      expect(ok.phoneNumber).toBe("+233200000000");
    });

    it("decides sensitive writes against the PERSISTED values: unchanged re-sends pass, one real change refuses the whole body", async () => {
      const e = await mk({ firstName: "U1", lastName: "Before", phoneNumber: "+233200000010", nationalId: "GHA-900000000-1", personalEmail: null });
      // Same values back (with whitespace, blank-for-null) plus a general change: allowed without the key.
      const ok = await upd(e.id, { lastName: "After", phoneNumber: " +233200000010 ", nationalId: "GHA-900000000-1", personalEmail: "" }, GENERAL);
      expect(ok.lastName).toBe("After");
      // The re-sent value is a no-op: the stored value is not rewritten, not even its whitespace.
      expect(ok.phoneNumber).toBe("+233200000010");
      const [audit] = await auditsFor(e.id, "employee.updated");
      expect(audit.metadata.changedFields).toEqual(["lastName"]);
      // One changed sensitive value among unchanged ones: refused whole, nothing applied, named precisely.
      await expect(upd(e.id, { lastName: "Never", phoneNumber: "+233200000010", nationalId: "GHA-900000000-2" }, GENERAL)).rejects.toMatchObject({
        name: "EmployeeSensitiveWriteForbiddenError",
        fields: ["nationalId"],
      });
      const [row] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, e.id));
      expect(row.lastName).toBe("After");
      expect(row.nationalId).toBe("GHA-900000000-1");
      // Clearing a stored value is a write; null-for-null is not.
      await expect(upd(e.id, { phoneNumber: null }, GENERAL)).rejects.toMatchObject({ fields: ["phoneNumber"] });
      await expect(upd(e.id, { personalEmail: null, workLocation: "Wa" }, GENERAL)).resolves.toMatchObject({ workLocation: "Wa" });
    });

    it("rolls back the whole update atomically when the reporting-line check fails inside the locked transaction", async () => {
      const boss = await mk({ firstName: "Boss" });
      const e = await mk({ firstName: "U2", lastName: "Keep", reportingManagerId: boss.id });
      // Direct cycle attempt bundled with a general change: the transaction aborts, nothing persists.
      await expect(upd(boss.id, { lastName: "Changed", reportingManagerId: e.id })).rejects.toBeInstanceOf(employees.EmployeeReportingCycleError);
      const [row] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, boss.id));
      expect(row.lastName).toBe(suffix);
      expect(row.reportingManagerId).toBeNull();
      expect(await auditsFor(boss.id, "employee.updated")).toHaveLength(0);
    });

    it("cannot reach another organization's employee through the service, even with full field authorization", async () => {
      await expect(upd(foreignEmployeeId, { firstName: "Stolen" }, FULL, orgId)).rejects.toBeInstanceOf(employees.EmployeeNotFoundError);
      await expect(mk({ firstName: "Z", departmentId: 999999999 })).rejects.toThrow(/Department does not belong/);
    });

    it("rejects malformed contact values and inconsistent dates on the merged record", async () => {
      const e = await mk({ firstName: "V1", dateOfBirth: new Date("1990-05-04"), hireDate: new Date("2026-01-15") });
      await expect(upd(e.id, { workEmail: "nope" })).rejects.toBeInstanceOf(policy.EmployeeValidationError);
      await expect(upd(e.id, { alternatePhoneNumber: "abc" })).rejects.toBeInstanceOf(policy.EmployeeValidationError);
      await expect(upd(e.id, { hireDate: new Date("1980-01-01") })).rejects.toThrow(/Hire date/);
      await expect(upd(e.id, { probationEndDate: new Date("2025-01-01") })).rejects.toThrow(/Probation end/);
      await expect(upd(e.id, { dateOfBirth: new Date("2090-01-01") })).rejects.toThrow(/future/);
    });
  });

  describe("search", () => {
    it("matches personal email only for callers who may read it", async () => {
      const needle = `private-${suffix}@example.invalid`;
      await mk({ firstName: "Q1", personalEmail: needle });
      const hidden = await employees.listEmployees({ organizationId: orgId, search: needle, page: 1, pageSize: 10 });
      expect(hidden.total).toBe(0);
      const shown = await employees.listEmployees({ organizationId: orgId, search: needle, page: 1, pageSize: 10, includePrivateContactFields: true });
      expect(shown.total).toBe(1);
      // Directory fields still match for everyone.
      const byName = await employees.listEmployees({ organizationId: orgId, search: "Q1", page: 1, pageSize: 10 });
      expect(byName.total).toBe(1);
    });
  });

  describe("audit", () => {
    it("writes employee.created and employee.updated with field names and masked values only", async () => {
      const e = await mk({ firstName: "AU", nationalId: "GHA-800000000-1", personalEmail: `au-${suffix}@example.invalid` });
      const [created] = await auditsFor(e.id, "employee.created");
      expect(created).toBeDefined();
      expect(created.organizationId).toBe(orgId);
      expect(created.actorApplicationUserId).toBe(userId);
      expect(created.actorMembershipId).toBe(membershipId);
      expect(created.metadata.setFields).toEqual(expect.arrayContaining(["firstName", "nationalId", "personalEmail"]));
      expect(JSON.stringify(created)).not.toContain("GHA-800000000-1");
      expect(JSON.stringify(created)).not.toContain(`au-${suffix}@example.invalid`);
      expect(created.afterState.nationalId).toBe("***********00-1");

      await upd(e.id, { nationalId: "GHA-800000000-2", workLocation: "Tamale", firstName: "AU" });
      const [updated] = await auditsFor(e.id, "employee.updated");
      expect(updated).toBeDefined();
      expect(updated.metadata.changedFields.sort()).toEqual(["nationalId", "workLocation"]);
      expect(updated.beforeState.nationalId).toBe("***********00-1");
      expect(updated.afterState.nationalId).toBe("***********00-2");
      expect(updated.afterState.workLocation).toBe("Tamale");
      expect(JSON.stringify(updated)).not.toContain("GHA-800000000-2");

      // A no-op body records nothing further.
      await upd(e.id, { firstName: "AU" });
      expect(await auditsFor(e.id, "employee.updated")).toHaveLength(1);
    });

    it("does not leave an employee.created row behind when the enclosing transaction rolls back", async () => {
      let createdId: number | null = null;
      await expect(
        db.transaction(async (tx: any) => {
          const e = await employees.createEmployee(tx, {
            organizationId: orgId,
            fields: { firstName: "RB", lastName: suffix } as any,
            actorApplicationUserId: userId,
            actorMembershipId: membershipId,
            authorization: FULL,
          });
          createdId = e.id;
          throw new Error("force rollback");
        }),
      ).rejects.toThrow("force rollback");
      expect(createdId).not.toBeNull();
      expect(await auditsFor(createdId!, "employee.created")).toHaveLength(0);
      const rows = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, createdId!));
      expect(rows).toHaveLength(0);
    });
  });
});
