/**
 * WS-26 assisted (on-behalf) submissions — live proof against a real database.
 *
 * Runs only with WS26_LIVE_DATABASE_URL pointing at a LOCAL throwaway database
 * (liveDbGuard refuses anything else). Every invariant below is exercised
 * through the real services and read back from the real tables:
 *
 *   - PIF v1 (installed and published WITHOUT a policy, i.e. the Production
 *     state) is never mutated; a content-locked v2 DRAFT is prepared; the other
 *     three WWM forms stay closed; submissions keep referencing v1;
 *   - a draft edit that omits the policy does not silently close v2;
 *   - assisted creation persists assisted/reason/notes, the real creating
 *     membership and the subject independently; created_on_behalf and
 *     submitted_on_behalf events and audit rows carry the category, never the
 *     notes; provenance is unchanged by later writes;
 *   - form.assess alone does not authorize assisted creation (real role grants);
 *   - HR cannot sign, upload or reuse its own asset as the subject employee, and
 *     the employee can still sign their own slot;
 *   - cross-tenant templates and subjects are refused;
 *   - the version policy fails closed for every non-literal-true jsonb value.
 */
import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { WWM_LEAVE_APPLICATION_KEY } from "../formTemplates/wwm/leaveApplication";
import { WWM_PERSONAL_INFORMATION_KEY, wwmPersonalInformationV1Stages } from "../formTemplates/wwm/personalInformation";
import { WWM_PROBATIONARY_ASSESSMENT_KEY } from "../formTemplates/wwm/probationaryAssessment";
import { WWM_STAFF_EVALUATION_KEY } from "../formTemplates/wwm/staffEvaluation";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

async function png(width = 24, height = 12): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
}
const file = (buf: Buffer, mimetype = "image/png") => ({ mimetype, size: buf.length, buffer: buf });

