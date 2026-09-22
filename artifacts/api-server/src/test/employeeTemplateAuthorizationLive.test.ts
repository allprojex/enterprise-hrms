/**
 * The ordinary employee after the recruitment over-grant correction — live,
 * over real HTTP, against a real database.
 *
 * The caller holds ONLY the real SYSTEM `employee` template, exactly as seeded
 * and migrated (0083), and is linked to their own employee record. Proves:
 *   - every recruitment surface the eight removed keys used to open now
 *     answers 403 — including offer WRITE;
 *   - interview-panel participation (interview.read / scorecard.submit, kept)
 *     still works and still shows only the caller's own panels;
 *   - employee self-service is untouched: own profile, internal job board,
 *     own leave, own attendance clock-in;
 *   - the dashboard summary no longer carries the organization-wide asset
 *     count, while an HR holder of asset_management.manage still gets it;
 *   - /me/organizations reports a genuine Office Inventory approval delegate —
 *     and stops reporting one whose delegating head has been replaced.
 *
 * Opt-in (EMPLOYEE_AUTHZ_LIVE_DATABASE_URL, a disposable LOCAL database with
 * migrations applied and seed:roles + seed:modules run — liveDbGuard refuses
 * anything else).
 */
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("EMPLOYEE_AUTHZ_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

const REMOVED = [
  "requisition.read",
  "vacancy.read",
  "application.read",
  "candidate.read",
  "candidate.notes.read",
  "offer.read",
  "offer.manage",
  "recruitment.reports.read",
];

describeLive("ordinary employee authorization after the recruitment over-grant correction (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let isNull: any;
  let app: any;

  const suffix = `eta-${Date.now().toString(36)}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  let orgId: number;
  let deptId: number;
  let employeeTemplateId: number;

  interface Person {
    userId: number;
    membershipId: number;
    employeeId: number;
    token: string;
  }
  let employee: Person;
  let hrAssets: Person;

  const template = async (key: string) => {
    const [r] = await db
      .select()
      .from(schema.rolesTable)
      .where(and(eq(schema.rolesTable.key, key), isNull(schema.rolesTable.organizationId), eq(schema.rolesTable.isSystemRole, true)));
    if (!r) throw new Error(`system template "${key}" missing — run seed:roles`);
    return r.id as number;
  };

  async function permissionId(key: string): Promise<number> {
    const [p] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, key)).limit(1);
    if (!p) throw new Error(`permission ${key} is not seeded`);
    return p.id;
  }

  async function person(roleIds: number[]): Promise<Person> {
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${uniq("u")}@example.test`, passwordHash: "x", firstName: "Eta", lastName: uniq("P"), organizationId: orgId })
      .returning();
    const [m] = await db.insert(schema.organizationMembershipsTable).values({ organizationId: orgId, applicationUserId: user.id, status: "active" }).returning();
    for (const roleId of roleIds) await db.insert(schema.membershipRolesTable).values({ membershipId: m.id, roleId });
    const [e] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Eta", lastName: uniq("E"), departmentId: deptId, employmentStatus: "active" })
      .returning();
    await db.insert(schema.employeeUserLinksTable).values({ employeeId: e.id, applicationUserId: user.id, organizationMembershipId: m.id });
    const token = `eta-${randomUUID()}`;
    await db.insert(schema.sessionsTable).values({ token, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user.id, membershipId: m.id, employeeId: e.id, token };
  }

  const get = (p: Person, path: string) => request(app).get(path).set("Authorization", `Bearer ${p.token}`);
  const post = (p: Person, path: string, body: unknown) => request(app).post(path).set("Authorization", `Bearer ${p.token}`).send(body as object);
  const summaryFor = async (p: Person) => ((await get(p, "/api/me/organizations")).body as any[]).find((o) => o.organizationId === orgId);

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    isNull = drizzle.isNull;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    app = (await import("../app")).default;

    const [org] = await db.insert(schema.organizationsTable).values({ name: uniq("Org"), slug: uniq("org") }).returning();
    orgId = org.id;
    for (const mod of await db.select().from(schema.modulesTable)) {
      await db.insert(schema.organizationModulesTable).values({ organizationId: orgId, moduleId: mod.id, enabled: true }).onConflictDoNothing();
    }
    const [dept] = await db.insert(schema.departmentsTable).values({ organizationId: orgId, name: uniq("Dept"), code: uniq("D").slice(0, 30), status: "active" }).returning();
    deptId = dept.id;

    employeeTemplateId = await template("employee");
    employee = await person([employeeTemplateId]);

    const [assetRole] = await db
      .insert(schema.rolesTable)
      .values({ key: uniq("assets_admin"), organizationId: orgId, label: uniq("Assets admin"), isSystemRole: false })
      .returning();
    await db.insert(schema.rolePermissionsTable).values({ roleId: assetRole.id, permissionId: await permissionId("asset_management.manage") });
    hrAssets = await person([employeeTemplateId, assetRole.id]);

    await db.insert(schema.assetsTable).values({ organizationId: orgId, assetTag: uniq("AST"), categoryCode: "IT", name: uniq("Laptop"), status: "available" });
    // Importing the whole application is slow on a cold start.
  }, 120_000);

  it("the migrated system employee template holds none of the eight keys, and keeps panel participation", async () => {
    const keys = (
      await db
        .select({ key: schema.permissionsTable.key })
        .from(schema.rolePermissionsTable)
        .innerJoin(schema.permissionsTable, eq(schema.rolePermissionsTable.permissionId, schema.permissionsTable.id))
        .where(eq(schema.rolePermissionsTable.roleId, employeeTemplateId))
    ).map((r: { key: string }) => r.key);
    for (const k of REMOVED) expect({ k, held: keys.includes(k) }).toEqual({ k, held: false });
    expect(keys).toEqual(expect.arrayContaining(["interview.read", "scorecard.submit", "leave_request.approve", "leave_request.write.own"]));
  });

  it("every recruitment surface the removed keys opened now answers 403", async () => {
    const reads = [
      `/api/organizations/${orgId}/candidates`,
      `/api/organizations/${orgId}/applications`,
      `/api/organizations/${orgId}/offers`,
      `/api/organizations/${orgId}/job-requisitions`,
      `/api/organizations/${orgId}/vacancies`,
      `/api/organizations/${orgId}/recruitment/dashboard`,
    ];
    for (const path of reads) {
      const res = await get(employee, path);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  it("offer WRITE is refused (403), not merely hidden", async () => {
    const res = await post(employee, `/api/organizations/${orgId}/applications/1/offers`, {});
    expect(res.status).toBe(403);
  });

  it("interview-panel participation still works, and shows only the caller's own panels", async () => {
    const res = await get(employee, `/api/organizations/${orgId}/interviews`);
    expect(res.status).toBe(200);
    const items = (res.body.items ?? res.body) as unknown[];
    expect(items).toEqual([]);
  });

  it("employee self-service is untouched", async () => {
    expect((await get(employee, "/api/me/employee")).status).toBe(200);
    expect((await get(employee, "/api/me/internal-vacancies")).status).toBe(200);
    expect((await get(employee, `/api/organizations/${orgId}/employees/${employee.employeeId}/leave-requests`)).status).toBe(200);
    expect((await get(employee, `/api/organizations/${orgId}/employees/${employee.employeeId}/leave-balances`)).status).toBe(200);
    const clock = await post(employee, `/api/organizations/${orgId}/attendance-events`, { eventType: "clock_in" });
    expect([200, 201]).toContain(clock.status);
  });

  it("the dashboard summary no longer carries the organization-wide asset count for an ordinary employee", async () => {
    const res = await get(employee, "/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.body.assetMetrics).toBeNull();
  });

  it("an HR holder of asset_management.manage still receives it", async () => {
    const res = await get(hrAssets, "/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.body.assetMetrics).toEqual({ activeAssets: expect.any(Number) });
    expect(res.body.assetMetrics.activeAssets).toBeGreaterThanOrEqual(1);
  });

  it("an ordinary employee is not reported as an inventory approval delegate", async () => {
    const s = await summaryFor(employee);
    expect(s.isInventoryApprovalDelegate).toBe(false);
    expect(s.isDepartmentHead).toBe(false);
    expect(s.hasDirectReports).toBe(false);
  });

  it("a genuine delegate is reported — and stops being reported once the delegating head is replaced", async () => {
    const head = await person([employeeTemplateId]);
    const delegate = await person([employeeTemplateId]);
    const [headRow] = await db
      .insert(schema.departmentHeadsTable)
      .values({ organizationId: orgId, departmentId: deptId, headMembershipId: head.membershipId })
      .returning();
    await db.insert(schema.officeInventoryApprovalDelegationsTable).values({
      organizationId: orgId,
      departmentId: deptId,
      delegatingHeadMembershipId: head.membershipId,
      delegateMembershipId: delegate.membershipId,
      createdByMembershipId: head.membershipId,
    });
    expect((await summaryFor(delegate)).isInventoryApprovalDelegate).toBe(true);
    expect((await summaryFor(head)).isDepartmentHead).toBe(true);

    // The head is replaced: the old delegation row stays open but is inert.
    await db.update(schema.departmentHeadsTable).set({ validTo: new Date() }).where(eq(schema.departmentHeadsTable.id, headRow.id));
    const newHead = await person([employeeTemplateId]);
    await db.insert(schema.departmentHeadsTable).values({ organizationId: orgId, departmentId: deptId, headMembershipId: newHead.membershipId });
    expect((await summaryFor(delegate)).isInventoryApprovalDelegate).toBe(false);
  });
});
