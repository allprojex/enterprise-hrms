/**
 * VR-02B — Vehicle Request submission, live against a real database.
 *
 * Opt-in like every other live suite: skipped unless VR02B_LIVE_DATABASE_URL
 * points at a disposable LOCAL database (liveDbGuard refuses anything else),
 * so CI stays hermetic.
 *
 * What is proved here, and why it needs a real database:
 *   - AUTHORIZATION is explicit: permissions reach a membership only through
 *     organization roles, exactly as in Production, and no employee, job title
 *     or department membership substitutes for them;
 *   - IDENTITY is server-derived: requester, department and submitter come from
 *     the caller, and the department is a snapshot that survives a transfer;
 *   - TENANT INTEGRITY: a foreign vehicle is "not found", never confirmed;
 *   - FAIL CLOSED: every refusal writes no request row, and the pre-number
 *     refusals consume no sequence value;
 *   - NUMBERING: VR-00001 through the real numbering_sequences row lock, with
 *     concurrent submissions never sharing a reference;
 *   - OWN SCOPE: "mine" is what I submitted — including department requests,
 *     whose requester_employee_id is NULL — never a colleague's, and never
 *     widened by vehicle_request.read.all;
 *   - SCOPE BOUNDARY: submission writes no approval row and decides nothing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("VR02B_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("VR-02B — vehicle request submission (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let sql: any;
  let svc: typeof import("../lib/vehicleRequestSubmission");

  const suffix = `vr02b-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;
  const HOUR = 60 * 60 * 1000;
  const future = (hours: number) => new Date(Date.now() + hours * HOUR);

  let orgId: number;
  let otherOrgId: number;
  let deptA: number;
  let deptB: number;
  let inactiveDept: number;
  let vehicleAvailable: number;
  let vehicleMaintenance: number;
  let foreignVehicle: number;
  let permissionIdByKey: Map<string, number>;

  async function makeOrg(tag: string): Promise<number> {
    const [org] = await db.insert(schema.organizationsTable).values({ name: uniq(tag), slug: uniq(tag).toLowerCase() }).returning();
    return org.id;
  }

  async function makeDepartment(organizationId: number, status: "active" | "inactive" = "active"): Promise<number> {
    const [row] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId, name: uniq("Dept"), code: uniq("D").slice(0, 30), status })
      .returning();
    return row.id;
  }

  async function makeVehicle(organizationId: number, status: "available" | "maintenance" | "inactive" = "available"): Promise<number> {
    const [row] = await db
      .insert(schema.vehiclesTable)
      .values({ organizationId, registrationNumber: uniq("GR"), make: "Toyota", model: "Hilux", status })
      .returning();
    return row.id;
  }

  /** A role owned by the organization carrying exactly these permission keys. */
  async function makeRole(organizationId: number, keys: string[]): Promise<number> {
    const [role] = await db
      .insert(schema.rolesTable)
      .values({ key: uniq("custom"), organizationId, label: uniq("Custom role"), isSystemRole: false })
      .returning();
    for (const key of keys) {
      const permissionId = permissionIdByKey.get(key);
      if (!permissionId) throw new Error(`permission ${key} is not seeded`);
      await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId });
    }
    return role.id;
  }

  interface Person {
    userId: number;
    membershipId: number;
    employeeId: number | null;
    organizationId: number;
  }

  /**
   * A person in an organization. `keys` are granted through an org-owned role,
   * the only way anyone but super_admin can hold them after 0082.
   */
  async function makePerson(opts: {
    organizationId?: number;
    keys?: string[];
    departmentId?: number | null;
    employmentStatus?: string;
    linked?: boolean;
  } = {}): Promise<Person> {
    const organizationId = opts.organizationId ?? orgId;
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${uniq("u")}@example.test`, passwordHash: "x", firstName: "Vee", lastName: uniq("Arr"), organizationId })
      .returning();
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ organizationId, applicationUserId: user.id })
      .returning();
    if (opts.keys && opts.keys.length > 0) {
      const roleId = await makeRole(organizationId, opts.keys);
      await db.insert(schema.membershipRolesTable).values({ membershipId: membership.id, roleId });
    }
    let employeeId: number | null = null;
    if (opts.linked !== false) {
      const [employee] = await db
        .insert(schema.employeesTable)
        .values({
          organizationId,
          firstName: "Vee",
          lastName: uniq("Emp"),
          departmentId: opts.departmentId === undefined ? deptA : opts.departmentId,
          ...(opts.employmentStatus ? { employmentStatus: opts.employmentStatus } : {}),
        })
        .returning();
      employeeId = employee.id;
      await db.insert(schema.employeeUserLinksTable).values({
        employeeId: employee.id,
        applicationUserId: user.id,
        organizationMembershipId: membership.id,
      });
    }
    return { userId: user.id, membershipId: membership.id, employeeId, organizationId };
  }

  const actorOf = (p: Person) => ({ organizationId: p.organizationId, membershipId: p.membershipId, applicationUserId: p.userId });

  function input(overrides: Partial<import("../lib/vehicleRequestSubmission").SubmitVehicleRequestInput> = {}) {
    return {
      requestType: "employee" as const,
      vehicleId: vehicleAvailable,
      purpose: "Field visit",
      destination: "Kumasi",
      plannedTimeOut: future(2),
      plannedTimeIn: future(6),
      ...overrides,
    };
  }

  async function requestCount(organizationId: number = orgId): Promise<number> {
    const [row] = await db
      .select({ n: sql`count(*)::int` })
      .from(schema.vehicleRequestsTable)
      .where(eq(schema.vehicleRequestsTable.organizationId, organizationId));
    return row.n;
  }

  async function sequenceValue(organizationId: number = orgId): Promise<number | null> {
    const [row] = await db
      .select({ v: schema.numberingSequencesTable.currentValue })
      .from(schema.numberingSequencesTable)
      .where(
        and(
          eq(schema.numberingSequencesTable.organizationId, organizationId),
          eq(schema.numberingSequencesTable.sequenceKey, "vehicle_request_number"),
        ),
      );
    return row?.v ?? null;
  }

  async function addStage(organizationId: number, stageOrder: number) {
    await db.insert(schema.vehicleRequestApprovalStagesTable).values({
      organizationId,
      purpose: "vehicle_request",
      stageOrder,
      name: uniq("Stage"),
      resolverType: "department_head",
      resolverConfig: {},
    });
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    sql = drizzle.sql;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    svc = await import("../lib/vehicleRequestSubmission");

    const permissions = await db.select().from(schema.permissionsTable);
    permissionIdByKey = new Map(permissions.map((p: { key: string; id: number }) => [p.key, p.id]));

    orgId = await makeOrg("VR02B Org");
    otherOrgId = await makeOrg("VR02B Other");
    deptA = await makeDepartment(orgId);
    deptB = await makeDepartment(orgId);
    inactiveDept = await makeDepartment(orgId, "inactive");
    vehicleAvailable = await makeVehicle(orgId);
    vehicleMaintenance = await makeVehicle(orgId, "maintenance");
    foreignVehicle = await makeVehicle(otherOrgId);
    await addStage(orgId, 1);
    await addStage(orgId, 2);
  });

  // ── authorization ──────────────────────────────────────────────────────────
  describe("explicit authorization", () => {
    it("an ordinary employee with no grant cannot submit either type, and no row is written", async () => {
      const plain = await makePerson();
      const before = await requestCount();
      await expect(svc.submitVehicleRequest(actorOf(plain), input())).rejects.toBeInstanceOf(svc.VehicleRequestNotAuthorizedError);
      await expect(svc.submitVehicleRequest(actorOf(plain), input({ requestType: "department" }))).rejects.toBeInstanceOf(
        svc.VehicleRequestNotAuthorizedError,
      );
      expect(await requestCount()).toBe(before);
    });

    it("the system employee template grants no vehicle_request key (0082 + seed correction)", async () => {
      const rows = await db
        .select({ key: schema.permissionsTable.key })
        .from(schema.rolePermissionsTable)
        .innerJoin(schema.rolesTable, eq(schema.rolesTable.id, schema.rolePermissionsTable.roleId))
        .innerJoin(schema.permissionsTable, eq(schema.permissionsTable.id, schema.rolePermissionsTable.permissionId))
        .where(and(sql`${schema.rolesTable.organizationId} is null`, eq(schema.rolesTable.key, "employee")));
      expect(rows.map((r: { key: string }) => r.key).filter((k: string) => k.startsWith("vehicle_request."))).toEqual([]);
    });

    it("write.own permits an employee request only", async () => {
      const own = await makePerson({ keys: ["vehicle_request.write.own"] });
      const created = await svc.submitVehicleRequest(actorOf(own), input());
      expect(created.requestType).toBe("employee");
      await expect(svc.submitVehicleRequest(actorOf(own), input({ requestType: "department" }))).rejects.toBeInstanceOf(
        svc.VehicleRequestNotAuthorizedError,
      );
    });

    it("write.department permits a department request only", async () => {
      const dept = await makePerson({ keys: ["vehicle_request.write.department"] });
      const created = await svc.submitVehicleRequest(actorOf(dept), input({ requestType: "department" }));
      expect(created.requestType).toBe("department");
      await expect(svc.submitVehicleRequest(actorOf(dept), input())).rejects.toBeInstanceOf(svc.VehicleRequestNotAuthorizedError);
    });

    it("holding both permits either type", async () => {
      const both = await makePerson({ keys: ["vehicle_request.write.own", "vehicle_request.write.department"] });
      expect((await svc.submitVehicleRequest(actorOf(both), input())).requestType).toBe("employee");
      expect((await svc.submitVehicleRequest(actorOf(both), input({ requestType: "department" }))).requestType).toBe("department");
    });

    it("approve and read.all never imply submission", async () => {
      const overseer = await makePerson({ keys: ["vehicle_request.approve", "vehicle_request.read.all", "asset_management.manage"] });
      await expect(svc.submitVehicleRequest(actorOf(overseer), input())).rejects.toBeInstanceOf(svc.VehicleRequestNotAuthorizedError);
      await expect(svc.submitVehicleRequest(actorOf(overseer), input({ requestType: "department" }))).rejects.toBeInstanceOf(
        svc.VehicleRequestNotAuthorizedError,
      );
    });

  });

  // ── identity ───────────────────────────────────────────────────────────────
  describe("server-derived identity", () => {
    it("an employee request names the caller's own employee and snapshots their department", async () => {
      const own = await makePerson({ keys: ["vehicle_request.write.own"], departmentId: deptB });
      const created = await svc.submitVehicleRequest(actorOf(own), input());
      expect(created.submittedByMembershipId).toBe(own.membershipId);
      expect(created.requesterEmployeeId).toBe(own.employeeId);
      expect(created.requestingDepartmentId).toBe(deptB);
      expect(created.organizationId).toBe(orgId);
    });

    it("a department request has no requester employee, keeps the human submitter, and represents the caller's own department", async () => {
      const dept = await makePerson({ keys: ["vehicle_request.write.department"], departmentId: deptB });
      const created = await svc.submitVehicleRequest(actorOf(dept), input({ requestType: "department" }));
      expect(created.requesterEmployeeId).toBeNull();
      expect(created.submittedByMembershipId).toBe(dept.membershipId);
      expect(created.requestingDepartmentId).toBe(deptB);
    });

    it("identity smuggled into the input is ignored — the service has no field to receive it", async () => {
      const own = await makePerson({ keys: ["vehicle_request.write.own"], departmentId: deptA });
      const victim = await makePerson({ departmentId: deptB });
      const created = await svc.submitVehicleRequest(actorOf(own), {
        ...input(),
        requesterEmployeeId: victim.employeeId,
        requestingDepartmentId: deptB,
        submittedByMembershipId: victim.membershipId,
        organizationId: otherOrgId,
      } as never);
      expect(created.requesterEmployeeId).toBe(own.employeeId);
      expect(created.requestingDepartmentId).toBe(deptA);
      expect(created.submittedByMembershipId).toBe(own.membershipId);
      expect(created.organizationId).toBe(orgId);
    });

    it("the department snapshot survives a later transfer", async () => {
      const own = await makePerson({ keys: ["vehicle_request.write.own"], departmentId: deptA });
      const created = await svc.submitVehicleRequest(actorOf(own), input());
      await db.update(schema.employeesTable).set({ departmentId: deptB }).where(eq(schema.employeesTable.id, own.employeeId));
      const [row] = await db.select().from(schema.vehicleRequestsTable).where(eq(schema.vehicleRequestsTable.id, created.id));
      expect(row.requestingDepartmentId).toBe(deptA);
      const mine = await svc.getMyVehicleRequest(orgId, own.membershipId, created.id);
      expect(mine?.requestingDepartmentId).toBe(deptA);
    });
  });

  // ── fail-closed preconditions ──────────────────────────────────────────────
  describe("fail closed, with no row and no number consumed", () => {
    async function expectRefused(p: Person, overrides: Parameters<typeof input>[0], errorClass: new (...a: never[]) => Error) {
      const beforeRows = await requestCount();
      const beforeSeq = await sequenceValue();
      await expect(svc.submitVehicleRequest(actorOf(p), input(overrides))).rejects.toBeInstanceOf(errorClass);
      expect(await requestCount()).toBe(beforeRows);
      expect(await sequenceValue()).toBe(beforeSeq);
    }

    it("no linked employee record", async () => {
      await expectRefused(await makePerson({ keys: ["vehicle_request.write.own"], linked: false }), {}, svc.VehicleRequestNoEmployeeLinkError);
    });

    it("no canonical department — for both request types", async () => {
      const own = await makePerson({ keys: ["vehicle_request.write.own", "vehicle_request.write.department"], departmentId: null });
      await expectRefused(own, {}, svc.VehicleRequestNoDepartmentError);
      await expectRefused(own, { requestType: "department" }, svc.VehicleRequestNoDepartmentError);
    });

    it("an inactive department", async () => {
      await expectRefused(
        await makePerson({ keys: ["vehicle_request.write.own"], departmentId: inactiveDept }),
        {},
        svc.VehicleRequestDepartmentInactiveError,
      );
    });

    it("an employee who is not currently active", async () => {
      for (const status of ["probation", "on_leave", "suspended", "terminated"]) {
        await expectRefused(
          await makePerson({ keys: ["vehicle_request.write.own"], employmentStatus: status }),
          {},
          svc.VehicleRequestEmployeeNotActiveError,
        );
      }
    });

    it("a vehicle from another organization is 'not found', never confirmed", async () => {
      await expectRefused(await makePerson({ keys: ["vehicle_request.write.own"] }), { vehicleId: foreignVehicle }, svc.VehicleRequestVehicleNotFoundError);
    });

    it("a vehicle id that does not exist is reported identically", async () => {
      await expectRefused(await makePerson({ keys: ["vehicle_request.write.own"] }), { vehicleId: 987654321 }, svc.VehicleRequestVehicleNotFoundError);
    });

    it("a vehicle whose VR-01 status is not `available`", async () => {
      await expectRefused(
        await makePerson({ keys: ["vehicle_request.write.own"] }),
        { vehicleId: vehicleMaintenance },
        svc.VehicleRequestVehicleNotAvailableError,
      );
    });

    it("missing or blank purpose", async () => {
      await expectRefused(await makePerson({ keys: ["vehicle_request.write.own"] }), { purpose: "   " }, svc.VehicleRequestInvalidInputError);
    });

    it("missing Planned Time Out / Expected Time In", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      await expectRefused(p, { plannedTimeOut: undefined as never }, svc.VehicleRequestInvalidInputError);
      await expectRefused(p, { plannedTimeIn: new Date("invalid") }, svc.VehicleRequestInvalidInputError);
    });

    it("Planned Time Out in the past", async () => {
      await expectRefused(
        await makePerson({ keys: ["vehicle_request.write.own"] }),
        { plannedTimeOut: new Date(Date.now() - 60_000), plannedTimeIn: future(3) },
        svc.VehicleRequestInvalidInputError,
      );
    });

    it("Expected Time In equal to or before Planned Time Out", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      const t = future(4);
      await expectRefused(p, { plannedTimeOut: t, plannedTimeIn: new Date(t.getTime()) }, svc.VehicleRequestInvalidInputError);
      await expectRefused(p, { plannedTimeOut: t, plannedTimeIn: future(3) }, svc.VehicleRequestInvalidInputError);
    });

    it("zero approval stages configured — the exact owner message, no row, no number", async () => {
      const bareOrg = await makeOrg("VR02B NoStages");
      const bareDept = await makeDepartment(bareOrg);
      const bareVehicle = await makeVehicle(bareOrg);
      const p = await makePerson({ organizationId: bareOrg, keys: ["vehicle_request.write.own"], departmentId: bareDept });
      await expect(svc.submitVehicleRequest(actorOf(p), input({ vehicleId: bareVehicle }))).rejects.toThrow(
        "Vehicle Request approval workflow has not been configured. Please contact your administrator.",
      );
      expect(await requestCount(bareOrg)).toBe(0);
      expect(await sequenceValue(bareOrg)).toBeNull();
      const stages = await db
        .select()
        .from(schema.vehicleRequestApprovalStagesTable)
        .where(eq(schema.vehicleRequestApprovalStagesTable.organizationId, bareOrg));
      expect(stages).toEqual([]); // nothing was auto-created
    });
  });

  // ── numbering ──────────────────────────────────────────────────────────────
  describe("numbering", () => {
    it("allocates VR-00001 first, sequentially, per organization, through numbering_sequences", async () => {
      const fresh = await makeOrg("VR02B Numbering");
      const d = await makeDepartment(fresh);
      const v = await makeVehicle(fresh);
      await addStage(fresh, 1);
      const p = await makePerson({ organizationId: fresh, keys: ["vehicle_request.write.own"], departmentId: d });
      const first = await svc.submitVehicleRequest(actorOf(p), input({ vehicleId: v }));
      const second = await svc.submitVehicleRequest(actorOf(p), input({ vehicleId: v }));
      expect(first.requestReference).toBe("VR-00001");
      expect(second.requestReference).toBe("VR-00002");
      expect(await sequenceValue(fresh)).toBe(2);
    });

    it("concurrent submissions never share a reference (steady state: the counter row exists)", async () => {
      const fresh = await makeOrg("VR02B Concurrency");
      const d = await makeDepartment(fresh);
      const v = await makeVehicle(fresh);
      await addStage(fresh, 1);
      const people = await Promise.all(
        Array.from({ length: 8 }, () => makePerson({ organizationId: fresh, keys: ["vehicle_request.write.own"], departmentId: d })),
      );
      // The organization's first request creates its counter row.
      const first = await svc.submitVehicleRequest(actorOf(people[0]!), input({ vehicleId: v }));
      expect(first.requestReference).toBe("VR-00001");
      const created = await Promise.all(
        people.flatMap((p) => [0, 1].map(() => svc.submitVehicleRequest(actorOf(p), input({ vehicleId: v })))),
      );
      const refs = created.map((c) => c.requestReference);
      expect(new Set(refs).size).toBe(refs.length);
      expect(refs.length).toBe(16);
      expect([...refs].sort()).toEqual(Array.from({ length: 16 }, (_, i) => `VR-${String(i + 2).padStart(5, "0")}`));
    });

    it("sixteen simultaneous FIRST submissions in an organization all succeed as VR-00001..VR-00016", async () => {
      // The organization has no counter row yet, so every one of these races
      // to create it. The shared numbering helper used to fail every caller but
      // the winner here (25P02); it now lets each loser lock and increment the
      // winner's row, so all sixteen succeed with distinct, contiguous numbers.
      const fresh = await makeOrg("VR02B FirstRace");
      const d = await makeDepartment(fresh);
      const v = await makeVehicle(fresh);
      await addStage(fresh, 1);
      const people = await Promise.all(
        Array.from({ length: 16 }, () => makePerson({ organizationId: fresh, keys: ["vehicle_request.write.own"], departmentId: d })),
      );
      const created = await Promise.all(people.map((p) => svc.submitVehicleRequest(actorOf(p), input({ vehicleId: v }))));
      const refs = created.map((c) => c.requestReference);
      expect([...refs].sort()).toEqual(Array.from({ length: 16 }, (_, i) => `VR-${String(i + 1).padStart(5, "0")}`));
      expect(await requestCount(fresh)).toBe(16);
      expect(await sequenceValue(fresh)).toBe(16);
    });
  });

  // ── lifecycle boundary ─────────────────────────────────────────────────────
  describe("submission state, and nothing beyond it", () => {
    it("creates a pending request at the first stage, with total_stages frozen", async () => {
      const fresh = await makeOrg("VR02B Frozen");
      const d = await makeDepartment(fresh);
      const v = await makeVehicle(fresh);
      await addStage(fresh, 3);
      await addStage(fresh, 7);
      const p = await makePerson({ organizationId: fresh, keys: ["vehicle_request.write.own"], departmentId: d });
      const created = await svc.submitVehicleRequest(actorOf(p), input({ vehicleId: v }));
      expect(created.status).toBe("pending");
      expect(created.totalStages).toBe(2);
      expect(created.currentStageOrder).toBe(3);
      expect(created.decidedAt).toBeNull();
      await addStage(fresh, 9);
      const [row] = await db.select().from(schema.vehicleRequestsTable).where(eq(schema.vehicleRequestsTable.id, created.id));
      expect(row.totalStages).toBe(2);
    });

    it("writes no approval decision and leaves the vehicle's status untouched", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      const created = await svc.submitVehicleRequest(actorOf(p), input());
      const approvals = await db
        .select()
        .from(schema.vehicleRequestApprovalsTable)
        .where(eq(schema.vehicleRequestApprovalsTable.requestId, created.id));
      expect(approvals).toEqual([]);
      const [vehicle] = await db.select().from(schema.vehiclesTable).where(eq(schema.vehiclesTable.id, vehicleAvailable));
      expect(vehicle.status).toBe("available");
    });

    it("does not reserve: a second request for the same vehicle and window is accepted (overlap is VR-02C)", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      const window = { plannedTimeOut: future(30), plannedTimeIn: future(34) };
      const a = await svc.submitVehicleRequest(actorOf(p), input(window));
      const b = await svc.submitVehicleRequest(actorOf(p), input(window));
      expect(a.status).toBe("pending");
      expect(b.status).toBe("pending");
    });

    it("records an audit event with the submission's facts", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      const created = await svc.submitVehicleRequest(actorOf(p), input());
      const [event] = await db
        .select()
        .from(schema.auditEventsTable)
        .where(and(eq(schema.auditEventsTable.eventType, "vehicle_request.submitted"), eq(schema.auditEventsTable.targetId, String(created.id))));
      expect(event.organizationId).toBe(orgId);
      expect(event.actorMembershipId).toBe(p.membershipId);
      expect(event.category).toBe("assets_inventory");
      expect(event.afterState).toMatchObject({
        requestReference: created.requestReference,
        requestType: "employee",
        requesterEmployeeId: p.employeeId,
        requestingDepartmentId: deptA,
        vehicleId: vehicleAvailable,
      });
    });
  });

  // ── own scope ──────────────────────────────────────────────────────────────
  describe("own-scope reads", () => {
    it("'mine' includes my employee AND department requests, and nobody else's", async () => {
      const me = await makePerson({ keys: ["vehicle_request.write.own", "vehicle_request.write.department"], departmentId: deptA });
      const colleague = await makePerson({ keys: ["vehicle_request.write.own", "vehicle_request.write.department"], departmentId: deptA });
      const mineEmployee = await svc.submitVehicleRequest(actorOf(me), input());
      const mineDepartment = await svc.submitVehicleRequest(actorOf(me), input({ requestType: "department" }));
      const theirsDepartment = await svc.submitVehicleRequest(actorOf(colleague), input({ requestType: "department" }));

      const ids = (await svc.listMyVehicleRequests(orgId, me.membershipId)).map((r) => r.id);
      expect(ids).toContain(mineEmployee.id);
      expect(ids).toContain(mineDepartment.id);
      expect(ids).not.toContain(theirsDepartment.id); // same department, still not mine
      expect(await svc.getMyVehicleRequest(orgId, me.membershipId, theirsDepartment.id)).toBeNull();
    });

    it("read.all does not widen the self-service view", async () => {
      const overseer = await makePerson({ keys: ["vehicle_request.read.all", "vehicle_request.write.own"] });
      const other = await makePerson({ keys: ["vehicle_request.write.own"] });
      const theirs = await svc.submitVehicleRequest(actorOf(other), input());
      const ids = (await svc.listMyVehicleRequests(orgId, overseer.membershipId)).map((r) => r.id);
      expect(ids).not.toContain(theirs.id);
    });

    it("losing the submission grant later does not hide my history", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      const created = await svc.submitVehicleRequest(actorOf(p), input());
      await db.delete(schema.membershipRolesTable).where(eq(schema.membershipRolesTable.membershipId, p.membershipId));
      await expect(svc.submitVehicleRequest(actorOf(p), input())).rejects.toBeInstanceOf(svc.VehicleRequestNotAuthorizedError);
      expect((await svc.listMyVehicleRequests(orgId, p.membershipId)).map((r) => r.id)).toContain(created.id);
    });

    it("another organization's membership sees nothing of ours", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      const created = await svc.submitVehicleRequest(actorOf(p), input());
      expect(await svc.getMyVehicleRequest(otherOrgId, p.membershipId, created.id)).toBeNull();
      expect(await svc.listMyVehicleRequests(otherOrgId, p.membershipId)).toEqual([]);
    });
  });

  // ── requestable vehicles & context ─────────────────────────────────────────
  describe("requestable vehicles and submission context", () => {
    it("lists only this organization's vehicles whose VR-01 status is `available`", async () => {
      const ids = (await svc.listRequestableVehicles(orgId)).map((v) => v.id);
      expect(ids).toContain(vehicleAvailable);
      expect(ids).not.toContain(vehicleMaintenance);
      expect(ids).not.toContain(foreignVehicle);
    });

    it("a vehicle with a pending request for any window stays requestable (no reservation logic)", async () => {
      const p = await makePerson({ keys: ["vehicle_request.write.own"] });
      await svc.submitVehicleRequest(actorOf(p), input());
      expect((await svc.listRequestableVehicles(orgId)).map((v) => v.id)).toContain(vehicleAvailable);
    });

    it("context reports permitted types, the department, and why submission is blocked", async () => {
      const plain = await makePerson();
      expect(await svc.getSubmissionContext(actorOf(plain))).toMatchObject({
        canSubmitEmployeeRequest: false,
        canSubmitDepartmentRequest: false,
        blockedReason: "You have not been authorized to submit vehicle requests.",
      });
      const dept = await makePerson({ keys: ["vehicle_request.write.department"], departmentId: deptB });
      const ctx = await svc.getSubmissionContext(actorOf(dept));
      expect(ctx).toMatchObject({ canSubmitEmployeeRequest: false, canSubmitDepartmentRequest: true, blockedReason: null });
      expect(ctx.department?.id).toBe(deptB);
      const noDept = await makePerson({ keys: ["vehicle_request.write.own"], departmentId: null });
      expect((await svc.getSubmissionContext(actorOf(noDept))).blockedReason).toMatch(/assign you to a department/);
    });
  });
});
