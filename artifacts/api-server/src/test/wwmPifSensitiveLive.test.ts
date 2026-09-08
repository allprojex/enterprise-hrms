/**
 * WS-26C — PIF sensitive-field authorization, end to end (live, local 5433).
 * Skipped unless WS26_LIVE_DATABASE_URL is set.
 *
 * Proves, against the real WWM Personal Information template, that Ghana Card,
 * SSNIT, DOB (autofilled) and Medical Conditions (answer) are:
 *   - visible to the subject employee (their own record);
 *   - visible to HR holding employee.sensitive.read;
 *   - REDACTED for a colleague who can view the submission (form.read) but
 *     lacks employee.sensitive.read — in the detail API AND the rendered PDF —
 *     while the form labels/structure are preserved.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

const CARD = "GHA-TESTCARD-9931";
const SSNIT = "SSNIT-TEST-4402";
const MEDICAL = "Confidential test condition XYZZY";

describe.skipIf(!LIVE_URL)("WS-26C live: PIF sensitive-field authorization", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let render: typeof import("../lib/formEngine/render");
  let sensitivity: typeof import("../lib/formEngine/sensitivity");
  let pdfTools: typeof import("../lib/pdf/layoutRenderer");
  let wwm: typeof import("../formTemplates/wwm");

  const suffix = `pif-${Date.now().toString(36)}`;
  let orgId: number;
  let templateId: number;
  interface Person { userId: number; membershipId: number; employeeId: number }
  let subject: Person;
  let hr: Person;
  let colleague: Person;

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });
  const viewer = (p: Person) => submissions.buildViewerContext(orgId, actor(p));

  beforeAll(async () => {
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    render = await import("../lib/formEngine/render");
    sensitivity = await import("../lib/formEngine/sensitivity");
    pdfTools = await import("../lib/pdf/layoutRenderer");
    wwm = await import("../formTemplates/wwm");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `PIF ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const ensurePerm = async (key: string) => {
      const [ex] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
      if (ex) return ex.id;
      const [p] = await db.insert(schema.permissionsTable).values({ key, resource: key.split(".")[0], action: key.split(".").slice(1).join(".") }).returning();
      return p.id;
    };
    const mkRole = async (key: string, perms: string[]) => {
      const [r] = await db.insert(schema.rolesTable).values({ organizationId: orgId, key: `${key}-${suffix}`, label: key }).returning();
      for (const pk of perms) await db.insert(schema.rolePermissionsTable).values({ roleId: r.id, permissionId: await ensurePerm(pk) });
      return r.id;
    };
    const subjectRole = await mkRole("employee", ["organization.read"]);
    const hrRole = await mkRole("hr", ["form.read", "form.approve", "form.finalize", "employee.sensitive.read"]);
    const colleagueRole = await mkRole("colleague", ["form.read"]); // can view a submission, but NO employee.sensitive.read

    const mkPerson = async (tag: string, roleId: number, empOverrides: Record<string, unknown> = {}): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "Person", organizationId: orgId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId: orgId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: tag, lastName: "Person", ...empOverrides }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };

    // Subject carries the sensitive employee-native data the PIF autofills.
    subject = await mkPerson("subject", subjectRole, { nationalId: CARD, dateOfBirth: new Date("1990-05-01T00:00:00Z") });
    await db.insert(schema.employeeStatutoryIdentifiersTable).values({ organizationId: orgId, employeeId: subject.employeeId, ssnitNumber: SSNIT });
    hr = await mkPerson("hr", hrRole);
    colleague = await mkPerson("colleague", colleagueRole);

    const seed = wwm.WWM_FORM_TEMPLATES.find((t) => t.formType === "personal_information")!;
    const { template, version } = await templates.createTemplate({
      organizationId: orgId,
      templateKey: `${seed.templateKey}_${Date.now().toString(36)}`,
      formType: seed.formType,
      moduleKey: seed.moduleKey,
      title: seed.title,
      definition: seed.definition,
      stages: seed.stages,
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });
    templateId = template.id;
    await templates.publishVersion({ organizationId: orgId, versionId: version.id, actorApplicationUserId: hr.userId, actorMembershipId: hr.membershipId });

    const subjectViewer = await viewer(subject);
    const created = await submissions.createSubmission({ organizationId: orgId, templateId, subjectEmployeeId: subject.employeeId, actor: actor(subject) });
    await submissions.saveDraft({ organizationId: orgId, submissionId: created.id, answers: { medical_conditions: MEDICAL }, viewer: subjectViewer, actor: actor(subject) });
    submissionId = created.id;
  }, 60000);

  let submissionId: number;

  it("the subject sees their own sensitive PIF values (nothing redacted)", async () => {
    const detail = (await submissions.getSubmissionDetail(orgId, submissionId, await viewer(subject)))!;
    expect(detail.sensitiveRedactedKeys).toEqual([]);
    expect(detail.currentRevision!.autofillSnapshot.ghana_card_no).toBe(CARD);
    expect(detail.currentRevision!.autofillSnapshot.ssnit_no).toBe(SSNIT);
    expect(detail.currentRevision!.answers.medical_conditions).toBe(MEDICAL);
  });

  it("HR with employee.sensitive.read sees the sensitive values", async () => {
    const detail = (await submissions.getSubmissionDetail(orgId, submissionId, await viewer(hr)))!;
    expect(detail.sensitiveRedactedKeys).toEqual([]);
    expect(detail.currentRevision!.autofillSnapshot.ghana_card_no).toBe(CARD);
    expect(detail.currentRevision!.answers.medical_conditions).toBe(MEDICAL);
  });

  it("a colleague with form.read but NOT employee.sensitive.read gets sensitive values redacted", async () => {
    const detail = (await submissions.getSubmissionDetail(orgId, submissionId, await viewer(colleague)))!;
    expect(detail.sensitiveRedactedKeys.sort()).toEqual(["date_of_birth", "ghana_card_no", "medical_conditions", "ssnit_no"]);
    expect(detail.currentRevision!.autofillSnapshot.ghana_card_no).toBeNull();
    expect(detail.currentRevision!.autofillSnapshot.ssnit_no).toBeNull();
    expect(detail.currentRevision!.answers.medical_conditions).toBeNull();
    // A non-sensitive label/structure is untouched (the template still renders its fields).
    expect(detail.version.definition.sections.length).toBeGreaterThan(0);
  });

  it("the rendered PDF leaks no sensitive value to an unauthorized viewer, but keeps the labels", async () => {
    const submission = (await submissions.getSubmission(orgId, submissionId))!;
    const version = (await templates.getVersion(orgId, submission.templateVersionId))!;
    const def = templates.parseDefinition(version);

    const colleagueRedact = sensitivity.redactedSensitiveKeys(def, await viewer(colleague), submission.subjectEmployeeId);
    const redactedPdf = await render.renderSubmissionDocument({ organizationId: orgId, submissionId, kind: "draft", redactedValueKeys: colleagueRedact });
    const redactedText = pdfTools.extractPdfTextRuns(redactedPdf).join(" ");
    expect(redactedText).not.toContain(CARD);
    expect(redactedText).not.toContain(SSNIT);
    expect(redactedText).not.toContain(MEDICAL);
    expect(redactedText).toContain("Ghana Card No."); // label preserved

    // The subject's own render shows the values.
    const ownRedact = sensitivity.redactedSensitiveKeys(def, await viewer(subject), submission.subjectEmployeeId);
    expect(ownRedact.size).toBe(0);
    const ownPdf = await render.renderSubmissionDocument({ organizationId: orgId, submissionId, kind: "draft", redactedValueKeys: ownRedact });
    const ownText = pdfTools.extractPdfTextRuns(ownPdf).join(" ");
    expect(ownText).toContain(CARD);
    expect(ownText).toContain(MEDICAL);
  });
});
