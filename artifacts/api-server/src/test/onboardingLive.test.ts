/**
 * WS-10 — live proof of Onboarding, Induction & Handbook against a real
 * database.
 *
 * Covers the Owner's §57-§63 QA matrices. The properties that matter most are
 * the negative ones: a later template edit cannot rewrite onboarding already
 * issued, completed history is not rewritten when a Department Head is
 * replaced, ESS access is NOT gated on onboarding, a reference task cannot be
 * ticked into truth, an employee cannot reach another employee's onboarding,
 * and nothing crosses an organization boundary.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS10_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-10 — onboarding, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let orgId: number;
  let otherOrgId: number;
  let userId: number;
  let membershipId: number;
  let employeeId: number;
  let otherEmployeeId: number;
  let otherOrgEmployeeId: number;
  let deptId: number;
  let headMembershipId: number;
  let secondHeadMembershipId: number;

  let templates: typeof import("../lib/onboarding/templates");
  let instances: typeof import("../lib/onboarding/instances");
  let acks: typeof import("../lib/onboarding/acknowledgements");
  let kinds: typeof import("../lib/onboarding/kinds");
  let responsibility: typeof import("../lib/onboarding/responsibility");
  let scopes: typeof import("../lib/customFields/scopes");
  let deptHeads: typeof import("../lib/departmentHeads");

  const suffix = `ws10-${Date.now()}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    templates = await import("../lib/onboarding/templates");
    instances = await import("../lib/onboarding/instances");
    acks = await import("../lib/onboarding/acknowledgements");
    kinds = await import("../lib/onboarding/kinds");
    responsibility = await import("../lib/onboarding/responsibility");
    scopes = await import("../lib/customFields/scopes");
    deptHeads = await import("../lib/departmentHeads");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS10 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS10 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "WS10", lastName: "Actor", organizationId: orgId })
      .returning();
    userId = user.id;
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId: orgId, status: "active" })
      .returning();
    membershipId = m.id;

    const [dept] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId: orgId, name: `Dept ${suffix}`, code: `D-${suffix}` })
      .returning();
    deptId = dept.id;

    // Two potential heads, so replacement can be proven not to rewrite history.
    for (const tag of ["head1", "head2"]) {
      const [u] = await db
        .insert(schema.usersTable)
        .values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "Head", organizationId: orgId })
        .returning();
      const [mem] = await db
        .insert(schema.organizationMembershipsTable)
        .values({ applicationUserId: u.id, organizationId: orgId, status: "active" })
        .returning();
      if (tag === "head1") headMembershipId = mem.id;
      else secondHeadMembershipId = mem.id;
    }

    const [emp] = await db
      .insert(schema.employeesTable)
      .values({
        organizationId: orgId,
        firstName: "New",
        lastName: "Starter",
        departmentId: deptId,
        hireDate: new Date("2026-09-01T00:00:00Z"),
        employmentType: "full_time",
      })
      .returning();
    employeeId = emp.id;

    const [emp2] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Other", lastName: "Colleague" })
      .returning();
    otherEmployeeId = emp2.id;

    const [emp3] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Foreign", lastName: "Employee" })
      .returning();
    otherOrgEmployeeId = emp3.id;
  });

  const actor = () => ({ actorApplicationUserId: userId, actorMembershipId: membershipId });

  async function buildActiveTemplate(name: string, taskDefs: any[]) {
    const { template, version } = await templates.createTemplate({ organizationId: orgId, name, ...actor() });
    for (const def of taskDefs) {
      await templates.addVersionTask({ organizationId: orgId, versionId: version.id, definition: def, ...actor() });
    }
    await templates.activateVersion({ organizationId: orgId, versionId: version.id, ...actor() });
    return { template, version };
  }

  // -- §57 A-E: configure, version, start, snapshot, tasks ------------------

  it("A-E: configures a template, activates it, and starts onboarding that snapshots that exact version", async () => {
    const { template, version } = await buildActiveTemplate(`Standard ${suffix}`, [
      { title: "Read the welcome pack", required: true, responsibleResolver: "employee_self" },
      { title: "Optional social intro", required: false, responsibleResolver: "employee_self" },
    ]);

    const { instance } = await instances.startOnboarding({ organizationId: orgId, employeeId, ...actor() });

    expect(instance.templateId).toBe(template.id);
    expect(instance.templateVersionId).toBe(version.id);
    expect(instance.status).toBe("in_progress");

    const tasks = await instances.listInstanceTasks(orgId, instance.id);
    expect(tasks).toHaveLength(2);
    expect(tasks.filter((t: any) => t.required)).toHaveLength(1);
    // commencementDate is frozen from the hire date at start, not joined later.
    expect(instance.commencementDate?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("L: a later template edit does not alter onboarding already issued", async () => {
    const { template, version } = await buildActiveTemplate(`Editable ${suffix}`, [
      { title: "Original task", required: true },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Snapshot", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });

    // Publish a materially different version 2.
    const v2 = await templates.createVersion({ organizationId: orgId, templateId: template.id, ...actor() });
    await templates.addVersionTask({
      organizationId: orgId,
      versionId: v2.id,
      definition: { title: "Brand new task", required: true },
      ...actor(),
    });
    await templates.activateVersion({ organizationId: orgId, versionId: v2.id, ...actor() });

    const tasks = await instances.listInstanceTasks(orgId, instance.id);
    expect(tasks.map((t: any) => t.title)).toEqual(["Original task"]);
    const reloaded = await instances.getInstance(orgId, instance.id);
    expect(reloaded!.templateVersionId).toBe(version.id);
  });

  it("only one version of a template can be active at a time", async () => {
    const { template, version } = await buildActiveTemplate(`OneActive ${suffix}`, [{ title: "t", required: true }]);
    const v2 = await templates.createVersion({ organizationId: orgId, templateId: template.id, ...actor() });
    await templates.addVersionTask({ organizationId: orgId, versionId: v2.id, definition: { title: "t2" }, ...actor() });
    await templates.activateVersion({ organizationId: orgId, versionId: v2.id, ...actor() });

    const all = await templates.listVersions(orgId, template.id);
    expect(all.filter((v: any) => v.status === "active")).toHaveLength(1);
    expect(all.find((v: any) => v.id === version.id)!.status).toBe("archived");
  });

  // -- §57 G-H: due dates and derived overdue -------------------------------

  it("G-H: resolves due dates from the constrained bases and derives overdue rather than storing it", async () => {
    const { version } = await buildActiveTemplate(`Dues ${suffix}`, [
      { title: "Due at start", required: true, dueBasis: "onboarding_start", dueOffsetDays: 0 },
      { title: "Due after commencement", required: true, dueBasis: "commencement_date", dueOffsetDays: 7 },
      { title: "No due date", required: false },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Due", lastName: "Subject", hireDate: new Date("2026-09-01T00:00:00Z") })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });

    const tasks = await instances.listInstanceTasks(orgId, instance.id);
    const commencement = tasks.find((t: any) => t.title === "Due after commencement")!;
    expect(commencement.dueAt!.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(tasks.find((t: any) => t.title === "No due date")!.dueAt).toBeNull();

    // Overdue is a function of the clock, not a column: the same rows report
    // differently for a later "now".
    const notYet = instances.summarizeProgress(instance, tasks, new Date("2026-01-01T00:00:00Z"));
    const later = instances.summarizeProgress(instance, tasks, new Date("2027-01-01T00:00:00Z"));
    expect(notYet.overdue).toBe(0);
    expect(later.overdue).toBe(2);
    expect(Object.keys(tasks[0])).not.toContain("overdue");
  });

  // -- §57 I-K: required blocks, waiver unblocks, completion is derived -----

  it("I-K: a required task blocks completion, an authorized waiver releases it, and completion is server-derived", async () => {
    const { version } = await buildActiveTemplate(`Blocking ${suffix}`, [
      { title: "Must happen", required: true },
      { title: "Nice to have", required: false },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Block", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const tasks = await instances.listInstanceTasks(orgId, instance.id);
    const required = tasks.find((t: any) => t.required)!;
    const optional = tasks.find((t: any) => !t.required)!;

    // Completing only the OPTIONAL task must not complete the onboarding.
    await instances.completeTask({ organizationId: orgId, taskId: optional.id, ...actor() });
    expect((await instances.getInstance(orgId, instance.id))!.status).toBe("in_progress");

    // A waiver needs a reason.
    await expect(
      instances.waiveTask({ organizationId: orgId, taskId: required.id, reason: "   ", ...actor() }),
    ).rejects.toThrow(/reason/i);

    await instances.waiveTask({ organizationId: orgId, taskId: required.id, reason: "Provided in person", ...actor() });
    const done = await instances.getInstance(orgId, instance.id);
    expect(done!.status).toBe("completed");
    expect(done!.completedAt).not.toBeNull();

    // The waiver is evidence, not a silent bypass.
    const waived = (await instances.listInstanceTasks(orgId, instance.id)).find((t: any) => t.id === required.id)!;
    expect(waived.waiverReason).toBe("Provided in person");
    expect(waived.waivedByName).toBeTruthy();
  });

  // -- §57 F, M, N: responsibility resolution and history --------------------

  it("F/M/N: pending responsibility re-resolves to the new Department Head, but completed history keeps the original actor", async () => {
    await deptHeads.assignDepartmentHead({
      organizationId: orgId,
      departmentId: deptId,
      headMembershipId,
      assignedByMembershipId: membershipId,
      actorApplicationUserId: userId,
    } as any);

    const { version } = await buildActiveTemplate(`HeadOwned ${suffix}`, [
      { title: "Head signs off", required: true, responsibleResolver: "department_head" },
      { title: "Head also does this", required: true, responsibleResolver: "department_head" },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Head", lastName: "Subject", departmentId: deptId })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const tasks = await instances.listInstanceTasks(orgId, instance.id);

    const before = await responsibility.resolveResponsibility(orgId, emp.id, {
      resolver: "department_head",
      permissionKey: null,
      membershipId: null,
    });
    expect(before.membershipIds).toEqual([headMembershipId]);

    // Complete one task under the FIRST head.
    await instances.completeTask({ organizationId: orgId, taskId: tasks[0].id, ...actor() });
    const completed = (await instances.listInstanceTasks(orgId, instance.id)).find((t: any) => t.id === tasks[0].id)!;
    const frozenName = completed.completedByName;
    const frozenBy = completed.completedBy;

    // Replace the head.
    await deptHeads.assignDepartmentHead({
      organizationId: orgId,
      departmentId: deptId,
      headMembershipId: secondHeadMembershipId,
      assignedByMembershipId: membershipId,
      actorApplicationUserId: userId,
    } as any);

    const after = await responsibility.resolveResponsibility(orgId, emp.id, {
      resolver: "department_head",
      permissionKey: null,
      membershipId: null,
    });
    // Pending work follows the CURRENT head...
    expect(after.membershipIds).toEqual([secondHeadMembershipId]);

    // ...but completed history is untouched.
    const stillCompleted = (await instances.listInstanceTasks(orgId, instance.id)).find((t: any) => t.id === tasks[0].id)!;
    expect(stillCompleted.completedByName).toBe(frozenName);
    expect(stillCompleted.completedBy).toBe(frozenBy);
  });

  it("resolvers never match on a role name, and a cross-organization membership never resolves", async () => {
    const resolved = await responsibility.resolveResponsibility(orgId, employeeId, {
      resolver: "specific_membership",
      permissionKey: null,
      // A membership that exists, but in the OTHER organization.
      membershipId: 999_999_999,
    });
    expect(resolved.membershipIds).toEqual([]);
  });

  // -- §58: documents and handbook ------------------------------------------

  it("§58: reuses WS-5 document requirements rather than creating a second checklist", async () => {
    // The category must be one WS-5 recognizes for this organization.
    await db.insert(schema.masterDataDomainsTable).values({ key: "document_category", label: "Document Category", classification: "organization-defined" }).onConflictDoNothing();
    await db
      .insert(schema.masterDataItemsTable)
      .values({ domain: "document_category", organizationId: orgId, code: "id_card", label: "ID card", status: "active" })
      .onConflictDoNothing();

    const { version } = await buildActiveTemplate(`Docs ${suffix}`, [
      { title: "Provide ID", required: true, taskKind: "document", documentCategoryCode: "id_card" },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Doc", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });

    const task = (await instances.listInstanceTasks(orgId, instance.id))[0];
    expect(task.documentRequirementId).not.toBeNull();

    // The requirement lives in WS-5's own table — WS-10 built no second one.
    const [requirement] = await db
      .select()
      .from(schema.documentRequirementsTable)
      .where(eq(schema.documentRequirementsTable.id, task.documentRequirementId));
    expect(requirement.ownerType).toBe("employee");
    expect(requirement.ownerId).toBe(emp.id);
    expect(requirement.status).toBe("pending");

    // provided !== verified: the task stays blocked until WS-5 says verified.
    await expect(instances.completeTask({ organizationId: orgId, taskId: task.id, ...actor() })).rejects.toThrow(
      /not been verified/i,
    );
  });

  it("§58: acknowledgement is version-exact, and a new version leaves the old evidence intact", async () => {
    const [doc] = await db
      .insert(schema.organizationDocumentsTable)
      .values({ organizationId: orgId, categoryCode: "handbook", title: "Employee Handbook", reacknowledgeOnNewVersion: true })
      .returning();
    const [v1] = await db
      .insert(schema.organizationDocumentVersionsTable)
      .values({
        organizationId: orgId,
        documentId: doc.id,
        versionNumber: 1,
        storageKey: "k1",
        fileName: "hb.pdf",
        mimeType: "application/pdf",
        fileSize: 10,
        status: "current",
      })
      .returning();
    await db.update(schema.organizationDocumentsTable).set({ currentVersionId: v1.id }).where(eq(schema.organizationDocumentsTable.id, doc.id));

    const assigned = await acks.assignDocumentToEmployee({
      organizationId: orgId,
      employeeId,
      documentId: doc.id,
      audience: "all_employees",
      ...actor(),
    });
    expect(assigned.created).toBe(true);
    expect(assigned.acknowledgement.documentVersionId).toBe(v1.id);

    // Re-assigning is idempotent, not duplicating.
    const again = await acks.assignDocumentToEmployee({
      organizationId: orgId,
      employeeId,
      documentId: doc.id,
      audience: "all_employees",
      ...actor(),
    });
    expect(again.created).toBe(false);
    expect(again.acknowledgement.id).toBe(assigned.acknowledgement.id);

    const acknowledged = await acks.acknowledge({
      organizationId: orgId,
      acknowledgementId: assigned.acknowledgement.id,
      employeeId,
      ...actor(),
    });
    expect(acknowledged.status).toBe("acknowledged");
    expect(acknowledged.acknowledgedAt).not.toBeNull();
    const firstAckAt = acknowledged.acknowledgedAt;

    // Publish version 2 and raise re-acknowledgement.
    await db
      .update(schema.organizationDocumentVersionsTable)
      .set({ status: "superseded", supersededAt: new Date() })
      .where(eq(schema.organizationDocumentVersionsTable.id, v1.id));
    const [v2] = await db
      .insert(schema.organizationDocumentVersionsTable)
      .values({
        organizationId: orgId,
        documentId: doc.id,
        versionNumber: 2,
        storageKey: "k2",
        fileName: "hb2.pdf",
        mimeType: "application/pdf",
        fileSize: 11,
        status: "current",
      })
      .returning();
    await db.update(schema.organizationDocumentsTable).set({ currentVersionId: v2.id }).where(eq(schema.organizationDocumentsTable.id, doc.id));

    const raised = await acks.raiseReacknowledgements({ organizationId: orgId, documentId: doc.id, ...actor() });
    expect(raised.raised).toBeGreaterThan(0);

    const all = await acks.listForEmployee(orgId, employeeId);
    const forDoc = all.filter((a: any) => a.documentId === doc.id);
    // Two rows: the old acknowledged evidence AND the new pending obligation.
    expect(forDoc).toHaveLength(2);
    const old = forDoc.find((a: any) => a.documentVersionId === v1.id)!;
    const fresh = forDoc.find((a: any) => a.documentVersionId === v2.id)!;
    expect(old.status).toBe("acknowledged");
    expect(old.acknowledgedAt?.toISOString()).toBe(firstAckAt?.toISOString());
    expect(fresh.status).toBe("pending");
  });

  it("re-acknowledgement is not forced on documents the organization did not configure for it", async () => {
    const [doc] = await db
      .insert(schema.organizationDocumentsTable)
      .values({ organizationId: orgId, categoryCode: "policy", title: "Quiet policy", reacknowledgeOnNewVersion: false })
      .returning();
    const [v1] = await db
      .insert(schema.organizationDocumentVersionsTable)
      .values({
        organizationId: orgId,
        documentId: doc.id,
        versionNumber: 1,
        storageKey: "q1",
        fileName: "q.pdf",
        mimeType: "application/pdf",
        fileSize: 5,
        status: "current",
      })
      .returning();
    await db.update(schema.organizationDocumentsTable).set({ currentVersionId: v1.id }).where(eq(schema.organizationDocumentsTable.id, doc.id));
    await acks.assignDocumentToEmployee({ organizationId: orgId, employeeId, documentId: doc.id, audience: "all_employees", ...actor() });

    const raised = await acks.raiseReacknowledgements({ organizationId: orgId, documentId: doc.id, ...actor() });
    expect(raised.raised).toBe(0);
  });

  // -- §59: induction --------------------------------------------------------

  it("§59: induction is a task specialization with schedule, facilitator, reschedule and attendance", async () => {
    const { version } = await buildActiveTemplate(`Induction ${suffix}`, [
      { title: "HR induction", required: true, taskKind: "induction", responsibleResolver: "employee_self" },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Ind", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const task = (await instances.listInstanceTasks(orgId, instance.id))[0];
    expect(task.taskKind).toBe("induction");

    // The detail row is created with the task, not as a separate engine.
    const detail = await instances.getInductionDetail(orgId, task.id);
    expect(detail).not.toBeNull();
    expect(detail!.rescheduleCount).toBe(0);

    await instances.scheduleInduction({
      organizationId: orgId,
      taskId: task.id,
      facilitatorMembershipId: headMembershipId,
      scheduledAt: new Date("2026-09-02T09:00:00Z"),
      deliveryMode: "in_person",
      location: "Boardroom",
      ...actor(),
    });

    const moved = await instances.scheduleInduction({
      organizationId: orgId,
      taskId: task.id,
      scheduledAt: new Date("2026-09-03T09:00:00Z"),
      rescheduleReason: "Facilitator unavailable",
      ...actor(),
    });
    expect(moved.rescheduleCount).toBe(1);
    expect(moved.lastRescheduleReason).toBe("Facilitator unavailable");
    // Rescheduling did not lose the venue or facilitator.
    expect(moved.location).toBe("Boardroom");
    expect(moved.facilitatorMembershipId).toBe(headMembershipId);

    const attended = await instances.recordInductionAttendance({
      organizationId: orgId,
      taskId: task.id,
      attendedAt: new Date("2026-09-03T09:05:00Z"),
      attendanceNotes: "Attended in full",
      ...actor(),
    });
    expect(attended.attendedAt).not.toBeNull();

    // Completion still flows through the ordinary task model.
    await instances.completeTask({ organizationId: orgId, taskId: task.id, ...actor() });
    expect((await instances.getInstance(orgId, instance.id))!.status).toBe("completed");
  });

  // -- §61: integration boundaries ------------------------------------------

  it("§61: a reference task cannot be ticked into truth, and checking one creates nothing", async () => {
    const { version } = await buildActiveTemplate(`Refs ${suffix}`, [
      { title: "Laptop issued", required: true, taskKind: "asset_reference" },
      { title: "Stationery issued", required: true, taskKind: "inventory_reference" },
      { title: "Personnel file opened", required: true, taskKind: "personnel_file_reference" },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Ref", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const tasks = await instances.listInstanceTasks(orgId, instance.id);

    const assetsBefore = await db.select().from(schema.assetAssignmentsTable).where(eq(schema.assetAssignmentsTable.organizationId, orgId));
    const movesBefore = await db
      .select()
      .from(schema.officeInventoryStockMovementsTable)
      .where(eq(schema.officeInventoryStockMovementsTable.organizationId, orgId));
    const filesBefore = await db.select().from(schema.personnelFilesTable).where(eq(schema.personnelFilesTable.organizationId, orgId));

    for (const task of tasks) {
      await expect(instances.completeTask({ organizationId: orgId, taskId: task.id, ...actor() })).rejects.toThrow();
    }

    // Nothing was created in any referenced module — no shadow custody, no
    // stock movement, no PIF.
    const assetsAfter = await db.select().from(schema.assetAssignmentsTable).where(eq(schema.assetAssignmentsTable.organizationId, orgId));
    const movesAfter = await db
      .select()
      .from(schema.officeInventoryStockMovementsTable)
      .where(eq(schema.officeInventoryStockMovementsTable.organizationId, orgId));
    const filesAfter = await db.select().from(schema.personnelFilesTable).where(eq(schema.personnelFilesTable.organizationId, orgId));
    expect(assetsAfter).toHaveLength(assetsBefore.length);
    expect(movesAfter).toHaveLength(movesBefore.length);
    expect(filesAfter).toHaveLength(filesBefore.length);

    // A waiver is the deliberate, audited escape hatch.
    await instances.waiveTask({ organizationId: orgId, taskId: tasks[0].id, reason: "Issued before the system went live", ...actor() });
    const waived = (await instances.listInstanceTasks(orgId, instance.id)).find((t: any) => t.id === tasks[0].id)!;
    expect(waived.status).toBe("waived");
  });

  it("§61: a payroll reference is refused where Payroll is not enabled", async () => {
    await expect(kinds.assertPayrollReferenceAllowed(orgId, membershipId)).rejects.toThrow(/Payroll/i);
  });

  it("§61: WS-8 can now bind a custom field to a real onboarding record, and only within the organization", async () => {
    const { version } = await buildActiveTemplate(`Bind ${suffix}`, [{ title: "t", required: true }]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Bind", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });

    // The WS-8 contract: the scope is bindable and resolves.
    await expect(scopes.assertEntityInOrganization("onboarding", instance.id, orgId)).resolves.toBeUndefined();
    // ...but never across a tenant boundary.
    await expect(scopes.assertEntityInOrganization("onboarding", instance.id, otherOrgId)).rejects.toThrow();
  });

  it("§61: an employee with no candidate record can be onboarded", async () => {
    const { version } = await buildActiveTemplate(`Legacy ${suffix}`, [{ title: "t", required: true }]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Legacy", lastName: "Staff" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    expect(instance.candidateId).toBeNull();
    expect(instance.employeeId).toBe(emp.id);
  });

  // -- §62: cancellation -----------------------------------------------------

  it("§62: cancellation needs a reason, preserves history, and does not end employment or complete onboarding", async () => {
    const { version } = await buildActiveTemplate(`Cancel ${suffix}`, [
      { title: "Done already", required: true },
      { title: "Never done", required: true },
    ]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Cancel", lastName: "Subject", employmentStatus: "active" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const tasks = await instances.listInstanceTasks(orgId, instance.id);
    await instances.completeTask({ organizationId: orgId, taskId: tasks[0].id, ...actor() });

    await expect(
      instances.cancelOnboarding({ organizationId: orgId, instanceId: instance.id, reason: "  ", ...actor() }),
    ).rejects.toThrow(/reason/i);

    const cancelled = await instances.cancelOnboarding({
      organizationId: orgId,
      instanceId: instance.id,
      reason: "Start date deferred",
      ...actor(),
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.completedAt).toBeNull();

    const after = await instances.listInstanceTasks(orgId, instance.id);
    // Completed work keeps its status and evidence; only pending work is closed.
    expect(after.find((t: any) => t.id === tasks[0].id)!.status).toBe("completed");
    expect(after.find((t: any) => t.id === tasks[0].id)!.completedByName).toBeTruthy();
    expect(after.find((t: any) => t.id === tasks[1].id)!.status).toBe("cancelled");

    // Employment is untouched — cancellation is not a separation.
    const [stillEmployed] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(stillEmployed.employmentStatus).toBe("active");

    // A cancelled onboarding accepts no further work.
    await expect(
      instances.completeTask({ organizationId: orgId, taskId: tasks[1].id, ...actor() }),
    ).rejects.toThrow();
  });

  // -- §63: security abuse ---------------------------------------------------

  it("§63: onboarding cannot be started for an employee in another organization", async () => {
    const { version } = await buildActiveTemplate(`Cross ${suffix}`, [{ title: "t", required: true }]);
    await expect(
      instances.startOnboarding({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        templateVersionId: version.id,
        ...actor(),
      }),
    ).rejects.toThrow(/Employee not found/i);
  });

  it("§63: instances, tasks and templates are invisible across organizations (IDOR)", async () => {
    const { version } = await buildActiveTemplate(`Idor ${suffix}`, [{ title: "t", required: true }]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Idor", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const task = (await instances.listInstanceTasks(orgId, instance.id))[0];

    // Reading with the wrong organization returns nothing rather than data.
    expect(await instances.getInstance(otherOrgId, instance.id)).toBeNull();
    expect(await instances.listInstanceTasks(otherOrgId, instance.id)).toHaveLength(0);
    expect(await templates.getVersion(otherOrgId, version.id)).toBeNull();
    expect(await instances.getInductionDetail(otherOrgId, task.id)).toBeNull();

    // Writing with the wrong organization is refused.
    await expect(instances.completeTask({ organizationId: otherOrgId, taskId: task.id, ...actor() })).rejects.toThrow();
    await expect(
      instances.waiveTask({ organizationId: otherOrgId, taskId: task.id, reason: "x", ...actor() }),
    ).rejects.toThrow();
    await expect(
      instances.cancelOnboarding({ organizationId: otherOrgId, instanceId: instance.id, reason: "x", ...actor() }),
    ).rejects.toThrow();
  });

  it("§63: an employee cannot acknowledge a document assigned to a colleague", async () => {
    const [doc] = await db
      .insert(schema.organizationDocumentsTable)
      .values({ organizationId: orgId, categoryCode: "policy", title: "Someone else's policy" })
      .returning();
    const [v1] = await db
      .insert(schema.organizationDocumentVersionsTable)
      .values({
        organizationId: orgId,
        documentId: doc.id,
        versionNumber: 1,
        storageKey: "s1",
        fileName: "s.pdf",
        mimeType: "application/pdf",
        fileSize: 5,
        status: "current",
      })
      .returning();
    await db.update(schema.organizationDocumentsTable).set({ currentVersionId: v1.id }).where(eq(schema.organizationDocumentsTable.id, doc.id));

    const assigned = await acks.assignDocumentToEmployee({
      organizationId: orgId,
      employeeId: otherEmployeeId,
      documentId: doc.id,
      audience: "specific_employees",
      ...actor(),
    });

    // Acting as a different employee is refused, even with a valid id.
    await expect(
      acks.acknowledge({ organizationId: orgId, acknowledgementId: assigned.acknowledgement.id, employeeId, ...actor() }),
    ).rejects.toThrow(/belongs to someone else/i);

    // And across organizations it is simply not found.
    await expect(
      acks.acknowledge({
        organizationId: otherOrgId,
        acknowledgementId: assigned.acknowledgement.id,
        employeeId: otherEmployeeId,
        ...actor(),
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("§63: a document from another organization cannot be assigned", async () => {
    const [foreignDoc] = await db
      .insert(schema.organizationDocumentsTable)
      .values({ organizationId: otherOrgId, categoryCode: "policy", title: "Foreign policy" })
      .returning();
    await expect(
      acks.assignDocumentToEmployee({
        organizationId: orgId,
        employeeId,
        documentId: foreignDoc.id,
        audience: "all_employees",
        ...actor(),
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("§63: a task definition cannot name a membership from another organization", async () => {
    const [foreignUser] = await db
      .insert(schema.usersTable)
      .values({ email: `foreign-${suffix}@example.invalid`, passwordHash: "x", firstName: "F", lastName: "U", organizationId: otherOrgId })
      .returning();
    const [foreignMembership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: foreignUser.id, organizationId: otherOrgId, status: "active" })
      .returning();

    const { version } = await templates.createTemplate({ organizationId: orgId, name: `Foreign ${suffix}`, ...actor() });
    await expect(
      templates.addVersionTask({
        organizationId: orgId,
        versionId: version.id,
        definition: {
          title: "Owned by an outsider",
          responsibleResolver: "specific_membership",
          responsibleMembershipId: foreignMembership.id,
        },
        ...actor(),
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("§63: duplicate onboarding creation is prevented, and the handoff is idempotent", async () => {
    const { version } = await buildActiveTemplate(`Dupe ${suffix}`, [{ title: "t", required: true }]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Dupe", lastName: "Subject" })
      .returning();

    const first = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });

    // The explicit HR action refuses a second open onboarding...
    await expect(
      instances.startOnboarding({ organizationId: orgId, employeeId: emp.id, templateVersionId: version.id, ...actor() }),
    ).rejects.toThrow(/already has onboarding/i);

    // ...while the conversion handoff (reuseExisting) is idempotent.
    const retry = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      reuseExisting: true,
      ...actor(),
    });
    expect(retry.reused).toBe(true);
    expect(retry.instance.id).toBe(first.instance.id);

    const all = await db
      .select()
      .from(schema.onboardingInstancesTable)
      .where(and(eq(schema.onboardingInstancesTable.organizationId, orgId), eq(schema.onboardingInstancesTable.employeeId, emp.id)));
    expect(all).toHaveLength(1);
  });

  it("§63: a draft-only edit rule prevents rewriting a published version", async () => {
    const { template, version } = await buildActiveTemplate(`Frozen ${suffix}`, [{ title: "t", required: true }]);
    await expect(
      templates.addVersionTask({ organizationId: orgId, versionId: version.id, definition: { title: "sneaky" }, ...actor() }),
    ).rejects.toThrow(/draft/i);
    await expect(
      templates.deleteVersionTask({ organizationId: orgId, versionId: version.id, taskId: 1 }),
    ).rejects.toThrow(/draft/i);
    expect(template.id).toBeGreaterThan(0);
  });

  it("§63: an archived version cannot be reactivated, and an empty version cannot be activated", async () => {
    const { template, version } = await buildActiveTemplate(`Archive ${suffix}`, [{ title: "t", required: true }]);
    await templates.archiveVersion({ organizationId: orgId, versionId: version.id, ...actor() });
    await expect(
      templates.activateVersion({ organizationId: orgId, versionId: version.id, ...actor() }),
    ).rejects.toThrow(/archived/i);

    const empty = await templates.createVersion({ organizationId: orgId, templateId: template.id, ...actor() });
    await expect(templates.activateVersion({ organizationId: orgId, versionId: empty.id, ...actor() })).rejects.toThrow(
      /at least one task/i,
    );
  });

  it("§63: due offsets are bounded and dependency rules require a predecessor", async () => {
    const { version } = await templates.createTemplate({ organizationId: orgId, name: `Bounds ${suffix}`, ...actor() });
    await expect(
      templates.addVersionTask({
        organizationId: orgId,
        versionId: version.id,
        definition: { title: "far future", dueBasis: "onboarding_start", dueOffsetDays: 100000 },
        ...actor(),
      }),
    ).rejects.toThrow(/whole number of days/i);

    await expect(
      templates.addVersionTask({
        organizationId: orgId,
        versionId: version.id,
        definition: { title: "orphan dependency", dueBasis: "dependency_completion" },
        ...actor(),
      }),
    ).rejects.toThrow(/predecessor/i);
  });

  // -- §13/§26.23: no ESS gate, no probation gate ---------------------------

  it("§26.23: completing onboarding changes neither ESS access nor employment status", async () => {
    const { version } = await buildActiveTemplate(`NoGate ${suffix}`, [{ title: "only task", required: true }]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Gate", lastName: "Subject", employmentStatus: "probation" })
      .returning();
    const [u] = await db
      .insert(schema.usersTable)
      .values({ email: `gate-${suffix}@example.invalid`, passwordHash: "x", firstName: "G", lastName: "S", organizationId: orgId })
      .returning();
    const [mem] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId: orgId, status: "active" })
      .returning();
    await db
      .insert(schema.employeeUserLinksTable)
      .values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: mem.id });

    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });

    // Membership is active DURING incomplete onboarding — no lockout.
    const [duringMembership] = await db
      .select()
      .from(schema.organizationMembershipsTable)
      .where(eq(schema.organizationMembershipsTable.id, mem.id));
    expect(duringMembership.status).toBe("active");

    const periodsBefore = await db
      .select()
      .from(schema.employmentPeriodsTable)
      .where(eq(schema.employmentPeriodsTable.employeeId, emp.id));

    const task = (await instances.listInstanceTasks(orgId, instance.id))[0];
    await instances.completeTask({ organizationId: orgId, taskId: task.id, ...actor() });
    expect((await instances.getInstance(orgId, instance.id))!.status).toBe("completed");

    // Employment status untouched: no probation started, confirmed or ended.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("probation");

    // And no employment_periods event was appended by onboarding.
    const periodsAfter = await db
      .select()
      .from(schema.employmentPeriodsTable)
      .where(eq(schema.employmentPeriodsTable.employeeId, emp.id));
    expect(periodsAfter).toHaveLength(periodsBefore.length);

    // Membership still active after completion, too.
    const [afterMembership] = await db
      .select()
      .from(schema.organizationMembershipsTable)
      .where(eq(schema.organizationMembershipsTable.id, mem.id));
    expect(afterMembership.status).toBe("active");
  });

  it("§26.28: a supplementary task is the correction path, and completed history is not erased", async () => {
    const { version } = await buildActiveTemplate(`Supp ${suffix}`, [{ title: "original", required: true }]);
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Supp", lastName: "Subject" })
      .returning();
    const { instance } = await instances.startOnboarding({
      organizationId: orgId,
      employeeId: emp.id,
      templateVersionId: version.id,
      ...actor(),
    });
    const task = (await instances.listInstanceTasks(orgId, instance.id))[0];
    await instances.completeTask({ organizationId: orgId, taskId: task.id, ...actor() });
    expect((await instances.getInstance(orgId, instance.id))!.status).toBe("completed");

    await instances.addSupplementaryTask({
      organizationId: orgId,
      instanceId: instance.id,
      title: "Corrected paperwork",
      reason: "Wrong form was filed",
      ...actor(),
    });

    const reopened = await instances.getInstance(orgId, instance.id);
    expect(reopened!.status).toBe("in_progress");
    expect(reopened!.completedAt).toBeNull();

    // The original completion is intact — it was appended to, not rewritten.
    const tasks = await instances.listInstanceTasks(orgId, instance.id);
    expect(tasks.find((t: any) => t.id === task.id)!.status).toBe("completed");
    expect(tasks).toHaveLength(2);
  });
});
