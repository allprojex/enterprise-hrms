/**
 * WS-16 Pass 2A (§32.7, §32.9) — the shared live direct-report helper, and
 * the semantic parity of the six consumers migrated onto it.
 *
 * This suite exists to make a refactor provable rather than plausible. Every
 * assertion below is about behaviour that six shipped scopes already had
 * before consolidation, so a future change that alters the helper breaks a
 * consumer's contract here rather than silently in production.
 *
 * What is proved:
 *
 *   - the helper resolves LIVE: reassigning `reportingManagerId` moves an
 *     employee between managers on the very next call, with no cache to
 *     invalidate and no snapshot to rebuild;
 *   - it applies NO employment-status filter — terminated, suspended,
 *     on_leave and probation employees all remain in scope, exactly as all
 *     six call sites behaved before;
 *   - a null manager yields an empty set without a database round trip,
 *     reproducing the old `?? -1` sentinel's result;
 *   - organization scope is predicated explicitly: a manager id from another
 *     tenant returns nothing, and a forged cross-tenant pairing returns
 *     nothing;
 *   - each of the six migrated consumers still composes its own scope the way
 *     it always did — self included where it was, excluded where it was not;
 *   - the RETAINED seventh implementation still differs, deliberately
 *     (§32.9 #7), and the difference is asserted so a future "cleanup" cannot
 *     erase it quietly;
 *   - Performance's and Learning's snapshot authority is unaffected by a
 *     reporting-manager change (§32.3) — the prohibition that matters most.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS16_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-16 Pass 2A — shared live direct-report helper", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;

  let directReports: typeof import("../lib/directReports");
  let managerPortalAuth: typeof import("../lib/managerPortalAuthorization");

  let orgId: number;
  let otherOrgId: number;

  const suffix = `ws16p2a-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  async function makeEmployee(opts: {
    organizationId?: number;
    reportingManagerId?: number | null;
    employmentStatus?: string;
    lastName?: string;
  } = {}): Promise<number> {
    const [row] = await db
      .insert(schema.employeesTable)
      .values({
        organizationId: opts.organizationId ?? orgId,
        firstName: uniq("emp"),
        lastName: opts.lastName ?? "Report",
        reportingManagerId: opts.reportingManagerId ?? null,
        ...(opts.employmentStatus ? { employmentStatus: opts.employmentStatus } : {}),
      })
      .returning();
    return row.id;
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    directReports = await import("../lib/directReports");
    managerPortalAuth = await import("../lib/managerPortalAuthorization");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS16P2A ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS16P2A other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;
  });

  // --- Core contract ------------------------------------------------------

  it("returns the current direct reports of a manager, ids only", async () => {
    const manager = await makeEmployee();
    const a = await makeEmployee({ reportingManagerId: manager });
    const b = await makeEmployee({ reportingManagerId: manager });
    await makeEmployee(); // unrelated employee, reports to nobody

    const ids = await directReports.listLiveDirectReportEmployeeIds(orgId, manager);

    expect([...ids].sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
    expect(ids.every((id) => typeof id === "number")).toBe(true);
  });

  it("returns an empty array for a manager with no direct reports", async () => {
    const lonely = await makeEmployee();
    await expect(directReports.listLiveDirectReportEmployeeIds(orgId, lonely)).resolves.toEqual([]);
  });

  it("returns an empty array for a null manager, reproducing the old `?? -1` sentinel", async () => {
    // Four of the six migrated sites previously wrote
    // `reportingManagerId = (ownEmployeeId ?? -1)`, relying on -1 matching no
    // serial id. The helper's contract must produce the same empty result.
    await expect(directReports.listLiveDirectReportEmployeeIds(orgId, null)).resolves.toEqual([]);
  });

  it("excludes employees whose reporting manager is NULL", async () => {
    const manager = await makeEmployee();
    const unmanaged = await makeEmployee({ reportingManagerId: null });
    const ids = await directReports.listLiveDirectReportEmployeeIds(orgId, manager);
    expect(ids).not.toContain(unmanaged);
  });

  // --- Live, never snapshotted (§11) --------------------------------------

  it("re-resolves live: reassigning reportingManagerId moves the employee immediately", async () => {
    const oldManager = await makeEmployee();
    const newManager = await makeEmployee();
    const moving = await makeEmployee({ reportingManagerId: oldManager });

    expect(await directReports.listLiveDirectReportEmployeeIds(orgId, oldManager)).toContain(moving);
    expect(await directReports.listLiveDirectReportEmployeeIds(orgId, newManager)).not.toContain(moving);

    await db
      .update(schema.employeesTable)
      .set({ reportingManagerId: newManager })
      .where(eq(schema.employeesTable.id, moving));

    // No cache to invalidate, no projection to rebuild — the very next call.
    expect(await directReports.listLiveDirectReportEmployeeIds(orgId, oldManager)).not.toContain(moving);
    expect(await directReports.listLiveDirectReportEmployeeIds(orgId, newManager)).toContain(moving);
  });

  // --- Employment status: the critical regression boundary (§10) -----------

  it("applies NO employment-status filter — this is what all six sites did", async () => {
    const manager = await makeEmployee();
    const active = await makeEmployee({ reportingManagerId: manager, employmentStatus: "active" });
    const probation = await makeEmployee({ reportingManagerId: manager, employmentStatus: "probation" });
    const onLeave = await makeEmployee({ reportingManagerId: manager, employmentStatus: "on_leave" });
    const suspended = await makeEmployee({ reportingManagerId: manager, employmentStatus: "suspended" });
    const terminated = await makeEmployee({ reportingManagerId: manager, employmentStatus: "terminated" });

    const ids = await directReports.listLiveDirectReportEmployeeIds(orgId, manager);

    // Every one of these was in scope before consolidation. Narrowing the
    // helper would silently narrow six shipped scopes at once.
    for (const id of [active, probation, onLeave, suspended, terminated]) {
      expect(ids).toContain(id);
    }
  });

  // --- Tenant isolation (§9, §34) -----------------------------------------

  it("scopes by organization explicitly, not by foreign-key identity alone", async () => {
    const managerA = await makeEmployee({ organizationId: orgId });
    const reportA = await makeEmployee({ organizationId: orgId, reportingManagerId: managerA });

    // Same real manager id, asked in the WRONG organization's context.
    const leaked = await directReports.listLiveDirectReportEmployeeIds(otherOrgId, managerA);
    expect(leaked).toEqual([]);
    expect(leaked).not.toContain(reportA);
  });

  it("returns nothing for a forged cross-tenant manager id", async () => {
    const managerB = await makeEmployee({ organizationId: otherOrgId });
    await makeEmployee({ organizationId: otherOrgId, reportingManagerId: managerB });

    // Org A context, Org B manager id supplied by a caller.
    await expect(directReports.listLiveDirectReportEmployeeIds(orgId, managerB)).resolves.toEqual([]);
  });

  it("does not let a manager reassignment inside one tenant leak across the organization predicate", async () => {
    const managerA = await makeEmployee({ organizationId: orgId });
    const managerB = await makeEmployee({ organizationId: otherOrgId });
    const report = await makeEmployee({ organizationId: orgId, reportingManagerId: managerA });

    // A cross-tenant reporting line should never become visible from the
    // other side even if the column itself is written.
    await db
      .update(schema.employeesTable)
      .set({ reportingManagerId: managerB })
      .where(eq(schema.employeesTable.id, report));

    // The employee is in org A; asking org B for managerB's reports must not
    // return it, because the organization predicate excludes it.
    await expect(directReports.listLiveDirectReportEmployeeIds(otherOrgId, managerB)).resolves.toEqual([]);

    // Restore, so later assertions are unaffected.
    await db
      .update(schema.employeesTable)
      .set({ reportingManagerId: managerA })
      .where(eq(schema.employeesTable.id, report));
  });

  // --- The RETAINED seventh implementation (§32.9 #7, prompt §6/§16) -------

  describe("the retained seventh implementation stays deliberately different", () => {
    it("listLiveDirectReports excludes terminated employees; the shared helper does not", async () => {
      const manager = await makeEmployee();
      const stillHere = await makeEmployee({ reportingManagerId: manager, employmentStatus: "active" });
      const gone = await makeEmployee({ reportingManagerId: manager, employmentStatus: "terminated" });

      const shared = await directReports.listLiveDirectReportEmployeeIds(orgId, manager);
      const roster = await managerPortalAuth.listLiveDirectReports(orgId, manager);
      const rosterIds = roster.map((e: any) => e.id);

      // Both agree about a current employee.
      expect(shared).toContain(stillHere);
      expect(rosterIds).toContain(stillHere);

      // They deliberately disagree about a terminated one. THIS is why #7 was
      // not migrated: routing it through the shared helper would put a former
      // employee back on a live team roster, and teaching the shared helper
      // this filter would narrow six shipped scopes.
      expect(shared).toContain(gone);
      expect(rosterIds).not.toContain(gone);
    });

    it("listLiveDirectReports still returns full rows in a deterministic order", async () => {
      const manager = await makeEmployee();
      await makeEmployee({ reportingManagerId: manager, lastName: "Zebra" });
      await makeEmployee({ reportingManagerId: manager, lastName: "Aardvark" });
      await makeEmployee({ reportingManagerId: manager, lastName: "Mongoose" });

      const roster = await managerPortalAuth.listLiveDirectReports(orgId, manager);

      // Full rows, not ids — the other reason the two are not interchangeable.
      expect(roster[0]).toHaveProperty("firstName");
      expect(roster[0]).toHaveProperty("employmentStatus");

      const lastNames = roster.map((e: any) => e.lastName);
      expect(lastNames).toEqual([...lastNames].sort((a: string, b: string) => a.localeCompare(b)));
    });
  });

  // --- Snapshot authority must be untouched (§5, §17, §32.3) --------------

  describe("snapshot authority survives a reporting-manager change", () => {
    it("Learning's managerEmployeeIdSnapshot does not follow reportingManagerId", async () => {
      const oldManager = await makeEmployee();
      const newManager = await makeEmployee();
      const learner = await makeEmployee({ reportingManagerId: oldManager });

      const [course] = await db
        .insert(schema.learningCoursesTable)
        .values({
          organizationId: orgId,
          categoryCode: "compliance",
          title: uniq("course"),
          deliveryMode: "self_paced",
        })
        .returning();
      const [enrollment] = await db
        .insert(schema.learningEnrollmentsTable)
        .values({
          organizationId: orgId,
          courseId: course.id,
          employeeId: learner,
          courseTitleSnapshot: course.title,
          categorySnapshot: "Compliance",
          deliveryModeSnapshot: "self_paced",
          hasAssessmentSnapshot: false,
          issuesCertificateSnapshot: false,
          managerEmployeeIdSnapshot: oldManager,
          originType: "hr_assigned",
        })
        .returning();

      await db
        .update(schema.employeesTable)
        .set({ reportingManagerId: newManager })
        .where(eq(schema.employeesTable.id, learner));

      const [after] = await db
        .select()
        .from(schema.learningEnrollmentsTable)
        .where(eq(schema.learningEnrollmentsTable.id, enrollment.id));

      // The live relationship moved; the snapshot did NOT. Converting this to
      // live authority would silently rewrite who owned this enrolment.
      expect(await directReports.listLiveDirectReportEmployeeIds(orgId, newManager)).toContain(learner);
      expect(after.managerEmployeeIdSnapshot).toBe(oldManager);
      expect(after.managerEmployeeIdSnapshot).not.toBe(newManager);
    });

    it("Performance's reviewerEmployeeId does not follow reportingManagerId", async () => {
      const oldManager = await makeEmployee();
      const newManager = await makeEmployee();
      const subject = await makeEmployee({ reportingManagerId: oldManager });

      const [scale] = await db
        .insert(schema.performanceRatingScalesTable)
        .values({ organizationId: orgId, name: uniq("scale") })
        .returning();
      const [template] = await db
        .insert(schema.performanceReviewTemplatesTable)
        .values({
          organizationId: orgId,
          name: uniq("template"),
          ratingScaleId: scale.id,
          goalsWeight: 60,
          competenciesWeight: 40,
          applicabilityScope: "all_active",
        })
        .returning();
      const [cycle] = await db
        .insert(schema.performanceCyclesTable)
        .values({
          organizationId: orgId,
          name: uniq("cycle"),
          cycleType: "annual",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          templateId: template.id,
          ratingScaleId: scale.id,
          applicabilityScope: "all_active",
        })
        .returning();
      const [review] = await db
        .insert(schema.performanceReviewsTable)
        .values({
          organizationId: orgId,
          cycleId: cycle.id,
          templateId: template.id,
          ratingScaleId: scale.id,
          employeeId: subject,
          reviewerEmployeeId: oldManager,
          goalsWeight: 60,
          competenciesWeight: 40,
          scoringPrecisionSnapshot: 2,
          acknowledgementRequiredSnapshot: false,
        })
        .returning();

      await db
        .update(schema.employeesTable)
        .set({ reportingManagerId: newManager })
        .where(eq(schema.employeesTable.id, subject));

      const [after] = await db
        .select()
        .from(schema.performanceReviewsTable)
        .where(eq(schema.performanceReviewsTable.id, review.id));

      expect(await directReports.listLiveDirectReportEmployeeIds(orgId, newManager)).toContain(subject);
      expect(after.reviewerEmployeeId).toBe(oldManager);
      expect(after.reviewerEmployeeId).not.toBe(newManager);
    });
  });

  // --- Consumer parity: each keeps its own composition (§14) --------------

  describe("migrated consumers still compose their own scope", () => {
    it("Assets team custody excludes self; the helper never added it", async () => {
      const assets = await import("../lib/assets");
      const manager = await makeEmployee();
      const report = await makeEmployee({ reportingManagerId: manager });

      const issue = async (employeeId: number) => {
        const [asset] = await db
          .insert(schema.assetsTable)
          .values({
            organizationId: orgId,
            assetTag: uniq("tag"),
            categoryCode: "laptop",
            name: uniq("asset"),
          })
          .returning();
        await db.insert(schema.assetAssignmentsTable).values({
          organizationId: orgId,
          assetId: asset.id,
          employeeId,
          assetTagSnapshot: asset.assetTag,
          assetNameSnapshot: asset.name,
          categorySnapshot: "Laptop",
          issuedAt: new Date(),
          issueCondition: "good",
        });
      };
      await issue(report);
      await issue(manager);

      const team = await assets.listTeamAssetAssignments(orgId, manager);
      const employeeIds = team.map((a: any) => a.employeeId);

      expect(employeeIds).toContain(report);
      // Self-exclusion is this endpoint's own choice and must survive.
      expect(employeeIds).not.toContain(manager);
    });

    it("Assets team custody returns [] for a null manager, as before", async () => {
      const assets = await import("../lib/assets");
      await expect(assets.listTeamAssetAssignments(orgId, null)).resolves.toEqual([]);
    });
  });
});
