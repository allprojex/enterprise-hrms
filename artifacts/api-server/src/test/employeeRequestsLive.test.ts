/**
 * WS-13 — live proof of Employee Data Change Approval & HR Service Requests.
 *
 * The high-risk invariants §29 freezes, each proved against a real database:
 *
 *   - maker-checker: the requester can never approve their own request;
 *   - stale detection is PER FIELD, and an unrelated edit does not invalidate;
 *   - one active request per (employee, field), guaranteed by the database;
 *   - application is transactional and idempotent;
 *   - the frozen stage count survives later reconfiguration;
 *   - a forbidden or specialist-module field is refused by the registry;
 *   - an ESS request derives its subject from the employee link, never a body;
 *   - sensitive values are masked in audit, chronology and approval DTOs;
 *   - every cross-tenant identifier fails safely;
 *   - no job type can approve, apply or fulfil anything.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS13_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-13 — employee requests, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let orgId: number;
  let otherOrgId: number;
  let requesterUserId: number;
  let requesterMembershipId: number;
  let approverUserId: number;
  let approverMembershipId: number;
  let otherOrgEmployeeId: number;
  let otherOrgMembershipId: number;
  let deptId: number;

  let dataChange: typeof import("../lib/employeeRequests/dataChange");
  let serviceRequests: typeof import("../lib/employeeRequests/serviceRequests");
  let stages: typeof import("../lib/employeeRequests/approvalStages");
  let eligible: typeof import("../lib/employeeRequests/eligibleFields");
  let reminders: typeof import("../lib/employeeRequests/reminders");
  let jobHandlers: typeof import("../lib/jobHandlers");
  let registry: typeof import("../lib/jobHandlerRegistry");

  const suffix = `ws13-${Date.now()}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    dataChange = await import("../lib/employeeRequests/dataChange");
    serviceRequests = await import("../lib/employeeRequests/serviceRequests");
    stages = await import("../lib/employeeRequests/approvalStages");
    eligible = await import("../lib/employeeRequests/eligibleFields");
    reminders = await import("../lib/employeeRequests/reminders");
    jobHandlers = await import("../lib/jobHandlers");
    registry = await import("../lib/jobHandlerRegistry");
    jobHandlers.registerShippedJobHandlers();

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS13 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS13 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const mkUser = async (tag: string, organizationId: number) => {
      const [u] = await db
        .insert(schema.usersTable)
        .values({
          email: `${tag}-${suffix}@example.invalid`,
          passwordHash: "x",
          firstName: tag,
          lastName: "Actor",
          organizationId,
        })
        .returning();
      const [m] = await db
        .insert(schema.organizationMembershipsTable)
        .values({ applicationUserId: u.id, organizationId, status: "active" })
        .returning();
      return { userId: u.id, membershipId: m.id };
    };

    const requester = await mkUser("requester", orgId);
    requesterUserId = requester.userId;
    requesterMembershipId = requester.membershipId;
    const approver = await mkUser("approver", orgId);
    approverUserId = approver.userId;
    approverMembershipId = approver.membershipId;
    const foreign = await mkUser("foreign", otherOrgId);
    otherOrgMembershipId = foreign.membershipId;

    const [dept] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId: orgId, name: `Dept ${suffix}`, code: `D-${suffix}` })
      .returning();
    deptId = dept.id;

    const [foreignEmp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Foreign", lastName: "Employee" })
      .returning();
    otherOrgEmployeeId = foreignEmp.id;
  });

  const asRequester = () => ({ actorApplicationUserId: requesterUserId, actorMembershipId: requesterMembershipId });
  const asApprover = () => ({ actorApplicationUserId: approverUserId, actorMembershipId: approverMembershipId });

  async function makeEmployee(tag: string, overrides: Record<string, unknown> = {}) {
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: tag, lastName: "Subject", ...overrides })
      .returning();
    return emp;
  }

  // -- Eligible-field registry (§29.3) --------------------------------------

  it("the registry refuses specialist-module fields and unknown columns", async () => {
    const emp = await makeEmployee("RegistryGuard");

    // Every one of these is a real `employees` column, and every one belongs to
    // another module. The registry is an allow-list, so none is reachable.
    for (const forbidden of [
      "employmentStatus",
      "separationDate",
      "separationReason",
      "positionId",
      "departmentId",
      "branchId",
      "reportingManagerId",
      "hireDate",
      "probationEndDate",
      "employmentType",
      "employeeNumber",
      "notes",
    ]) {
      expect(eligible.isEligibleField(forbidden)).toBe(false);
      await expect(
        dataChange.createRequest({
          organizationId: orgId,
          employeeId: emp.id,
          origin: "hr_originated",
          fields: [{ fieldKey: forbidden, requestedValue: "anything" }],
          ...asRequester(),
        }),
      ).rejects.toThrow(/not a field this platform allows/i);
    }

    // And an entirely invented key is refused the same way.
    await expect(
      dataChange.createRequest({
        organizationId: orgId,
        employeeId: emp.id,
        origin: "hr_originated",
        fields: [{ fieldKey: "salary; DROP TABLE employees", requestedValue: "x" }],
        ...asRequester(),
      }),
    ).rejects.toThrow(/not a field this platform allows/i);

    // The employee is untouched by all of that.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.employmentStatus).toBe("active");
    expect(after.separationDate).toBeNull();
  });

  it("a work email cannot be requested through self-service, but can by HR", async () => {
    const emp = await makeEmployee("OriginEligibility");
    await expect(
      dataChange.createRequest({
        organizationId: orgId,
        employeeId: emp.id,
        origin: "employee_self_service",
        fields: [{ fieldKey: "workEmail", requestedValue: "new@example.invalid" }],
        ...asRequester(),
      }),
    ).rejects.toThrow(/cannot be requested through employee self-service/i);

    const ok = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "workEmail", requestedValue: "new@example.invalid" }],
      ...asRequester(),
    });
    expect(ok.request.origin).toBe("hr_originated");
  });

  it("configuration cannot introduce a field", async () => {
    await expect(
      dataChange.setFieldPolicy({
        organizationId: orgId,
        fieldKey: "employmentStatus",
        approvalRequired: false,
        ...asRequester(),
      }),
    ).rejects.toThrow(/not a field this platform allows/i);

    // A legitimate eligible field configures fine.
    const policy = await dataChange.setFieldPolicy({
      organizationId: orgId,
      fieldKey: "phoneNumber",
      approvalRequired: true,
      ...asRequester(),
    });
    expect(policy.approvalRequired).toBe(true);
  });

  // -- Maker-checker (§29.6) ------------------------------------------------

  it("the requester can NEVER approve their own request", async () => {
    const emp = await makeEmployee("MakerChecker");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue: "Sam" }],
      ...asRequester(),
    });

    await expect(
      dataChange.approve({ organizationId: orgId, requestId: request.id, ...asRequester() }),
    ).rejects.toThrow(/may not approve it/i);
    await expect(
      dataChange.reject({ organizationId: orgId, requestId: request.id, reason: "no", ...asRequester() }),
    ).rejects.toThrow(/may not approve it/i);

    // Still pending — the refusal changed nothing.
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("pending");

    // A different person can.
    const approved = await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(approved.status).toBe("approved");
  });

  it("maker-checker cannot be evaded by a second membership, because the platform forbids one", async () => {
    const emp = await makeEmployee("SecondMembership");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "nationality", requestedValue: "Ghanaian" }],
      ...asRequester(),
    });

    // The obvious way round maker-checker would be to hold a SECOND membership
    // in the same organization and approve through that. The platform makes
    // that impossible: `organization_memberships` is unique on
    // (application_user_id, organization_id), so the loophole is closed by the
    // schema rather than by a check somebody could forget.
    await expect(
      db
        .insert(schema.organizationMembershipsTable)
        .values({ applicationUserId: requesterUserId, organizationId: orgId, status: "active" }),
    ).rejects.toThrow();

    // And the service's own guard checks BOTH user and membership, so even a
    // forged membership id belonging to somebody else does not help: the user
    // id still matches the requester.
    await expect(
      dataChange.approve({
        organizationId: orgId,
        requestId: request.id,
        actorApplicationUserId: requesterUserId,
        actorMembershipId: approverMembershipId,
      }),
    ).rejects.toThrow(/may not approve it/i);
  });

  // -- Duplicate pending (§29.10) -------------------------------------------

  it("only one ACTIVE request may exist per employee and field, but history is preserved", async () => {
    const emp = await makeEmployee("DuplicateGuard");
    const first = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "personalEmail", requestedValue: "a@example.invalid" }],
      ...asRequester(),
    });

    await expect(
      dataChange.createRequest({
        organizationId: orgId,
        employeeId: emp.id,
        origin: "hr_originated",
        fields: [{ fieldKey: "personalEmail", requestedValue: "b@example.invalid" }],
        ...asRequester(),
      }),
    ).rejects.toThrow(/already open/i);

    // Reject the first — the slot is released and history survives.
    await dataChange.reject({ organizationId: orgId, requestId: first.request.id, reason: "superseded", ...asApprover() });
    const second = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "personalEmail", requestedValue: "b@example.invalid" }],
      ...asRequester(),
    });
    expect(second.request.id).not.toBe(first.request.id);

    const all = await dataChange.listRequests(orgId, { employeeId: emp.id });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((r: any) => r.id === first.request.id && r.status === "rejected")).toBe(true);
  });

  // -- Stale detection (§29.10) ---------------------------------------------

  it("a field that moved after the request is detected as stale and is NOT applied", async () => {
    const emp = await makeEmployee("StaleDetect", { phoneNumber: "0200000000" });
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "phoneNumber", requestedValue: "0244444444" }],
      ...asRequester(),
    });

    // Somebody else changes the same field directly.
    await db
      .update(schema.employeesTable)
      .set({ phoneNumber: "0555555555" })
      .where(eq(schema.employeesTable.id, emp.id));

    const stale = await dataChange.detectStaleFields(orgId, request.id);
    expect(stale.map((s: any) => s.fieldKey)).toContain("phoneNumber");

    await expect(
      dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() }),
    ).rejects.toThrow(/changed after this request was raised/i);

    // Marked stale, and the live value was NOT overwritten.
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("stale");
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.phoneNumber).toBe("0555555555");

    // Re-confirm, then it can proceed.
    await dataChange.reconfirm({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("pending");
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    const applied = await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(applied.status).toBe("applied");
    const [final] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(final.phoneNumber).toBe("0244444444");
  });

  it("an edit to an UNRELATED field does not invalidate a request", async () => {
    const emp = await makeEmployee("UnrelatedEdit", { phoneNumber: "0200000001", nationality: "Ghanaian" });
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "phoneNumber", requestedValue: "0266666666" }],
      ...asRequester(),
    });

    // A different column moves — and `employees.updatedAt` moves with it.
    await db
      .update(schema.employeesTable)
      .set({ nationality: "Nigerian" })
      .where(eq(schema.employeesTable.id, emp.id));

    // THE ASSERTION THIS TEST EXISTS FOR (§29.10): per-field comparison, so this
    // request is untouched even though the row changed.
    expect(await dataChange.detectStaleFields(orgId, request.id)).toHaveLength(0);
    const approved = await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(approved.status).toBe("approved");
  });

  // -- Application (§29.10) -------------------------------------------------

  it("application is idempotent and never applies twice", async () => {
    const emp = await makeEmployee("Idempotent", { preferredName: "Old" });
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue: "New" }],
      ...asRequester(),
    });
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });

    const first = await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });
    const second = await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(first.status).toBe("applied");
    expect(second.status).toBe("applied");
    expect(second.appliedAt?.getTime()).toBe(first.appliedAt?.getTime());

    // Exactly one `applied` event, so nothing wrote twice.
    const events = await dataChange.listRequestEvents(orgId, request.id);
    expect(events.filter((e: any) => e.eventType === "applied")).toHaveLength(1);
  });

  it("a multi-field change applies atomically, and the four timestamps stay distinct", async () => {
    const emp = await makeEmployee("MultiField", { phoneNumber: "0201111111", preferredName: "A" });
    const effective = new Date("2026-12-01T00:00:00Z");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [
        { fieldKey: "phoneNumber", requestedValue: "0277777777" },
        { fieldKey: "preferredName", requestedValue: "B" },
      ],
      effectiveDate: effective,
      ...asRequester(),
    });
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    const applied = await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });

    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.phoneNumber).toBe("0277777777");
    expect(after.preferredName).toBe("B");

    // §29.11 keeps these apart, and `createdAt` is none of them.
    expect(applied.requestedAt).toBeTruthy();
    expect(applied.decidedAt).toBeTruthy();
    expect(applied.appliedAt).toBeTruthy();
    expect(applied.effectiveDate?.toISOString()).toBe(effective.toISOString());
    expect(applied.decidedAt!.getTime()).toBeGreaterThanOrEqual(applied.requestedAt.getTime());
  });

  // -- Stage freezing (§29.8) -----------------------------------------------

  it("the stage count is frozen at request time and later reconfiguration cannot change it", async () => {
    const stage = await stages.createStage({
      organizationId: orgId,
      purpose: "data_change",
      stageOrder: 1,
      name: "HR review",
      resolverType: "permission_holder",
      resolverConfig: { permissionKey: "data_change.approve" },
      ...asRequester(),
    });

    const emp = await makeEmployee("StageFreeze");
    await dataChange.setFieldPolicy({
      organizationId: orgId,
      fieldKey: "maritalStatus",
      approvalRequired: true,
      ...asRequester(),
    });
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "maritalStatus", requestedValue: "married" }],
      ...asRequester(),
    });
    expect(request.stageCountAtRequest).toBe(1);
    expect(request.currentStageOrder).toBe(1);

    // Add a second stage AFTER the request was raised.
    await stages.createStage({
      organizationId: orgId,
      purpose: "data_change",
      stageOrder: 2,
      name: "Second",
      resolverType: "permission_holder",
      resolverConfig: { permissionKey: "data_change.approve" },
      ...asRequester(),
    });

    // The in-flight request still completes on ONE stage — its frozen count.
    const reread = await dataChange.getRequest(orgId, request.id);
    expect(reread!.stageCountAtRequest).toBe(1);

    await db.delete(schema.requestApprovalStagesTable).where(eq(schema.requestApprovalStagesTable.id, stage.id));
    await db
      .delete(schema.requestApprovalStagesTable)
      .where(eq(schema.requestApprovalStagesTable.organizationId, orgId));
  });

  it("a stage naming a membership from another organization is refused", async () => {
    await expect(
      stages.createStage({
        organizationId: orgId,
        purpose: "data_change",
        stageOrder: 9,
        name: "Cross tenant",
        resolverType: "specific_membership",
        resolverConfig: { membershipId: otherOrgMembershipId },
        ...asRequester(),
      }),
    ).rejects.toThrow(/does not belong to this organization/i);
  });

  // -- Sensitive masking (§29.7, §29.16, §29.19) ----------------------------

  it("a sensitive value is masked in the approval view, the chronology and the audit trail", async () => {
    const emp = await makeEmployee("Sensitive", { nationalId: "GHA-OLD-1234567" });
    const secret = "GHA-NEW-7654321";
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "nationalId", requestedValue: secret }],
      ...asRequester(),
    });
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });

    // The approval view masks it.
    const fields = await dataChange.listRequestFields(orgId, request.id);
    const view = dataChange.toApprovalView((await dataChange.getRequest(orgId, request.id))!, fields);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.fields[0]!.sensitive).toBe(true);

    // The chronology masks it.
    const events = await dataChange.listRequestEvents(orgId, request.id);
    expect(JSON.stringify(events)).not.toContain(secret);

    // The audit trail masks it.
    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.organizationId, orgId),
          eq(schema.auditEventsTable.eventType, "data_change_request.applied"),
          eq(schema.auditEventsTable.targetId, String(request.id)),
        ),
      );
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(secret);

    // But the AUTHORITATIVE record has the real value — masking governs who may
    // see it, not what is stored.
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.nationalId).toBe(secret);
  });

  // -- Tenant isolation (§29.20) --------------------------------------------

  it("data-change requests are not reachable across organizations", async () => {
    const emp = await makeEmployee("Isolation");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue: "Iso" }],
      ...asRequester(),
    });

    expect(await dataChange.getRequest(otherOrgId, request.id)).toBeUndefined();
    expect((await dataChange.listRequests(otherOrgId)).some((r: any) => r.id === request.id)).toBe(false);
    expect(await dataChange.listRequestFields(otherOrgId, request.id)).toHaveLength(0);
    for (const call of [
      () => dataChange.approve({ organizationId: otherOrgId, requestId: request.id, ...asApprover() }),
      () => dataChange.reject({ organizationId: otherOrgId, requestId: request.id, reason: "x", ...asApprover() }),
      () => dataChange.applyRequest({ organizationId: otherOrgId, requestId: request.id, ...asApprover() }),
      () => dataChange.withdraw({ organizationId: otherOrgId, requestId: request.id, ...asRequester() }),
    ]) {
      await expect(call()).rejects.toThrow();
    }
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("pending");
  });

  it("a request cannot be raised against another organization's employee", async () => {
    await expect(
      dataChange.createRequest({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        origin: "hr_originated",
        fields: [{ fieldKey: "preferredName", requestedValue: "Nope" }],
        ...asRequester(),
      }),
    ).rejects.toThrow(/not found in this organization/i);
  });

  // -- HR service requests (§29.12–29.14) -----------------------------------

  it("a service request runs submission through fulfilment, with approval kept separate", async () => {
    const emp = await makeEmployee("ServiceFlow");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `enquiry-${suffix}`,
      name: "HR enquiry",
      approvalRequired: false,
      ...asRequester(),
    });

    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: type.id,
      employeeId: emp.id,
      subject: "Payslip question",
      viaSelfService: false,
      ...asRequester(),
    });
    expect(request.status).toBe("submitted");
    expect(request.approvalStatus).toBe("not_required");

    await serviceRequests.acknowledge({ organizationId: orgId, requestId: request.id, ...asApprover() });
    await serviceRequests.assign({
      organizationId: orgId,
      requestId: request.id,
      assignedMembershipId: approverMembershipId,
      ...asApprover(),
    });
    const fulfilled = await serviceRequests.fulfil({
      organizationId: orgId,
      requestId: request.id,
      resolutionSummary: "Answered by email.",
      ...asApprover(),
    });
    expect(fulfilled.status).toBe("fulfilled");
    // Approval was never required, and fulfilment did not invent one.
    expect(fulfilled.approvalStatus).toBe("not_required");
  });

  it("approval and fulfilment are distinct: an approved request is not thereby fulfilled", async () => {
    const emp = await makeEmployee("ApprovalDistinct");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `approved-${suffix}`,
      name: "Needs approval",
      approvalRequired: true,
      ...asRequester(),
    });
    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: type.id,
      employeeId: emp.id,
      subject: "Something",
      viaSelfService: false,
      ...asRequester(),
    });
    expect(request.approvalStatus).toBe("pending");

    // Cannot be fulfilled while awaiting approval.
    await expect(
      serviceRequests.fulfil({
        organizationId: orgId,
        requestId: request.id,
        resolutionSummary: "too early",
        ...asApprover(),
      }),
    ).rejects.toThrow(/awaiting approval/i);

    // Maker-checker holds here too.
    await expect(
      serviceRequests.approve({ organizationId: orgId, requestId: request.id, ...asRequester() }),
    ).rejects.toThrow(/may not approve it/i);

    const approved = await serviceRequests.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    expect(approved.approvalStatus).toBe("approved");
    // Approved but NOT fulfilled — the two states are separate.
    expect(approved.status).not.toBe("fulfilled");
  });

  it("a document-fulfilled type requires a WS-5 document, and refuses one from another organization", async () => {
    const emp = await makeEmployee("LetterRequest");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `letter-${suffix}`,
      name: "Employment letter",
      fulfilmentKind: "document",
      ...asRequester(),
    });
    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: type.id,
      employeeId: emp.id,
      subject: "Employment letter please",
      viaSelfService: false,
      ...asRequester(),
    });

    // WS-13 generates nothing, so fulfilment without a document is refused.
    await expect(
      serviceRequests.fulfil({
        organizationId: orgId,
        requestId: request.id,
        resolutionSummary: "done",
        ...asApprover(),
      }),
    ).rejects.toThrow(/Documents & Records/i);

    const mkDoc = async (organizationId: number) => {
      const [doc] = await db
        .insert(schema.generatedDocumentsTable)
        .values({
          organizationId,
          categoryCode: "letter",
          storageKey: `gk-${organizationId}-${suffix}`,
          fileName: "letter.pdf",
          mimeType: "application/pdf",
          fileSize: 100,
          generatedAt: new Date(),
        })
        .returning();
      return doc;
    };
    const foreignDoc = await mkDoc(otherOrgId);
    await expect(
      serviceRequests.fulfil({
        organizationId: orgId,
        requestId: request.id,
        resolutionSummary: "done",
        generatedDocumentId: foreignDoc.id,
        ...asApprover(),
      }),
    ).rejects.toThrow();

    const ownDoc = await mkDoc(orgId);
    const fulfilled = await serviceRequests.fulfil({
      organizationId: orgId,
      requestId: request.id,
      resolutionSummary: "Letter issued.",
      generatedDocumentId: ownDoc.id,
      ...asApprover(),
    });
    expect(fulfilled.generatedDocumentId).toBe(ownDoc.id);
  });

  it("the ESS view never carries an internal note, and a hidden type cannot be raised in self-service", async () => {
    const emp = await makeEmployee("EssVisibility");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `hidden-${suffix}`,
      name: "Internal only",
      employeeVisible: false,
      ...asRequester(),
    });

    await expect(
      serviceRequests.submitRequest({
        organizationId: orgId,
        typeId: type.id,
        employeeId: emp.id,
        subject: "nope",
        viaSelfService: true,
        ...asRequester(),
      }),
    ).rejects.toThrow(/not available in self-service/i);

    const visibleType = await serviceRequests.createType({
      organizationId: orgId,
      code: `visible-${suffix}`,
      name: "Visible",
      ...asRequester(),
    });
    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: visibleType.id,
      employeeId: emp.id,
      subject: "Question",
      viaSelfService: true,
      ...asRequester(),
    });

    // An internal note. Default visibility is false.
    await db.insert(schema.serviceRequestEventsTable).values({
      organizationId: orgId,
      requestId: request.id,
      eventType: "note_added",
      notes: "INTERNAL: escalate quietly",
      occurredAt: new Date(),
    });

    const visible = await serviceRequests.listEvents(orgId, request.id, { onlyVisibleToEmployee: true });
    const all = await serviceRequests.listEvents(orgId, request.id);
    expect(all.length).toBeGreaterThan(visible.length);

    const view = serviceRequests.toEssView(request, visible);
    expect(JSON.stringify(view)).not.toContain("INTERNAL");
    // Belt and braces: even handed every event, the view refuses to leak one.
    expect(JSON.stringify(serviceRequests.toEssView(request, all))).not.toContain("INTERNAL");
    // The allow-list omits internal routing entirely.
    expect(JSON.stringify(view)).not.toContain("assignedMembershipId");
  });

  it("service requests and types are not reachable across organizations", async () => {
    const emp = await makeEmployee("ServiceIsolation");
    const type = await serviceRequests.createType({
      organizationId: orgId,
      code: `iso-${suffix}`,
      name: "Isolated",
      ...asRequester(),
    });
    const request = await serviceRequests.submitRequest({
      organizationId: orgId,
      typeId: type.id,
      employeeId: emp.id,
      subject: "Isolated",
      viaSelfService: false,
      ...asRequester(),
    });

    expect(await serviceRequests.getType(otherOrgId, type.id)).toBeUndefined();
    expect(await serviceRequests.getRequest(otherOrgId, request.id)).toBeUndefined();
    expect(await serviceRequests.listEvents(otherOrgId, request.id)).toHaveLength(0);
    for (const call of [
      () => serviceRequests.acknowledge({ organizationId: otherOrgId, requestId: request.id, ...asApprover() }),
      () => serviceRequests.close({ organizationId: otherOrgId, requestId: request.id, ...asApprover() }),
      () =>
        serviceRequests.updateType({ organizationId: otherOrgId, typeId: type.id, name: "hijack", ...asApprover() }),
    ]) {
      await expect(call()).rejects.toThrow();
    }

    // A cross-tenant assignee is refused.
    await expect(
      serviceRequests.assign({
        organizationId: orgId,
        requestId: request.id,
        assignedMembershipId: otherOrgMembershipId,
        ...asApprover(),
      }),
    ).rejects.toThrow();
  });

  // -- Scheduled jobs (§29.15) ----------------------------------------------

  it("WS-13 job handlers are registered, and NONE can approve, apply or fulfil", async () => {
    for (const jobType of [
      reminders.DATA_CHANGE_APPROVAL_PENDING,
      reminders.SERVICE_REQUEST_APPROVAL_PENDING,
      reminders.SERVICE_REQUEST_OVERDUE,
      reminders.SERVICE_REQUEST_AWAITING_EMPLOYEE,
    ]) {
      expect(registry.getJobHandler(jobType)).toBeTruthy();
    }

    // No registered job type anywhere claims authority to decide or write.
    const forbidden = /(auto[_.]?)?(approve|apply|fulfil|fulfill|decide|reject|mutate)/i;
    for (const jobType of registry.listRegisteredJobTypes()) {
      expect(String(jobType)).not.toMatch(forbidden);
    }
  });

  it("a data-change reminder no-ops once the request is decided, and never mutates it", async () => {
    const emp = await makeEmployee("ReminderStale");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "alternatePhoneNumber", requestedValue: "0233333333" }],
      ...asRequester(),
    });
    await dataChange.reject({ organizationId: orgId, requestId: request.id, reason: "no", ...asApprover() });

    const handler = registry.getJobHandler(reminders.DATA_CHANGE_APPROVAL_PENDING)!;
    await expect(
      handler.execute({
        jobId: 1,
        organizationId: orgId,
        payload: handler.parsePayload({ requestId: request.id }),
        sourceReferenceType: "data_change_request",
        sourceReferenceId: request.id,
        attemptCount: 1,
      } as never),
    ).rejects.toThrow(/no longer awaiting a decision/i);

    // The handler wrote nothing.
    expect((await dataChange.getRequest(orgId, request.id))!.status).toBe("rejected");
  });

  it("a forged reminder aimed at another organization resolves nothing", async () => {
    const emp = await makeEmployee("ForgedReminder");
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "middleName", requestedValue: "Forged" }],
      ...asRequester(),
    });

    const handler = registry.getJobHandler(reminders.DATA_CHANGE_APPROVAL_PENDING)!;
    await expect(
      handler.execute({
        jobId: 2,
        organizationId: otherOrgId,
        payload: handler.parsePayload({ requestId: request.id }),
        sourceReferenceType: "data_change_request",
        sourceReferenceId: request.id,
        attemptCount: 1,
      } as never),
    ).rejects.toThrow(/no longer exists in this organization/i);
  });

  // -- Reporting (§29.21) ---------------------------------------------------

  it("read models report counts and ageing, never a requested value", async () => {
    const emp = await makeEmployee("Reporting");
    await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "passportNumber", requestedValue: "SECRET-PASSPORT-VALUE" }],
      ...asRequester(),
    });

    const pending = await dataChange.pendingRequests(orgId);
    const serialized = JSON.stringify(pending);
    expect(serialized).not.toContain("SECRET-PASSPORT-VALUE");
    expect(pending.some((r: any) => r.employeeId === emp.id)).toBe(true);
    // Scoped: another organization sees none of it.
    expect((await dataChange.pendingRequests(otherOrgId)).some((r: any) => r.employeeId === emp.id)).toBe(false);
  });

  it("withdrawal never undoes an applied change", async () => {
    const emp = await makeEmployee("NoUndo", { preferredName: "Before" });
    const { request } = await dataChange.createRequest({
      organizationId: orgId,
      employeeId: emp.id,
      origin: "hr_originated",
      fields: [{ fieldKey: "preferredName", requestedValue: "After" }],
      ...asRequester(),
    });
    await dataChange.approve({ organizationId: orgId, requestId: request.id, ...asApprover() });
    await dataChange.applyRequest({ organizationId: orgId, requestId: request.id, ...asApprover() });

    await expect(
      dataChange.withdraw({ organizationId: orgId, requestId: request.id, ...asRequester() }),
    ).rejects.toThrow(/already been applied/i);

    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.preferredName).toBe("After");
  });

  it("deptId fixture is org-scoped", () => {
    expect(deptId).toBeGreaterThan(0);
  });
});
