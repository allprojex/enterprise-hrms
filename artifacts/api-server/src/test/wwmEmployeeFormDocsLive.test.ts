/**
 * WS-26C (U4) — employee finalized-form records surfacing (live, local 5433).
 * Skipped unless WS26_LIVE_DATABASE_URL is set.
 *
 * Proves the data/authorization boundary of listEmployeeFinalizedForms:
 *   - an employee's OWN finalized forms surface (subject resolved server-side);
 *   - only FINALIZED forms surface (drafts/pending excluded);
 *   - another employee's forms are not returned in this employee's set;
 *   - cross-tenant fails closed;
 *   - the download is the governed sensitivity-aware forms route (no raw path).
 * The route wrapping this reuses the exact documents-route gate (own OR
 * employee.documents.read), already covered by the remediation tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe.skipIf(!LIVE_URL)("WS-26C U4 live: employee finalized-form surfacing", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let empForms: typeof import("../lib/employeeFormDocuments");

  const suffix = `efd-${Date.now().toString(36)}`;
  let orgId: number;
  let otherOrgId: number;
  interface Person { userId: number; membershipId: number; employeeId: number }
  let hr: Person; let manager: Person; let staff: Person; let colleague: Person;
  let finalizedSubmissionId: number;

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });
  const viewer = (organizationId: number, p: Person) => submissions.buildViewerContext(organizationId, actor(p));

  beforeAll(async () => {
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    empForms = await import("../lib/employeeFormDocuments");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `EFD ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `EFD other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;
    const ensurePerm = async (key: string) => {
      const [ex] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
      if (ex) return ex.id;
      const [p] = await db.insert(schema.permissionsTable).values({ key, resource: key.split(".")[0], action: key.split(".").slice(1).join(".") }).returning();
      return p.id;
    };
    const mkRole = async (organizationId: number, key: string, perms: string[]) => {
      const [r] = await db.insert(schema.rolesTable).values({ organizationId, key: `${key}-${suffix}`, label: key }).returning();
      for (const pk of perms) await db.insert(schema.rolePermissionsTable).values({ roleId: r.id, permissionId: await ensurePerm(pk) });
      return r.id;
    };
    const hrRole = await mkRole(orgId, "hr", ["form.read", "form.approve", "form.finalize", "form.final.read", "employee.documents.read", "employee.read"]);
    const empRole = await mkRole(orgId, "employee", ["organization.read", "employee.read"]);
    const mkPerson = async (tag: string, organizationId: number, roleId: number, overrides: Record<string, unknown> = {}): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "P", organizationId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId, firstName: tag, lastName: "P", ...overrides }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };
    hr = await mkPerson("hr", orgId, hrRole);
    manager = await mkPerson("manager", orgId, empRole);
    staff = await mkPerson("staff", orgId, empRole, { reportingManagerId: manager.employeeId });
    colleague = await mkPerson("colleague", orgId, empRole);

    // A minimal finalizable template: one field, one supervisor approval stage.
    const definition = {
      header: { lines: ["Org", "Simple"], logo: "none" },
      sections: [{ key: "main", title: "Main", layout: "stack", items: [{ kind: "field", key: "note", label: "Note", type: "short_text" }] }],
    };
    const stages = [{ stageOrder: 1, name: "Approver", participant: "supervisor", resolver: "reporting_manager", editableSectionKeys: ["main"], allowedActions: ["approve", "return", "reject"] }];
    const { template, version } = await templates.createTemplate({ organizationId: orgId, templateKey: `simple_${Date.now().toString(36)}`, formType: "generic", moduleKey: null, title: "Simple Finalizable", definition, stages, actorApplicationUserId: hr.userId, actorMembershipId: hr.membershipId });
    await templates.publishVersion({ organizationId: orgId, versionId: version.id, actorApplicationUserId: hr.userId, actorMembershipId: hr.membershipId });

    // FINALIZED form for staff: create -> submit -> manager approve -> hr finalize.
    const staffViewer = await viewer(orgId, staff);
    const created = await submissions.createSubmission({ organizationId: orgId, templateId: template.id, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    finalizedSubmissionId = created.id;
    await submissions.submit({ organizationId: orgId, submissionId: created.id, answers: { note: "ok" }, viewer: staffViewer, actor: actor(staff) });
    await submissions.stageAction({ organizationId: orgId, submissionId: created.id, action: "approve", viewer: await viewer(orgId, manager), actor: actor(manager) });
    await submissions.finalize({ organizationId: orgId, submissionId: created.id, viewer: await viewer(orgId, hr), actor: actor(hr) });

    // A DRAFT form for staff (must NOT surface as a finalized record).
    await submissions.createSubmission({ organizationId: orgId, templateId: template.id, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    // A FINALIZED form for the colleague (must NOT appear in staff's set).
    const colViewer = await viewer(orgId, colleague);
    const colSub = await submissions.createSubmission({ organizationId: orgId, templateId: template.id, subjectEmployeeId: colleague.employeeId, actor: actor(colleague) });
    await submissions.submit({ organizationId: orgId, submissionId: colSub.id, answers: { note: "c" }, viewer: colViewer, actor: actor(colleague) });
    // colleague's reporting manager is unset; approve via hr acting as... need an approver. Give colleague a manager.
    await db.update(schema.employeesTable).set({ reportingManagerId: manager.employeeId }).where(eq(schema.employeesTable.id, colleague.employeeId));
    await submissions.stageAction({ organizationId: orgId, submissionId: colSub.id, action: "approve", viewer: await viewer(orgId, manager), actor: actor(manager) });
    await submissions.finalize({ organizationId: orgId, submissionId: colSub.id, viewer: await viewer(orgId, hr), actor: actor(hr) });
  }, 60000);

  it("surfaces the employee's OWN finalized form, finalized-only, with a governed download path", async () => {
    const list = await empForms.listEmployeeFinalizedForms(orgId, staff.employeeId);
    expect(list).toHaveLength(1); // the draft is excluded
    const doc = list[0];
    expect(doc.submissionId).toBe(finalizedSubmissionId);
    expect(doc.sha256).toBeTruthy();
    expect(doc.formType).toBe("generic");
    // Download only via the sensitivity-aware forms route — never a raw generated-documents byte path.
    expect(doc.downloadPath).toBe(`/api/organizations/${orgId}/form-submissions/${finalizedSubmissionId}/document.pdf?kind=final`);
  });

  it("is subject-scoped: another employee's finalized form is not in this employee's set", async () => {
    const staffList = await empForms.listEmployeeFinalizedForms(orgId, staff.employeeId);
    expect(staffList.some((d) => d.submissionId === finalizedSubmissionId)).toBe(true);
    const colleagueList = await empForms.listEmployeeFinalizedForms(orgId, colleague.employeeId);
    // colleague has their own finalized form, and it is NOT staff's.
    expect(colleagueList.every((d) => d.submissionId !== finalizedSubmissionId)).toBe(true);
    expect(colleagueList.length).toBeGreaterThanOrEqual(1);
  });

  it("cross-tenant fails closed: another org returns nothing for this employee id", async () => {
    expect(await empForms.listEmployeeFinalizedForms(otherOrgId, staff.employeeId)).toEqual([]);
  });
});
