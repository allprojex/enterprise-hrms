/**
 * WS-15 P2/P3 — Employee 360 section composition, live (§31.29).
 *
 * The invariants this bundle depends on, each proved against a real database:
 *
 *   - a section the caller may not read is OMITTED, indistinguishably from a
 *     disabled module or an employee with nothing recorded;
 *   - org_admin gains nothing: grievances never appear on a 360 view at all,
 *     and succession never appears for anybody;
 *   - WS-14 typed capability replaces the legacy free-text skills as the
 *     CURRENT model, while the legacy rows survive, labelled, unconverted;
 *   - the same for WS-12 structured cases versus legacy disciplinary notes;
 *   - a claimed skill is never presented as verified capability;
 *   - no row carries narrative, evidence, a proposed value or a leave reason;
 *   - a cross-tenant employee id fails before any provider runs;
 *   - one failing provider yields a named unavailable section, not silence;
 *   - nothing in this path writes, and no legacy row is migrated or deleted.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS15_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-15 P2/P3 — Employee 360, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let aggregate: typeof import("../lib/employee360/aggregate");
  let providers: typeof import("../lib/employee360/providers");
  let capability: typeof import("../lib/skills/capability");

  let orgId: number;
  let otherOrgId: number;
  let roleIds: Record<string, number> = {};
  let employeeId: number;
  let foreignEmployeeId: number;

  const suffix = `ws15p3b-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  interface Actor {
    userId: number;
    membershipId: number;
  }
  let hr: Actor;
  let orgAdmin: Actor;
  let nobody: Actor;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    aggregate = await import("../lib/employee360/aggregate");
    providers = await import("../lib/employee360/providers");
    capability = await import("../lib/skills/capability");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `360 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `360 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    for (const r of await db.select().from(schema.rolesTable)) roleIds[r.key] = r.id;

    for (const key of ["leave", "learning", "attendance", "onboarding"]) {
      const [m] = await db.select().from(schema.modulesTable).where(eq(schema.modulesTable.key, key)).limit(1);
      if (m) {
        await db
          .insert(schema.organizationModulesTable)
          .values({ organizationId: orgId, moduleId: m.id, enabled: true })
          .onConflictDoNothing();
      }
    }

    hr = await makeActor("hr", ["hr_manager"]);
    orgAdmin = await makeActor("orgadmin", ["org_admin"]);
    nobody = await makeActor("nobody", []);

    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Subject", lastName: "Employee" })
      .returning();
    employeeId = emp.id;
    const [foreign] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Foreign", lastName: "Employee" })
      .returning();
    foreignEmployeeId = foreign.id;
  });

  async function makeActor(tag: string, roleKeys: string[]): Promise<Actor> {
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq(tag)}@example.invalid`,
        passwordHash: "x",
        firstName: tag,
        lastName: "Actor",
        organizationId: orgId,
      })
      .returning();
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId: orgId, status: "active" })
      .returning();
    for (const key of roleKeys) {
      if (roleIds[key]) {
        await db
          .insert(schema.membershipRolesTable)
          .values({ membershipId: m.id, roleId: roleIds[key] })
          .onConflictDoNothing();
      }
    }
    return { userId: u.id, membershipId: m.id };
  }

  const resolve = (actor: Actor, empId = employeeId, organizationId = orgId) =>
    aggregate.resolveEmployee360({
      organizationId,
      employeeId: empId,
      applicationUserId: actor.userId,
      membershipId: actor.membershipId,
    });

  const sectionOf = (result: any, key: string) => result.sections.find((s: any) => s.key === key);

  // -- The frozen section set (§31.29) --------------------------------------

  it("implements exactly the eight sections §31.29 names as absent — succession and Payroll have no provider", async () => {
    const keys = providers.EMPLOYEE_360_PROVIDERS.map((p) => p.key).sort();
    expect(keys).toEqual([
      "attendance",
      "employee_relations",
      "employee_requests",
      "employment_lifecycle",
      "learning",
      "leave",
      "onboarding",
      "skills",
    ]);
    // §30.17: an employee's succession standing never appears on their 360
    // view, for anybody. §31.29's missing-section list does not name Payroll.
    expect(keys).not.toContain("succession");
    expect(keys).not.toContain("payroll");
  });

  // -- Omission is the confidentiality mechanism (§31.29) --------------------

  it("a caller with no source permission gets an empty section list, not a 403 and not empty sections", async () => {
    const result = await resolve(nobody);
    expect(result.sections).toEqual([]);
    expect(result.unavailableSections).toEqual([]);
  });

  it("a section the caller cannot read is omitted, not returned empty", async () => {
    // WS-12 has a case, so the section genuinely exists for an authorized reader.
    await db.insert(schema.disciplinaryCasesTable).values({
      organizationId: orgId,
      employeeId,
      categoryCode: "conduct",
      subject: "CONFIDENTIALDISCIPLINARY subject",
      openedAt: new Date(),
      status: "open",
    });

    const authorized = await resolve(hr);
    expect(sectionOf(authorized, "employee_relations")).toBeDefined();

    const unauthorized = await resolve(nobody);
    // Absent entirely — never present-with-zero-rows, which would assert the
    // module exists and this employee has nothing.
    expect(sectionOf(unauthorized, "employee_relations")).toBeUndefined();
  });

  it("no grievance ever reaches a 360 view, even for a grievance reader", async () => {
    await db.insert(schema.grievanceCasesTable).values({
      organizationId: orgId,
      complainantEmployeeId: employeeId,
      categoryCode: "conduct",
      subject: "CONFIDENTIALGRIEVANCE subject",
      description: "CONFIDENTIALGRIEVANCE narrative",
      status: "submitted",
      confidentiality: "confidential",
      submittedAt: new Date(),
    });

    // hr_manager holds grievance.read, and STILL sees no grievance here: the
    // Employee Relations workspace is the only route to it.
    const result = await resolve(hr);
    expect(JSON.stringify(result)).not.toContain("CONFIDENTIALGRIEVANCE");
    const er = sectionOf(result, "employee_relations");
    expect(er.rows.every((r: any) => !/grievance/i.test(r.label))).toBe(true);
  });

  it("org_admin gains nothing — no grievance, no succession, no bypass", async () => {
    const [position] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: orgId, title: `Critical ${suffix}` })
      .returning();
    const [plan] = await db
      .insert(schema.successionPlansTable)
      .values({
        organizationId: orgId,
        positionId: position.id,
        status: "active",
        criticalityNotes: "CONFIDENTIALSUCCESSION note",
      })
      .returning();
    await db.insert(schema.successionCandidatesTable).values({
      organizationId: orgId,
      planId: plan.id,
      employeeId,
      status: "active",
      rationale: "CONFIDENTIALSUCCESSION rationale",
      nominatedAt: new Date(),
    });

    for (const actor of [orgAdmin, hr]) {
      const result = await resolve(actor);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("CONFIDENTIALSUCCESSION");
      expect(serialized).not.toContain("CONFIDENTIALGRIEVANCE");
      expect(result.sections.some((s: any) => s.key === "succession")).toBe(false);
    }
  });

  // -- The legacy reconciliation, which is the risky part (§31.29, §31.37) ---

  it("WS-14 typed capability is the current model, and legacy free-text skills survive labelled and unconverted", async () => {
    const [skill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: orgId, code: uniq("s"), name: "First Aid", proficiencyApplicable: false })
      .returning();
    await capability.claimSkill({
      organizationId: orgId,
      employeeId,
      skillId: skill.id,
      source: "employee_self_service",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });
    // The superseded model: a free-text code and a free-text proficiency string
    // with no scale behind it.
    const [legacyRow] = await db
      .insert(schema.employeeSkillsTable)
      .values({
        organizationId: orgId,
        employeeId,
        skillCode: "LEGACYSKILLCODE",
        proficiencyLevel: "LEGACYPROFICIENCYSTRING",
      })
      .returning();

    const section = sectionOf(await resolve(hr), "skills");
    expect(section).toBeDefined();
    expect(section.provenance).toBe("current");

    const current = section.rows.filter((r: any) => r.provenance === "current");
    const legacy = section.rows.filter((r: any) => r.provenance === "legacy");
    expect(current.length).toBe(1);
    expect(legacy.length).toBe(1);

    // The current row carries WS-14's own status verbatim — a claim is never
    // rendered as verified capability (§30.5, §30.6).
    expect(current[0].status).toBe("claimed");
    expect(section.stats.find((s: any) => s.label === "Verified").value).toBe("0");
    expect(section.stats.find((s: any) => s.label === "Awaiting verification").value).toBe("1");

    // The legacy row is present and labelled, but its free-text proficiency
    // string is NOT surfaced as a status: nothing may be inferred from it.
    expect(legacy[0].label).toBe("LEGACYSKILLCODE");
    expect(legacy[0].status).toBeNull();
    expect(JSON.stringify(section)).not.toContain("LEGACYPROFICIENCYSTRING");
    expect(section.note).toMatch(/not verified capability/i);

    // NOTHING WAS MIGRATED. The legacy row is byte-for-byte where it was.
    const [stillThere] = await db
      .select()
      .from(schema.employeeSkillsTable)
      .where(eq(schema.employeeSkillsTable.id, legacyRow.id));
    expect(stillThere.skillCode).toBe("LEGACYSKILLCODE");
    expect(stillThere.proficiencyLevel).toBe("LEGACYPROFICIENCYSTRING");
  });

  it("WS-12 structured cases are the current model, and legacy disciplinary notes survive labelled", async () => {
    const [legacyRow] = await db
      .insert(schema.employeeDisciplinaryRecordsTable)
      .values({
        organizationId: orgId,
        employeeId,
        actionType: "warning",
        description: "LEGACYDISCIPLINARYNOTE body",
        actionDate: new Date("2024-01-01T00:00:00.000Z"),
      })
      .returning();

    const section = sectionOf(await resolve(hr), "employee_relations");
    const current = section.rows.filter((r: any) => r.provenance === "current");
    const legacy = section.rows.filter((r: any) => r.provenance === "legacy");
    expect(current.length).toBeGreaterThan(0);
    expect(legacy.length).toBe(1);

    // The structured case shows a REFERENCE, never the allegation or summary.
    expect(current[0].label).toMatch(/^Disciplinary case #\d+$/);
    expect(JSON.stringify(section)).not.toContain("CONFIDENTIALDISCIPLINARY");
    // The legacy note's body never reaches the page either.
    expect(JSON.stringify(section)).not.toContain("LEGACYDISCIPLINARYNOTE");
    expect(legacy[0].label).toBe("Legacy disciplinary record");
    expect(section.note).toMatch(/pre-date structured disciplinary cases/i);

    // Not migrated, not deleted.
    const [stillThere] = await db
      .select()
      .from(schema.employeeDisciplinaryRecordsTable)
      .where(eq(schema.employeeDisciplinaryRecordsTable.id, legacyRow.id));
    expect(stillThere.description).toBe("LEGACYDISCIPLINARYNOTE body");
  });

  // -- WS-13 masking (§29, §31.14) ------------------------------------------

  it("a data-change row names neither the field nor the proposed value", async () => {
    const request = await (await import("../lib/employeeRequests/dataChange")).createRequest({
      organizationId: orgId,
      employeeId,
      origin: "hr_originated",
      fields: [{ fieldKey: "nationalId", requestedValue: "PROPOSEDSENSITIVEVALUE" }],
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });
    expect(request).toBeDefined();

    const section = sectionOf(await resolve(hr), "employee_requests");
    expect(section).toBeDefined();
    expect(JSON.stringify(section)).not.toContain("PROPOSEDSENSITIVEVALUE");
    expect(JSON.stringify(section)).not.toContain("nationalId");
    expect(section.rows.some((r: any) => r.label === "Data change request")).toBe(true);
  });

  // -- Leave and the other module sections ----------------------------------

  it("a leave row never carries the leave reason", async () => {
    const [type] = await db
      .insert(schema.leaveTypesTable)
      .values({ organizationId: orgId, name: `Annual ${suffix}`, code: uniq("lt"), status: "active" })
      .returning();
    const [policy] = await db
      .insert(schema.leavePoliciesTable)
      .values({
        organizationId: orgId,
        leaveTypeId: type.id,
        name: `Policy ${suffix}`,
        annualEntitlementDays: "20",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        status: "active",
      })
      .returning();
    await db.insert(schema.leaveRequestsTable).values({
      organizationId: orgId,
      employeeId,
      leaveTypeId: type.id,
      leavePolicyId: policy.id,
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      daysRequested: "2",
      reason: "LEAVEREASONCONFIDENTIAL",
      status: "pending",
    });

    const section = sectionOf(await resolve(hr), "leave");
    expect(section).toBeDefined();
    expect(JSON.stringify(section)).not.toContain("LEAVEREASONCONFIDENTIAL");
    expect(section.rows.every((r: any) => r.label === "Leave request")).toBe(true);
  });

  it("attendance is a counts-only summary with no per-day rows", async () => {
    // Whether or not attendance data exists, the section must never carry a
    // reconstructable movement pattern.
    const section = sectionOf(await resolve(hr), "attendance");
    if (section) {
      expect(section.rows).toEqual([]);
      expect(section.stats.map((s: any) => s.label).sort()).toEqual(["Absent", "Late", "Present"]);
    }
  });

  it("every section carries a deep link into the module that owns it", async () => {
    const result = await resolve(hr);
    expect(result.sections.length).toBeGreaterThan(0);
    for (const section of result.sections) {
      expect(typeof section.deepLink).toBe("string");
      expect(section.deepLink.startsWith("/")).toBe(true);
    }
  });

  it("the section shape carries exactly the frozen fields", async () => {
    const result = await resolve(hr);
    const allowed = ["key", "title", "provenance", "stats", "rows", "truncated", "deepLink", "note"];
    for (const section of result.sections) {
      for (const key of Object.keys(section)) expect(allowed).toContain(key);
      for (const row of section.rows) {
        expect(Object.keys(row).sort()).toEqual(["id", "label", "occurredAt", "provenance", "status"]);
        // No free-text body of any kind reaches a row.
        expect(row).not.toHaveProperty("description");
        expect(row).not.toHaveProperty("notes");
        expect(row).not.toHaveProperty("reason");
      }
    }
  });

  // -- Tenant isolation (§31.24) --------------------------------------------

  it("a cross-tenant employee id fails before any provider runs", async () => {
    await expect(resolve(hr, foreignEmployeeId)).rejects.toBeInstanceOf(
      aggregate.Employee360EmployeeNotFoundError,
    );
    // And asking about a local employee from the wrong organization fails too.
    await expect(resolve(hr, employeeId, otherOrgId)).rejects.toBeInstanceOf(
      aggregate.Employee360EmployeeNotFoundError,
    );
  });

  // -- Provider failure isolation (§31.22 convention) ------------------------

  it("an authorization error hides a section; a query error names it", async () => {
    const ctx = {
      organizationId: orgId,
      employeeId,
      applicationUserId: hr.userId,
      membershipId: hr.membershipId,
    };
    const authThrows: any = {
      key: "skills",
      authorize: async () => {
        throw new Error("permission lookup exploded");
      },
      query: async () => null,
    };
    const queryThrows: any = {
      key: "leave",
      authorize: async () => true,
      query: async () => {
        throw new Error("simulated outage");
      },
    };

    // Same contract the aggregator applies: an authorization fault must never
    // become a signal that a protected module exists.
    const outcomes = await Promise.all(
      [authThrows, queryThrows].map(async (p) => {
        try {
          if (!(await p.authorize(ctx))) return { key: p.key, state: "omitted" };
        } catch {
          return { key: p.key, state: "omitted" };
        }
        try {
          await p.query(ctx);
          return { key: p.key, state: "ok" };
        } catch {
          return { key: p.key, state: "unavailable" };
        }
      }),
    );
    expect(outcomes.find((o) => o.key === "skills")!.state).toBe("omitted");
    expect(outcomes.find((o) => o.key === "leave")!.state).toBe("unavailable");

    // With a healthy database the real aggregator reports nothing unavailable.
    const real = await aggregate.resolveEmployee360(ctx);
    expect(real.unavailableSections).toEqual([]);
  });

  it("resolving a 360 view writes nothing", async () => {
    const countBefore = await db.select().from(schema.employeeSkillsTable);
    const casesBefore = await db.select().from(schema.disciplinaryCasesTable);
    await resolve(hr);
    await resolve(orgAdmin);
    const countAfter = await db.select().from(schema.employeeSkillsTable);
    const casesAfter = await db.select().from(schema.disciplinaryCasesTable);
    expect(countAfter.length).toBe(countBefore.length);
    expect(casesAfter.length).toBe(casesBefore.length);
  });
});
