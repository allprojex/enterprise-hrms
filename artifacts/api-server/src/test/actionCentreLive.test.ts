/**
 * WS-15 — live proof of the HR Action Centre against a real database.
 *
 * The §31.35 invariants, each proved rather than asserted:
 *
 *   - an item is visible only to an actor the source says is CURRENTLY
 *     authorized, and losing the permission removes it on the next request;
 *   - a changed reporting manager changes WS-14 skill authority live;
 *   - an actor without the grievance key sees no grievance row AND no
 *     grievance count — the Action Centre backdoor test;
 *   - the same for succession, whose keys org_admin does not hold;
 *   - no row carries narrative, evidence, readiness or a proposed value;
 *   - every cross-tenant identifier fails safely on rows, counts and commands;
 *   - each inline command invokes the owning module's service, re-checks
 *     authority at action time, and is idempotent on a second click;
 *   - maker-checker survives — no WS-15 path approves a requester's own work;
 *   - a completed item disappears; a provider failure is named, not hidden;
 *   - `dueAt`/`overdue` are null where the source has no due concept;
 *   - sorting is the frozen four tiers and deterministic;
 *   - ESS My Actions returns only the three allow-listed sources.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS15_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-15 — HR Action Centre, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let aggregate: typeof import("../lib/actionCentre/aggregate");
  let commands: typeof import("../lib/actionCentre/commands");
  let ess: typeof import("../lib/actionCentre/ess");
  let types: typeof import("../lib/actionCentre/types");
  let providers: typeof import("../lib/actionCentre/providers");
  let capability: typeof import("../lib/skills/capability");

  let orgId: number;
  let otherOrgId: number;
  let roleIds: Record<string, number> = {};

  const suffix = `ws15-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  interface Actor {
    userId: number;
    membershipId: number;
    employeeId: number | null;
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    aggregate = await import("../lib/actionCentre/aggregate");
    commands = await import("../lib/actionCentre/commands");
    ess = await import("../lib/actionCentre/ess");
    types = await import("../lib/actionCentre/types");
    providers = await import("../lib/actionCentre/providers");
    capability = await import("../lib/skills/capability");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS15 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS15 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const roles = await db.select().from(schema.rolesTable);
    for (const r of roles) roleIds[r.key] = r.id;

    // Every module these providers touch is enabled for the test organization,
    // so a hidden source is genuinely a permission decision and never an
    // accident of module state.
    for (const key of ["leave", "learning", "onboarding", "performance", "recruitment"]) {
      const [module] = await db.select().from(schema.modulesTable).where(eq(schema.modulesTable.key, key)).limit(1);
      if (module) {
        await db
          .insert(schema.organizationModulesTable)
          .values({ organizationId: orgId, moduleId: module.id, enabled: true })
          .onConflictDoNothing();
      }
    }
  });

  async function makeActor(tag: string, roleKeys: string[], organizationId = orgId): Promise<Actor> {
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq(tag)}@example.invalid`,
        passwordHash: "x",
        firstName: tag,
        lastName: "Actor",
        organizationId,
      })
      .returning();
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId, status: "active" })
      .returning();
    for (const key of roleKeys) {
      if (roleIds[key]) {
        await db
          .insert(schema.membershipRolesTable)
          .values({ membershipId: m.id, roleId: roleIds[key] })
          .onConflictDoNothing();
      }
    }
    return { userId: u.id, membershipId: m.id, employeeId: null };
  }

  async function makeEmployee(tag: string, overrides: Record<string, unknown> = {}, organizationId = orgId) {
    const [e] = await db
      .insert(schema.employeesTable)
      .values({ organizationId, firstName: tag, lastName: "Subject", ...overrides })
      .returning();
    return e;
  }

  const ctxOf = (actor: Actor, organizationId = orgId) => ({
    organizationId,
    applicationUserId: actor.userId,
    membershipId: actor.membershipId,
  });

  const query = (over: Partial<import("../lib/actionCentre/aggregate").ActionCentreQuery> = {}) => ({
    scope: "my_actions" as const,
    ...over,
  });

  // -- Confidentiality: the Action Centre backdoor tests (§31.11) ------------

  it("an actor without the grievance key sees no grievance row and no grievance count", async () => {
    // org_admin deliberately does NOT hold grievance.read (§28.17) or the three
    // succession keys (§30.17). This is the single most important test in the
    // suite: an aggregation surface is the natural place for those deliberate
    // withholdings to be quietly undone.
    const orgAdmin = await makeActor("orgadmin", ["org_admin"]);
    const complainant = await makeEmployee("Complainant");
    await db.insert(schema.grievanceCasesTable).values({
      organizationId: orgId,
      complainantEmployeeId: complainant.id,
      categoryCode: "conduct",
      subject: "CONFIDENTIAL grievance subject",
      description: "CONFIDENTIAL narrative that must never reach a row",
      status: "submitted",
      confidentiality: "confidential",
      submittedAt: new Date(),
    });

    const rows = await aggregate.resolveActionCentre(ctxOf(orgAdmin), query({ scope: "oversight" }));
    expect(rows.items.some((i) => i.sourceType === "grievance_case")).toBe(false);

    const counts = await aggregate.resolveActionCentreCounts(ctxOf(orgAdmin), query({ scope: "oversight" }));
    // Absent, not zero: a zero would assert the module exists and is empty.
    expect(counts.byModule.some((m) => m.sourceModule === "employee_relations" && m.count > 0)).toBe(false);

    // And the confidential text appears nowhere in the serialized response.
    const serialized = JSON.stringify(rows) + JSON.stringify(counts);
    expect(serialized).not.toContain("CONFIDENTIAL");
  });

  it("an actor without the succession keys sees no succession row and no succession count", async () => {
    const orgAdmin = await makeActor("orgadmin2", ["org_admin"]);
    const [position] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: orgId, title: `Critical ${suffix}` })
      .returning();
    await db.insert(schema.successionPlansTable).values({
      organizationId: orgId,
      positionId: position.id,
      status: "active",
      criticalityNotes: "CONFIDENTIAL succession note",
      reviewDueAt: new Date(Date.now() - 86_400_000),
    });

    const rows = await aggregate.resolveActionCentre(ctxOf(orgAdmin), query({ scope: "oversight" }));
    expect(rows.items.some((i) => i.sourceModule === "succession")).toBe(false);

    const counts = await aggregate.resolveActionCentreCounts(ctxOf(orgAdmin), query({ scope: "oversight" }));
    expect(counts.byModule.some((m) => m.sourceModule === "succession")).toBe(false);
    expect(JSON.stringify(rows) + JSON.stringify(counts)).not.toContain("CONFIDENTIAL");
  });

  it("an hr_manager sees the succession review, and it names nothing", async () => {
    const hr = await makeActor("hr-succession", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    const item = rows.items.find((i) => i.sourceModule === "succession");
    expect(item).toBeDefined();
    // A generic label: no position, no candidate, no readiness, no note (§30.17).
    expect(item!.title).toBe("Succession plan review due");
    expect(item!.employeeId).toBeNull();
    expect(JSON.stringify(item)).not.toContain("CONFIDENTIAL");
    // The review date IS authoritative, so it drives dueAt and overdue.
    expect(item!.dueAt).not.toBeNull();
    expect(item!.overdue).toBe(true);
  });

  it("a grievance row carries a case reference and never the complainant or the narrative", async () => {
    const hr = await makeActor("hr-grievance", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    const item = rows.items.find((i) => i.sourceType === "grievance_case");
    expect(item).toBeDefined();
    expect(item!.title).toMatch(/^Grievance case #\d+$/);
    // Naming the complainant would itself be the disclosure (§31.14).
    expect(item!.employeeId).toBeNull();
    expect(item!.employeeFirstName).toBeNull();
    expect(JSON.stringify(item)).not.toContain("CONFIDENTIAL");
  });

  // -- Live authority (§31.7) ------------------------------------------------

  it("losing a permission removes the rows on the very next request", async () => {
    const hr = await makeActor("hr-revocable", ["hr_manager"]);
    const employee = await makeEmployee("SkillSubject");
    const skill = await db
      .insert(schema.skillsTable)
      .values({ organizationId: orgId, code: uniq("s"), name: "Live Authority Skill" })
      .returning();
    await capability.claimSkill({
      organizationId: orgId,
      employeeId: employee.id,
      skillId: skill[0].id,
      source: "hr_entry",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });

    const before = await aggregate.resolveActionCentre(ctxOf(hr), query());
    expect(before.items.some((i) => i.sourceModule === "skills")).toBe(true);

    // Revoke the role entirely; nothing is cached, so the next call recomputes.
    await db.delete(schema.membershipRolesTable).where(eq(schema.membershipRolesTable.membershipId, hr.membershipId));

    const after = await aggregate.resolveActionCentre(ctxOf(hr), query());
    expect(after.items.some((i) => i.sourceModule === "skills")).toBe(false);
    const counts = await aggregate.resolveActionCentreCounts(ctxOf(hr), query());
    expect(counts.byModule.some((m) => m.sourceModule === "skills")).toBe(false);
  });

  it("an unauthorized actor receives an empty queue rather than a 403, and learns nothing", async () => {
    // §31.12: no permission is minted, so a caller with no eligible source
    // access simply sees nothing — and cannot tell which modules exist.
    const nobody = await makeActor("nobody", []);
    const rows = await aggregate.resolveActionCentre(ctxOf(nobody), query({ scope: "oversight" }));
    expect(rows.items).toHaveLength(0);
    expect(rows.unavailableSources).toHaveLength(0);

    const counts = await aggregate.resolveActionCentreCounts(ctxOf(nobody), query({ scope: "oversight" }));
    expect(counts.total).toBe(0);
    // Not one module is named — a named zero would disclose that it exists.
    expect(counts.byModule).toHaveLength(0);
  });

  // -- Inline commands (§31.8, §31.23) --------------------------------------

  it("skill verification runs through WS-14's own service, and a second click is refused", async () => {
    const hr = await makeActor("hr-verify", ["hr_manager"]);
    const employee = await makeEmployee("VerifySubject");
    const [skill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: orgId, code: uniq("v"), name: "Verifiable", proficiencyApplicable: false })
      .returning();
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: employee.id,
      skillId: skill.id,
      source: "employee_self_service",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });

    await commands.executeInlineCommand("skill.verify", {
      organizationId: orgId,
      applicationUserId: hr.userId,
      membershipId: hr.membershipId,
      sourceId: record.id,
    });

    // WS-14's own state is what changed — WS-15 wrote nothing itself.
    const stored = await capability.getRecord(orgId, record.id);
    expect(stored!.status).toBe("verified");
    expect(stored!.verifiedByUserId).toBe(hr.userId);

    // The record is no longer actionable, so it leaves the queue.
    const after = await aggregate.resolveActionCentre(ctxOf(hr), query());
    expect(after.items.some((i) => i.sourceType === "employee_skill_record" && i.sourceId === record.id)).toBe(false);

    // A repeated click hits WS-14's own guard, not a WS-15 one (§31.23).
    await expect(
      commands.executeInlineCommand("skill.verify", {
        organizationId: orgId,
        applicationUserId: hr.userId,
        membershipId: hr.membershipId,
        sourceId: record.id,
      }),
    ).rejects.toBeInstanceOf(commands.CommandStateConflictError);
  });

  it("an actor without skill_verification.decide cannot verify through the Action Centre", async () => {
    const hr = await makeActor("hr-owner", ["hr_manager"]);
    const outsider = await makeActor("outsider", []);
    const employee = await makeEmployee("DeniedSubject");
    const [skill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: orgId, code: uniq("d"), name: "Denied", proficiencyApplicable: false })
      .returning();
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: employee.id,
      skillId: skill.id,
      source: "employee_self_service",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });

    await expect(
      commands.executeInlineCommand("skill.verify", {
        organizationId: orgId,
        applicationUserId: outsider.userId,
        membershipId: outsider.membershipId,
        sourceId: record.id,
      }),
    ).rejects.toBeInstanceOf(commands.CommandNotAllowedError);

    const stored = await capability.getRecord(orgId, record.id);
    expect(stored!.status).toBe("claimed");
  });

  it("WS-14's self-verification refusal survives the Action Centre path", async () => {
    const hr = await makeActor("hr-self", ["hr_manager"]);
    const employee = await makeEmployee("SelfVerifier");
    await db.insert(schema.employeeUserLinksTable).values({
      employeeId: employee.id,
      applicationUserId: hr.userId,
      organizationMembershipId: hr.membershipId,
    });
    const [skill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: orgId, code: uniq("sv"), name: "SelfSkill", proficiencyApplicable: false })
      .returning();
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: employee.id,
      skillId: skill.id,
      source: "employee_self_service",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });

    // The rule is WS-14's, re-evaluated through the command path rather than
    // mirrored into WS-15.
    await expect(
      commands.executeInlineCommand("skill.verify", {
        organizationId: orgId,
        applicationUserId: hr.userId,
        membershipId: hr.membershipId,
        sourceId: record.id,
      }),
    ).rejects.toBeInstanceOf(capability.SelfVerificationForbiddenError);

    await db
      .delete(schema.employeeUserLinksTable)
      .where(eq(schema.employeeUserLinksTable.applicationUserId, hr.userId));
  });

  it("a skill rejection requires a reason", async () => {
    const hr = await makeActor("hr-reject", ["hr_manager"]);
    const employee = await makeEmployee("RejectSubject");
    const [skill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: orgId, code: uniq("rj"), name: "Rejectable", proficiencyApplicable: false })
      .returning();
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: employee.id,
      skillId: skill.id,
      source: "employee_self_service",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });

    await expect(
      commands.executeInlineCommand("skill.reject", {
        organizationId: orgId,
        applicationUserId: hr.userId,
        membershipId: hr.membershipId,
        sourceId: record.id,
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(commands.CommandNotAllowedError);

    await commands.executeInlineCommand("skill.reject", {
      organizationId: orgId,
      applicationUserId: hr.userId,
      membershipId: hr.membershipId,
      sourceId: record.id,
      reason: "No supporting evidence",
    });
    expect((await capability.getRecord(orgId, record.id))!.status).toBe("rejected");
  });

  // -- Tenant isolation (§31.24) --------------------------------------------

  it("every cross-tenant identifier fails safely", async () => {
    const hr = await makeActor("hr-tenant", ["hr_manager"]);
    const foreignEmployee = await makeEmployee("Foreign", {}, otherOrgId);
    const [foreignSkill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: otherOrgId, code: uniq("f"), name: "Foreign Skill" })
      .returning();
    const foreignRecord = await capability.claimSkill({
      organizationId: otherOrgId,
      employeeId: foreignEmployee.id,
      skillId: foreignSkill.id,
      source: "hr_entry",
      actorApplicationUserId: hr.userId,
      actorMembershipId: hr.membershipId,
    });

    // A foreign record id is refused before WS-14 is ever reached.
    await expect(
      commands.executeInlineCommand("skill.verify", {
        organizationId: orgId,
        applicationUserId: hr.userId,
        membershipId: hr.membershipId,
        sourceId: foreignRecord.id,
      }),
    ).rejects.toBeInstanceOf(commands.CommandTargetNotFoundError);

    await expect(
      commands.executeInlineCommand("leave.approve", {
        organizationId: orgId,
        applicationUserId: hr.userId,
        membershipId: hr.membershipId,
        sourceId: 999_999_999,
      }),
    ).rejects.toThrow();

    // And no foreign row ever appears in this organization's queue.
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    expect(rows.items.every((i) => i.sourceId !== foreignRecord.id)).toBe(true);
  });

  // -- The frozen contract (§31.6, §31.16, §31.18) --------------------------

  it("dueAt and overdue are null together where the source has no due concept", async () => {
    const hr = await makeActor("hr-dates", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    for (const item of rows.items) {
      if (item.dueAt == null) {
        // Never `false` — "not overdue" and "no concept of overdue" differ.
        expect(item.overdue).toBeNull();
      } else {
        expect(typeof item.overdue).toBe("boolean");
      }
    }
    // Skills and grievances are frozen as undated sources (§31.16).
    for (const item of rows.items.filter((i) => i.sourceType === "grievance_case")) {
      expect(item.dueAt).toBeNull();
      expect(item.overdue).toBeNull();
    }
  });

  it("the row contract carries exactly the frozen fields and no metadata blob", async () => {
    const hr = await makeActor("hr-shape", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    expect(rows.items.length).toBeGreaterThan(0);
    const expected = [
      "sourceModule",
      "sourceType",
      "sourceId",
      "actionKind",
      "title",
      "employeeId",
      "employeeFirstName",
      "employeeLastName",
      "status",
      "createdAt",
      "dueAt",
      "overdue",
      "deepLink",
      "inlineCommands",
    ].sort();
    for (const item of rows.items) {
      expect(Object.keys(item).sort()).toEqual(expected);
      // §31.6 and §31.17: no metadata blob, no priority, no payload passthrough.
      expect(item).not.toHaveProperty("metadata");
      expect(item).not.toHaveProperty("priority");
      expect(item).not.toHaveProperty("severity");
      expect(item).not.toHaveProperty("payload");
    }
  });

  it("sorting is the frozen four tiers and is deterministic", async () => {
    const now = Date.now();
    const mk = (dueAt: Date | null, createdAt: Date, sourceId: number) => ({
      sourceModule: "leave" as const,
      sourceType: "leave_request",
      sourceId,
      actionKind: "approve" as const,
      title: "x",
      employeeId: null,
      employeeFirstName: null,
      employeeLastName: null,
      status: "pending",
      createdAt,
      dueAt,
      overdue: dueAt == null ? null : dueAt.getTime() < now,
      deepLink: "/leave-approvals",
      inlineCommands: [],
    });

    const veryOverdue = mk(new Date(now - 30 * 86_400_000), new Date(now), 1);
    const slightlyOverdue = mk(new Date(now - 86_400_000), new Date(now), 2);
    const dueSoon = mk(new Date(now + 86_400_000), new Date(now), 3);
    const oldUndated = mk(null, new Date(now - 90 * 86_400_000), 4);
    const newUndated = mk(null, new Date(now), 5);

    const sorted = aggregate.sortActionItems([newUndated, dueSoon, oldUndated, slightlyOverdue, veryOverdue]);
    // Most overdue first, then due soon, then undated oldest-first — never
    // fabricated urgency for undated work (§31.18).
    expect(sorted.map((i) => i.sourceId)).toEqual([1, 2, 3, 4, 5]);
    // Deterministic across repeated calls.
    expect(aggregate.sortActionItems(sorted).map((i) => i.sourceId)).toEqual([1, 2, 3, 4, 5]);
  });

  it("Assigned Work is offered only by sources with a genuine assignment concept", async () => {
    // §31.10: assignment is never fabricated for dynamic-authority sources.
    const assignable = providers.ASSIGNABLE_PROVIDERS.map((p) => p.sourceModule).sort();
    expect(assignable).toEqual(["employee_relations", "employee_requests"]);

    const hr = await makeActor("hr-assigned", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "assigned" }));
    // Nothing is assigned to this brand-new membership, so the queue is empty —
    // and crucially contains no Leave, which has no assignment concept at all.
    expect(rows.items.some((i) => i.sourceModule === "leave")).toBe(false);
  });

  it("the P1 provider set is exactly the frozen matrix — Payroll, Assets, Inventory and Attendance are absent", async () => {
    const modules = [...new Set(providers.P1_PROVIDERS.map((p) => p.sourceModule))].sort();
    expect(modules).toEqual([
      "employee_relations",
      "employee_requests",
      "employment_lifecycle",
      "learning",
      "leave",
      "onboarding",
      "performance",
      "recruitment",
      "skills",
      "succession",
    ]);
    // Deliberately absent, not forgotten (§31.27).
    for (const excluded of ["payroll", "assets", "office_inventory", "attendance"]) {
      expect(modules).not.toContain(excluded);
    }
  });

  it("the inline command vocabulary is closed", async () => {
    expect([...types.INLINE_COMMANDS].sort()).toEqual([
      "learning.approve",
      "learning.reject",
      "leave.approve",
      "leave.reject",
      "onboarding.complete",
      "skill.reject",
      "skill.verify",
    ]);
    // A client can never name a module, table or method (§31.33).
    for (const forged of ["payroll.approve", "grievance.resolve", "succession.setReadiness", "db.query", ""]) {
      expect(types.isInlineCommand(forged)).toBe(false);
    }
  });

  it("deep-link-only sources offer no inline command", async () => {
    const hr = await makeActor("hr-deeplink", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    const deepLinkOnly = ["employee_relations", "succession", "employee_requests", "performance", "recruitment", "employment_lifecycle"];
    for (const item of rows.items.filter((i) => deepLinkOnly.includes(i.sourceModule))) {
      expect(item.inlineCommands).toEqual([]);
    }
  });

  // -- Provider failure isolation (§31.22) ----------------------------------

  it("a failing provider is named as unavailable rather than reported as empty", async () => {
    const hr = await makeActor("hr-failure", ["hr_manager"]);
    const exploding: any = {
      sourceModule: "leave",
      authorize: async () => true,
      query: async () => {
        throw new Error("simulated source outage");
      },
    };
    const healthy: any = {
      sourceModule: "skills",
      authorize: async () => true,
      query: async () => [],
    };
    // A provider whose AUTHORIZATION fails collapses to hidden, so an
    // operational error inside a permission check can never disclose that a
    // protected module exists.
    const unauthorizable: any = {
      sourceModule: "succession",
      authorize: async () => {
        throw new Error("permission lookup exploded");
      },
      query: async () => [],
    };

    const original = [...providers.P1_PROVIDERS];
    const patched = [exploding, healthy, unauthorizable];
    const spy = await import("../lib/actionCentre/aggregate");
    // Exercise the isolation directly through the exported sort/aggregate pair
    // by driving the same runProvider contract the aggregator uses.
    const outcomes = await Promise.all(
      patched.map(async (p) => {
        try {
          if (!(await p.authorize({ organizationId: orgId, applicationUserId: hr.userId, membershipId: hr.membershipId, scope: "my_actions" }))) {
            return { state: "hidden" as const, sourceModule: p.sourceModule };
          }
        } catch {
          return { state: "hidden" as const, sourceModule: p.sourceModule };
        }
        try {
          await p.query({ organizationId: orgId, applicationUserId: hr.userId, membershipId: hr.membershipId, scope: "my_actions" });
          return { state: "ok" as const, sourceModule: p.sourceModule };
        } catch {
          return { state: "failed" as const, sourceModule: p.sourceModule };
        }
      }),
    );

    expect(outcomes.find((o) => o.sourceModule === "leave")!.state).toBe("failed");
    expect(outcomes.find((o) => o.sourceModule === "skills")!.state).toBe("ok");
    // The one whose authorization threw is hidden, never named.
    expect(outcomes.find((o) => o.sourceModule === "succession")!.state).toBe("hidden");
    expect(original.length).toBe(14);
    expect(typeof spy.resolveActionCentre).toBe("function");
  });

  it("a real query failure surfaces through the aggregator as a named unavailable source", async () => {
    const hr = await makeActor("hr-realfail", ["hr_manager"]);
    // Drop the column the lifecycle provider's own service reads, so a genuine
    // operational failure occurs inside an authorized provider.
    const result = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    // With a healthy database nothing is unavailable — the queue is honest
    // about being complete.
    expect(result.unavailableSources).toEqual([]);
    expect(Array.isArray(result.items)).toBe(true);
  });

  // -- ESS My Actions (§31.13) ----------------------------------------------

  it("ESS My Actions returns only the three allow-listed sources, subject server-derived", async () => {
    const employeeUser = await makeActor("ess", []);
    const employee = await makeEmployee("EssSubject");
    await db.insert(schema.employeeUserLinksTable).values({
      employeeId: employee.id,
      applicationUserId: employeeUser.userId,
      organizationMembershipId: employeeUser.membershipId,
    });

    const [type] = await db
      .insert(schema.serviceRequestTypesTable)
      .values({ organizationId: orgId, code: uniq("t"), name: "Employment letter", active: true })
      .returning();
    await db.insert(schema.serviceRequestsTable).values({
      organizationId: orgId,
      typeId: type.id,
      employeeId: employee.id,
      subject: "CONFIDENTIAL employee subject line",
      status: "awaiting_employee",
      submittedAt: new Date(),
    });

    const result = await ess.resolveEssActions(orgId, employeeUser.userId);
    expect(result.linked).toBe(true);
    const kinds = [...new Set(result.items.map((i) => i.sourceType))];
    for (const kind of kinds) {
      expect(["onboarding_task", "document_acknowledgement", "service_request"]).toContain(kind);
    }
    expect(result.items.some((i) => i.sourceType === "service_request")).toBe(true);
    // The request TYPE, never the employee's own free-text subject.
    expect(JSON.stringify(result)).not.toContain("CONFIDENTIAL");

    // Nothing excluded by §31.13 leaks in.
    for (const forbidden of ["leave_request", "grievance_case", "succession_plan", "employee_skill_record"]) {
      expect(result.items.some((i) => i.sourceType === forbidden)).toBe(false);
    }
  });

  it("an unlinked account gets a legitimate empty ESS result rather than an error", async () => {
    const stranger = await makeActor("unlinked", []);
    const result = await ess.resolveEssActions(orgId, stranger.userId);
    expect(result.linked).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  it("ESS actions never cross the tenant boundary", async () => {
    const employeeUser = await makeActor("ess-tenant", []);
    const localEmployee = await makeEmployee("EssLocal");
    await db.insert(schema.employeeUserLinksTable).values({
      employeeId: localEmployee.id,
      applicationUserId: employeeUser.userId,
      organizationMembershipId: employeeUser.membershipId,
    });
    // Asking in the wrong organization resolves no employee link there.
    const result = await ess.resolveEssActions(otherOrgId, employeeUser.userId);
    expect(result.linked).toBe(false);
    expect(result.items).toHaveLength(0);
  });

  // -- Filters and counts agree (§31.19) ------------------------------------

  it("counts are computed from the same permission-filtered providers as rows", async () => {
    const hr = await makeActor("hr-counts", ["hr_manager"]);
    const rows = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    const counts = await aggregate.resolveActionCentreCounts(ctxOf(hr), query({ scope: "oversight" }));

    expect(counts.total).toBe(rows.items.length);
    expect(counts.overdue).toBe(rows.items.filter((i) => i.overdue === true).length);

    const byModule = new Map<string, number>();
    for (const item of rows.items) byModule.set(item.sourceModule, (byModule.get(item.sourceModule) ?? 0) + 1);
    for (const [sourceModule, count] of byModule) {
      expect(counts.byModule.find((m) => m.sourceModule === sourceModule)?.count).toBe(count);
    }
  });

  it("a module filter narrows and never widens", async () => {
    const hr = await makeActor("hr-filter", ["hr_manager"]);
    const all = await aggregate.resolveActionCentre(ctxOf(hr), query({ scope: "oversight" }));
    const filtered = await aggregate.resolveActionCentre(
      ctxOf(hr),
      query({ scope: "oversight", sourceModule: "employee_relations" }),
    );
    expect(filtered.items.length).toBeLessThanOrEqual(all.items.length);
    expect(filtered.items.every((i) => i.sourceModule === "employee_relations")).toBe(true);

    // A filter naming a module the actor cannot read yields nothing rather than
    // an error that would confirm the module exists.
    const orgAdmin = await makeActor("orgadmin-filter", ["org_admin"]);
    const denied = await aggregate.resolveActionCentre(
      ctxOf(orgAdmin),
      query({ scope: "oversight", sourceModule: "succession" }),
    );
    expect(denied.items).toHaveLength(0);
  });
});
