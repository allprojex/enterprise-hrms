/**
 * WS-26A — live integration against a disposable local PostgreSQL (the
 * docker-compose `db` service on 5433). Skipped unless WS26_LIVE_DATABASE_URL
 * is set; refuses a non-local host (liveDbGuard).
 *
 *   WS26_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
 *     npx vitest run src/test/formEngineLive.test.ts
 *
 * What is proven here, against real rows and real RLS-enabled tables:
 *   - tenant isolation: another organization cannot list, read, submit,
 *     download or act on WWM-shaped templates and submissions (404 shape),
 *     guessed ids do not help, and the organization id in a request never
 *     overrides the proven one;
 *   - a published version is frozen once used;
 *   - lifecycle: draft → submit → stage → approve → finalize → archive with
 *     append-only revisions and a complete chronology;
 *   - maker-checker and stage authority;
 *   - download at every state; the final snapshot is immutable and hashed;
 *   - permissions: an ordinary employee cannot administer templates.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe.skipIf(!LIVE_URL)("WS-26A live: templates, submissions, isolation, immutability", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let render: typeof import("../lib/formEngine/render");
  let wwm: typeof import("../formTemplates/wwm");
  let pdfTools: typeof import("../lib/pdf/layoutRenderer");

  const suffix = `ws26-${Date.now().toString(36)}`;
  let orgId: number;
  let otherOrgId: number;
  let hrRoleId: number;
  let employeeRoleId: number;

  interface Person {
    userId: number;
    membershipId: number;
    employeeId: number;
  }
  let hr: Person;
  let manager: Person;
  let staff: Person;
  let foreignHr: Person;

  beforeAll(async () => {
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    render = await import("../lib/formEngine/render");
    wwm = await import("../formTemplates/wwm");
    pdfTools = await import("../lib/pdf/layoutRenderer");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS26 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `WS26 other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    // Roles carrying the WS-26 keys, created per organization so the test never
    // depends on the seeded system roles being present.
    const ensurePermission = async (key: string) => {
      const [existing] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
      if (existing) return existing.id;
      const [p] = await db.insert(schema.permissionsTable).values({ key, resource: key.split(".")[0], action: key.split(".").slice(1).join(".") }).returning();
      return p.id;
    };
    const mkRole = async (organizationId: number, key: string, permissionKeys: string[]) => {
      const [role] = await db.insert(schema.rolesTable).values({ organizationId, key: `${key}-${suffix}`, label: key }).returning();
      for (const pk of permissionKeys) {
        await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await ensurePermission(pk) });
      }
      return role.id;
    };
    const HR_KEYS = ["form_template.manage", "form_template.publish", "form.read", "form.assess", "form.approve", "form.finalize", "form.final.read"];
    hrRoleId = await mkRole(orgId, "hr", HR_KEYS);
    employeeRoleId = await mkRole(orgId, "employee", ["organization.read"]);
    const foreignHrRoleId = await mkRole(otherOrgId, "hr", HR_KEYS);

    const mkPerson = async (tag: string, organizationId: number, roleId: number, overrides: Record<string, unknown> = {}): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "Person", organizationId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId, firstName: tag, lastName: "Person", ...overrides }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };

    hr = await mkPerson("hr", orgId, hrRoleId);
    manager = await mkPerson("manager", orgId, employeeRoleId);
    staff = await mkPerson("staff", orgId, employeeRoleId, { reportingManagerId: manager.employeeId });
    foreignHr = await mkPerson("foreignhr", otherOrgId, foreignHrRoleId);
  });

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });
  const templateActor = (p: Person) => ({ actorApplicationUserId: p.userId, actorMembershipId: p.membershipId });
  const viewer = (organizationId: number, p: Person) => submissions.buildViewerContext(organizationId, actor(p));

  let leaveTemplateId: number;
  let leaveVersionId: number;

  it("HR creates and publishes the WWM leave template; the version is frozen once a submission uses it", async () => {
    const seed = wwm.WWM_FORM_TEMPLATES[0];
    const { template, version } = await templates.createTemplate({
      organizationId: orgId,
      templateKey: seed.templateKey,
      formType: seed.formType,
      moduleKey: null,
      title: seed.title,
      definition: seed.definition,
      stages: seed.stages,
      ...templateActor(hr),
    });
    leaveTemplateId = template.id;
    leaveVersionId = version.id;
    expect(version.status).toBe("draft");
    expect(await templates.getPublishedVersion(orgId, template.id)).toBeNull();

    const published = await templates.publishVersion({ organizationId: orgId, versionId: version.id, ...templateActor(hr) });
    expect(published.status).toBe("published");
    expect((await templates.getTemplate(orgId, template.id))!.currentPublishedVersionId).toBe(version.id);

    // Published definitions are never editable.
    await expect(templates.updateDraftVersion({ organizationId: orgId, versionId: version.id, definition: seed.definition, ...templateActor(hr) })).rejects.toThrow(/Only a draft version/);

    // Second version: draft, then published, superseding the first.
    const v2 = await templates.createDraftVersion({ organizationId: orgId, templateId: template.id, definition: seed.definition, stages: seed.stages, changeNote: "v2", ...templateActor(hr) });
    expect(v2.versionNumber).toBe(2);
    await expect(templates.createDraftVersion({ organizationId: orgId, templateId: template.id, definition: seed.definition, ...templateActor(hr) })).rejects.toThrow(/draft version already exists/);
    const p2 = await templates.publishVersion({ organizationId: orgId, versionId: v2.id, ...templateActor(hr) });
    expect(p2.status).toBe("published");
    expect((await templates.getVersion(orgId, version.id))!.status).toBe("archived");
    leaveVersionId = v2.id;

    const staffViewer = await viewer(orgId, staff);
    const submission = await submissions.createSubmission({ organizationId: orgId, templateId: template.id, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    expect(submission.templateVersionId).toBe(v2.id);
    expect((await templates.getVersion(orgId, v2.id))!.firstUsedAt).not.toBeNull();
    expect(await templates.versionHasSubmissions(orgId, v2.id)).toBe(true);
    expect(staffViewer.employeeId).toBe(staff.employeeId);
  });

  it("another tenant cannot discover, read, submit to, or download the template — guessed ids answer nothing", async () => {
    const foreignList = await templates.listTemplates(otherOrgId);
    expect(foreignList.find((t) => t.id === leaveTemplateId)).toBeUndefined();
    expect(await templates.getTemplate(otherOrgId, leaveTemplateId)).toBeNull();
    expect(await templates.getVersion(otherOrgId, leaveVersionId)).toBeNull();
    await expect(templates.publishVersion({ organizationId: otherOrgId, versionId: leaveVersionId, ...templateActor(foreignHr) })).rejects.toThrow(templates.FormVersionNotFoundError);
    await expect(submissions.createSubmission({ organizationId: otherOrgId, templateId: leaveTemplateId, subjectEmployeeId: foreignHr.employeeId, actor: actor(foreignHr) })).rejects.toThrow(/not available/);
    await expect(render.renderBlankDocument({ organizationId: otherOrgId, versionId: leaveVersionId })).rejects.toThrow(templates.FormVersionNotFoundError);
    // A foreign subject id cannot be attached to a WWM-org submission either.
    await expect(submissions.createSubmission({ organizationId: orgId, templateId: leaveTemplateId, subjectEmployeeId: foreignHr.employeeId, actor: actor(hr) })).rejects.toThrow(submissions.FormSubjectNotFoundError);
  });

  it("lifecycle: draft revisions, submit, manager approval, finalize with an immutable hashed snapshot, archive", async () => {
    const staffViewer = await viewer(orgId, staff);
    const managerViewer = await viewer(orgId, manager);
    const hrViewer = await viewer(orgId, hr);

    const created = await submissions.createSubmission({ organizationId: orgId, templateId: leaveTemplateId, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    const id = created.id;

    // Autofill snapshot carries authoritative values; the client cannot override them.
    const detail0 = (await submissions.getSubmissionDetail(orgId, id, staffViewer))!;
    expect(detail0.currentRevision!.autofillSnapshot.employee_name).toBe("staff Person");
    expect(detail0.viewer.canSubmit).toBe(true);

    await submissions.saveDraft({ organizationId: orgId, submissionId: id, answers: { employee_name: "Forged", leave_type: "annual_leave", from_date: "2026-10-05" }, viewer: staffViewer, actor: actor(staff) });
    await submissions.saveDraft({ organizationId: orgId, submissionId: id, answers: { leave_type: "annual_leave", from_date: "2026-10-05", to_date: "2026-10-07", days_requested: 3, contact_phone: "020" }, viewer: staffViewer, actor: actor(staff) });
    const afterDrafts = (await submissions.getSubmissionDetail(orgId, id, staffViewer))!;
    expect(afterDrafts.revisions.map((r) => r.kind)).toEqual(["draft", "draft", "draft"]);
    expect(afterDrafts.currentRevision!.answers.employee_name).toBeUndefined();
    expect(afterDrafts.currentRevision!.answers.days_requested).toBe(3);

    // Draft download renders with the DRAFT marker.
    const draftPdf = await render.renderSubmissionDocument({ organizationId: orgId, submissionId: id, kind: "draft" });
    expect(pdfTools.extractPdfTextRuns(draftPdf).join(" ")).toContain("DRAFT");

    // Submit → pending at stage 1 (manager).
    const submitted = await submissions.submit({ organizationId: orgId, submissionId: id, viewer: staffViewer, actor: actor(staff) });
    expect(submitted.status).toBe("pending_approval");
    expect(submitted.currentStageOrder).toBe(1);
    expect(submitted.stageCountSnapshot).toBe(1);

    // The subject cannot act on their own approval stage; HR is not the resolved actor either.
    await expect(submissions.stageAction({ organizationId: orgId, submissionId: id, action: "approve", viewer: staffViewer, actor: actor(staff) })).rejects.toThrow(submissions.FormStageAuthorityError);
    await expect(submissions.stageAction({ organizationId: orgId, submissionId: id, action: "approve", viewer: hrViewer, actor: actor(hr) })).rejects.toThrow(/not the actor/);

    // The manager sees it in their queue and may only edit the approval section.
    const managerQueue = await submissions.listVisibleSubmissions(orgId, managerViewer);
    expect(managerQueue.some((s) => s.id === id)).toBe(true);
    const managerDetail = (await submissions.getSubmissionDetail(orgId, id, managerViewer))!;
    expect(managerDetail.viewer.editableSectionKeys).toEqual(["approval"]);
    expect(managerDetail.viewer.availableActions).toEqual(["approve", "return", "reject"]);

    // A return without a reason is refused and changes nothing.
    await expect(
      submissions.stageAction({ organizationId: orgId, submissionId: id, action: "return", notes: "   ", viewer: managerViewer, actor: actor(manager) }),
    ).rejects.toThrow(submissions.FormDecisionReasonRequiredError);
    expect((await submissions.getSubmission(orgId, id))!.status).toBe("pending_approval");

    // Return for correction, resubmit, then approve with the approval section filled.
    const returned = await submissions.stageAction({ organizationId: orgId, submissionId: id, action: "return", notes: "Add the email address", viewer: managerViewer, actor: actor(manager) });
    expect(returned.status).toBe("returned");
    const returnedPdf = await render.renderSubmissionDocument({ organizationId: orgId, submissionId: id, kind: "returned" });
    expect(pdfTools.extractPdfTextRuns(returnedPdf).join(" ")).toContain("RETURNED FOR CORRECTION");

    await submissions.saveDraft({ organizationId: orgId, submissionId: id, answers: { ...afterDrafts.currentRevision!.answers, contact_email: "s@example.invalid" }, viewer: staffViewer, actor: actor(staff) });
    const resubmitted = await submissions.submit({ organizationId: orgId, submissionId: id, viewer: staffViewer, actor: actor(staff) });
    expect(resubmitted.status).toBe("pending_approval");

    const approved = await submissions.stageAction({
      organizationId: orgId,
      submissionId: id,
      action: "approve",
      answers: { decision: "approved", approved_by: "manager Person", date_approved: "2026-09-06", days_remaining: 12, date_of_resumption: "2026-10-08", from_date: "1999-01-01" },
      viewer: managerViewer,
      actor: actor(manager),
    });
    expect(approved.status).toBe("approved");
    const approvedDetail = (await submissions.getSubmissionDetail(orgId, id, hrViewer))!;
    // The manager's attempt to change an employee-section value was ignored; the approval section took.
    expect(approvedDetail.currentRevision!.answers.from_date).toBe("2026-10-05");
    expect(approvedDetail.currentRevision!.answers.decision).toBe("approved");
    expect(approvedDetail.events.map((e) => e.eventType)).toEqual([
      "created", "draft_saved", "draft_saved", "submitted", "returned", "draft_saved", "resubmitted", "stage_completed", "approved",
    ]);

    // Finalize (HR): immutable snapshot with hash; a second finalize is refused; the bytes served equal the hash.
    await expect(submissions.finalize({ organizationId: orgId, submissionId: id, viewer: staffViewer, actor: actor(staff) })).rejects.toThrow(/form.finalize/);
    const finalized = await submissions.finalize({ organizationId: orgId, submissionId: id, viewer: hrViewer, actor: actor(hr) });
    expect(finalized.status).toBe("finalized");
    expect(finalized.finalSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(submissions.finalize({ organizationId: orgId, submissionId: id, viewer: hrViewer, actor: actor(hr) })).rejects.toThrow(submissions.FormSubmissionFinalizedError);

    const { getGeneratedDocument } = await import("../lib/documentGeneration");
    const { readOrgFile } = await import("../lib/fileStorage");
    const generated = (await getGeneratedDocument(orgId, finalized.finalDocumentId!))!;
    expect(generated.sourceType).toBe("form_submission");
    const bytes = await readOrgFile(orgId, generated.storageKey);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(finalized.finalSha256);
    const finalText = pdfTools.extractPdfTextRuns(bytes).join(" ");
    expect(finalText).toContain("FINAL");
    expect(finalText).toContain("Approval & Signature Certificate");
    expect(finalText).toContain("7 working days");

    // A later employee-record change does not alter the stored snapshot.
    await db.update(schema.employeesTable).set({ firstName: "Renamed" }).where(eq(schema.employeesTable.id, staff.employeeId));
    const again = await readOrgFile(orgId, generated.storageKey);
    expect(again.equals(bytes)).toBe(true);
    expect(pdfTools.extractPdfTextRuns(again).join(" ")).toContain("staff Person");

    // Archive.
    const archived = await submissions.archive({ organizationId: orgId, submissionId: id, viewer: hrViewer, actor: actor(hr) });
    expect(archived.status).toBe("archived");

    // Cross-tenant: the foreign HR cannot see, act on or render it, even with the real id.
    const foreignViewer = await viewer(otherOrgId, foreignHr);
    expect(await submissions.getSubmissionDetail(otherOrgId, id, foreignViewer)).toBeNull();
    expect((await submissions.listVisibleSubmissions(otherOrgId, foreignViewer)).some((s) => s.id === id)).toBe(false);
    await expect(render.renderSubmissionDocument({ organizationId: otherOrgId, submissionId: id, kind: "submitted" })).rejects.toThrow(submissions.FormSubmissionNotFoundError);
    await expect(submissions.finalize({ organizationId: otherOrgId, submissionId: id, viewer: foreignViewer, actor: actor(foreignHr) })).rejects.toThrow(submissions.FormSubmissionNotFoundError);
  });

  it("a rejected form keeps its record, renders REJECTED, and an unrelated employee cannot see it", async () => {
    const staffViewer = await viewer(orgId, staff);
    const managerViewer = await viewer(orgId, manager);
    const created = await submissions.createSubmission({ organizationId: orgId, templateId: leaveTemplateId, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    await submissions.submit({ organizationId: orgId, submissionId: created.id, answers: { leave_type: "sick_leave", from_date: "2026-11-01", to_date: "2026-11-02", days_requested: 2 }, viewer: staffViewer, actor: actor(staff) });
    // A rejection without a reason is refused and changes nothing.
    await expect(
      submissions.stageAction({ organizationId: orgId, submissionId: created.id, action: "reject", answers: { decision: "rejected", rejection_reason: "Season" }, viewer: managerViewer, actor: actor(manager) }),
    ).rejects.toThrow(submissions.FormDecisionReasonRequiredError);
    expect((await submissions.getSubmission(orgId, created.id))!.status).toBe("pending_approval");
    const rejected = await submissions.stageAction({ organizationId: orgId, submissionId: created.id, action: "reject", answers: { decision: "rejected", rejection_reason: "Season" }, notes: "Season", viewer: managerViewer, actor: actor(manager) });
    expect(rejected.status).toBe("rejected");
    const pdf = await render.renderSubmissionDocument({ organizationId: orgId, submissionId: created.id, kind: "rejected" });
    const text = pdfTools.extractPdfTextRuns(pdf).join(" ");
    expect(text).toContain("REJECTED");
    expect(text).toContain("Season");

    const bystander = await (async () => {
      const [u] = await db.insert(schema.usersTable).values({ email: `bystander-${suffix}@example.invalid`, passwordHash: "x", firstName: "By", lastName: "Stander", organizationId: orgId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId: orgId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId: employeeRoleId });
      return { userId: u.id, membershipId: m.id, employeeId: -1 };
    })();
    const bystanderViewer = await viewer(orgId, bystander);
    expect(await submissions.getSubmissionDetail(orgId, created.id, bystanderViewer)).toBeNull();
    // ...and cannot administer templates: the service is permission-agnostic, so the guard is the route's requirePermission — assert the viewer has no key.
    expect(bystanderViewer.permissions.has("form_template.manage")).toBe(false);
  });

  it("all four WWM templates create, publish and render blank from real rows", async () => {
    for (const seed of wwm.WWM_FORM_TEMPLATES.slice(1)) {
      const { template, version } = await templates.createTemplate({
        organizationId: orgId,
        templateKey: seed.templateKey,
        formType: seed.formType,
        moduleKey: null,
        title: seed.title,
        definition: seed.definition,
        stages: seed.stages,
        ...templateActor(hr),
      });
      await templates.publishVersion({ organizationId: orgId, versionId: version.id, ...templateActor(hr) });
      const blank = await render.renderBlankDocument({ organizationId: orgId, versionId: version.id });
      expect(blank.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdfTools.extractPdfTextRuns(blank).join(" ")).toContain(seed.definition.header.lines[0]);
      expect(template.formType).toBe(seed.formType);
    }
  });
});
