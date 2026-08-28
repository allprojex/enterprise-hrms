/**
 * WS-11 — live proof of the Employment Lifecycle Events Expansion.
 *
 * Covers the Owner's §52–§58 QA matrices. The properties that matter most are
 * the negative ones, because they are the employment-law boundaries: a contract
 * passing its end date does not terminate anyone, an unsuccessful probation
 * outcome does not separate anyone, an acting appointment does not touch the
 * substantive position, imported history causes no side effect, and no
 * scheduled job makes a consequential decision.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS11_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-11 — employment lifecycle, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let orgId: number;
  let otherOrgId: number;
  let userId: number;
  let membershipId: number;
  let positionId: number;
  let otherOrgPositionId: number;
  let otherOrgEmployeeId: number;

  let terms: typeof import("../lib/employmentLifecycle/employmentTerms");
  let assignments: typeof import("../lib/employmentLifecycle/assignments");
  let probation: typeof import("../lib/employmentLifecycle/probation");
  let eventTypes: typeof import("../lib/employmentLifecycle/eventTypes");
  let lifecycleService: typeof import("../lib/employmentLifecycleService");
  let employees: typeof import("../lib/employees");
  let reminders: typeof import("../lib/employmentLifecycle/reminders");
  let jobHandlers: typeof import("../lib/jobHandlers");
  let registry: typeof import("../lib/jobHandlerRegistry");

  const suffix = `ws11-${Date.now()}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    terms = await import("../lib/employmentLifecycle/employmentTerms");
    assignments = await import("../lib/employmentLifecycle/assignments");
    probation = await import("../lib/employmentLifecycle/probation");
    eventTypes = await import("../lib/employmentLifecycle/eventTypes");
    lifecycleService = await import("../lib/employmentLifecycleService");
    employees = await import("../lib/employees");
    reminders = await import("../lib/employmentLifecycle/reminders");
    jobHandlers = await import("../lib/jobHandlers");
    registry = await import("../lib/jobHandlerRegistry");
    jobHandlers.registerShippedJobHandlers();

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS11 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS11 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "WS11", lastName: "Actor", organizationId: orgId })
      .returning();
    userId = user.id;
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId: orgId, status: "active" })
      .returning();
    membershipId = m.id;

    const [pos] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: orgId, title: `Acting Head ${suffix}`, code: `AH-${suffix}` })
      .returning();
    positionId = pos.id;
    const [otherPos] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: otherOrgId, title: `Foreign ${suffix}`, code: `FP-${suffix}` })
      .returning();
    otherOrgPositionId = otherPos.id;

    const [foreignEmp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Foreign", lastName: "Employee" })
      .returning();
    otherOrgEmployeeId = foreignEmp.id;
  });

  const actor = () => ({ actorApplicationUserId: userId, actorMembershipId: membershipId });

  async function makeEmployee(tag: string, overrides: Record<string, unknown> = {}) {
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: tag, lastName: "Subject", ...overrides })
      .returning();
    return emp;
  }

  async function historyFor(employeeId: number) {
    return db
      .select()
      .from(schema.employmentPeriodsTable)
      .where(
        and(
          eq(schema.employmentPeriodsTable.organizationId, orgId),
          eq(schema.employmentPeriodsTable.employeeId, employeeId),
        ),
      );
  }

  // -- §52 A–G: employment history ------------------------------------------

  it("A–C: transfer, promotion and confirmation still record lifecycle history", async () => {
    const emp = await makeEmployee("Existing", { employmentStatus: "probation" });
    const [dept] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId: orgId, name: `D ${suffix}`, code: `DC-${suffix}` })
      .returning();

    await employees.transferEmployee({
      organizationId: orgId,
      employeeId: emp.id,
      departmentId: dept.id,
      effectiveDate: new Date("2026-01-01T00:00:00Z"),
      ...actor(),
    });
    await employees.promoteEmployee({
      organizationId: orgId,
      employeeId: emp.id,
      positionId,
      effectiveDate: new Date("2026-02-01T00:00:00Z"),
      ...actor(),
    });
    await employees.confirmEmployee({
      organizationId: orgId,
      employeeId: emp.id,
      effectiveDate: new Date("2026-03-01T00:00:00Z"),
      ...actor(),
    });

    const events = (await historyFor(emp.id)).map((e: any) => e.eventType);
    expect(events).toEqual(expect.arrayContaining(["transfer", "promotion", "confirmation"]));
  });

  it("D–E: separation and rehire NOW record lifecycle history, alongside their audit events", async () => {
    const emp = await makeEmployee("Separating");

    await employees.separateEmployee({
      organizationId: orgId,
      employeeId: emp.id,
      separationDate: new Date("2026-06-30T00:00:00Z"),
      separationReason: "resignation",
      ...actor(),
    });

    const afterSeparation = await historyFor(emp.id);
    const separationEvent = afterSeparation.find((e: any) => e.eventType === "separation");
    expect(separationEvent).toBeTruthy();
    expect(separationEvent.newState.employmentStatus).toBe("terminated");

    // The pre-existing audit event is NOT weakened or replaced (§27.3).
    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(eq(schema.auditEventsTable.organizationId, orgId), eq(schema.auditEventsTable.eventType, "employee.separated")),
      );
    expect(audits.length).toBeGreaterThan(0);

    await employees.rehireEmployee({ organizationId: orgId, employeeId: emp.id, ...actor() });
    const afterRehire = await historyFor(emp.id);
    expect(afterRehire.find((e: any) => e.eventType === "rehire")).toBeTruthy();
    // Same employees.id throughout; the separation event survives the rehire.
    expect(afterRehire.find((e: any) => e.eventType === "separation")).toBeTruthy();
  });

  it("F–G: an arbitrary imported event string is readable, preserved, and causes ZERO side effects", async () => {
    const emp = await makeEmployee("Imported", { employmentStatus: "probation", probationEndDate: new Date("2026-12-01T00:00:00Z") });

    // Exactly what WS-7's adapter does: an arbitrary historical event type.
    const imported = await lifecycleService.recordEmploymentPeriodEvent({
      organizationId: orgId,
      employeeId: emp.id,
      eventType: "Re-designation (legacy HR system)",
      effectiveDate: new Date("2019-04-01T00:00:00Z"),
      newState: { note: "from spreadsheet", source: "migration" },
      ...actor(),
      source: "import",
    });
    expect(imported.eventType).toBe("Re-designation (legacy HR system)");

    // Readable and correctly flagged as non-system.
    expect(eventTypes.isSystemEventType(imported.eventType)).toBe(false);
    expect(eventTypes.labelForEventType(imported.eventType)).toBe("Re-designation (legacy HR system)");

    // A forged imported string that LOOKS like a system event still cannot move
    // a live date — state derivation only trusts registered system events.
    await lifecycleService.recordEmploymentPeriodEvent({
      organizationId: orgId,
      employeeId: emp.id,
      eventType: "probation_extension_from_old_system",
      effectiveDate: new Date("2030-01-01T00:00:00Z"),
      newState: { newProbationEndDate: "2099-01-01T00:00:00Z" },
      ...actor(),
      source: "import",
    });

    const resolved = await probation.resolveProbationEnd(orgId, emp.id);
    expect(resolved.source).toBe("employee_record");
    expect(resolved.probationEndDate?.toISOString()).toBe("2026-12-01T00:00:00.000Z");

    // And employment state is entirely untouched by imported history.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("probation");
  });

  it("the system write path refuses an unregistered event type", async () => {
    const emp = await makeEmployee("Registry");
    await expect(
      lifecycleService.recordEmploymentPeriodEvent({
        organizationId: orgId,
        employeeId: emp.id,
        eventType: "totally_made_up_event",
        effectiveDate: new Date(),
        newState: {},
        ...actor(),
      }),
    ).rejects.toThrow(/not a registered system lifecycle event type/i);
  });

  // -- §53 H–P: contract ------------------------------------------------------

  it("H–J–K–L: create, renew, and prove the prior term is preserved with an event", async () => {
    const emp = await makeEmployee("Contract");

    const first = await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "fixed_term",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      ...actor(),
    });
    expect((await terms.getActiveTerm(orgId, emp.id))!.id).toBe(first.id);

    const { previous, renewed } = await terms.renewTerm({
      organizationId: orgId,
      termId: first.id,
      termType: "fixed_term",
      startDate: new Date("2027-01-01T00:00:00Z"),
      endDate: new Date("2027-12-31T00:00:00Z"),
      reason: "Renewed for a further year",
      ...actor(),
    });

    // The prior term is preserved with its ORIGINAL dates, not overwritten.
    expect(previous.status).toBe("superseded");
    expect(previous.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(previous.endDate!.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(renewed.renewedFromTermId).toBe(first.id);
    expect((await terms.getActiveTerm(orgId, emp.id))!.id).toBe(renewed.id);
    expect(await terms.listTerms(orgId, emp.id)).toHaveLength(2);

    const renewalEvent = (await historyFor(emp.id)).find((e: any) => e.eventType === "contract_renewal");
    expect(renewalEvent).toBeTruthy();
    expect(renewalEvent.newState.renewedFromTermId).toBe(first.id);
  });

  it("only one active term can exist, even under a concurrent create", async () => {
    const emp = await makeEmployee("OneActive");
    await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "permanent",
      startDate: new Date("2026-01-01T00:00:00Z"),
      ...actor(),
    });
    await expect(
      terms.createTerm({
        organizationId: orgId,
        employeeId: emp.id,
        termType: "permanent",
        startDate: new Date("2026-02-01T00:00:00Z"),
        ...actor(),
      }),
    ).rejects.toThrow(/already has an active employment term/i);
  });

  it("term dates are validated by type", async () => {
    const emp = await makeEmployee("Dates");
    await expect(
      terms.createTerm({ organizationId: orgId, employeeId: emp.id, termType: "fixed_term", startDate: new Date(), ...actor() }),
    ).rejects.toThrow(/needs an end date/i);
    await expect(
      terms.createTerm({
        organizationId: orgId,
        employeeId: emp.id,
        termType: "permanent",
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        ...actor(),
      }),
    ).rejects.toThrow(/cannot have an end date/i);
  });

  it("M–N: an expired contract leaves the employee EMPLOYED — expiry never separates", async () => {
    const emp = await makeEmployee("Expired", { employmentStatus: "active" });
    const term = await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "fixed_term",
      startDate: new Date("2020-01-01T00:00:00Z"),
      endDate: new Date("2020-12-31T00:00:00Z"),
      ...actor(),
    });

    // Derived expiry state, computed against an explicit instant.
    expect(terms.deriveExpiryState(term, 30, new Date("2026-01-01T00:00:00Z"))).toBe("expired");
    expect(terms.deriveExpiryState(term, 30, new Date("2020-06-01T00:00:00Z"))).toBe("current");

    // THE BOUNDARY: the employee is still employed, still active, and no
    // separation event or audit event exists.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("active");
    expect(after.separationDate).toBeNull();
    expect((await historyFor(emp.id)).find((e: any) => e.eventType === "separation")).toBeUndefined();

    // The term still reports as active — expiry is information, not a status.
    expect((await terms.getActiveTerm(orgId, emp.id))!.id).toBe(term.id);

    // It surfaces in the HR action queue rather than acting on its own.
    const expiring = await terms.findExpiringTerms(orgId, 30, new Date("2026-01-01T00:00:00Z"));
    expect(expiring.some((row: any) => row.term.id === term.id && row.state === "expired")).toBe(true);
  });

  it("closing a term does not separate the employee either", async () => {
    const emp = await makeEmployee("Closing", { employmentStatus: "active" });
    const term = await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "fixed_term",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-06-30T00:00:00Z"),
      ...actor(),
    });
    const closed = await terms.closeTerm({ organizationId: orgId, termId: term.id, reason: "Not renewed", ...actor() });
    expect(closed.status).toBe("closed");

    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("active");
    expect(after.separationDate).toBeNull();
  });

  it("P: a term from another organization is not reachable", async () => {
    const emp = await makeEmployee("CrossTerm");
    const term = await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "permanent",
      startDate: new Date("2026-01-01T00:00:00Z"),
      ...actor(),
    });
    expect(await terms.getTerm(otherOrgId, term.id)).toBeNull();
    await expect(
      terms.renewTerm({
        organizationId: otherOrgId,
        termId: term.id,
        termType: "permanent",
        startDate: new Date("2027-01-01T00:00:00Z"),
        ...actor(),
      }),
    ).rejects.toThrow();
    await expect(terms.closeTerm({ organizationId: otherOrgId, termId: term.id, ...actor() })).rejects.toThrow();
    await expect(
      terms.createTerm({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        termType: "permanent",
        startDate: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow(/Employee not found/i);
  });

  // -- §54 Q–Y: probation ----------------------------------------------------

  it("R–S–T: extension preserves the previous end, records reason and actor, and is append-only", async () => {
    const emp = await makeEmployee("Extend", {
      employmentStatus: "probation",
      probationEndDate: new Date("2026-06-30T00:00:00Z"),
    });

    const { previousProbationEndDate } = await probation.extendProbation({
      organizationId: orgId,
      employeeId: emp.id,
      newProbationEndDate: new Date("2026-09-30T00:00:00Z"),
      effectiveDate: new Date("2026-06-25T00:00:00Z"),
      reason: "Additional assessment period agreed",
      extensionsAllowed: true,
      maxExtensions: null,
      ...actor(),
    });
    expect(previousProbationEndDate?.toISOString()).toBe("2026-06-30T00:00:00.000Z");

    const event = (await historyFor(emp.id)).find((e: any) => e.eventType === "probation_extension");
    expect(event).toBeTruthy();
    expect(event.newState.previousProbationEndDate).toBeTruthy();
    expect(event.newState.newProbationEndDate).toBeTruthy();
    expect(event.newState.reason).toBe("Additional assessment period agreed");
    expect(event.recordedBy).toBe(userId);

    // Current derived end comes from the extension event.
    const resolved = await probation.resolveProbationEnd(orgId, emp.id);
    expect(resolved.source).toBe("extension_event");
    expect(resolved.probationEndDate?.toISOString()).toBe("2026-09-30T00:00:00.000Z");

    // A second extension appends rather than replacing.
    await probation.extendProbation({
      organizationId: orgId,
      employeeId: emp.id,
      newProbationEndDate: new Date("2026-12-31T00:00:00Z"),
      effectiveDate: new Date("2026-09-25T00:00:00Z"),
      reason: "Further extension",
      extensionsAllowed: true,
      maxExtensions: null,
      ...actor(),
    });
    expect(await probation.countExtensions(orgId, emp.id)).toBe(2);
    const allExtensions = (await historyFor(emp.id)).filter((e: any) => e.eventType === "probation_extension");
    expect(allExtensions).toHaveLength(2);
  });

  it("extension respects organization policy: disabled, limited, and never backwards", async () => {
    const emp = await makeEmployee("Policy", {
      employmentStatus: "probation",
      probationEndDate: new Date("2026-06-30T00:00:00Z"),
    });
    const base = {
      organizationId: orgId,
      employeeId: emp.id,
      effectiveDate: new Date("2026-06-01T00:00:00Z"),
      reason: "x",
      ...actor(),
    };

    await expect(
      probation.extendProbation({ ...base, newProbationEndDate: new Date("2026-09-30T00:00:00Z"), extensionsAllowed: false, maxExtensions: null }),
    ).rejects.toThrow(/does not permit probation extensions/i);

    await expect(
      probation.extendProbation({ ...base, newProbationEndDate: new Date("2026-01-01T00:00:00Z"), extensionsAllowed: true, maxExtensions: null }),
    ).rejects.toThrow(/must be later/i);

    await probation.extendProbation({ ...base, newProbationEndDate: new Date("2026-09-30T00:00:00Z"), extensionsAllowed: true, maxExtensions: 1 });
    await expect(
      probation.extendProbation({ ...base, newProbationEndDate: new Date("2026-11-30T00:00:00Z"), extensionsAllowed: true, maxExtensions: 1 }),
    ).rejects.toThrow(/at most 1 probation extension/i);
  });

  it("U–V: an unsuccessful outcome is recorded and does NOT separate the employee", async () => {
    const emp = await makeEmployee("Unsuccessful", {
      employmentStatus: "probation",
      probationEndDate: new Date("2026-06-30T00:00:00Z"),
    });

    await probation.recordUnsuccessfulProbation({
      organizationId: orgId,
      employeeId: emp.id,
      effectiveDate: new Date("2026-06-30T00:00:00Z"),
      reason: "Performance standard not met",
      ...actor(),
    });

    const event = (await historyFor(emp.id)).find((e: any) => e.eventType === "probation_unsuccessful");
    expect(event).toBeTruthy();
    expect(event.newState.outcome).toBe("unsuccessful");
    expect(await probation.hasUnsuccessfulOutcome(orgId, emp.id)).toBe(true);

    // THE BOUNDARY: no separation, no status change, no separation date.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("probation");
    expect(after.separationDate).toBeNull();
    expect((await historyFor(emp.id)).find((e: any) => e.eventType === "separation")).toBeUndefined();

    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.organizationId, orgId),
          eq(schema.auditEventsTable.eventType, "employee.separated"),
          eq(schema.auditEventsTable.targetId, String(emp.id)),
        ),
      );
    expect(audits).toHaveLength(0);
  });

  it("Q: confirmation still works after WS-11, and probation actions require probation status", async () => {
    const emp = await makeEmployee("StillConfirms", { employmentStatus: "probation" });
    const confirmed = await employees.confirmEmployee({
      organizationId: orgId,
      employeeId: emp.id,
      effectiveDate: new Date("2026-07-01T00:00:00Z"),
      ...actor(),
    });
    expect(confirmed.employmentStatus).toBe("active");

    await expect(
      probation.extendProbation({
        organizationId: orgId,
        employeeId: emp.id,
        newProbationEndDate: new Date("2027-01-01T00:00:00Z"),
        effectiveDate: new Date(),
        reason: "x",
        extensionsAllowed: true,
        maxExtensions: null,
        ...actor(),
      }),
    ).rejects.toThrow(/not on probation/i);
  });

  it("Y: probation actions are refused across organizations", async () => {
    await expect(
      probation.extendProbation({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        newProbationEndDate: new Date("2027-01-01T00:00:00Z"),
        effectiveDate: new Date(),
        reason: "x",
        extensionsAllowed: true,
        maxExtensions: null,
        ...actor(),
      }),
    ).rejects.toThrow(/Employee not found/i);
  });

  // -- §55 Z–AF: acting -------------------------------------------------------

  it("Z–AA–AB–AC–AD–AE: acting appointment never touches the substantive position", async () => {
    const [substantive] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: orgId, title: `Substantive ${suffix}`, code: `SB-${suffix}` })
      .returning();
    const emp = await makeEmployee("Acting", { positionId: substantive.id });

    const created = await assignments.startAssignment({
      organizationId: orgId,
      employeeId: emp.id,
      assignmentType: "acting",
      actingPositionId: positionId,
      startDate: new Date("2026-01-01T00:00:00Z"),
      expectedEndDate: new Date("2026-06-30T00:00:00Z"),
      reason: "Covering a vacancy",
      enabled: true,
      ...actor(),
    });
    expect(created.actingPositionId).toBe(positionId);

    // THE BOUNDARY: substantive position, department and status all unchanged.
    const [during] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(during.positionId).toBe(substantive.id);
    expect(during.employmentStatus).toBe("active");

    expect((await assignments.getOpenAssignment(orgId, emp.id, "acting"))!.id).toBe(created.id);
    expect((await historyFor(emp.id)).find((e: any) => e.eventType === "acting_start")).toBeTruthy();

    const ended = await assignments.endAssignment({
      organizationId: orgId,
      assignmentId: created.id,
      actualEndDate: new Date("2026-05-31T00:00:00Z"),
      endReason: "Substantive holder returned",
      ...actor(),
    });
    expect(ended.actualEndDate).not.toBeNull();
    expect(await assignments.getOpenAssignment(orgId, emp.id, "acting")).toBeNull();
    expect((await historyFor(emp.id)).find((e: any) => e.eventType === "acting_end")).toBeTruthy();

    // Still unchanged after ending — nothing was "restored" because nothing moved.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.positionId).toBe(substantive.id);

    // History preserved.
    expect(await assignments.listAssignments(orgId, emp.id, "acting")).toHaveLength(1);
    await expect(
      assignments.endAssignment({ organizationId: orgId, assignmentId: created.id, actualEndDate: new Date(), ...actor() }),
    ).rejects.toThrow(/already ended/i);
  });

  it("AF: an acting position or employee from another organization is refused", async () => {
    const emp = await makeEmployee("CrossActing");
    await expect(
      assignments.startAssignment({
        organizationId: orgId,
        employeeId: emp.id,
        assignmentType: "acting",
        actingPositionId: otherOrgPositionId,
        startDate: new Date(),
        enabled: true,
        ...actor(),
      }),
    ).rejects.toThrow(/does not belong to this organization/i);

    await expect(
      assignments.startAssignment({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        assignmentType: "acting",
        actingPositionId: positionId,
        startDate: new Date(),
        enabled: true,
        ...actor(),
      }),
    ).rejects.toThrow(/Employee not found/i);
  });

  it("only one open acting appointment at a time, and the capability can be disabled", async () => {
    const emp = await makeEmployee("OneActing");
    await assignments.startAssignment({
      organizationId: orgId,
      employeeId: emp.id,
      assignmentType: "acting",
      actingPositionId: positionId,
      startDate: new Date("2026-01-01T00:00:00Z"),
      enabled: true,
      ...actor(),
    });
    await expect(
      assignments.startAssignment({
        organizationId: orgId,
        employeeId: emp.id,
        assignmentType: "acting",
        actingPositionId: positionId,
        startDate: new Date("2026-02-01T00:00:00Z"),
        enabled: true,
        ...actor(),
      }),
    ).rejects.toThrow(/already has an open acting appointment/i);

    const other = await makeEmployee("Disabled");
    await expect(
      assignments.startAssignment({
        organizationId: orgId,
        employeeId: other.id,
        assignmentType: "acting",
        actingPositionId: positionId,
        startDate: new Date(),
        enabled: false,
        ...actor(),
      }),
    ).rejects.toThrow(/does not use acting appointments/i);
  });

  // -- §56 AG–AM: secondment --------------------------------------------------

  it("AG–AH–AI–AJ–AK–AL: secondment keeps identity, status and substantive position intact", async () => {
    const [substantive] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: orgId, title: `Sec Substantive ${suffix}`, code: `SS-${suffix}` })
      .returning();
    const emp = await makeEmployee("Seconded", { positionId: substantive.id, employmentStatus: "active" });

    const created = await assignments.startAssignment({
      organizationId: orgId,
      employeeId: emp.id,
      assignmentType: "secondment",
      destinationDescription: "Partner NGO — regional programme office",
      destinationType: "external",
      startDate: new Date("2026-03-01T00:00:00Z"),
      expectedEndDate: new Date("2026-09-01T00:00:00Z"),
      enabled: true,
      ...actor(),
    });
    expect(created.destinationDescription).toBe("Partner NGO — regional programme office");
    // V1 is descriptive: there is no destination organization reference at all.
    expect(Object.keys(created)).not.toContain("destinationOrganizationId");

    const [during] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(during.organizationId).toBe(orgId);
    expect(during.employmentStatus).toBe("active");
    expect(during.positionId).toBe(substantive.id);

    expect((await historyFor(emp.id)).find((e: any) => e.eventType === "secondment_start")).toBeTruthy();

    await assignments.endAssignment({
      organizationId: orgId,
      assignmentId: created.id,
      actualEndDate: new Date("2026-08-15T00:00:00Z"),
      ...actor(),
    });
    expect(await assignments.getOpenAssignment(orgId, emp.id, "secondment")).toBeNull();
    expect((await historyFor(emp.id)).find((e: any) => e.eventType === "secondment_end")).toBeTruthy();
    expect(await assignments.listAssignments(orgId, emp.id, "secondment")).toHaveLength(1);
  });

  it("a secondment needs a destination, and acting and secondment may coexist", async () => {
    const emp = await makeEmployee("Both");
    await expect(
      assignments.startAssignment({
        organizationId: orgId,
        employeeId: emp.id,
        assignmentType: "secondment",
        startDate: new Date(),
        enabled: true,
        ...actor(),
      }),
    ).rejects.toThrow(/needs a destination/i);

    await assignments.startAssignment({
      organizationId: orgId,
      employeeId: emp.id,
      assignmentType: "acting",
      actingPositionId: positionId,
      startDate: new Date("2026-01-01T00:00:00Z"),
      enabled: true,
      ...actor(),
    });
    // The partial unique index is per TYPE, so both may be open at once — a
    // legitimate arrangement the frozen scope does not forbid.
    await assignments.startAssignment({
      organizationId: orgId,
      employeeId: emp.id,
      assignmentType: "secondment",
      destinationDescription: "Head office project",
      destinationType: "internal",
      startDate: new Date("2026-01-01T00:00:00Z"),
      enabled: true,
      ...actor(),
    });
    expect(await assignments.getOpenAssignment(orgId, emp.id, "acting")).not.toBeNull();
    expect(await assignments.getOpenAssignment(orgId, emp.id, "secondment")).not.toBeNull();
  });

  it("AM: assignments are not reachable across organizations", async () => {
    const emp = await makeEmployee("CrossAssign");
    const created = await assignments.startAssignment({
      organizationId: orgId,
      employeeId: emp.id,
      assignmentType: "acting",
      actingPositionId: positionId,
      startDate: new Date(),
      enabled: true,
      ...actor(),
    });
    expect(await assignments.getAssignment(otherOrgId, created.id)).toBeNull();
    await expect(
      assignments.endAssignment({
        organizationId: otherOrgId,
        assignmentId: created.id,
        actualEndDate: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow();
  });

  // -- §44/§58: scheduled jobs are observers only -----------------------------

  it("reminder handlers are registered, and no lifecycle-mutating job type exists", () => {
    expect(registry.getJobHandler("employment.probation_reminder")).toBeDefined();
    expect(registry.getJobHandler("employment.contract_expiry_reminder")).toBeDefined();
    // Nothing that could act on employment was smuggled in.
    for (const forbidden of [
      "employment.auto_separate",
      "employment.auto_confirm",
      "employment.auto_renew",
      "employment.auto_revert",
    ]) {
      expect(registry.getJobHandler(forbidden)).toBeUndefined();
    }
  });

  it("a contract-expiry reminder no-ops after renewal, and NEVER mutates employment", async () => {
    const emp = await makeEmployee("ReminderContract", { employmentStatus: "active" });
    const term = await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "fixed_term",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-02-01T00:00:00Z"),
      ...actor(),
    });

    await terms.renewTerm({
      organizationId: orgId,
      termId: term.id,
      termType: "fixed_term",
      startDate: new Date("2026-02-02T00:00:00Z"),
      endDate: new Date("2027-02-01T00:00:00Z"),
      ...actor(),
    });

    const handler = registry.getJobHandler("employment.contract_expiry_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "employment_term",
        sourceReferenceId: term.id,
        payload: handler.parsePayload({ employmentTermId: term.id }),
        attemptCount: 0,
      }),
    ).rejects.toBeInstanceOf(registry.PermanentJobError);

    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("active");
  });

  it("a probation reminder no-ops after confirmation and after a superseding extension", async () => {
    const confirmed = await makeEmployee("ReminderConfirmed", {
      employmentStatus: "probation",
      probationEndDate: new Date("2026-06-30T00:00:00Z"),
    });
    await employees.confirmEmployee({
      organizationId: orgId,
      employeeId: confirmed.id,
      effectiveDate: new Date("2026-06-01T00:00:00Z"),
      ...actor(),
    });

    const handler = registry.getJobHandler("employment.probation_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "employee",
        sourceReferenceId: confirmed.id,
        payload: handler.parsePayload({ employeeId: confirmed.id }),
        attemptCount: 0,
      }),
    ).rejects.toThrow(/no longer on probation/i);

    // A far-future extension moves the end beyond the reminder window.
    const extended = await makeEmployee("ReminderExtended", {
      employmentStatus: "probation",
      probationEndDate: new Date("2026-06-30T00:00:00Z"),
    });
    await probation.extendProbation({
      organizationId: orgId,
      employeeId: extended.id,
      newProbationEndDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      effectiveDate: new Date(),
      reason: "Extended well beyond the window",
      extensionsAllowed: true,
      maxExtensions: null,
      ...actor(),
    });
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: orgId,
        sourceReferenceType: "employee",
        sourceReferenceId: extended.id,
        payload: handler.parsePayload({ employeeId: extended.id }),
        attemptCount: 0,
      }),
    ).rejects.toThrow(/moved beyond the reminder window/i);
  });

  it("a forged reminder aimed at another organization resolves nothing", async () => {
    const emp = await makeEmployee("ForgedJob", { employmentStatus: "probation" });
    const handler = registry.getJobHandler("employment.probation_reminder")!;
    await expect(
      handler.execute({
        jobId: -1,
        organizationId: otherOrgId,
        sourceReferenceType: "employee",
        sourceReferenceId: emp.id,
        payload: handler.parsePayload({ employeeId: emp.id }),
        attemptCount: 0,
      }),
    ).rejects.toThrow(/no longer exists in this organization/i);
    expect(reminders.PROBATION_REMINDER).toBe("employment.probation_reminder");
  });
});
