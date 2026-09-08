/**
 * WS-26C — generic submission↔domain linkage (live, local 5433).
 * Skipped unless WS26_LIVE_DATABASE_URL is set.
 *
 * Proves Option A: a submission may LINK to an existing same-org domain record;
 * linking never creates/approves/mutates any Leave/Performance/employee record;
 * a cross-tenant target fails closed; unsupported domains and duplicates are
 * rejected; tenant isolation holds.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS26_LIVE_DATABASE_URL");
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe.skipIf(!LIVE_URL)("WS-26C live: submission↔domain linkage", () => {
  let db: typeof import("@workspace/db").db;
  let schema: typeof import("@workspace/db");
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let templates: typeof import("../lib/formEngine/templates");
  let submissions: typeof import("../lib/formEngine/submissions");
  let links: typeof import("../lib/formEngine/domainLinks");
  let wwm: typeof import("../formTemplates/wwm");

  const suffix = `link-${Date.now().toString(36)}`;
  let orgId: number;
  let otherOrgId: number;
  interface Person { userId: number; membershipId: number; employeeId: number }
  let hr: Person; // holds form.approve
  let staff: Person; // subject, no form.approve
  let foreignEmployeeId: number;
  let submissionId: number;

  const actor = (p: Person) => ({ userId: p.userId, membershipId: p.membershipId });

  beforeAll(async () => {
    ({ eq, and } = await import("drizzle-orm"));
    schema = await import("@workspace/db");
    db = schema.db;
    templates = await import("../lib/formEngine/templates");
    submissions = await import("../lib/formEngine/submissions");
    links = await import("../lib/formEngine/domainLinks");
    wwm = await import("../formTemplates/wwm");

    const [org] = await db.insert(schema.organizationsTable).values({ name: `Link ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `Link other ${suffix}`, slug: `${suffix}-o` }).returning();
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
    const hrRole = await mkRole(orgId, "hr", ["form.read", "form.approve", "form.finalize"]);
    const staffRole = await mkRole(orgId, "employee", ["organization.read"]);

    const mkPerson = async (tag: string, organizationId: number, roleId: number): Promise<Person> => {
      const [u] = await db.insert(schema.usersTable).values({ email: `${tag}-${suffix}@example.invalid`, passwordHash: "x", firstName: tag, lastName: "P", organizationId }).returning();
      const [m] = await db.insert(schema.organizationMembershipsTable).values({ applicationUserId: u.id, organizationId, status: "active" }).returning();
      await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
      const [emp] = await db.insert(schema.employeesTable).values({ organizationId, firstName: tag, lastName: "P" }).returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: emp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id, employeeId: emp.id };
    };
    hr = await mkPerson("hr", orgId, hrRole);
    staff = await mkPerson("staff", orgId, staffRole);
    const [foreignEmp] = await db.insert(schema.employeesTable).values({ organizationId: otherOrgId, firstName: "foreign", lastName: "P" }).returning();
    foreignEmployeeId = foreignEmp.id;

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
    await templates.publishVersion({ organizationId: orgId, versionId: version.id, actorApplicationUserId: hr.userId, actorMembershipId: hr.membershipId });
    const created = await submissions.createSubmission({ organizationId: orgId, templateId: template.id, subjectEmployeeId: staff.employeeId, actor: actor(staff) });
    submissionId = created.id;
  }, 60000);

  const leaveCount = async (organizationId: number) =>
    (await db.select().from(schema.leaveRequestsTable).where(eq(schema.leaveRequestsTable.organizationId, organizationId))).length;

  it("links a submission to a same-org employee record and creates NO domain record", async () => {
    const before = await leaveCount(orgId);
    const link = await links.createSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, domainType: "employee", domainEntityId: staff.employeeId });
    expect(link.domainType).toBe("employee");
    expect(link.domainEntityId).toBe(staff.employeeId);
    expect(link.relationType).toBe("represents");
    // No auto-creation in any domain.
    expect(await leaveCount(orgId)).toBe(before);
    const list = await links.listSubmissionLinks(orgId, submissionId);
    expect(list.some((l) => l.id === link.id)).toBe(true);
  });

  it("rejects a duplicate link", async () => {
    await expect(links.createSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, domainType: "employee", domainEntityId: staff.employeeId })).rejects.toBeInstanceOf(links.DomainLinkConflictError);
  });

  it("fails closed on a cross-tenant target (employee from another org)", async () => {
    await expect(links.createSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, domainType: "employee", domainEntityId: foreignEmployeeId })).rejects.toBeInstanceOf(links.DomainLinkValidationError);
  });

  it("rejects an unsupported domain type and a non-existent leave request", async () => {
    await expect(links.createSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, domainType: "salary", domainEntityId: 1 })).rejects.toBeInstanceOf(links.DomainLinkValidationError);
    await expect(links.createSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, domainType: "leave_request", domainEntityId: 9999999 })).rejects.toBeInstanceOf(links.DomainLinkValidationError);
  });

  it("tenant isolation: another org cannot link to or list this submission", async () => {
    await expect(links.createSubmissionLink({ organizationId: otherOrgId, actor: actor(hr), submissionId, domainType: "employee", domainEntityId: foreignEmployeeId })).rejects.toBeInstanceOf(links.DomainLinkNotFoundError);
    expect(await links.listSubmissionLinks(otherOrgId, submissionId)).toEqual([]);
  });

  it("removes a link (and removing a non-existent one is a not-found)", async () => {
    const [existing] = await links.listSubmissionLinks(orgId, submissionId);
    await links.removeSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, linkId: existing.id });
    expect(await links.listSubmissionLinks(orgId, submissionId)).toEqual([]);
    await expect(links.removeSubmissionLink({ organizationId: orgId, actor: actor(hr), submissionId, linkId: existing.id })).rejects.toBeInstanceOf(links.DomainLinkNotFoundError);
  });
});
