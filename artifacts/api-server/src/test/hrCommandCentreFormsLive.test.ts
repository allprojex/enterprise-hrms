/**
 * HR Command Centre × assisted forms — live, against a LOCAL throwaway database
 * (WS26_LIVE_DATABASE_URL; liveDbGuard refuses anything else).
 *
 * Walks a real HR-assisted PIF v2 through draft → Employee Confirmation &
 * Signature → HR review → approved, and asks resolveHrCommandCentre at each
 * point what each person sees:
 *
 *   - an HR-assisted DRAFT is nobody's approval task;
 *   - while waiting on the employee it is the EMPLOYEE's task, and for HR it
 *     is oversight only ("elsewhere in workflow"), never "needs my action";
 *   - at HR review it is an action only for an HR user the backend would let
 *     approve — never for the HR user who created it (maker-checker);
 *   - assistance notes never appear in any dashboard payload.
 */
import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { WWM_PERSONAL_INFORMATION_KEY } from "../formTemplates/wwm/personalInformation";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 24, height: 12, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
}
const file = (buf: Buffer) => ({ mimetype: "image/png", size: buf.length, buffer: buf });

describe.skipIf(!LIVE_URL)("HR Command Centre × assisted PIF, live", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let signatures: typeof import("../lib/formEngine/signatures");
  let assisted: typeof import("../lib/formEngine/assistedSubmission");
  let permissions: typeof import("../lib/permissions");
  let commandCentre: typeof import("../lib/hrCommandCentre");
  let wwm: typeof import("../formTemplates/wwm");

  const suffix = `ccforms-${Date.now().toString(36)}`;
  const NOTES = `Hospital stay ${suffix}`;
  const STAGE1 = "Employee Confirmation & Signature";
  let orgId: number;
  let pifTemplateId: number;

  interface Person {
    userId: number;
    membershipId: number;
    employeeId: number;
  }
  let hr: Person;
  let hr2: Person;
  let subject: Person;

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });
  const viewer = (p: Person) => submissions.buildViewerContext(orgId, actor(p));
  const centre = (p: Person) => commandCentre.resolveHrCommandCentre({ organizationId: orgId, applicationUserId: p.userId, membershipId: p.membershipId });
  const formTasks = (c: Awaited<ReturnType<typeof centre>>, id: number) => (c.tasks?.items ?? []).filter((t) => t.sourceModule === "forms" && t.sourceId === id);
  const formsCard = (c: Awaited<ReturnType<typeof centre>>) => c.attention.find((a) => a.key === "forms_awaiting_review") ?? null;

  beforeAll(async () => {
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    signatures = await import("../lib/formEngine/signatures");
    assisted = await import("../lib/formEngine/assistedSubmission");
    permissions = await import("../lib/permissions");
    commandCentre = await import("../lib/hrCommandCentre");
    wwm = await import("../formTemplates/wwm");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `CC forms ${suffix}`, slug: suffix }).returning();
    orgId = org.id;

    const ensurePermission = async (key: string) => {
      const [existing] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
      if (existing) return existing.id;
      const [p] = await db.insert(schema.permissionsTable).values({ key, resource: key.split(".")[0], action: key.split(".").slice(1).join(".") }).returning();
      return p.id;
    };
    const mkRole = async (key: string, permissionKeys: string[]) => {
      const [role] = await db.insert(schema.rolesTable).values({ organizationId: orgId, key: `${key}-${suffix}`, label: key }).returning();
      for (const pk of permissionKeys) await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: await ensurePermission(pk) });
      return role.id;
    };
    const mkPerson = async (tag: string, roleId: number): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "Person", organizationId: orgId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId: orgId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: tag, lastName: "Person" }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };

    const hrRole = await mkRole("hr", [
      "form_template.manage",
      "form_template.publish",
      "form.read",
      "form.approve",
      "form_submission.create_on_behalf",
    ]);
    const employeeRole = await mkRole("employee", ["organization.read"]);
    hr = await mkPerson("hr", hrRole);
    hr2 = await mkPerson("hr2", hrRole);
    subject = await mkPerson("subject", employeeRole);

    const seed = wwm.WWM_FORM_TEMPLATES.find((s) => s.templateKey === WWM_PERSONAL_INFORMATION_KEY)!;
    const { template, version } = await templates.createTemplate({
      organizationId: orgId,
      templateKey: seed.templateKey,
      formType: seed.formType,
      moduleKey: seed.moduleKey,
      title: seed.title,
      definition: seed.definition,
      stages: seed.stages,
      signaturePolicy: seed.signaturePolicy,
      submissionPolicy: seed.submissionPolicy,
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });
    await templates.publishVersion({ organizationId: orgId, versionId: version.id, actorApplicationUserId: hr.userId, actorMembershipId: hr.membershipId });
    pifTemplateId = template.id;
  });

  it("separates the employee's action, HR oversight and HR action across the whole assisted PIF lifecycle", async () => {
    const version = (await templates.getPublishedVersion(orgId, pifTemplateId))!;
    const resolved = assisted.authorizeOnBehalf({
      permissions: await permissions.getEffectivePermissions(hr.membershipId),
      version,
      assistance: { reason: "medical_or_incapacity", notes: NOTES },
    });
    const created = await submissions.createSubmission({ organizationId: orgId, templateId: pifTemplateId, subjectEmployeeId: subject.employeeId, actor: actor(hr), assistance: resolved });
    const id = created.id;

    // 1. HR-assisted DRAFT: no one's approval task; not even oversight (it is not in a workflow yet).
    for (const p of [hr, hr2, subject]) expect(formTasks(await centre(p), id)).toHaveLength(0);
    expect(formsCard(await centre(hr))).toMatchObject({ count: 0, secondaryCount: 0 });

    // HR completes and submits it on the employee's behalf → stage 1, waiting on the employee.
    await submissions.submit({ organizationId: orgId, submissionId: id, viewer: await viewer(hr), actor: actor(hr) });

    // 2. Awaiting Employee Confirmation & Signature: the employee's task, HR oversight only.
    const subjectCentre = await centre(subject);
    expect(formTasks(subjectCentre, id)).toEqual([
      expect.objectContaining({ title: "Staff Personal Information Form", context: `Stage: ${STAGE1} · HR-assisted`, deepLink: `/forms/${id}`, dueAt: null, overdue: null }),
    ]);
    expect(formsCard(subjectCentre)).toBeNull(); // no form.read — no oversight card for an ordinary employee
    for (const p of [hr, hr2]) {
      const c = await centre(p);
      expect(formTasks(c, id)).toHaveLength(0);
      expect(formsCard(c)).toMatchObject({ count: 0, secondaryCount: 1 });
    }

    // The employee signs and confirms → HR review.
    const subjectViewer = await viewer(subject);
    await signatures.applySignature({ organizationId: orgId, actor: actor(subject), viewer: subjectViewer, submissionId: id, slotKey: "employee_signature", method: "drawn", imageFile: file(await png()) });
    expect(await submissions.stageAction({ organizationId: orgId, submissionId: id, action: "complete", viewer: subjectViewer, actor: actor(subject) })).toMatchObject({ currentStageOrder: 2 });

    // 3. HR review: an action for the second HR user only. The creating HR user sees oversight, because the backend refuses their approval.
    expect(formTasks(await centre(subject), id)).toHaveLength(0);
    const creatorCentre = await centre(hr);
    expect(formTasks(creatorCentre, id)).toHaveLength(0);
    expect(formsCard(creatorCentre)).toMatchObject({ count: 0, secondaryCount: 1 });
    await expect(submissions.stageAction({ organizationId: orgId, submissionId: id, action: "approve", viewer: await viewer(hr), actor: actor(hr) })).rejects.toThrow(
      submissions.FormStageAuthorityError,
    );
    const reviewerCentre = await centre(hr2);
    expect(formTasks(reviewerCentre, id)).toEqual([expect.objectContaining({ context: "Stage: HR review · HR-assisted", status: "pending_approval" })]);
    expect(formsCard(reviewerCentre)).toMatchObject({ count: 1, secondaryCount: 0 });
    expect(reviewerCentre.tasks!.total).toBeGreaterThanOrEqual(1);

    // Notes never reach any dashboard payload.
    for (const c of [subjectCentre, creatorCentre, reviewerCentre]) expect(JSON.stringify(c)).not.toContain(NOTES);

    // 4. Approved: no longer anyone's task, no longer pending oversight.
    await submissions.stageAction({ organizationId: orgId, submissionId: id, action: "approve", viewer: await viewer(hr2), actor: actor(hr2) });
    const after = await centre(hr2);
    expect(formTasks(after, id)).toHaveLength(0);
    expect(formsCard(after)).toMatchObject({ count: 0, secondaryCount: 0 });
  });
});