describe.skipIf(!LIVE_URL)("WS-26 assisted submissions, live", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let sql: typeof import("drizzle-orm").sql;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let signatures: typeof import("../lib/formEngine/signatures");
  let installer: typeof import("../lib/formEngine/templateInstaller");
  let assisted: typeof import("../lib/formEngine/assistedSubmission");
  let permissions: typeof import("../lib/permissions");
  let wwm: typeof import("../formTemplates/wwm");

  const suffix = `ws26a-${Date.now().toString(36)}`;
  const NOTES = `Ward 4 admission ${suffix}`;
  let orgId: number;
  let otherOrgId: number;

  interface Person {
    userId: number;
    membershipId: number;
    employeeId: number;
  }
  let hr: Person;
  let assessor: Person;
  let staff: Person;
  let subject: Person;
  let foreignHr: Person;
  let foreignStaff: Person;
  /** A second HR user: maker-checker means the assisting HR user cannot also review. */
  let hr2: Person;

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });
  const templateActor = (p: Person) => ({ actorApplicationUserId: p.userId, actorMembershipId: p.membershipId });
  const viewer = (organizationId: number, p: Person) => submissions.buildViewerContext(organizationId, actor(p));

  const HR_KEYS = [
    "form_template.manage",
    "form_template.publish",
    "form.read",
    "form.assess",
    "form.approve",
    "form.finalize",
    "form.final.read",
    "form_submission.create_on_behalf",
  ];

  beforeAll(async () => {
    ({ eq, and, sql } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    signatures = await import("../lib/formEngine/signatures");
    installer = await import("../lib/formEngine/templateInstaller");
    assisted = await import("../lib/formEngine/assistedSubmission");
    permissions = await import("../lib/permissions");
    wwm = await import("../formTemplates/wwm");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS26A ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `WS26A other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    const ensurePermission = async (key: string) => {
      const [existing] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
      if (existing) return existing.id;
      const [p] = await db.insert(schema.permissionsTable).values({ key, resource: key.split(".")[0], action: key.split(".").slice(1).join(".") }).returning();
      return p.id;
    };
    const mkRole = async (organizationId: number, key: string, permissionKeys: string[]) => {
      const [role] = await db.insert(schema.rolesTable).values({ organizationId, key: `${key}-${suffix}`, label: key }).returning();
      for (const pk of permissionKeys) await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await ensurePermission(pk) });
      return role.id;
    };
    const mkPerson = async (tag: string, organizationId: number, roleId: number): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "Person", organizationId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId, firstName: tag, lastName: "Person" }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };

    const hrRole = await mkRole(orgId, "hr", HR_KEYS);
    // Everything an assessor/org admin held that used to authorize this by accident — minus the explicit key.
    const assessorRole = await mkRole(orgId, "assessor", HR_KEYS.filter((k) => k !== "form_submission.create_on_behalf"));
    const employeeRole = await mkRole(orgId, "employee", ["organization.read"]);
    const foreignHrRole = await mkRole(otherOrgId, "hr", HR_KEYS);
    const foreignEmployeeRole = await mkRole(otherOrgId, "employee", ["organization.read"]);

    hr = await mkPerson("hr", orgId, hrRole);
    assessor = await mkPerson("assessor", orgId, assessorRole);
    staff = await mkPerson("staff", orgId, employeeRole);
    subject = await mkPerson("subject", orgId, employeeRole);
    foreignHr = await mkPerson("foreignhr", otherOrgId, foreignHrRole);
    foreignStaff = await mkPerson("foreignstaff", otherOrgId, foreignEmployeeRole);
    hr2 = await mkPerson("hr2", orgId, hrRole);
  });

  // -------------------------------------------------------------------------
  // PIF v1 → v2
  // -------------------------------------------------------------------------

  const pifSeed = () => wwm.WWM_FORM_TEMPLATES.find((s) => s.templateKey === WWM_PERSONAL_INFORMATION_KEY)!;
  let pifTemplateId: number;
  let pifV1Id: number;
  let pifV2Id: number;
  let v1Submission: number;

  it("PIF v1 installed without a policy stays untouched; a content-locked v2 draft is prepared; the other three stay closed", async () => {
    // The Production state: all four published BEFORE submission_policy existed.
    // PIF v1 = HR review only, exactly the frozen v1 workflow.
    const productionSeeds = wwm.WWM_FORM_TEMPLATES.map((s) => ({
      ...s,
      submissionPolicy: undefined,
      priorPublishedStages: undefined,
      stages: s.templateKey === WWM_PERSONAL_INFORMATION_KEY ? wwmPersonalInformationV1Stages : s.stages,
    }));
    const installed = await installer.installTemplates({ organizationId: orgId, seeds: productionSeeds, ...templateActor(hr) });
    expect(installed.every((r) => r.action === "installed" && r.published)).toBe(true);

    pifTemplateId = installed.find((r) => r.templateKey === WWM_PERSONAL_INFORMATION_KEY)!.templateId;
    const v1Before = (await templates.getPublishedVersion(orgId, pifTemplateId))!;
    pifV1Id = v1Before.id;
    expect(v1Before.submissionPolicy).toBeNull();
    expect(assisted.allowsOnBehalfSubmission(v1Before)).toBe(false);
    const v1StagesBefore = await templates.listStages(orgId, pifV1Id);

    // An existing submission against v1.
    const own = await submissions.createSubmission({ organizationId: orgId, templateId: pifTemplateId, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    v1Submission = own.id;
    expect(own.templateVersionId).toBe(pifV1Id);
    // First use legitimately freezes v1 (firstUsedAt). From here on, nothing may change it.
    const v1Snapshot = (await templates.getVersion(orgId, pifV1Id))!;
    expect(v1Snapshot.firstUsedAt).not.toBeNull();

    // Re-running the ordinary installer with the NEW seeds changes nothing (it skips installed templates).
    const rerun = await installer.installTemplates({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, ...templateActor(hr) });
    expect(rerun.every((r) => r.action === "already_present")).toBe(true);
    expect((await templates.listVersions(orgId, pifTemplateId)).length).toBe(1);

    // Dry run writes nothing.
    const dry = await installer.prepareSubmissionPolicyVersions({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, ...templateActor(hr), dryRun: true });
    const EXPECTED_CHANGES = [
      "submissionPolicy.allowOnBehalfSubmission = true",
      'stage 1 added: "Employee Confirmation & Signature" (resolver subject_employee)',
      '"HR review" moves from stage 1 to stage 2',
    ];
    expect(dry.find((r) => r.templateKey === WWM_PERSONAL_INFORMATION_KEY)).toMatchObject({
      action: "would_prepare_draft",
      publishedVersionNumber: 1,
      proposedChanges: EXPECTED_CHANGES,
    });
    expect((await templates.listVersions(orgId, pifTemplateId)).length).toBe(1);

    const prepared = await installer.prepareSubmissionPolicyVersions({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, ...templateActor(hr) });
    const byKey = Object.fromEntries(prepared.map((r) => [r.templateKey, r]));
    expect(byKey[WWM_PERSONAL_INFORMATION_KEY]!.action).toBe("draft_prepared");
    for (const key of [WWM_LEAVE_APPLICATION_KEY, WWM_STAFF_EVALUATION_KEY, WWM_PROBATIONARY_ASSESSMENT_KEY]) {
      expect(byKey[key]!.action).toBe("unchanged");
      const versions = await templates.listVersions(orgId, byKey[key]!.templateId!);
      expect(versions).toHaveLength(1);
      expect(versions[0]!.submissionPolicy).toBeNull();
    }

    // v1: byte-for-byte the same row, still the published version, same stages.
    const v1After = (await templates.getVersion(orgId, pifV1Id))!;
    expect(v1After).toEqual(v1Snapshot);
    expect((await templates.getTemplate(orgId, pifTemplateId))!.currentPublishedVersionId).toBe(pifV1Id);
    expect(await templates.listStages(orgId, pifV1Id)).toEqual(v1StagesBefore);

    // v2: a DRAFT with identical content and the opted-in policy.
    pifV2Id = byKey[WWM_PERSONAL_INFORMATION_KEY]!.draftVersionId!;
    const v2 = (await templates.getVersion(orgId, pifV2Id))!;
    expect(v2.status).toBe("draft");
    expect(v2.versionNumber).toBe(2);
    expect(v2.definitionSha256).toBe(v1Before.definitionSha256);
    expect(v2.signaturePolicy).toEqual(v1Before.signaturePolicy);
    expect(v2.submissionPolicy).toEqual({ allowOnBehalfSubmission: true });
    const strip = (s: { stageOrder: number; name: string; participant: string; resolver: string; resolverConfig: unknown; editableSectionKeys: unknown; allowedActions: unknown; signatureSlotKey: string | null }) =>
      ({ stageOrder: s.stageOrder, name: s.name, participant: s.participant, resolver: s.resolver, resolverConfig: s.resolverConfig, editableSectionKeys: s.editableSectionKeys, allowedActions: s.allowedActions, signatureSlotKey: s.signatureSlotKey });
    const HR_REVIEW = { name: "HR review", participant: "hr", resolver: "permission_holder", resolverConfig: { permissionKey: "form.approve" }, editableSectionKeys: [], allowedActions: ["approve", "return", "reject"], signatureSlotKey: null };
    expect(v1StagesBefore.map(strip)).toEqual([{ stageOrder: 1, ...HR_REVIEW }]);
    expect((await templates.listStages(orgId, pifV2Id)).map(strip)).toEqual([
      { stageOrder: 1, name: "Employee Confirmation & Signature", participant: "employee", resolver: "subject_employee", resolverConfig: null, editableSectionKeys: [], allowedActions: ["complete"], signatureSlotKey: "employee_signature" },
      { stageOrder: 2, ...HR_REVIEW },
    ]);
    expect(byKey[WWM_PERSONAL_INFORMATION_KEY]!.proposedChanges).toEqual(EXPECTED_CHANGES);
    expect(v2.renderConfig).toEqual(v1Before.renderConfig);

    // Idempotent.
    const again = await installer.prepareSubmissionPolicyVersions({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, ...templateActor(hr) });
    expect(again.find((r) => r.templateKey === WWM_PERSONAL_INFORMATION_KEY)!.action).toBe("draft_already_prepared");
    expect((await templates.listVersions(orgId, pifTemplateId)).length).toBe(2);

    // Not published: assisted completion of the PIF is still refused.
    const hrPermissions = await permissions.getEffectivePermissions(hr.membershipId);
    const stillPublished = (await templates.getPublishedVersion(orgId, pifTemplateId))!;
    expect(stillPublished.id).toBe(pifV1Id);
    expect(() =>
      assisted.authorizeOnBehalf({ permissions: hrPermissions, version: stillPublished, assistance: { reason: "administrative_assistance" } }),
    ).toThrow(assisted.AssistedSubmissionPolicyError);
  });

  it("blocks preparation when the seed content differs from what is published, and needs form_template.manage", async () => {
    const tampered = wwm.WWM_FORM_TEMPLATES.map((s) =>
      s.templateKey === WWM_STAFF_EVALUATION_KEY ? { ...s, title: s.title, submissionPolicy: { allowOnBehalfSubmission: true }, stages: s.stages.map((st) => ({ ...st, name: `${st.name} (changed)` })) } : s,
    );
    const results = await installer.prepareSubmissionPolicyVersions({ organizationId: orgId, seeds: tampered, ...templateActor(hr), dryRun: true });
    expect(results.find((r) => r.templateKey === WWM_STAFF_EVALUATION_KEY)!.action).toBe("blocked_content_changed");

    // A live PIF whose workflow is neither the known v1 nor the v2 seed fails closed — nothing is prepared.
    const unexpectedPif = wwm.WWM_FORM_TEMPLATES.filter((s) => s.templateKey === WWM_PERSONAL_INFORMATION_KEY).map((s) => ({
      ...s,
      submissionPolicy: undefined,
      priorPublishedStages: undefined,
      stages: wwmPersonalInformationV1Stages.map((st) => ({ ...st, name: "HR check" })),
    }));
    const [odd] = await installer.installTemplates({ organizationId: otherOrgId, seeds: unexpectedPif, ...templateActor(foreignHr) });
    const oddResult = await installer.prepareSubmissionPolicyVersions({
      organizationId: otherOrgId,
      seeds: wwm.WWM_FORM_TEMPLATES.filter((s) => s.templateKey === WWM_PERSONAL_INFORMATION_KEY),
      ...templateActor(foreignHr),
    });
    expect(oddResult[0]!.action).toBe("blocked_content_changed");
    expect(await templates.listVersions(otherOrgId, odd!.templateId)).toHaveLength(1);
    await expect(installer.prepareSubmissionPolicyVersions({ organizationId: orgId, seeds: wwm.WWM_FORM_TEMPLATES, ...templateActor(staff) })).rejects.toThrow();
  });

  it("an edit to the prepared draft that omits the policy does not close it; publishing v2 leaves v1 content and its submissions intact", async () => {
    await templates.updateDraftVersion({ organizationId: orgId, versionId: pifV2Id, changeNote: "Reviewed", ...templateActor(hr) });
    expect((await templates.getVersion(orgId, pifV2Id))!.submissionPolicy).toEqual({ allowOnBehalfSubmission: true });

    const v1Before = (await templates.getVersion(orgId, pifV1Id))!;
    // Publishing is a separate governed act; done here only on the throwaway database.
    await templates.publishVersion({ organizationId: orgId, versionId: pifV2Id, ...templateActor(hr) });
    const v1After = (await templates.getVersion(orgId, pifV1Id))!;
    // Publishing archives the superseded version (existing lifecycle); its CONTENT never changes.
    expect(v1After.status).toBe("archived");
    const content = (v: typeof v1Before) => ({
      templateId: v.templateId,
      versionNumber: v.versionNumber,
      definition: v.definition,
      definitionSha256: v.definitionSha256,
      signaturePolicy: v.signaturePolicy,
      submissionPolicy: v.submissionPolicy,
      renderConfig: v.renderConfig,
      publishedAt: v.publishedAt,
      firstUsedAt: v.firstUsedAt,
    });
    expect(content(v1After)).toEqual(content(v1Before));
    expect(v1After.submissionPolicy).toBeNull();
    const [row] = await db.select().from(schema.formSubmissionsTable).where(eq(schema.formSubmissionsTable.id, v1Submission));
    expect(row!.templateVersionId).toBe(pifV1Id);
  });

  // -------------------------------------------------------------------------
  // Provenance, events, audit
  // -------------------------------------------------------------------------

  let assistedPifId: number;

  it("persists assisted provenance, the creating membership and the subject; events and audit carry the category, never the notes", async () => {
    const version = (await templates.getPublishedVersion(orgId, pifTemplateId))!;
    expect(version.id).toBe(pifV2Id);
    const resolved = assisted.authorizeOnBehalf({
      permissions: await permissions.getEffectivePermissions(hr.membershipId),
      version,
      assistance: { reason: "other", notes: NOTES },
    });
    const created = await submissions.createSubmission({ organizationId: orgId, templateId: pifTemplateId, subjectEmployeeId: subject.employeeId, actor: actor(hr), assistance: resolved });
    assistedPifId = created.id;

    const [row] = await db.select().from(schema.formSubmissionsTable).where(eq(schema.formSubmissionsTable.id, created.id));
    expect(row).toMatchObject({
      organizationId: orgId,
      templateVersionId: pifV2Id,
      subjectEmployeeId: subject.employeeId,
      createdByMembershipId: hr.membershipId,
      assisted: true,
      assistanceReason: "other",
      assistanceNotes: NOTES,
      status: "draft",
    });

    const events = await submissions.listEvents(orgId, created.id);
    expect(events[0]!.eventType).toBe("created_on_behalf");
    expect(events[0]!.details).toMatchObject({ assisted: true, assistanceReason: "other", subjectEmployeeId: subject.employeeId });
    expect(JSON.stringify(events)).not.toContain(NOTES);

    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.organizationId, orgId), eq(schema.auditEventsTable.targetId, String(created.id))));
    const createdAudit = audits.find((a) => a.eventType === "form.created_on_behalf")!;
    expect(createdAudit.actorMembershipId).toBe(hr.membershipId);
    expect(createdAudit.metadata).toMatchObject({ subjectEmployeeId: subject.employeeId, assisted: true, assistanceReason: "other" });
    expect(JSON.stringify(audits)).not.toContain(NOTES);

    // List and detail projections never carry the notes — including the subject's own view.
    const listed = await submissions.listSubmissions(orgId, {});
    const summary = listed.find((s) => s.id === created.id)!;
    expect(summary).toMatchObject({ assisted: true, assistanceReason: "other" });
    expect(summary).not.toHaveProperty("assistanceNotes");
    const subjectDetail = await submissions.getSubmissionDetail(orgId, created.id, await viewer(orgId, subject));
    expect(subjectDetail).not.toBeNull();
    expect(JSON.stringify(subjectDetail)).not.toContain(NOTES);
    const hrDetail = await submissions.getSubmissionDetail(orgId, created.id, await viewer(orgId, hr));
    expect(JSON.stringify(hrDetail)).not.toContain(NOTES);
  });

  it("HR's submit is recorded as submitted_on_behalf, and provenance is unchanged by later writes", async () => {
    const hrViewer = await viewer(orgId, hr);
    await submissions.saveDraft({ organizationId: orgId, submissionId: assistedPifId, answers: { spouse_name: "N/A" }, viewer: hrViewer, actor: actor(hr) });
    await submissions.submit({ organizationId: orgId, submissionId: assistedPifId, viewer: hrViewer, actor: actor(hr) });

    const events = await submissions.listEvents(orgId, assistedPifId);
    expect(events.map((e) => e.eventType)).toEqual(["created_on_behalf", "draft_saved", "submitted_on_behalf"]);
    expect(events[2]!.details).toMatchObject({ assisted: true, assistanceReason: "other", subjectEmployeeId: subject.employeeId });
    expect(JSON.stringify(events)).not.toContain(NOTES);
    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.organizationId, orgId), eq(schema.auditEventsTable.targetId, String(assistedPifId))));
    expect(audits.map((a) => a.eventType)).toContain("form.submitted_on_behalf");
    expect(JSON.stringify(audits)).not.toContain(NOTES);

    const [row] = await db.select().from(schema.formSubmissionsTable).where(eq(schema.formSubmissionsTable.id, assistedPifId));
    expect(row).toMatchObject({ assisted: true, assistanceReason: "other", assistanceNotes: NOTES, createdByMembershipId: hr.membershipId, subjectEmployeeId: subject.employeeId });

    // A self-completed form submitted by its own subject is a plain submission.
    const staffViewer = await viewer(orgId, staff);
    await submissions.submit({ organizationId: orgId, submissionId: v1Submission, viewer: staffViewer, actor: actor(staff) });
    expect((await submissions.listEvents(orgId, v1Submission)).map((e) => e.eventType)).toEqual(["created", "submitted"]);
  });

  it("PIF v2 assisted flow: only the subject employee can sign and confirm; HR review waits, then a different HR user reviews", async () => {
    const hrViewer = await viewer(orgId, hr);
    const hr2Viewer = await viewer(orgId, hr2);
    const subjectViewer = await viewer(orgId, subject);
    const staffViewer = await viewer(orgId, staff);
    type Viewer = Awaited<ReturnType<typeof viewer>>;
    const act = (p: Person, v: Viewer, action: "complete" | "approve") =>
      submissions.stageAction({ organizationId: orgId, submissionId: assistedPifId, action, viewer: v, actor: actor(p) });
    const signDrawn = async (p: Person, v: Viewer) =>
      signatures.applySignature({ organizationId: orgId, actor: actor(p), viewer: v, submissionId: assistedPifId, slotKey: "employee_signature", method: "drawn", imageFile: file(await png()) });
    const signWithAsset = (p: Person, v: Viewer, assetId: number) =>
      signatures.applySignature({ organizationId: orgId, actor: actor(p), viewer: v, submissionId: assistedPifId, slotKey: "employee_signature", method: "uploaded", sourceAssetId: assetId });

    // Awaiting the employee — visible as such to the employee, to HR and in lists.
    const subjectDetail = (await submissions.getSubmissionDetail(orgId, assistedPifId, subjectViewer))!;
    expect(subjectDetail.submission).toMatchObject({ status: "pending_approval", currentStageOrder: 1, currentStageName: "Employee Confirmation & Signature", templateVersionId: pifV2Id, assisted: true });
    expect(subjectDetail.viewer.availableActions).toEqual(["complete"]);
    expect((await submissions.getSubmissionDetail(orgId, assistedPifId, hrViewer))!.viewer.availableActions).toEqual([]);
    expect((await submissions.listSubmissions(orgId, {})).find((s) => s.id === assistedPifId)!.currentStageName).toBe("Employee Confirmation & Signature");

    // The assisting HR creator: no signature, no use of its own stored asset, no completion of the employee's stage.
    await expect(signDrawn(hr, hrViewer)).rejects.toThrow(signatures.SignatureAuthorityError);
    const hrAsset = await signatures.uploadSignatureAsset({ organizationId: orgId, actor: actor(hr), file: file(await png()) });
    await expect(signWithAsset(hr, hrViewer, hrAsset.id)).rejects.toThrow(signatures.SignatureAuthorityError);
    await expect(act(hr, hrViewer, "complete")).rejects.toThrow(submissions.FormStageAuthorityError);
    // Another employee: neither signature nor completion.
    await expect(signDrawn(staff, staffViewer)).rejects.toThrow(signatures.SignatureAuthorityError);
    await expect(act(staff, staffViewer, "complete")).rejects.toThrow(submissions.FormStageAuthorityError);
    // HR review cannot occur before the employee stage.
    await expect(act(hr2, hr2Viewer, "approve")).rejects.toThrow(/not allowed at this stage/);
    // The subject cannot bypass their own signature with a direct API call, nor sign with HR's asset.
    await expect(act(subject, subjectViewer, "complete")).rejects.toThrow(/own signature/);
    await expect(signWithAsset(subject, subjectViewer, hrAsset.id)).rejects.toThrow(/your own stored signature/);
    expect(await signatures.listSubmissionSignatures(orgId, hrViewer, assistedPifId)).toHaveLength(0);

    // The subject signs and confirms; the form advances to HR review.
    const signed = await signDrawn(subject, subjectViewer);
    expect(signed).toMatchObject({ slotKey: "employee_signature", signerUserId: subject.userId, signerMembershipId: subject.membershipId, representedEmployeeId: subject.employeeId, stageOrder: 1 });
    expect(await act(subject, subjectViewer, "complete")).toMatchObject({ status: "pending_approval", currentStageOrder: 2 });

    // Maker-checker: the assisting HR user cannot also review; the subject cannot; a different HR user can.
    await expect(act(hr, hrViewer, "approve")).rejects.toThrow(/raised it or whom it concerns/);
    await expect(act(subject, subjectViewer, "approve")).rejects.toThrow(submissions.FormStageAuthorityError);
    expect((await act(hr2, hr2Viewer, "approve")).status).toBe("approved");

    // History records every actor, stage and time; never the notes.
    const events = await submissions.listEvents(orgId, assistedPifId);
    expect(events.map((e) => e.eventType)).toEqual([
      "created_on_behalf",
      "draft_saved",
      "submitted_on_behalf",
      "signature_applied",
      "stage_completed",
      "stage_completed",
      "approved",
    ]);
    const of = (type: string) => events.filter((e) => e.eventType === type);
    expect(of("created_on_behalf")[0]).toMatchObject({ actorUserId: hr.userId, actorMembershipId: hr.membershipId });
    expect(of("submitted_on_behalf")[0]).toMatchObject({ actorMembershipId: hr.membershipId });
    expect(of("signature_applied")[0]).toMatchObject({ actorUserId: subject.userId, actorMembershipId: subject.membershipId });
    expect(of("stage_completed")[0]).toMatchObject({ actorMembershipId: subject.membershipId, stageOrder: 1, stageName: "Employee Confirmation & Signature" });
    expect(of("stage_completed")[1]).toMatchObject({ actorMembershipId: hr2.membershipId, stageOrder: 2, stageName: "HR review" });
    expect(events.every((e) => e.occurredAt instanceof Date)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(NOTES);
    const audits = await db
      .select()
      .from(schema.auditEventsTable)
      .where(and(eq(schema.auditEventsTable.organizationId, orgId), eq(schema.auditEventsTable.targetId, String(assistedPifId))));
    expect(audits.map((a) => a.eventType)).toEqual(expect.arrayContaining(["form.created_on_behalf", "form.submitted_on_behalf", "form.stage_completed", "form.approved"]));
    expect(JSON.stringify(audits)).not.toContain(NOTES);
    const [row] = await db.select().from(schema.formSubmissionsTable).where(eq(schema.formSubmissionsTable.id, assistedPifId));
    expect(row).toMatchObject({ templateVersionId: pifV2Id, assisted: true, assistanceReason: "other", assistanceNotes: NOTES, createdByMembershipId: hr.membershipId, subjectEmployeeId: subject.employeeId });
  });

  it("PIF v2 normal flow: the employee signs and confirms through the same stage; changed content needs a fresh signature", async () => {
    const hrViewer = await viewer(orgId, hr);
    type Viewer = Awaited<ReturnType<typeof viewer>>;
    const sign = async (p: Person, v: Viewer, submissionId: number) =>
      signatures.applySignature({ organizationId: orgId, actor: actor(p), viewer: v, submissionId, slotKey: "employee_signature", method: "drawn", imageFile: file(await png()) });

    // Sign the draft, submit it unchanged, confirm (the UI's "Submit & confirm").
    const assessorViewer = await viewer(orgId, assessor);
    const own = await submissions.createSubmission({ organizationId: orgId, templateId: pifTemplateId, subjectEmployeeId: assessor.employeeId, actor: actor(assessor) });
    expect(own).toMatchObject({ templateVersionId: pifV2Id, assisted: false });
    await submissions.saveDraft({ organizationId: orgId, submissionId: own.id, answers: { spouse_name: "C" }, viewer: assessorViewer, actor: actor(assessor) });
    await sign(assessor, assessorViewer, own.id);
    await submissions.submit({ organizationId: orgId, submissionId: own.id, viewer: assessorViewer, actor: actor(assessor) });
    expect(await submissions.stageAction({ organizationId: orgId, submissionId: own.id, action: "complete", viewer: assessorViewer, actor: actor(assessor) })).toMatchObject({ currentStageOrder: 2 });
    expect((await submissions.listEvents(orgId, own.id)).map((e) => e.eventType)).toEqual(["created", "draft_saved", "signature_applied", "submitted", "stage_completed"]);
    expect((await submissions.stageAction({ organizationId: orgId, submissionId: own.id, action: "approve", viewer: hrViewer, actor: actor(hr) })).status).toBe("approved");

    // Sign, then change the answers: the old signature no longer attests the content.
    const staffViewer = await viewer(orgId, staff);
    const changed = await submissions.createSubmission({ organizationId: orgId, templateId: pifTemplateId, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    await submissions.saveDraft({ organizationId: orgId, submissionId: changed.id, answers: { spouse_name: "A" }, viewer: staffViewer, actor: actor(staff) });
    const stale = await sign(staff, staffViewer, changed.id);
    await submissions.saveDraft({ organizationId: orgId, submissionId: changed.id, answers: { spouse_name: "B" }, viewer: staffViewer, actor: actor(staff) });
    await submissions.submit({ organizationId: orgId, submissionId: changed.id, viewer: staffViewer, actor: actor(staff) });
    await expect(submissions.stageAction({ organizationId: orgId, submissionId: changed.id, action: "complete", viewer: staffViewer, actor: actor(staff) })).rejects.toThrow(/own signature/);
    await signatures.revokeSignature({ organizationId: orgId, actor: actor(staff), viewer: staffViewer, submissionId: changed.id, signatureId: stale.id, reason: "Form changed after signing" });
    await sign(staff, staffViewer, changed.id);
    expect(await submissions.stageAction({ organizationId: orgId, submissionId: changed.id, action: "complete", viewer: staffViewer, actor: actor(staff) })).toMatchObject({ currentStageOrder: 2 });
  });

  it("offers no signature waiver anywhere", async () => {
    for (const mod of [signatures, submissions, assisted, installer, templates]) {
      expect(Object.keys(mod).filter((k) => /waiv|bypass|skipSignature/i.test(k))).toEqual([]);
    }
    const result = (await db.execute(sql`select enum_range(null::form_signature_method)::text as methods, enum_range(null::form_submission_event_type)::text as events`)) as unknown as { rows: { methods: string; events: string }[] };
    expect(result.rows[0]!.methods).toBe("{drawn,uploaded,device}");
    expect(result.rows[0]!.events).not.toMatch(/waiv/i);
  });

  it("form.assess alone — every other HR form key, via real role grants — does not authorize assisted creation", async () => {
    const version = (await templates.getPublishedVersion(orgId, pifTemplateId))!;
    const assessorPermissions = await permissions.getEffectivePermissions(assessor.membershipId);
    expect(assessorPermissions.has("form.assess")).toBe(true);
    expect(() => assisted.authorizeOnBehalf({ permissions: assessorPermissions, version, assistance: { reason: "administrative_assistance" } })).toThrow(
      assisted.AssistedSubmissionPolicyError,
    );
    const staffPermissions = await permissions.getEffectivePermissions(staff.membershipId);
    expect(() => assisted.authorizeOnBehalf({ permissions: staffPermissions, version, assistance: { reason: "administrative_assistance" } })).toThrow(
      /form_submission.create_on_behalf/,
    );
  });

  // -------------------------------------------------------------------------
  // Signature ownership
  // -------------------------------------------------------------------------

  it("HR cannot sign, upload or reuse its own asset as the subject; the employee still signs their own slot", async () => {
    const assistTemplateKey = `assisted_sig_${suffix.replace(/-/g, "_")}`;
    const definition = {
      header: { logo: "organization", lines: ["ASSISTED SIGNATURE TEST"] },
      sections: [
        { key: "details", title: "DETAILS", layout: "key_value", items: [{ kind: "field", key: "remarks", label: "Remarks", type: "short_text" }] },
        {
          key: "declaration",
          title: "DECLARATION",
          layout: "stack",
          items: [{ kind: "signature", key: "employee_signature", label: "Signature", role: "employee", dateLabel: "Date", required: true }],
        },
      ],
    };
    const { template, version } = await templates.createTemplate({
      organizationId: orgId,
      templateKey: assistTemplateKey,
      formType: "personal_information",
      moduleKey: null,
      title: "Assisted signature test",
      definition,
      signaturePolicy: { slots: [{ key: "employee_signature", role: "employee", required: true, methods: ["drawn", "uploaded"] }] },
      submissionPolicy: { allowOnBehalfSubmission: true },
      stages: [
        { stageOrder: 1, name: "Employee signature", participant: "employee", resolver: "subject_employee", editableSectionKeys: [], allowedActions: ["complete"], signatureSlotKey: "employee_signature" },
        { stageOrder: 2, name: "HR review", participant: "hr", resolver: "permission_holder", resolverConfig: { permissionKey: "form.approve" }, editableSectionKeys: [], allowedActions: ["approve", "return", "reject"] },
      ],
      ...templateActor(hr),
    });
    const published = await templates.publishVersion({ organizationId: orgId, versionId: version.id, ...templateActor(hr) });
    const hrViewer = await viewer(orgId, hr);
    const subjectViewer = await viewer(orgId, subject);

    const resolved = assisted.authorizeOnBehalf({ permissions: hrViewer.permissions, version: published, assistance: { reason: "accessibility_assistance" } });
    const created = await submissions.createSubmission({ organizationId: orgId, templateId: template.id, subjectEmployeeId: subject.employeeId, actor: actor(hr), assistance: resolved });
    await submissions.submit({ organizationId: orgId, submissionId: created.id, answers: { remarks: "entered by HR" }, viewer: hrViewer, actor: actor(hr) });

    // HR: drawn signature on the employee's slot.
    await expect(
      signatures.applySignature({ organizationId: orgId, actor: actor(hr), viewer: hrViewer, submissionId: created.id, slotKey: "employee_signature", method: "drawn", imageFile: file(await png()) }),
    ).rejects.toThrow(signatures.SignatureAuthorityError);
    // HR: its own stored signature asset, applied as the employee.
    const hrAsset = await signatures.uploadSignatureAsset({ organizationId: orgId, actor: actor(hr), file: file(await png()) });
    await expect(
      signatures.applySignature({ organizationId: orgId, actor: actor(hr), viewer: hrViewer, submissionId: created.id, slotKey: "employee_signature", method: "uploaded", sourceAssetId: hrAsset.id }),
    ).rejects.toThrow(signatures.SignatureAuthorityError);
    // HR: completing the employee's stage for them.
    await expect(submissions.stageAction({ organizationId: orgId, submissionId: created.id, action: "complete", viewer: hrViewer, actor: actor(hr) })).rejects.toThrow(
      submissions.FormStageAuthorityError,
    );
    // The employee cannot use HR's asset either.
    await expect(
      signatures.applySignature({ organizationId: orgId, actor: actor(subject), viewer: subjectViewer, submissionId: created.id, slotKey: "employee_signature", method: "uploaded", sourceAssetId: hrAsset.id }),
    ).rejects.toThrow(/your own stored signature/);
    expect(await signatures.listSubmissionSignatures(orgId, hrViewer, created.id)).toHaveLength(0);

    // The employee signs their own slot and completes their stage.
    const signed = await signatures.applySignature({ organizationId: orgId, actor: actor(subject), viewer: subjectViewer, submissionId: created.id, slotKey: "employee_signature", method: "drawn", imageFile: file(await png()) });
    expect(signed).toMatchObject({ slotKey: "employee_signature" });
    const applied = await signatures.listSubmissionSignatures(orgId, hrViewer, created.id);
    expect(applied).toHaveLength(1);
    expect(JSON.stringify(applied)).toContain(String(subject.userId));
    const completed = await submissions.stageAction({ organizationId: orgId, submissionId: created.id, action: "complete", viewer: subjectViewer, actor: actor(subject) });
    expect(completed.currentStageOrder).toBe(2);

    const [row] = await db.select().from(schema.formSubmissionsTable).where(eq(schema.formSubmissionsTable.id, created.id));
    expect(row).toMatchObject({ assisted: true, assistanceReason: "accessibility_assistance", assistanceNotes: null, createdByMembershipId: hr.membershipId });
  });

  it("the PIF's employee signature cannot be applied by HR on an assisted PIF", async () => {
    await expect(
      signatures.applySignature({ organizationId: orgId, actor: actor(hr), viewer: await viewer(orgId, hr), submissionId: assistedPifId, slotKey: "employee_signature", method: "drawn", imageFile: file(await png()) }),
    ).rejects.toThrow();
    // The only signature on this form is the subject's own (applied in the v2 flow test).
    const applied = await signatures.listSubmissionSignatures(orgId, await viewer(orgId, hr), assistedPifId);
    expect(applied.filter((s) => s.signerUserId === hr.userId)).toHaveLength(0);
    expect(applied.every((s) => s.signerUserId === subject.userId && s.representedEmployeeId === subject.employeeId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Tenancy and fail-closed policy
  // -------------------------------------------------------------------------

  it("refuses cross-tenant templates and subjects, whatever ids the client supplies", async () => {
    // Org B's HR (holding the key) cannot use org A's template.
    expect(await templates.getTemplate(otherOrgId, pifTemplateId)).toBeNull();
    await expect(
      submissions.createSubmission({ organizationId: otherOrgId, templateId: pifTemplateId, subjectEmployeeId: foreignStaff.employeeId, actor: actor(foreignHr), assistance: { assisted: true, assistanceReason: "administrative_assistance", assistanceNotes: null } }),
    ).rejects.toThrow(/not available/);
    // Org A's HR cannot raise an assisted form for org B's employee.
    await expect(
      submissions.createSubmission({ organizationId: orgId, templateId: pifTemplateId, subjectEmployeeId: foreignStaff.employeeId, actor: actor(hr), assistance: { assisted: true, assistanceReason: "administrative_assistance", assistanceNotes: null } }),
    ).rejects.toThrow(submissions.FormSubjectNotFoundError);
    // Nothing was written for either attempt.
    const foreignRows = await db.select().from(schema.formSubmissionsTable).where(eq(schema.formSubmissionsTable.subjectEmployeeId, foreignStaff.employeeId));
    expect(foreignRows).toHaveLength(0);
  });

  it("fails closed for every stored policy value except literal allowOnBehalfSubmission: true", async () => {
    const seed = pifSeed();
    const { version } = await templates.createTemplate({
      organizationId: orgId,
      templateKey: `policy_probe_${suffix.replace(/-/g, "_")}`,
      formType: seed.formType,
      moduleKey: null,
      title: "Policy probe",
      definition: seed.definition,
      stages: seed.stages,
      signaturePolicy: seed.signaturePolicy,
      ...templateActor(hr),
    });
    const probes: unknown[] = [
      null,
      {},
      { allowOnBehalfSubmission: false },
      { allowOnBehalfSubmission: "true" },
      { allowOnBehalfSubmission: 1 },
      { allowOnBehalfSubmission: "yes" },
      { allowOnBehalfSubmission: [true] },
      "allowOnBehalfSubmission",
      true,
      1,
      [{ allowOnBehalfSubmission: true }],
    ];
    for (const probe of probes) {
      await db.update(schema.formTemplateVersionsTable).set({ submissionPolicy: probe as never }).where(eq(schema.formTemplateVersionsTable.id, version.id));
      const stored = (await templates.getVersion(orgId, version.id))!;
      expect(assisted.allowsOnBehalfSubmission(stored), JSON.stringify(probe)).toBe(false);
    }
    await db.update(schema.formTemplateVersionsTable).set({ submissionPolicy: { allowOnBehalfSubmission: true } }).where(eq(schema.formTemplateVersionsTable.id, version.id));
    expect(assisted.allowsOnBehalfSubmission((await templates.getVersion(orgId, version.id))!)).toBe(true);
  });
});
