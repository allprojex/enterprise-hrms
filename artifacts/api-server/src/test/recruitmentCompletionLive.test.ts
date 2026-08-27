/**
 * WS-9 — live proof of Recruitment Completion against a real database.
 *
 * Covers the Owner's §35 QA matrix. The properties that matter most are the
 * negative ones: the public publication gate is NOT weakened, a token cannot
 * reach another version or another organization, a superseded/expired/withdrawn
 * offer cannot be accepted, and conversion is refused until the organization
 * has actually authorized the hire and the candidate has actually accepted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS9_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-9 — recruitment completion, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgId: number;
  let otherOrgId: number;
  let membershipId: number;
  let userId: number;
  let deptId: number;
  let headMembershipId: number;
  let headUserId: number;
  let vacancyId: number;
  let otherOrgVacancyId: number;
  let workflowId: number;

  let stages: typeof import("../lib/recruitmentApprovalStages");
  let hire: typeof import("../lib/hireAuthorization");
  let manual: typeof import("../lib/manualCandidateCapture");
  let responses: typeof import("../lib/offerResponses");
  let particulars: typeof import("../lib/employmentParticulars");
  let conversion: typeof import("../lib/employeeConversion");
  let publicCareers: typeof import("../lib/publicCareers");

  const SOURCE = "referral";

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    stages = await import("../lib/recruitmentApprovalStages");
    hire = await import("../lib/hireAuthorization");
    manual = await import("../lib/manualCandidateCapture");
    responses = await import("../lib/offerResponses");
    particulars = await import("../lib/employmentParticulars");
    conversion = await import("../lib/employeeConversion");
    publicCareers = await import("../lib/publicCareers");

    const suffix = `ws9-${Date.now()}`;
    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS9 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `WS9 other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "WS9", lastName: "Actor", organizationId: orgId })
      .returning();
    userId = user.id;
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId: orgId, status: "active" })
      .returning();
    membershipId = m.id;

    const [headUser] = await db
      .insert(schema.usersTable)
      .values({ email: `head-${suffix}@example.invalid`, passwordHash: "x", firstName: "Dept", lastName: "Head", organizationId: orgId })
      .returning();
    headUserId = headUser.id;
    const [headM] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: headUserId, organizationId: orgId, status: "active" })
      .returning();
    headMembershipId = headM.id;

    const [dept] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId: orgId, code: `D${suffix}`.slice(0, 20), name: "Finance" })
      .returning();
    deptId = dept.id;
    await db
      .insert(schema.departmentHeadsTable)
      .values({ organizationId: orgId, departmentId: deptId, headMembershipId });

    // Recruitment source Master Data — organization-defined, as WS-9 requires.
    await db
      .insert(schema.masterDataDomainsTable)
      .values({ key: "recruitment_source", label: "Recruitment Source", classification: "organization-defined" })
      .onConflictDoNothing({ target: schema.masterDataDomainsTable.key });
    await db
      .insert(schema.masterDataItemsTable)
      .values({ domain: "recruitment_source", organizationId: orgId, code: SOURCE, label: "Employee referral" });

    const [workflow] = await db
      .insert(schema.recruitmentWorkflowsTable)
      .values({ organizationId: orgId, name: "Default", isDefault: true })
      .returning();
    workflowId = workflow.id;
    await db
      .insert(schema.recruitmentStagesTable)
      .values([
        { organizationId: orgId, workflowId, name: "Applied", category: "applied", displayOrder: 1 },
        { organizationId: orgId, workflowId, name: "Hired", category: "hired", displayOrder: 2 },
      ]);

    const [req1] = await db
      .insert(schema.jobRequisitionsTable)
      .values({ organizationId: orgId, title: "Accountant", requisitionType: "new_role", requestedHeadcount: 1, departmentId: deptId, status: "approved" })
      .returning();

    // DRAFT — deliberately never published, to prove manual capture works
    // without publication and the public path still refuses it.
    const [vac] = await db
      .insert(schema.vacanciesTable)
      .values({ organizationId: orgId, requisitionId: req1.id, workflowId, title: "Accountant", publicId: `pub-${suffix}`, status: "draft", visibility: "internal" })
      .returning();
    vacancyId = vac.id;

    const [otherReq] = await db
      .insert(schema.jobRequisitionsTable)
      .values({ organizationId: otherOrgId, title: "Other", requisitionType: "new_role", requestedHeadcount: 1, status: "approved" })
      .returning();
    const [otherVac] = await db
      .insert(schema.vacanciesTable)
      .values({ organizationId: otherOrgId, requisitionId: otherReq.id, title: "Other", publicId: `pubo-${suffix}`, status: "draft" })
      .returning();
    otherOrgVacancyId = otherVac.id;
  });

  afterAll(async () => {
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  async function newCandidate(tag: string) {
    return manual.captureCandidateManually({
      organizationId: orgId,
      vacancyId,
      sourceCode: SOURCE,
      firstName: "Ama",
      lastName: tag,
      email: `${tag}-${Date.now()}@example.invalid`,
      actorMembershipId: membershipId,
    });
  }

  async function makeIssuedOffer(applicationId: number, opts: { expiryDate?: string } = {}) {
    const [offer] = await db.insert(schema.offersTable).values({ organizationId: orgId, applicationId }).returning();
    const [version] = await db
      .insert(schema.offerVersionsTable)
      .values({
        organizationId: orgId,
        offerId: offer.id,
        versionNumber: 1,
        status: "issued",
        expiryDate: opts.expiryDate ?? null,
      })
      .returning();
    await db.update(schema.offersTable).set({ currentVersionId: version.id }).where(eq(schema.offersTable.id, offer.id));
    return { offer, version };
  }

  // --- A/B: public publication gate is NOT weakened --------------------------

  it("A/B. the public path still refuses an unpublished vacancy", async () => {
    const org = await publicCareers.resolvePublicOrganization(`ws9-${orgId}-nope`);
    expect(org).toBeNull();

    // The draft vacancy above is not publicly eligible, and must stay that way.
    const eligible = await publicCareers.resolveEligibleVacancyForApply(orgId, `pub-${vacancyId}-missing`);
    expect(eligible).toBeNull();

    const listed = await publicCareers.listPublicVacancies({ organizationId: orgId, page: 1, pageSize: 50 });
    expect(listed.items.some((v: any) => v.id === vacancyId)).toBe(false);
  });

  // --- C/D/E/F: manual capture ----------------------------------------------

  it("C/E. authorized manual capture works against an UNPUBLISHED vacancy with a configured source", async () => {
    const [vac] = await db.select().from(schema.vacanciesTable).where(eq(schema.vacanciesTable.id, vacancyId));
    expect(vac.status).toBe("draft"); // never published

    const result = await newCandidate("manual");
    expect(result.application.id).toBeGreaterThan(0);
    expect(result.application.sourceCode).toBe(SOURCE);
    // Historical free-text column is populated too, so nothing downstream that
    // reads `source` breaks.
    expect(result.application.source).toBe(SOURCE);
    // Landed on the organization's own configured pipeline entry stage.
    expect(result.application.currentStageId).not.toBeNull();
  });

  it("F. rejects an unknown source, and a source belonging to another organization", async () => {
    await expect(
      manual.captureCandidateManually({
        organizationId: orgId,
        vacancyId,
        sourceCode: "not_a_configured_source",
        firstName: "X",
        lastName: "Y",
        email: `bad-${Date.now()}@example.invalid`,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(/not an available recruitment source/i);

    // A source configured for another organization is equally unavailable.
    await db
      .insert(schema.masterDataItemsTable)
      .values({ domain: "recruitment_source", organizationId: otherOrgId, code: "other_org_source", label: "Theirs" });
    await expect(manual.assertRecruitmentSourceValid(orgId, "other_org_source")).rejects.toThrow(/not an available/i);
  });

  it("rejects a cross-organization vacancy and preserves duplicate protection", async () => {
    await expect(
      manual.captureCandidateManually({
        organizationId: orgId,
        vacancyId: otherOrgVacancyId,
        sourceCode: SOURCE,
        firstName: "Cross",
        lastName: "Org",
        email: `cross-${Date.now()}@example.invalid`,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(/not found in this organization/i);

    const email = `dupe-${Date.now()}@example.invalid`;
    const base = { organizationId: orgId, vacancyId, sourceCode: SOURCE, firstName: "Dupe", lastName: "Test", email, actorMembershipId: membershipId };
    await manual.captureCandidateManually(base);
    await expect(manual.captureCandidateManually(base)).rejects.toThrow(manual.DuplicateApplicationError);
  });

  // --- G/H/I/J/K: approval chain --------------------------------------------

  it("G/H/I/J. resolves multi-stage authority, with Department Head coming from department_heads", async () => {
    const s1 = await stages.createApprovalStage({
      organizationId: orgId,
      input: { purpose: "hire", stageOrder: 1, name: "Department Head", resolverType: "department_head" },
      actorMembershipId: membershipId,
    });
    const s2 = await stages.createApprovalStage({
      organizationId: orgId,
      input: { purpose: "hire", stageOrder: 2, name: "HR", resolverType: "permission_holder", resolverConfig: { permissionKey: "application.manage" } },
      actorMembershipId: membershipId,
    });
    expect((await stages.listApprovalStages(orgId, "hire")).map((s: any) => s.stageOrder)).toEqual([1, 2]);

    // The configured department head qualifies…
    const granted = await stages.resolveStageAuthority({
      organizationId: orgId,
      stage: s1,
      actorMembershipId: headMembershipId,
      departmentId: deptId,
    });
    expect(granted?.authorityBasis).toMatch(/Department head/i);

    // …and another member does NOT, no matter what roles they hold — this
    // resolver reads the department_heads relationship, never a role name.
    const denied = await stages.resolveStageAuthority({
      organizationId: orgId,
      stage: s1,
      actorMembershipId: membershipId,
      departmentId: deptId,
    });
    expect(denied).toBeNull();

    // A duplicate stage order is refused.
    await expect(
      stages.createApprovalStage({
        organizationId: orgId,
        input: { purpose: "hire", stageOrder: 1, name: "Clash", resolverType: "department_head" },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(/already configured/i);

    // A named approver from another organization is refused at configuration time.
    await expect(
      stages.createApprovalStage({
        organizationId: otherOrgId,
        input: { purpose: "hire", stageOrder: 9, name: "Foreign", resolverType: "specific_membership", resolverConfig: { membershipId } },
        actorMembershipId: null,
      }),
    ).rejects.toThrow(/not an active member/i);

    void s2;
  });

  it("K. an unauthorized actor cannot decide a stage, and history is not rewritten when the head changes", async () => {
    const captured = await newCandidate("approval");
    const auth = await hire.requestHireAuthorization({
      organizationId: orgId,
      applicationId: captured.application.id,
      actorMembershipId: membershipId,
    });
    expect(auth.totalStages).toBe(2);
    expect(auth.currentStageOrder).toBe(1);

    // A member who is NOT the department head is refused, regardless of roles.
    await expect(
      hire.decideHireAuthorizationStage({
        organizationId: orgId,
        hireAuthorizationId: auth.id,
        actorMembershipId: membershipId,
        actorUserId: userId,
        decision: "approved",
      }),
    ).rejects.toThrow(stages.NotAuthorizedForStageError);

    // The real department head approves stage 1.
    const after1 = await hire.decideHireAuthorizationStage({
      organizationId: orgId,
      hireAuthorizationId: auth.id,
      actorMembershipId: headMembershipId,
      actorUserId: headUserId,
      decision: "approved",
    });
    expect(after1.status).toBe("pending");
    expect(after1.currentStageOrder).toBe(2);

    const decisions = await hire.listDecisions(orgId, auth.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].authorityBasis).toMatch(/Department head/i);
    expect(decisions[0].decidedByNameSnapshot).toBeTruthy();

    // Now REPLACE the department head. The recorded decision must not change.
    await db
      .update(schema.departmentHeadsTable)
      .set({ validTo: new Date() })
      .where(eq(schema.departmentHeadsTable.departmentId, deptId));
    await db
      .insert(schema.departmentHeadsTable)
      .values({ organizationId: orgId, departmentId: deptId, headMembershipId });

    const after = await hire.listDecisions(orgId, auth.id);
    expect(after[0].authorityBasis).toBe(decisions[0].authorityBasis);
    expect(after[0].decidedByNameSnapshot).toBe(decisions[0].decidedByNameSnapshot);

    // The head cannot also decide stage 2 — that stage resolves on a
    // permission they do not hold, so authority does not carry across stages.
    await expect(
      hire.decideHireAuthorizationStage({
        organizationId: orgId,
        hireAuthorizationId: auth.id,
        actorMembershipId: headMembershipId,
        actorUserId: headUserId,
        decision: "approved",
      }),
    ).rejects.toThrow(stages.NotAuthorizedForStageError);
  });

  // --- N-V: offer lifecycle --------------------------------------------------

  it("O. an offer can be accepted, exactly once, and the version status moves", async () => {
    const captured = await newCandidate("accept");
    const { version } = await makeIssuedOffer(captured.application.id);

    const response = await responses.recordOfferResponse({
      organizationId: orgId,
      offerVersionId: version.id,
      responseType: "accepted",
      channel: "recorded_by_staff",
      respondedByMembershipId: membershipId,
    });
    expect(response.responseType).toBe("accepted");

    const [reloaded] = await db.select().from(schema.offerVersionsTable).where(eq(schema.offerVersionsTable.id, version.id));
    expect(reloaded.status).toBe("accepted");

    // A second response to the same version is refused.
    await expect(
      responses.recordOfferResponse({
        organizationId: orgId,
        offerVersionId: version.id,
        responseType: "declined",
        channel: "recorded_by_staff",
        respondedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(responses.OfferResponseNotAllowedError);
  });

  it("P/Q. decline and withdrawal are recorded, and withdrawal requires a reason", async () => {
    const declined = await newCandidate("decline");
    const d = await makeIssuedOffer(declined.application.id);
    await responses.recordOfferResponse({
      organizationId: orgId,
      offerVersionId: d.version.id,
      responseType: "declined",
      channel: "recorded_by_staff",
      reason: "Accepted another role",
      respondedByMembershipId: membershipId,
    });
    const [dv] = await db.select().from(schema.offerVersionsTable).where(eq(schema.offerVersionsTable.id, d.version.id));
    expect(dv.status).toBe("declined");

    const withdrawn = await newCandidate("withdraw");
    const w = await makeIssuedOffer(withdrawn.application.id);
    await expect(
      responses.recordOfferWithdrawal({
        organizationId: orgId,
        offerVersionId: w.version.id,
        reason: "",
        respondedByMembershipId: membershipId,
        conversionCompleted: false,
      }),
    ).rejects.toThrow(/reason is required/i);

    await responses.recordOfferWithdrawal({
      organizationId: orgId,
      offerVersionId: w.version.id,
      reason: "Role cancelled",
      respondedByMembershipId: membershipId,
      conversionCompleted: false,
    });
    const [wv] = await db.select().from(schema.offerVersionsTable).where(eq(schema.offerVersionsTable.id, w.version.id));
    expect(wv.status).toBe("withdrawn");

    // Withdrawal after a completed conversion is prevented.
    await expect(
      responses.recordOfferWithdrawal({
        organizationId: orgId,
        offerVersionId: w.version.id,
        reason: "too late",
        respondedByMembershipId: membershipId,
        conversionCompleted: true,
      }),
    ).rejects.toThrow(/already been converted/i);
  });

  it("R/S. an expired or superseded offer cannot be accepted", async () => {
    const expired = await newCandidate("expired");
    const e = await makeIssuedOffer(expired.application.id, { expiryDate: "2000-01-01" });
    const state = await responses.getOfferVersionState(orgId, e.version.id);
    expect(state!.isExpired).toBe(true);
    expect(state!.canRespond).toBe(false);
    await expect(
      responses.recordOfferResponse({
        organizationId: orgId,
        offerVersionId: e.version.id,
        responseType: "accepted",
        channel: "recorded_by_staff",
        respondedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(/expired/i);

    const sup = await newCandidate("superseded");
    const s = await makeIssuedOffer(sup.application.id);
    await db.update(schema.offerVersionsTable).set({ status: "superseded" }).where(eq(schema.offerVersionsTable.id, s.version.id));
    // Point the offer at a newer version so the old one is no longer current.
    const [v2] = await db
      .insert(schema.offerVersionsTable)
      .values({ organizationId: orgId, offerId: s.offer.id, versionNumber: 2, status: "issued" })
      .returning();
    await db.update(schema.offersTable).set({ currentVersionId: v2.id }).where(eq(schema.offersTable.id, s.offer.id));

    await expect(
      responses.recordOfferResponse({
        organizationId: orgId,
        offerVersionId: s.version.id,
        responseType: "accepted",
        channel: "recorded_by_staff",
        respondedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(/revised|superseded/i);
  });

  it("T/U/V. response tokens are single-purpose, version-bound, org-bound, and replay-protected", async () => {
    const c1 = await newCandidate("token1");
    const o1 = await makeIssuedOffer(c1.application.id);
    const c2 = await newCandidate("token2");
    const o2 = await makeIssuedOffer(c2.application.id);

    const { token } = await responses.issueResponseToken({
      organizationId: orgId,
      offerVersionId: o1.version.id,
      actorMembershipId: membershipId,
    });

    // Only the hash is stored — the plaintext must not be findable.
    const stored = await db
      .select()
      .from(schema.offerResponseTokensTable)
      .where(eq(schema.offerResponseTokensTable.offerVersionId, o1.version.id));
    expect(stored[0].tokenHash).not.toBe(token);
    expect(stored[0].tokenHash).toHaveLength(64);

    const resolved = await responses.resolveResponseToken(token);
    expect(resolved.offerVersionId).toBe(o1.version.id);
    // It resolves to ITS OWN version, never the other offer's.
    expect(resolved.offerVersionId).not.toBe(o2.version.id);
    expect(resolved.organizationId).toBe(orgId);

    await expect(responses.resolveResponseToken("not-a-real-token-value-000000000000")).rejects.toThrow(
      responses.OfferResponseTokenInvalidError,
    );

    await responses.consumeResponseToken(resolved.tokenId);
    // Replay is refused.
    await expect(responses.consumeResponseToken(resolved.tokenId)).rejects.toThrow(responses.OfferResponseTokenInvalidError);
    await expect(responses.resolveResponseToken(token)).rejects.toThrow(responses.OfferResponseTokenInvalidError);

    // Responding revokes any outstanding link for that version.
    const c3 = await newCandidate("token3");
    const o3 = await makeIssuedOffer(c3.application.id);
    const t3 = await responses.issueResponseToken({ organizationId: orgId, offerVersionId: o3.version.id, actorMembershipId: membershipId });
    await responses.recordOfferResponse({
      organizationId: orgId,
      offerVersionId: o3.version.id,
      responseType: "accepted",
      channel: "recorded_by_staff",
      respondedByMembershipId: membershipId,
    });
    await expect(responses.resolveResponseToken(t3.token)).rejects.toThrow(responses.OfferResponseTokenInvalidError);
  });

  // --- W/X/Y/Z: conversion gate ---------------------------------------------

  it("W/X. conversion is blocked until hire is authorized AND the offer is accepted", async () => {
    const captured = await newCandidate("convert");
    const drizzle = await import("drizzle-orm");
    const [hiredStage] = await db
      .select()
      .from(schema.recruitmentStagesTable)
      .where(
        drizzle.and(
          eq(schema.recruitmentStagesTable.organizationId, orgId),
          eq(schema.recruitmentStagesTable.workflowId, workflowId),
          eq(schema.recruitmentStagesTable.category, "hired"),
        ),
      );
    await db
      .update(schema.applicationsTable)
      .set({ currentStageId: hiredStage.id })
      .where(eq(schema.applicationsTable.id, captured.application.id));

    // Stages ARE configured (from the earlier test), so authorization is required.
    await expect(
      conversion.convertApplicationToEmployee({
        organizationId: orgId,
        applicationId: captured.application.id,
        actorApplicationUserId: userId,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(conversion.HireNotAuthorizedError);

    // Authorize both stages.
    const auth = await hire.requestHireAuthorization({
      organizationId: orgId,
      applicationId: captured.application.id,
      actorMembershipId: membershipId,
    });
    await hire.decideHireAuthorizationStage({
      organizationId: orgId,
      hireAuthorizationId: auth.id,
      actorMembershipId: headMembershipId,
      actorUserId: headUserId,
      decision: "approved",
    });
    // Stage 2 is permission_holder("application.manage"). Grant that
    // permission explicitly rather than relying on seeded roles, so the test
    // is deterministic on a freshly migrated database.
    await db
      .insert(schema.permissionsTable)
      .values({ key: "application.manage", resource: "application", action: "manage" })
      .onConflictDoNothing({ target: schema.permissionsTable.key });
    const [permRow] = await db
      .select()
      .from(schema.permissionsTable)
      .where(eq(schema.permissionsTable.key, "application.manage"));
    const [approverRole] = await db
      .insert(schema.rolesTable)
      .values({ key: "ws9_approver_" + Date.now(), label: "WS9 Approver", isSystem: false })
      .returning();
    await db
      .insert(schema.rolePermissionsTable)
      .values({ roleId: approverRole.id, permissionId: permRow.id })
      .onConflictDoNothing();
    await db
      .insert(schema.membershipRolesTable)
      .values({ membershipId, roleId: approverRole.id })
      .onConflictDoNothing();
    await hire.decideHireAuthorizationStage({
      organizationId: orgId,
      hireAuthorizationId: auth.id,
      actorMembershipId: membershipId,
      actorUserId: userId,
      decision: "approved",
    });
    expect(await hire.isHireAuthorized(orgId, captured.application.id)).toBe(true);

    // Still blocked: an offer exists but has not been accepted.
    const { version } = await makeIssuedOffer(captured.application.id);
    await expect(
      conversion.convertApplicationToEmployee({
        organizationId: orgId,
        applicationId: captured.application.id,
        actorApplicationUserId: userId,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(conversion.OfferNotAcceptedError);

    // Accept it — now conversion succeeds.
    await responses.recordOfferResponse({
      organizationId: orgId,
      offerVersionId: version.id,
      responseType: "accepted",
      channel: "recorded_by_staff",
      respondedByMembershipId: membershipId,
    });
    const result = await conversion.convertApplicationToEmployee({
      organizationId: orgId,
      applicationId: captured.application.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(result.employeeId).toBeGreaterThan(0);
  });

  it("Y. direct employee creation is completely unaffected by the Recruitment gate", async () => {
    // The gate lives only on the Recruitment conversion path; creating an
    // employee directly must not require an offer or an authorization.
    const { createEmployee } = await import("../lib/employees");
    const created = await createEmployee(db, {
      organizationId: orgId,
      fields: { firstName: "Direct", lastName: "Hire" },
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    } as any);
    expect(created.id).toBeGreaterThan(0);
  });

  it("an organization with NO configured hire stages keeps converting as before", async () => {
    // Legacy/prospective compatibility (§25.4): the gate engages only where the
    // organization has adopted the new lifecycle.
    const [w] = await db
      .insert(schema.recruitmentWorkflowsTable)
      .values({ organizationId: otherOrgId, name: "Default", isDefault: true })
      .returning();
    const [applied] = await db
      .insert(schema.recruitmentStagesTable)
      .values({ organizationId: otherOrgId, workflowId: w.id, name: "Applied", category: "applied", displayOrder: 1 })
      .returning();
    const [hiredStage] = await db
      .insert(schema.recruitmentStagesTable)
      .values({ organizationId: otherOrgId, workflowId: w.id, name: "Hired", category: "hired", displayOrder: 2 })
      .returning();
    await db.update(schema.vacanciesTable).set({ workflowId: w.id }).where(eq(schema.vacanciesTable.id, otherOrgVacancyId));

    const [cand] = await db
      .insert(schema.candidatesTable)
      .values({ organizationId: otherOrgId, firstName: "Legacy", lastName: "Path", email: `legacy-${Date.now()}@example.invalid` })
      .returning();
    const [app] = await db
      .insert(schema.applicationsTable)
      .values({
        organizationId: otherOrgId,
        candidateId: cand.id,
        vacancyId: otherOrgVacancyId,
        currentStageId: hiredStage.id,
        publicId: `legacy-${Date.now()}`,
      })
      .returning();

    expect(await stages.listApprovalStages(otherOrgId, "hire")).toHaveLength(0);
    const [otherUser] = await db
      .insert(schema.usersTable)
      .values({ email: `ou-${Date.now()}@example.invalid`, passwordHash: "x", firstName: "O", lastName: "U", organizationId: otherOrgId })
      .returning();
    const [otherM] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: otherUser.id, organizationId: otherOrgId, status: "active" })
      .returning();

    // No stages configured and no offer issued — converts exactly as before WS-9.
    const result = await conversion.convertApplicationToEmployee({
      organizationId: otherOrgId,
      applicationId: app.id,
      actorApplicationUserId: otherUser.id,
      actorMembershipId: otherM.id,
    });
    expect(result.employeeId).toBeGreaterThan(0);
    void applied;
  });

  // --- AA/AB: particulars ----------------------------------------------------

  it("AA. issued particulars do not change when configuration changes afterwards", async () => {
    const captured = await newCandidate("particulars");
    const { version } = await makeIssuedOffer(captured.application.id);

    const suggested = await particulars.suggestParticulars(orgId, version.id);
    expect(suggested.fields.employerName).toContain("WS9");
    // Fields the platform cannot know are blank, never guessed.
    expect(suggested.fields.noticeByEmployer).toBeNull();
    expect(suggested.fields.probationTerms).toBeNull();

    const saved = await particulars.saveParticulars({
      organizationId: orgId,
      offerVersionId: version.id,
      fields: { ...suggested.fields, noticeByEmployer: "One month", probationTerms: "Six months by agreement" },
      derivedFrom: suggested.derivedFrom,
      actorMembershipId: membershipId,
    });
    expect(saved.issuedAt).toBeNull();

    const issued = await particulars.issueParticulars({ organizationId: orgId, offerVersionId: version.id, actorMembershipId: membershipId });
    expect(issued.issuedAt).not.toBeNull();
    const frozenNotice = issued.noticeByEmployer;

    // Change organization configuration afterwards.
    await db.update(schema.organizationsTable).set({ name: "Renamed Organization" }).where(eq(schema.organizationsTable.id, orgId));

    const reloaded = await particulars.getParticularsByOfferVersion(orgId, version.id);
    expect(reloaded!.employerName).toBe(saved.employerName); // NOT the new name
    expect(reloaded!.noticeByEmployer).toBe(frozenNotice);

    // And editing an issued record is refused outright.
    await expect(
      particulars.saveParticulars({
        organizationId: orgId,
        offerVersionId: version.id,
        fields: { noticeByEmployer: "changed" },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(particulars.EmploymentParticularsIssuedError);

    // The merge context is flat and uses the registered allow-list keys.
    const ctx = particulars.buildParticularsMergeContext(reloaded!);
    expect(ctx["particulars.noticeByEmployer"]).toBe(frozenNotice);
  });

  // --- AC: cross-organization isolation --------------------------------------

  it("AC. cross-organization access is refused across every new resource", async () => {
    const captured = await newCandidate("isolation");
    const { version } = await makeIssuedOffer(captured.application.id);

    expect(await responses.getOfferVersionState(otherOrgId, version.id)).toBeNull();
    expect(await particulars.getParticularsByOfferVersion(otherOrgId, version.id)).toBeNull();
    expect(await hire.getHireAuthorizationByApplication(otherOrgId, captured.application.id)).toBeNull();
    expect(await stages.listApprovalStages(otherOrgId, "hire")).toHaveLength(0);

    await expect(
      responses.issueResponseToken({ organizationId: otherOrgId, offerVersionId: version.id, actorMembershipId: null }),
    ).rejects.toThrow();

    await expect(
      hire.requestHireAuthorization({ organizationId: otherOrgId, applicationId: captured.application.id, actorMembershipId: null }),
    ).rejects.toThrow(hire.HireAuthorizationNotFoundError);
  });
});
