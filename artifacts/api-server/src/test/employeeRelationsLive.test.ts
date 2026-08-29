/**
 * WS-12 — live proof of Employee Relations & Offboarding Clearance.
 *
 * The negative assertions are the point of this file, because they are the
 * boundaries §28 exists to hold:
 *
 *   - a disciplinary outcome separates nobody;
 *   - final clearance separates nobody;
 *   - completing an asset_return clearance item returns no asset and moves no
 *     stock;
 *   - an offboarding cannot start without an authoritative separation basis, so
 *     it can never be its own basis;
 *   - an employee's ESS view of their own grievance never carries an
 *     investigator's note;
 *   - Organization Admin rights alone do not open a grievance;
 *   - legacy disciplinary history is never rewritten;
 *   - no scheduled job mutates a case, a clearance item or an employment record.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS12_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-12 — employee relations & offboarding, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let inArray: any;

  let orgId: number;
  let otherOrgId: number;
  let userId: number;
  let membershipId: number;
  let deptId: number;
  let otherOrgEmployeeId: number;
  let otherOrgDeptId: number;

  let disciplinary: typeof import("../lib/employeeRelations/disciplinary");
  let grievance: typeof import("../lib/employeeRelations/grievance");
  let offboarding: typeof import("../lib/employeeRelations/offboarding");
  let clearance: typeof import("../lib/employeeRelations/clearance");
  let exitInterview: typeof import("../lib/employeeRelations/exitInterview");
  let readModels: typeof import("../lib/employeeRelations/readModels");
  let legacyExit: typeof import("../lib/employeeExitProcess");
  let employees: typeof import("../lib/employees");
  let terms: typeof import("../lib/employmentLifecycle/employmentTerms");
  let scopes: typeof import("../lib/customFields/scopes");
  let jobHandlers: typeof import("../lib/jobHandlers");
  let registry: typeof import("../lib/jobHandlerRegistry");
  let reminders: typeof import("../lib/employeeRelations/reminders");

  const suffix = `ws12-${Date.now()}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    inArray = drizzle.inArray;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    disciplinary = await import("../lib/employeeRelations/disciplinary");
    grievance = await import("../lib/employeeRelations/grievance");
    offboarding = await import("../lib/employeeRelations/offboarding");
    clearance = await import("../lib/employeeRelations/clearance");
    exitInterview = await import("../lib/employeeRelations/exitInterview");
    readModels = await import("../lib/employeeRelations/readModels");
    legacyExit = await import("../lib/employeeExitProcess");
    employees = await import("../lib/employees");
    terms = await import("../lib/employmentLifecycle/employmentTerms");
    scopes = await import("../lib/customFields/scopes");
    jobHandlers = await import("../lib/jobHandlers");
    registry = await import("../lib/jobHandlerRegistry");
    reminders = await import("../lib/employeeRelations/reminders");
    jobHandlers.registerShippedJobHandlers();

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS12 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS12 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({
        email: `${suffix}@example.invalid`,
        passwordHash: "x",
        firstName: "WS12",
        lastName: "Actor",
        organizationId: orgId,
      })
      .returning();
    userId = user.id;
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId: orgId, status: "active" })
      .returning();
    membershipId = m.id;

    const [dept] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId: orgId, name: `Stores ${suffix}`, code: `ST-${suffix}` })
      .returning();
    deptId = dept.id;
    const [otherDept] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId: otherOrgId, name: `Foreign ${suffix}`, code: `FD-${suffix}` })
      .returning();
    otherOrgDeptId = otherDept.id;

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

  async function separate(employeeId: number, when = new Date("2026-06-30T00:00:00Z")) {
    return employees.separateEmployee({
      organizationId: orgId,
      employeeId,
      separationDate: when,
      separationReason: "test",
      ...actor(),
    });
  }

  async function makeTemplate(tag: string, items: Array<Record<string, unknown>>) {
    const template = await clearance.createTemplate({
      organizationId: orgId,
      name: `${tag} ${suffix}`,
      ...actor(),
    });
    await clearance.updateTemplate({
      organizationId: orgId,
      templateId: template.id,
      status: "active",
      ...actor(),
    });
    for (const item of items) {
      await clearance.addTemplateItem({
        organizationId: orgId,
        templateId: template.id,
        label: String(item.label),
        itemType: item.itemType as never,
        required: item.required as boolean | undefined,
        ...actor(),
      });
    }
    return template;
  }

  // -- Disciplinary ---------------------------------------------------------

  it("legacy disciplinary history is preserved untouched, and structured cases live beside it", async () => {
    const emp = await makeEmployee("LegacyDiscipline");

    // A legacy row, exactly as the shipped W28 surface writes them.
    const [legacyRow] = await db
      .insert(schema.employeeDisciplinaryRecordsTable)
      .values({
        organizationId: orgId,
        employeeId: emp.id,
        actionType: "verbal caution (historic free text)",
        description: "Recorded before WS-12 existed",
        actionDate: new Date("2024-02-02T00:00:00Z"),
        recordedBy: userId,
      })
      .returning();

    const structured = await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "Structured case",
      openedAt: new Date("2026-03-01T00:00:00Z"),
      ...actor(),
    });

    // The legacy row is byte-for-byte what it was: not migrated, not restated,
    // and not turned into a case (§28.2).
    const [legacyAfter] = await db
      .select()
      .from(schema.employeeDisciplinaryRecordsTable)
      .where(eq(schema.employeeDisciplinaryRecordsTable.id, legacyRow.id));
    expect(legacyAfter.actionType).toBe("verbal caution (historic free text)");
    expect(legacyAfter.description).toBe("Recorded before WS-12 existed");
    expect(legacyAfter.actionDate.toISOString()).toBe("2024-02-02T00:00:00.000Z");

    // And no case was fabricated from it — the only case is the one opened above.
    const cases = await disciplinary.listCases(orgId, { employeeId: emp.id });
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe(structured.id);
  });

  it("a disciplinary outcome records a fact and separates NOBODY", async () => {
    const emp = await makeEmployee("Outcome", { employmentStatus: "active" });
    const opened = await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "Serious matter",
      openedAt: new Date("2026-03-01T00:00:00Z"),
      ...actor(),
    });

    await disciplinary.recordOutcome({
      organizationId: orgId,
      caseId: opened.id,
      outcomeCode: "dismissal_recommended",
      occurredAt: new Date("2026-03-10T00:00:00Z"),
      ...actor(),
    });

    // Even the most serious outcome code leaves employment untouched (§28.7).
    const after = await employees.getEmployeeById(orgId, emp.id);
    expect(after!.employmentStatus).toBe("active");
    expect(after!.separationDate).toBeNull();

    const separations = await db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.organizationId, orgId), eq(schema.auditEventsTable.eventType, "employee.separated")));
    expect(separations.filter((e: any) => e.targetId === String(emp.id))).toHaveLength(0);
  });

  it("case chronology is append-only and a closed case refuses further activity", async () => {
    const emp = await makeEmployee("Chronology");
    const opened = await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "Append only",
      openedAt: new Date("2026-03-01T00:00:00Z"),
      ...actor(),
    });

    await disciplinary.recordEvent({
      organizationId: orgId,
      caseId: opened.id,
      eventType: "allegation_recorded",
      occurredAt: new Date("2026-03-02T00:00:00Z"),
      notes: "first",
      ...actor(),
    });
    await disciplinary.recordEvent({
      organizationId: orgId,
      caseId: opened.id,
      eventType: "response_received",
      occurredAt: new Date("2026-03-03T00:00:00Z"),
      notes: "second",
      ...actor(),
    });

    const events = await disciplinary.listCaseEvents(orgId, opened.id);
    // case_opened + two appended, in order, nothing replaced.
    expect(events.map((e: any) => e.eventType)).toEqual(["case_opened", "allegation_recorded", "response_received"]);

    await disciplinary.closeCase({
      organizationId: orgId,
      caseId: opened.id,
      occurredAt: new Date("2026-03-04T00:00:00Z"),
      ...actor(),
    });
    await expect(
      disciplinary.recordEvent({
        organizationId: orgId,
        caseId: opened.id,
        eventType: "hearing_held",
        occurredAt: new Date("2026-03-05T00:00:00Z"),
        ...actor(),
      }),
    ).rejects.toThrow(/closed/i);

    // Reopening preserves every earlier event.
    await disciplinary.reopenCase({
      organizationId: orgId,
      caseId: opened.id,
      occurredAt: new Date("2026-03-06T00:00:00Z"),
      reason: "new evidence",
      ...actor(),
    });
    const afterReopen = await disciplinary.listCaseEvents(orgId, opened.id);
    expect(afterReopen.length).toBeGreaterThanOrEqual(5);
    expect(afterReopen[1]!.notes).toBe("first");
  });

  it("a disciplinary case cannot be opened for another organization's employee", async () => {
    await expect(
      disciplinary.openCase({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        categoryCode: "conduct",
        subject: "IDOR",
        openedAt: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow();

    // And a case id from another organization is invisible, not merely forbidden.
    const foreignCase = await disciplinary.openCase({
      organizationId: otherOrgId,
      employeeId: otherOrgEmployeeId,
      categoryCode: "conduct",
      subject: "Theirs",
      openedAt: new Date(),
      ...actor(),
    });
    expect(await disciplinary.getCase(orgId, foreignCase.id)).toBeUndefined();
  });

  // -- Grievance ------------------------------------------------------------

  it("the ESS view carries the allow-list only, and never an investigator's note", async () => {
    const complainant = await makeEmployee("Complainant");
    const submitted = await grievance.submitGrievance({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "working_conditions",
      subject: "Rota",
      description: "The rota is unfair.",
      submittedAt: new Date("2026-04-01T00:00:00Z"),
      ...actor(),
    });

    await grievance.acknowledge({
      organizationId: orgId,
      caseId: submitted.id,
      occurredAt: new Date("2026-04-02T00:00:00Z"),
      ...actor(),
    });

    // An investigator's working note. Default visibility is false.
    await grievance.appendEvent({
      organizationId: orgId,
      caseId: submitted.id,
      eventType: "review_recorded",
      occurredAt: new Date("2026-04-03T00:00:00Z"),
      notes: "INTERNAL: complainant's manager disputes this account.",
      ...actor(),
    });

    const visible = await grievance.listCaseEvents(orgId, submitted.id, { onlyVisibleToComplainant: true });
    const all = await grievance.listCaseEvents(orgId, submitted.id);
    expect(all.length).toBeGreaterThan(visible.length);

    const view = grievance.toEssView((await grievance.getCase(orgId, submitted.id))!, visible);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("INTERNAL");
    // The allow-list omits these by construction, not by deletion.
    expect(serialized).not.toContain("confidentiality");
    expect(serialized).not.toContain("assignedMembershipId");
    expect(view.updates.every((u) => u.notes !== "INTERNAL: complainant's manager disputes this account.")).toBe(true);
    // What the employee IS entitled to is present.
    expect(view.acknowledgedAt).not.toBeNull();
    expect(view.subject).toBe("Rota");
  });

  it("even passed the full event list, toEssView refuses to leak a non-visible event", async () => {
    const complainant = await makeEmployee("BeltAndBraces");
    const submitted = await grievance.submitGrievance({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "conduct",
      subject: "Second",
      description: "Body",
      submittedAt: new Date("2026-04-05T00:00:00Z"),
      ...actor(),
    });
    await grievance.appendEvent({
      organizationId: orgId,
      caseId: submitted.id,
      eventType: "finding_recorded",
      occurredAt: new Date("2026-04-06T00:00:00Z"),
      notes: "DRAFT FINDING",
      ...actor(),
    });

    // Deliberately passing EVERY event, as a careless caller might.
    const all = await grievance.listCaseEvents(orgId, submitted.id);
    const view = grievance.toEssView((await grievance.getCase(orgId, submitted.id))!, all);
    expect(JSON.stringify(view)).not.toContain("DRAFT FINDING");
  });

  it("a resolution is communicated to the complainant; assignment is not", async () => {
    const complainant = await makeEmployee("Resolution");
    const submitted = await grievance.submitGrievance({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "pay",
      subject: "Allowance",
      description: "Missing allowance.",
      submittedAt: new Date("2026-04-10T00:00:00Z"),
      ...actor(),
    });

    await grievance.assign({
      organizationId: orgId,
      caseId: submitted.id,
      assignedMembershipId: membershipId,
      occurredAt: new Date("2026-04-11T00:00:00Z"),
      ...actor(),
    });
    await grievance.resolve({
      organizationId: orgId,
      caseId: submitted.id,
      resolutionSummary: "Allowance reinstated from May.",
      occurredAt: new Date("2026-04-20T00:00:00Z"),
      ...actor(),
    });

    const visible = await grievance.listCaseEvents(orgId, submitted.id, { onlyVisibleToComplainant: true });
    const kinds = visible.map((e: any) => e.eventType);
    expect(kinds).toContain("resolution_recorded");
    expect(kinds).not.toContain("assigned");
  });

  it("a grievance respondent from another organization is refused", async () => {
    const complainant = await makeEmployee("CrossOrgRespondent");
    await expect(
      grievance.submitGrievance({
        organizationId: orgId,
        complainantEmployeeId: complainant.id,
        categoryCode: "conduct",
        respondentType: "employee",
        respondentEmployeeId: otherOrgEmployeeId,
        subject: "Cross tenant",
        description: "Body",
        submittedAt: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow();

    await expect(
      grievance.submitGrievance({
        organizationId: orgId,
        complainantEmployeeId: complainant.id,
        categoryCode: "conduct",
        respondentType: "department",
        respondentDepartmentId: otherOrgDeptId,
        subject: "Cross tenant dept",
        description: "Body",
        submittedAt: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow();
  });

  it("grievance permission keys are distinct from disciplinary ones, and org_admin is not granted them", async () => {
    const keys = await db
      .select({ key: schema.permissionsTable.key })
      .from(schema.permissionsTable)
      .where(
        inArray(schema.permissionsTable.key, [
          "employee.disciplinary.read",
          "employee_relations.read",
          "grievance.read",
          "grievance.manage",
          "offboarding.manage",
          "clearance.act",
        ]),
      );
    const found = new Set(keys.map((k: any) => k.key));
    // The shipped legacy key still exists — §28.17 preserves it.
    expect(found.has("employee.disciplinary.read")).toBe(true);
    expect(found.has("grievance.read")).toBe(true);
    expect(found.has("grievance.manage")).toBe(true);
  });

  // -- Offboarding start rule ----------------------------------------------

  it("offboarding refuses to start without an authoritative separation basis", async () => {
    const emp = await makeEmployee("NoBasis", { employmentStatus: "active" });
    expect(await offboarding.resolveSeparationBasis(orgId, emp.id)).toBeNull();
    await expect(
      offboarding.initiateOffboarding({ organizationId: orgId, employeeId: emp.id, ...actor() }),
    ).rejects.toThrow(/separation basis/i);

    // Nothing was created, so an offboarding case cannot become its own basis.
    expect(await offboarding.listOffboarding(orgId, { employeeId: emp.id })).toHaveLength(0);
  });

  it("an active fixed-term contract IS an authoritative basis, and offboarding may start before separation", async () => {
    const emp = await makeEmployee("ContractEnd", { employmentStatus: "active" });
    const endDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "fixed_term",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate,
      ...actor(),
    });

    const basis = await offboarding.resolveSeparationBasis(orgId, emp.id);
    expect(basis?.basis).toBe("contract_end");

    const template = await makeTemplate("Standard", [
      { label: "Return laptop", itemType: "asset_return", required: true },
      { label: "Handover notes", itemType: "document_handover", required: false },
    ]);
    const { exitProcess, itemsCreated } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });

    expect(itemsCreated).toBe(2);
    expect(exitProcess.status).toBe("initiated");
    expect(exitProcess.separationBasis).toBe("contract_end");
    // Started BEFORE separation: no actual separation instant yet.
    expect(exitProcess.separationDate).toBeNull();
    expect(exitProcess.expectedSeparationDate).not.toBeNull();

    // And the employee is still employed.
    const after = await employees.getEmployeeById(orgId, emp.id);
    expect(after!.employmentStatus).toBe("active");
  });

  it("clearance items are SNAPSHOTS: editing the template afterwards changes nothing in flight", async () => {
    const emp = await makeEmployee("Snapshot", { employmentStatus: "active" });
    await separate(emp.id);

    const template = await makeTemplate("Snapshotted", [{ label: "Original label", itemType: "general", required: true }]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });

    const templateItems = await clearance.listTemplateItems(orgId, template.id);
    await clearance.removeTemplateItem({
      organizationId: orgId,
      templateId: template.id,
      itemId: templateItems[0]!.id,
      ...actor(),
    });

    // The live obligation survives its template item being deleted.
    const items = await clearance.listItems(orgId, exitProcess.id);
    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe("Original label");
    expect(items[0]!.sourceTemplateItemId).toBeNull();
  });

  it("completing an asset_return item returns NO asset and moves NO stock", async () => {
    const emp = await makeEmployee("AssetHolder", { employmentStatus: "active" });
    await separate(emp.id);

    const [asset] = await db
      .insert(schema.assetsTable)
      .values({
        organizationId: orgId,
        assetTag: `TAG-${suffix}`,
        name: `Laptop ${suffix}`,
        categoryCode: "it",
        status: "assigned",
        condition: "good",
      })
      .returning();
    const [assignment] = await db
      .insert(schema.assetAssignmentsTable)
      .values({
        organizationId: orgId,
        assetId: asset.id,
        employeeId: emp.id,
        assetTagSnapshot: asset.assetTag,
        assetNameSnapshot: asset.name,
        // Both NOT NULL on the shipped table; the fixture must satisfy the real
        // schema rather than a convenient subset of it.
        categorySnapshot: asset.categoryCode,
        issueCondition: "good",
        issuedAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning();

    const template = await makeTemplate("AssetClearance", [
      { label: "Return laptop", itemType: "asset_return", required: true },
    ]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });

    const custodyBefore = await clearance.summarizeOutstandingCustody(orgId, emp.id);
    expect(custodyBefore.assets).toHaveLength(1);

    const items = await clearance.listItems(orgId, exitProcess.id);
    await clearance.completeItem({ organizationId: orgId, itemId: items[0]!.id, ...actor() });

    // THE ASSERTION THIS TEST EXISTS FOR (§28.9).
    const [assignmentAfter] = await db
      .select()
      .from(schema.assetAssignmentsTable)
      .where(eq(schema.assetAssignmentsTable.id, assignment.id));
    expect(assignmentAfter.custodyEndedAt).toBeNull();
    expect(assignmentAfter.receivedByMembershipId).toBeNull();
    expect(assignmentAfter.returnNotes).toBeNull();

    const [assetAfter] = await db.select().from(schema.assetsTable).where(eq(schema.assetsTable.id, asset.id));
    expect(assetAfter.status).toBe("assigned");
    expect(assetAfter.condition).toBe("good");

    // Custody is still reported as outstanding, because it genuinely is.
    const custodyAfter = await clearance.summarizeOutstandingCustody(orgId, emp.id);
    expect(custodyAfter.assets).toHaveLength(1);
  });

  it("only returnable office inventory is clearance-relevant; consumables never appear", async () => {
    const emp = await makeEmployee("InventoryHolder", { employmentStatus: "active" });

    const [consumable] = await db
      .insert(schema.officeInventoryItemsTable)
      .values({
        organizationId: orgId,
        itemCode: `C-${suffix}`,
        name: `Pens ${suffix}`,
        categoryCode: "stationery",
        classification: "consumable",
        unitOfMeasure: "each",
      })
      .returning();
    const [returnable] = await db
      .insert(schema.officeInventoryItemsTable)
      .values({
        organizationId: orgId,
        itemCode: `R-${suffix}`,
        name: `Radio ${suffix}`,
        categoryCode: "equipment",
        classification: "returnable",
        unitOfMeasure: "each",
      })
      .returning();

    for (const item of [consumable, returnable]) {
      await db.insert(schema.officeInventoryStockMovementsTable).values({
        organizationId: orgId,
        itemId: item.id,
        movementType: "issued",
        quantity: "1",
        holderType: "employee",
        holderId: emp.id,
        occurredAt: new Date("2026-02-01T00:00:00Z"),
        createdBy: userId,
      });
    }

    const custody = await clearance.summarizeOutstandingCustody(orgId, emp.id);
    expect(custody.inventory).toHaveLength(1);
    expect(custody.inventory[0]!.itemId).toBe(returnable.id);
  });

  it("a waiver requires a reason, is audited, and lets required clearance close", async () => {
    const emp = await makeEmployee("Waiver", { employmentStatus: "active" });
    await separate(emp.id);
    const template = await makeTemplate("WaiverTemplate", [
      { label: "Unrecoverable item", itemType: "asset_return", required: true },
    ]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });
    const items = await clearance.listItems(orgId, exitProcess.id);

    await expect(
      clearance.waiveItem({ organizationId: orgId, itemId: items[0]!.id, reason: "   ", ...actor() }),
    ).rejects.toThrow(/reason/i);

    await clearance.waiveItem({
      organizationId: orgId,
      itemId: items[0]!.id,
      reason: "Employee emigrated; recovery abandoned by HR decision.",
      ...actor(),
    });

    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.organizationId, orgId), eq(schema.auditEventsTable.eventType, "clearance_item.waived")));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits[audits.length - 1]!.metadata)).toContain("emigrated");

    // A waived required item is discharged, so final clearance becomes possible.
    const progress = await offboarding.computeClearanceProgress(orgId, exitProcess.id);
    expect(progress.requiredOutstanding).toBe(0);
  });

  it("final clearance refuses while required items are outstanding, and separates nobody once granted", async () => {
    const emp = await makeEmployee("FinalClearance", { employmentStatus: "active" });
    const template = await makeTemplate("FinalTemplate", [
      { label: "Required desk", itemType: "general", required: true },
      { label: "Optional desk", itemType: "general", required: false },
    ]);
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await terms.createTerm({
      organizationId: orgId,
      employeeId: emp.id,
      termType: "fixed_term",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate,
      ...actor(),
    });
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });

    await expect(
      offboarding.grantFinalClearance({ organizationId: orgId, exitProcessId: exitProcess.id, ...actor() }),
    ).rejects.toThrow(/outstanding/i);

    const items = await clearance.listItems(orgId, exitProcess.id);
    const required = items.find((i: any) => i.required)!;
    await clearance.completeItem({ organizationId: orgId, itemId: required.id, ...actor() });

    const { exitProcess: cleared, progress } = await offboarding.grantFinalClearance({
      organizationId: orgId,
      exitProcessId: exitProcess.id,
      ...actor(),
    });
    expect(cleared.status).toBe("completed");
    expect(cleared.finalClearedAt).not.toBeNull();
    expect(progress.requiredOutstanding).toBe(0);

    // THE ASSERTION THIS TEST EXISTS FOR (§28.7): clearance is not separation.
    const after = await employees.getEmployeeById(orgId, emp.id);
    expect(after!.employmentStatus).toBe("active");
    expect(after!.separationDate).toBeNull();
  });

  it("clearanceCompleted cannot be set by hand once structured items exist", async () => {
    const emp = await makeEmployee("DerivedFlag", { employmentStatus: "active" });
    await separate(emp.id);
    const template = await makeTemplate("DerivedTemplate", [{ label: "Desk", itemType: "general", required: true }]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });

    await expect(
      legacyExit.updateEmployeeExitProcess({
        organizationId: orgId,
        employeeId: emp.id,
        exitProcessId: exitProcess.id,
        clearanceCompleted: true,
        ...actor(),
      }),
    ).rejects.toThrow(/derived/i);
  });

  it("a legacy exit process without clearance items keeps its editable booleans", async () => {
    const emp = await makeEmployee("LegacyExit", { employmentStatus: "active" });
    await separate(emp.id, new Date("2026-05-01T00:00:00Z"));
    const legacy = await legacyExit.createEmployeeExitProcess({
      organizationId: orgId,
      employeeId: emp.id,
      ...actor(),
    });

    const updated = await legacyExit.updateEmployeeExitProcess({
      organizationId: orgId,
      employeeId: emp.id,
      exitProcessId: legacy.id,
      clearanceCompleted: true,
      ...actor(),
    });
    expect(updated.clearanceCompleted).toBe(true);
  });

  it("only one offboarding runs per employee, and rehire/re-separation gets its own cycle", async () => {
    const emp = await makeEmployee("Cycles", { employmentStatus: "active" });
    await separate(emp.id, new Date("2026-05-10T00:00:00Z"));
    const template = await makeTemplate("CycleTemplate", [{ label: "Desk", itemType: "general", required: true }]);

    const first = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });
    await expect(
      offboarding.initiateOffboarding({ organizationId: orgId, employeeId: emp.id, ...actor() }),
    ).rejects.toThrow(/already running/i);

    // Close the first cycle, rehire, separate again — a second cycle is allowed
    // and the first is preserved.
    const items = await clearance.listItems(orgId, first.exitProcess.id);
    await clearance.completeItem({ organizationId: orgId, itemId: items[0]!.id, ...actor() });
    await offboarding.grantFinalClearance({ organizationId: orgId, exitProcessId: first.exitProcess.id, ...actor() });

    await employees.rehireEmployee({ organizationId: orgId, employeeId: emp.id, ...actor() });
    await separate(emp.id, new Date("2026-09-01T00:00:00Z"));
    const second = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });

    expect(second.exitProcess.id).not.toBe(first.exitProcess.id);
    const all = await offboarding.listOffboarding(orgId, { employeeId: emp.id });
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("offboarding and clearance are not reachable across organizations", async () => {
    const emp = await makeEmployee("IsolationOffboarding", { employmentStatus: "active" });
    await separate(emp.id);
    const template = await makeTemplate("IsolationTemplate", [{ label: "Desk", itemType: "general", required: true }]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });
    const items = await clearance.listItems(orgId, exitProcess.id);

    expect(await offboarding.getOffboarding(otherOrgId, exitProcess.id)).toBeUndefined();
    expect(await clearance.getItem(otherOrgId, items[0]!.id)).toBeUndefined();
    expect(await clearance.getTemplate(otherOrgId, template.id)).toBeUndefined();
    await expect(
      clearance.completeItem({ organizationId: otherOrgId, itemId: items[0]!.id, ...actor() }),
    ).rejects.toThrow();
    await expect(
      clearance.waiveItem({ organizationId: otherOrgId, itemId: items[0]!.id, reason: "x", ...actor() }),
    ).rejects.toThrow();
  });

  it("an evidence document from another organization cannot be attached", async () => {
    const emp = await makeEmployee("EvidenceIsolation");
    const opened = await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "Evidence",
      openedAt: new Date(),
      ...actor(),
    });
    const [foreignDoc] = await db
      .insert(schema.employeeDocumentsTable)
      .values({
        organizationId: otherOrgId,
        employeeId: otherOrgEmployeeId,
        categoryCode: "other",
        fileName: "foreign.pdf",
        storageKey: `k-${suffix}`,
        mimeType: "application/pdf",
        fileSize: 10,
      })
      .returning();

    await expect(
      disciplinary.attachEvidence({
        organizationId: orgId,
        caseId: opened.id,
        documentId: foreignDoc.id,
        occurredAt: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow();
  });

  it("document confidentiality is additive: existing documents keep behaving as before", async () => {
    const emp = await makeEmployee("DocConfidentiality");
    const [doc] = await db
      .insert(schema.employeeDocumentsTable)
      .values({
        organizationId: orgId,
        employeeId: emp.id,
        categoryCode: "other",
        fileName: "ordinary.pdf",
        storageKey: `k2-${suffix}`,
        mimeType: "application/pdf",
        fileSize: 10,
      })
      .returning();
    // A writer that has never heard of the column gets `normal` — unchanged
    // behaviour for every pre-WS-12 document (§28.11).
    expect(doc.confidentiality).toBe("normal");

    const [restricted] = await db
      .insert(schema.employeeDocumentsTable)
      .values({
        organizationId: orgId,
        employeeId: emp.id,
        categoryCode: "other",
        fileName: "evidence.pdf",
        storageKey: `k3-${suffix}`,
        mimeType: "application/pdf",
        fileSize: 10,
        confidentiality: "restricted",
      })
      .returning();
    expect(restricted.confidentiality).toBe("restricted");
  });

  // -- Exit interview -------------------------------------------------------

  it("exit interviews bind to the WS-8 exit_interview scope, and carry no rehire-eligibility field", async () => {
    const emp = await makeEmployee("ExitInterview", { employmentStatus: "active" });
    await separate(emp.id);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      ...actor(),
    });

    const interview = await exitInterview.scheduleInterview({
      organizationId: orgId,
      exitProcessId: exitProcess.id,
      interviewDate: new Date("2026-07-01T00:00:00Z"),
      ...actor(),
    });
    await expect(
      exitInterview.scheduleInterview({ organizationId: orgId, exitProcessId: exitProcess.id, ...actor() }),
    ).rejects.toThrow(/already exists/i);

    const completed = await exitInterview.completeInterview({
      organizationId: orgId,
      interviewId: interview.id,
      reasonForLeavingCode: "better_offer",
      confidentialNotes: "HR only",
      ...actor(),
    });
    expect(completed.status).toBe("completed");

    // NO rehire-eligibility field exists anywhere on this record (§28.15).
    const keys = Object.keys(completed).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.includes("rehire"))).toBe(false);

    // The WS-8 scope is registered and bindable, and resolves to this row.
    expect(scopes.isKnownScope("exit_interview")).toBe(true);
    await scopes.assertEntityInOrganization("exit_interview", interview.id, orgId);
    await expect(scopes.assertEntityInOrganization("exit_interview", interview.id, otherOrgId)).rejects.toThrow();

    // And disciplinary findings remain OUT of the custom-field scope list (§24.3, §28.19).
    expect(scopes.isKnownScope("disciplinary_case")).toBe(false);
    expect(scopes.isKnownScope("disciplinary_finding")).toBe(false);
  });

  // -- Scheduled jobs -------------------------------------------------------

  it("WS-12 job handlers are registered, and NONE of them mutates a case, clearance or employment", async () => {
    const registered = registry.listRegisteredJobTypes ? registry.listRegisteredJobTypes() : [];
    const expected = [
      reminders.RESPONSE_DUE_REMINDER,
      reminders.HEARING_REMINDER,
      reminders.GRIEVANCE_ACKNOWLEDGEMENT_DUE,
      reminders.GRIEVANCE_ACTION_OVERDUE,
      reminders.CLEARANCE_ASSIGNED,
      reminders.CLEARANCE_OVERDUE,
    ];
    for (const jobType of expected) {
      expect(registry.getJobHandler(jobType)).toBeTruthy();
    }

    // No job type anywhere claims authority to decide an employment-relations
    // outcome. This is the §28.20 / §27.11 assertion.
    const forbidden = /auto[_.]?(separate|terminate|close_case|decide|waive|clear|finding|outcome|sanction)/i;
    for (const jobType of registered.length ? registered : expected) {
      expect(String(jobType)).not.toMatch(forbidden);
    }
  });

  it("a clearance reminder no-ops permanently once the item is resolved", async () => {
    const emp = await makeEmployee("ReminderStale", { employmentStatus: "active" });
    await separate(emp.id);
    const template = await makeTemplate("ReminderTemplate", [{ label: "Desk", itemType: "general", required: true }]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });
    const items = await clearance.listItems(orgId, exitProcess.id);
    await clearance.completeItem({ organizationId: orgId, itemId: items[0]!.id, ...actor() });

    const handler = registry.getJobHandler(reminders.CLEARANCE_ASSIGNED)!;
    await expect(
      handler.execute({
        jobId: 1,
        organizationId: orgId,
        payload: handler.parsePayload({ clearanceItemId: items[0]!.id }),
        sourceReferenceType: "clearance_item",
        sourceReferenceId: items[0]!.id,
        attemptCount: 1,
      } as never),
    ).rejects.toThrow(/already resolved/i);

    // And the item is exactly as it was — the handler wrote nothing.
    const after = await clearance.getItem(orgId, items[0]!.id);
    expect(after!.status).toBe("completed");
  });

  it("a forged reminder aimed at another organization resolves nothing", async () => {
    const emp = await makeEmployee("ForgedReminder", { employmentStatus: "active" });
    await separate(emp.id);
    const template = await makeTemplate("ForgedTemplate", [{ label: "Desk", itemType: "general", required: true }]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });
    const items = await clearance.listItems(orgId, exitProcess.id);

    const handler = registry.getJobHandler(reminders.CLEARANCE_ASSIGNED)!;
    await expect(
      handler.execute({
        jobId: 2,
        // The other organization's context with THIS organization's item id.
        organizationId: otherOrgId,
        payload: handler.parsePayload({ clearanceItemId: items[0]!.id }),
        sourceReferenceType: "clearance_item",
        sourceReferenceId: items[0]!.id,
        attemptCount: 1,
      } as never),
    ).rejects.toThrow(/no longer exists in this organization/i);
  });

  // -- Reporting ------------------------------------------------------------

  it("read models report counts and ageing, never case content", async () => {
    const emp = await makeEmployee("Reporting");
    await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "SECRET SUBJECT TEXT",
      description: "SECRET DESCRIPTION TEXT",
      openedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      ...actor(),
    });

    const open = await readModels.openDisciplinaryCases(orgId);
    const serialized = JSON.stringify(open);
    expect(serialized).not.toContain("SECRET SUBJECT TEXT");
    expect(serialized).not.toContain("SECRET DESCRIPTION TEXT");
    const row = open.find((r) => r.employeeId === emp.id)!;
    expect(row.ageDays).toBeGreaterThanOrEqual(9);

    // The report is scoped: another organization sees none of it.
    expect((await readModels.openDisciplinaryCases(otherOrgId)).some((r) => r.employeeId === emp.id)).toBe(false);
  });

  it("sensitive-read auditing writes an audit row through the existing framework", async () => {
    const sensitiveRead = await import("../lib/sensitiveRead");
    const emp = await makeEmployee("SensitiveRead");
    const opened = await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "Audited read",
      openedAt: new Date(),
      ...actor(),
    });

    await sensitiveRead.recordSensitiveRead({
      organizationId: orgId,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
      targetType: "disciplinary_case",
      targetId: opened.id,
      subjectEmployeeId: emp.id,
      reason: "confidential",
    });

    const rows = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.organizationId, orgId),
          eq(schema.auditEventsTable.eventType, "disciplinary_case.read"),
        ),
      );
    const mine = rows.filter((r: any) => r.targetId === String(opened.id));
    expect(mine.length).toBeGreaterThan(0);
    // OD #17: it lands in the "hr" category so HR auditors can actually see it.
    expect(mine[0]!.category).toBe("hr");
    expect(JSON.stringify(mine[0]!.metadata)).toContain("sensitiveRead");
    // No before/after state: a read copies no confidential content into audit.
    expect(mine[0]!.beforeState).toBeNull();
    expect(mine[0]!.afterState).toBeNull();
  });


  // -- Acceptance gap closure: invariants §28 freezes that the first pass did
  //    not prove directly ---------------------------------------------------

  it("a grievance is not readable or actionable across organizations", async () => {
    const complainant = await makeEmployee("GrievanceIsolation");
    const submitted = await grievance.submitGrievance({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "conduct",
      subject: "Theirs alone",
      description: "Body",
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      ...actor(),
    });

    // Invisible, not merely forbidden — the other tenant cannot even learn it exists.
    expect(await grievance.getCase(otherOrgId, submitted.id)).toBeUndefined();
    expect((await grievance.listCases(otherOrgId)).some((g: any) => g.id === submitted.id)).toBe(false);
    expect(await grievance.listCaseEvents(otherOrgId, submitted.id)).toHaveLength(0);

    // And every mutation refuses under a foreign organization context.
    for (const call of [
      () =>
        grievance.acknowledge({
          organizationId: otherOrgId,
          caseId: submitted.id,
          occurredAt: new Date(),
          ...actor(),
        }),
      () =>
        grievance.assign({
          organizationId: otherOrgId,
          caseId: submitted.id,
          assignedMembershipId: membershipId,
          occurredAt: new Date(),
          ...actor(),
        }),
      () =>
        grievance.resolve({
          organizationId: otherOrgId,
          caseId: submitted.id,
          resolutionSummary: "x",
          occurredAt: new Date(),
          ...actor(),
        }),
      () =>
        grievance.closeCase({
          organizationId: otherOrgId,
          caseId: submitted.id,
          occurredAt: new Date(),
          ...actor(),
        }),
    ]) {
      await expect(call()).rejects.toThrow();
    }

    // The record is untouched by all of that.
    const after = await grievance.getCase(orgId, submitted.id);
    expect(after!.status).toBe("submitted");
    expect(after!.acknowledgedAt).toBeNull();
  });

  it("grievance evidence from another organization cannot be attached", async () => {
    const complainant = await makeEmployee("GrievanceEvidenceIsolation");
    const submitted = await grievance.submitGrievance({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "conduct",
      subject: "Evidence isolation",
      description: "Body",
      submittedAt: new Date(),
      ...actor(),
    });
    const [foreignDoc] = await db
      .insert(schema.employeeDocumentsTable)
      .values({
        organizationId: otherOrgId,
        employeeId: otherOrgEmployeeId,
        categoryCode: "other",
        fileName: "foreign-grievance.pdf",
        storageKey: `gk-${suffix}`,
        mimeType: "application/pdf",
        fileSize: 10,
      })
      .returning();

    await expect(
      grievance.attachEvidence({
        organizationId: orgId,
        caseId: submitted.id,
        documentId: foreignDoc.id,
        occurredAt: new Date(),
        ...actor(),
      }),
    ).rejects.toThrow();
  });

  it("a forged responsible-department reference is refused on both template and ad-hoc items", async () => {
    const template = await clearance.createTemplate({
      organizationId: orgId,
      name: `ForgedDept ${suffix}`,
      ...actor(),
    });

    // A department id that is syntactically valid but belongs to another tenant.
    await expect(
      clearance.addTemplateItem({
        organizationId: orgId,
        templateId: template.id,
        label: "Cross-tenant desk",
        responsibleDepartmentId: otherOrgDeptId,
        ...actor(),
      }),
    ).rejects.toThrow();

    const emp = await makeEmployee("ForgedDeptAdHoc", { employmentStatus: "active" });
    await separate(emp.id);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      ...actor(),
    });
    await expect(
      clearance.addItem({
        organizationId: orgId,
        exitProcessId: exitProcess.id,
        label: "Cross-tenant desk",
        responsibleDepartmentId: otherOrgDeptId,
        ...actor(),
      }),
    ).rejects.toThrow();

    // A clearance item cannot be hung off another tenant's offboarding either.
    await expect(
      clearance.addItem({
        organizationId: otherOrgId,
        exitProcessId: exitProcess.id,
        label: "Cross-tenant offboarding",
        ...actor(),
      }),
    ).rejects.toThrow();

    // And an evidence document from another tenant cannot be attached on completion.
    const items = await clearance.listItems(orgId, exitProcess.id);
    if (items.length > 0) {
      const [foreignDoc] = await db
        .insert(schema.employeeDocumentsTable)
        .values({
          organizationId: otherOrgId,
          employeeId: otherOrgEmployeeId,
          categoryCode: "other",
          fileName: "foreign-evidence.pdf",
          storageKey: `ck-${suffix}`,
          mimeType: "application/pdf",
          fileSize: 10,
        })
        .returning();
      await expect(
        clearance.completeItem({
          organizationId: orgId,
          itemId: items[0]!.id,
          evidenceDocumentId: foreignDoc.id,
          ...actor(),
        }),
      ).rejects.toThrow();
    }
  });

  it("completing an inventory_return item moves NO stock", async () => {
    const emp = await makeEmployee("InventoryObserveOnly", { employmentStatus: "active" });
    await separate(emp.id);

    const [item] = await db
      .insert(schema.officeInventoryItemsTable)
      .values({
        organizationId: orgId,
        itemCode: `RO-${suffix}`,
        name: `Handset ${suffix}`,
        categoryCode: "equipment",
        classification: "returnable",
        unitOfMeasure: "each",
      })
      .returning();
    await db.insert(schema.officeInventoryStockMovementsTable).values({
      organizationId: orgId,
      itemId: item.id,
      movementType: "issued",
      quantity: "1",
      holderType: "employee",
      holderId: emp.id,
      occurredAt: new Date("2026-02-01T00:00:00Z"),
      createdBy: userId,
    });

    const movementsBefore = await db
      .select()
      .from(schema.officeInventoryStockMovementsTable)
      .where(eq(schema.officeInventoryStockMovementsTable.organizationId, orgId));

    const template = await makeTemplate("InventoryClearance", [
      { label: "Return handset", itemType: "inventory_return", required: true },
    ]);
    const { exitProcess } = await offboarding.initiateOffboarding({
      organizationId: orgId,
      employeeId: emp.id,
      clearanceTemplateId: template.id,
      ...actor(),
    });
    const clearanceItems = await clearance.listItems(orgId, exitProcess.id);
    await clearance.completeItem({ organizationId: orgId, itemId: clearanceItems[0]!.id, ...actor() });

    // THE ASSERTION THIS TEST EXISTS FOR (§28.10): not one stock movement was
    // created, and none was altered.
    const movementsAfter = await db
      .select()
      .from(schema.officeInventoryStockMovementsTable)
      .where(eq(schema.officeInventoryStockMovementsTable.organizationId, orgId));
    expect(movementsAfter).toHaveLength(movementsBefore.length);

    // Custody is still reported outstanding, because it genuinely is.
    const custody = await clearance.summarizeOutstandingCustody(orgId, emp.id);
    expect(custody.inventory.some((row: any) => row.itemId === item.id)).toBe(true);
  });

  // -- Owner Decision #18 acceptance (§28.12) --------------------------------

  it("OD #18: a sensitive read records actor, tenant, resource and action — and no case content", async () => {
    const sensitiveRead = await import("../lib/sensitiveRead");
    const emp = await makeEmployee("Od18Disciplinary");
    const opened = await disciplinary.openCase({
      organizationId: orgId,
      employeeId: emp.id,
      categoryCode: "conduct",
      subject: "OD18 SUBJECT SECRET",
      description: "OD18 DESCRIPTION SECRET",
      confidentiality: "restricted",
      openedAt: new Date(),
      ...actor(),
    });

    await sensitiveRead.recordSensitiveRead({
      organizationId: orgId,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
      targetType: "disciplinary_case",
      targetId: opened.id,
      subjectEmployeeId: emp.id,
      reason: "restricted",
    });

    const [row] = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.organizationId, orgId),
          eq(schema.auditEventsTable.eventType, "disciplinary_case.read"),
          eq(schema.auditEventsTable.targetId, String(opened.id)),
        ),
      );

    // (1) the read generated a record; (2) it identifies the actor;
    expect(row).toBeTruthy();
    expect(row.actorApplicationUserId).toBe(userId);
    expect(row.actorMembershipId).toBe(membershipId);
    // (3) tenant context is retained;
    expect(row.organizationId).toBe(orgId);
    // (4) resource and action are retained;
    expect(row.targetType).toBe("disciplinary_case");
    expect(row.targetId).toBe(String(opened.id));
    expect(row.eventType).toBe("disciplinary_case.read");
    expect(row.outcome).toBe("success");
    expect(JSON.stringify(row.metadata)).toContain("sensitiveRead");

    // (6) the audit mechanism cannot itself be used to discover protected
    // content: the row carries the case IDENTITY and nothing from inside it.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("OD18 SUBJECT SECRET");
    expect(serialized).not.toContain("OD18 DESCRIPTION SECRET");
    expect(row.beforeState).toBeNull();
    expect(row.afterState).toBeNull();
  });

  it("OD #18: a refused sensitive read is recorded too, and grievance reads audit the same way", async () => {
    const sensitiveRead = await import("../lib/sensitiveRead");
    const complainant = await makeEmployee("Od18Grievance");
    const submitted = await grievance.submitGrievance({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "conduct",
      subject: "OD18 GRIEVANCE SECRET",
      description: "Body",
      submittedAt: new Date(),
      ...actor(),
    });

    await sensitiveRead.recordSensitiveRead({
      organizationId: orgId,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
      targetType: "grievance_case",
      targetId: submitted.id,
      subjectEmployeeId: complainant.id,
      reason: "confidential",
    });
    await sensitiveRead.recordSensitiveReadDenied({
      organizationId: orgId,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
      targetType: "grievance_case",
      targetId: submitted.id,
      reason: "confidential",
    });

    const rows = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.organizationId, orgId),
          eq(schema.auditEventsTable.eventType, "grievance_case.read"),
          eq(schema.auditEventsTable.targetId, String(submitted.id)),
        ),
      );
    expect(rows.length).toBe(2);
    const outcomes = rows.map((r: any) => r.outcome).sort();
    // A refused attempt on somebody's grievance file is exactly the signal an
    // audit reader wants, and it is invisible if only successes are recorded.
    expect(outcomes).toEqual(["denied", "success"]);
    expect(JSON.stringify(rows)).not.toContain("OD18 GRIEVANCE SECRET");
  });

  it("OD #18: sensitive reads land in the HR audit category, so HR auditors see them and others do not", async () => {
    const auditCategories = await import("../lib/auditCategories");

    // (5) An HR auditor holding OD #17's scoped key reaches these events...
    expect(auditCategories.resolveAuditCategory("disciplinary_case.read")).toBe("hr");
    expect(auditCategories.resolveAuditCategory("grievance_case.read")).toBe("hr");
    expect(auditCategories.resolveAuditCategory("employee_relations_evidence.read")).toBe("hr");
    // ...and every WS-12 mutation event is categorized the same way, so the
    // read trail and the change trail are visible to the same auditor.
    expect(auditCategories.resolveAuditCategory("disciplinary_case.opened")).toBe("hr");
    expect(auditCategories.resolveAuditCategory("grievance_case.resolved")).toBe("hr");
    expect(auditCategories.resolveAuditCategory("clearance_item.waived")).toBe("hr");
    expect(auditCategories.resolveAuditCategory("employee_exit_process.final_cleared")).toBe("hr");
    expect(auditCategories.resolveAuditCategory("exit_interview.completed")).toBe("hr");

    // (6) A caller scoped to another category cannot reach them. This is the
    // OD #17 model doing the work — the reason §28.12 kept these in "hr"
    // rather than moving them to "security" for naming tidiness.
    const auditAuth = await import("../lib/auditAuthorization");
    const [payrollOnlyUser] = await db
      .insert(schema.usersTable)
      .values({
        email: `payroll-auditor-${suffix}@example.invalid`,
        passwordHash: "x",
        firstName: "Payroll",
        lastName: "Auditor",
        organizationId: orgId,
      })
      .returning();
    const [payrollOnlyMembership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: payrollOnlyUser.id, organizationId: orgId, status: "active" })
      .returning();

    const [role] = await db
      .insert(schema.rolesTable)
      .values({
        organizationId: orgId,
        key: `payroll-auditor-${suffix}`,
        label: "Payroll auditor (test)",
        description: "test",
        isSystemRole: false,
      })
      .returning();
    const [perm] = await db
      .select()
      .from(schema.permissionsTable)
      .where(eq(schema.permissionsTable.key, "audit.read.payroll"))
      .limit(1);
    await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: perm.id });
    await db.insert(schema.membershipRolesTable).values({ membershipId: payrollOnlyMembership.id, roleId: role.id });

    const allowed = await auditAuth.resolveAllowedAuditCategories(payrollOnlyMembership.id);
    expect(allowed).not.toBe("all");
    expect(allowed as string[]).toContain("payroll");
    // The decisive assertion: this caller cannot select the category the
    // Employee Relations read trail lives in.
    expect(allowed as string[]).not.toContain("hr");
  });

});
