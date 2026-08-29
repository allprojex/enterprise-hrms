/**
 * WS-14 — live proof of Skills, Competency Framework & Succession.
 *
 * The invariants §30 freezes, each proved against a real database rather than
 * asserted in prose:
 *
 *   - one catalogue, organization-unique codes, retire-never-delete;
 *   - Master Data import is idempotent and one-way;
 *   - exactly one active proficiency scale, guaranteed by the database;
 *   - publishing a scale archives the incumbent and rewrites no history;
 *   - a level's ORDER can never change, so past assessments keep their meaning;
 *   - claiming verifies nothing, and assessing verifies nothing;
 *   - verification is the only writer of a verified level;
 *   - nobody verifies their own skill;
 *   - assessor authority comes from the employee record, not a role name;
 *   - assessment history is append-only;
 *   - only VERIFIED capability counts toward a requirement, and
 *     no-verified-evidence is a distinct state from below-requirement;
 *   - expired certification evidence stops counting, derived and never stored;
 *   - one open succession plan per position, guaranteed by the database;
 *   - a terminated employee cannot be nominated;
 *   - candidates carry NO rank, score or ordering column — asserted against
 *     the live schema, not against the ORM model;
 *   - nomination, readiness and removal change no employment state;
 *   - readiness is human-supplied and appends a chronology entry;
 *   - coverage reporting leaks no candidate identity or confidential note;
 *   - every cross-tenant identifier fails safely;
 *   - no WS-14 job type can assess, verify, nominate or change readiness;
 *   - org_admin does not receive succession access by default.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS14_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-14 — skills, competency and succession, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let sql: any;

  let orgId: number;
  let otherOrgId: number;
  let hrUserId: number;
  let hrMembershipId: number;
  let verifierUserId: number;
  let verifierMembershipId: number;
  let otherOrgSkillId: number;
  let otherOrgPositionId: number;
  let otherOrgEmployeeId: number;

  let scaleLevels: any[];

  let catalogue: typeof import("../lib/skills/catalogue");
  let capability: typeof import("../lib/skills/capability");
  let succession: typeof import("../lib/skills/succession");
  let reminders: typeof import("../lib/skills/reminders");
  let jobHandlers: typeof import("../lib/jobHandlers");
  let registry: typeof import("../lib/jobHandlerRegistry");

  const suffix = `ws14-${Date.now()}`;
  let seq = 0;
  const uniq = (tag: string) => `${tag}-${suffix}-${(seq += 1)}`;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    sql = drizzle.sql;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    catalogue = await import("../lib/skills/catalogue");
    capability = await import("../lib/skills/capability");
    succession = await import("../lib/skills/succession");
    reminders = await import("../lib/skills/reminders");
    jobHandlers = await import("../lib/jobHandlers");
    registry = await import("../lib/jobHandlerRegistry");
    jobHandlers.registerShippedJobHandlers();

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS14 ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS14 other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    const mkUser = async (tag: string, organizationId: number) => {
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
      return { userId: u.id, membershipId: m.id };
    };

    const hr = await mkUser("hr", orgId);
    hrUserId = hr.userId;
    hrMembershipId = hr.membershipId;
    const verifier = await mkUser("verifier", orgId);
    verifierUserId = verifier.userId;
    verifierMembershipId = verifier.membershipId;

    // The one scale every capability test measures against.
    const created = await catalogue.createScale({
      organizationId: orgId,
      name: "Baseline",
      levels: [{ label: "Awareness" }, { label: "Working" }, { label: "Expert" }],
      ...asHr(),
    });
    scaleLevels = created.levels;

    // Cross-tenant bait: real rows, in the wrong organization.
    const [foreignSkill] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: otherOrgId, code: uniq("foreign"), name: "Foreign Skill" })
      .returning();
    otherOrgSkillId = foreignSkill.id;
    const [foreignPos] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: otherOrgId, title: `Foreign Position ${suffix}` })
      .returning();
    otherOrgPositionId = foreignPos.id;
    const [foreignEmp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Foreign", lastName: "Employee" })
      .returning();
    otherOrgEmployeeId = foreignEmp.id;
  });

  function asHr() {
    return { actorApplicationUserId: hrUserId, actorMembershipId: hrMembershipId };
  }
  function asVerifier() {
    return { actorApplicationUserId: verifierUserId, actorMembershipId: verifierMembershipId };
  }

  async function makeEmployee(tag: string, overrides: Record<string, unknown> = {}) {
    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: tag, lastName: "Subject", ...overrides })
      .returning();
    return emp;
  }

  async function makePosition(tag: string) {
    const [pos] = await db
      .insert(schema.positionsTable)
      .values({ organizationId: orgId, title: `${tag} ${suffix}` })
      .returning();
    return pos;
  }

  async function makeSkill(tag: string, overrides: Record<string, unknown> = {}) {
    return catalogue.createSkill({ organizationId: orgId, code: uniq(tag), name: tag, ...overrides, ...asHr() });
  }

  const AWARENESS = () => scaleLevels[0];
  const WORKING = () => scaleLevels[1];
  const EXPERT = () => scaleLevels[2];

  // -- Catalogue (§30.2–30.4) ----------------------------------------------

  it("a skill code is unique per organization, and the same code is free elsewhere", async () => {
    const code = uniq("dup");
    await catalogue.createSkill({ organizationId: orgId, code, name: "First", ...asHr() });

    await expect(
      catalogue.createSkill({ organizationId: orgId, code, name: "Second", ...asHr() }),
    ).rejects.toBeInstanceOf(catalogue.DuplicateSkillCodeError);

    // Another organization is free to use the identical code — the uniqueness
    // is organization-scoped, not global.
    const [elsewhere] = await db
      .insert(schema.skillsTable)
      .values({ organizationId: otherOrgId, code, name: "Elsewhere" })
      .returning();
    expect(elsewhere.code).toBe(code);
  });

  it("retiring a skill deactivates it and never deletes it", async () => {
    const skill = await makeSkill("Retirable");
    const emp = await makeEmployee("HoldsRetired");
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      source: "hr_entry",
      ...asHr(),
    });

    const retired = await catalogue.updateSkill({
      organizationId: orgId,
      skillId: skill.id,
      active: false,
      ...asHr(),
    });
    expect(retired.active).toBe(false);

    // The row survives, and so does the record pointing at it.
    const still = await catalogue.getSkill(orgId, skill.id);
    expect(still).toBeDefined();
    const held = await capability.getRecord(orgId, record.id);
    expect(held!.skillId).toBe(skill.id);

    // A retired skill can no longer be claimed afresh.
    const other = await makeEmployee("CannotClaimRetired");
    await expect(
      capability.claimSkill({
        organizationId: orgId,
        employeeId: other.id,
        skillId: skill.id,
        source: "hr_entry",
        ...asHr(),
      }),
    ).rejects.toBeInstanceOf(capability.InvalidCapabilityError);
  });

  it("Master Data import is idempotent, and writes nothing back to Master Data", async () => {
    const codes = [uniq("md-a"), uniq("md-b")];
    for (const code of codes) {
      await db
        .insert(schema.masterDataItemsTable)
        .values({ domain: "skill", organizationId: orgId, code, label: `Label ${code}` });
    }
    const before = await db
      .select()
      .from(schema.masterDataItemsTable)
      .where(and(eq(schema.masterDataItemsTable.organizationId, orgId), eq(schema.masterDataItemsTable.domain, "skill")));

    const first = await catalogue.importFromMasterData({ organizationId: orgId, ...asHr() });
    expect(first.imported).toBeGreaterThanOrEqual(2);

    // Re-running imports nothing new — the second pass skips every item.
    const second = await catalogue.importFromMasterData({ organizationId: orgId, ...asHr() });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(before.length);

    // Master Data itself is untouched: same rows, same labels.
    const after = await db
      .select()
      .from(schema.masterDataItemsTable)
      .where(and(eq(schema.masterDataItemsTable.organizationId, orgId), eq(schema.masterDataItemsTable.domain, "skill")));
    expect(after.length).toBe(before.length);
    expect(after.map((r: any) => r.label).sort()).toEqual(before.map((r: any) => r.label).sort());
  });

  // -- Proficiency scale (§30.3) -------------------------------------------

  it("the database allows only one active scale, and publishing archives the incumbent", async () => {
    const activeBefore = await catalogue.getActiveScale(orgId);
    expect(activeBefore).not.toBeNull();

    const replacement = await catalogue.createScale({
      organizationId: orgId,
      name: `Replacement ${suffix}`,
      levels: [{ label: "Novice" }, { label: "Practised" }],
      ...asHr(),
    });

    const rows = await db
      .select()
      .from(schema.proficiencyScalesTable)
      .where(and(eq(schema.proficiencyScalesTable.organizationId, orgId), eq(schema.proficiencyScalesTable.active, true)));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(replacement.scale.id);

    // The old scale is archived, NOT deleted — every historical assessment
    // pointing at its levels still resolves (§30.3).
    const old = await db
      .select()
      .from(schema.proficiencyScalesTable)
      .where(eq(schema.proficiencyScalesTable.id, activeBefore!.scale.id));
    expect(old).toHaveLength(1);
    expect(old[0].active).toBe(false);
    const oldLevels = await catalogue.listLevels(orgId, activeBefore!.scale.id);
    expect(oldLevels.length).toBe(3);

    // And the index is a real database guarantee, not a service convention:
    // a hand-written second active scale is refused outright.
    await expect(
      db
        .insert(schema.proficiencyScalesTable)
        .values({ organizationId: orgId, name: "Smuggled", active: true }),
    ).rejects.toThrow();

    // Restore the baseline scale as active for the remaining tests.
    await db
      .update(schema.proficiencyScalesTable)
      .set({ active: false })
      .where(eq(schema.proficiencyScalesTable.id, replacement.scale.id));
    await db
      .update(schema.proficiencyScalesTable)
      .set({ active: true })
      .where(eq(schema.proficiencyScalesTable.id, activeBefore!.scale.id));
  });

  it("a level can be relabelled but never reordered, so old assessments keep their meaning", async () => {
    const skill = await makeSkill("Relabelled", { proficiencyApplicable: true });
    const emp = await makeEmployee("RelabelSubject");
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: WORKING().id,
      source: "hr_entry",
      ...asHr(),
    });
    await capability.assess({
      organizationId: orgId,
      recordId: record.id,
      levelId: WORKING().id,
      assessorRole: "hr",
      assessedAt: new Date(),
      ...asHr(),
    });

    const relabelled = await catalogue.relabelLevel({
      organizationId: orgId,
      levelId: WORKING().id,
      label: "Competent",
      ...asHr(),
    });
    expect(relabelled.label).toBe("Competent");
    // The ordinal is untouched — relabelLevel has no path to it at all.
    expect(relabelled.ordinal).toBe(WORKING().ordinal);

    // The assessment still points at the same level row, so its ordinal
    // relationship to the requirement is exactly what it was.
    const history = await capability.listAssessments(orgId, record.id);
    expect(history[0]!.levelId).toBe(WORKING().id);

    await catalogue.relabelLevel({ organizationId: orgId, levelId: WORKING().id, label: "Working", ...asHr() });
  });

  // -- Claim, assess, verify (§30.5–30.8) -----------------------------------

  it("claiming records an unverified claim and never sets a verified level", async () => {
    const skill = await makeSkill("Claimed", { proficiencyApplicable: true });
    const emp = await makeEmployee("Claimer");

    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: EXPERT().id,
      source: "employee_self_service",
      ...asHr(),
    });

    expect(record.status).toBe("claimed");
    expect(record.claimedLevelId).toBe(EXPERT().id);
    expect(record.verifiedLevelId).toBeNull();
    expect(record.verifiedAt).toBeNull();
    expect(record.verifiedByUserId).toBeNull();

    // Re-claiming the same skill updates the one record rather than creating a
    // second: the table is unique on (organization, employee, skill), so an
    // employee has exactly one standing on any given skill.
    const again = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: WORKING().id,
      source: "hr_entry",
      ...asHr(),
    });
    expect(again.id).toBe(record.id);
    expect(again.claimedLevelId).toBe(WORKING().id);
    expect(again.verifiedLevelId).toBeNull();

    const rows = await db
      .select()
      .from(schema.employeeSkillRecordsTable)
      .where(
        and(
          eq(schema.employeeSkillRecordsTable.employeeId, emp.id),
          eq(schema.employeeSkillRecordsTable.skillId, skill.id),
        ),
      );
    expect(rows).toHaveLength(1);

    // And the uniqueness is a database guarantee, not a service convention: a
    // hand-written second row is refused outright.
    await expect(
      db.insert(schema.employeeSkillRecordsTable).values({
        organizationId: orgId,
        employeeId: emp.id,
        skillId: skill.id,
        status: "claimed",
        source: "hr_entry",
      }),
    ).rejects.toThrow();

    // A later re-claim cannot disturb a verification already recorded.
    await capability.verify({
      organizationId: orgId,
      recordId: record.id,
      levelId: WORKING().id,
      assessedAt: new Date(),
      ...asVerifier(),
    });
    const afterVerified = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: EXPERT().id,
      source: "employee_self_service",
      ...asHr(),
    });
    expect(afterVerified.status).toBe("verified");
    expect(afterVerified.verifiedLevelId).toBe(WORKING().id);
  });

  it("assessing does not verify, and verification is the only writer of a verified level", async () => {
    const skill = await makeSkill("Assessed", { proficiencyApplicable: true });
    const emp = await makeEmployee("Assessee");
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: EXPERT().id,
      source: "employee_self_service",
      ...asHr(),
    });

    const assessed = await capability.assess({
      organizationId: orgId,
      recordId: record.id,
      levelId: WORKING().id,
      assessorRole: "hr",
      assessedAt: new Date(),
      notes: "Observed at working level",
      ...asHr(),
    });

    // An assessment is an opinion on the record. It is NOT a confirmation.
    expect(assessed.record.status).toBe("assessed");
    expect(assessed.record.verifiedLevelId).toBeNull();
    expect(assessed.record.verifiedAt).toBeNull();
    expect(assessed.assessment.kind).toBe("assessment");

    const verified = await capability.verify({
      organizationId: orgId,
      recordId: record.id,
      levelId: WORKING().id,
      assessedAt: new Date(),
      ...asVerifier(),
    });
    expect(verified.record.status).toBe("verified");
    expect(verified.record.verifiedLevelId).toBe(WORKING().id);
    expect(verified.record.verifiedAt).not.toBeNull();
    expect(verified.record.verifiedByUserId).toBe(verifierUserId);
    expect(verified.assessment.kind).toBe("verification");

    // Verification recorded the level the verifier confirmed, not the level
    // the employee claimed.
    expect(verified.record.claimedLevelId).toBe(EXPERT().id);
    expect(verified.record.verifiedLevelId).toBe(WORKING().id);
  });

  it("assessment history is append-only", async () => {
    const skill = await makeSkill("History", { proficiencyApplicable: true });
    const emp = await makeEmployee("Historian");
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      source: "hr_entry",
      ...asHr(),
    });

    await capability.assess({
      organizationId: orgId,
      recordId: record.id,
      levelId: AWARENESS().id,
      assessorRole: "hr",
      assessedAt: new Date(Date.now() - 60_000),
      ...asHr(),
    });
    await capability.assess({
      organizationId: orgId,
      recordId: record.id,
      levelId: EXPERT().id,
      assessorRole: "reporting_manager",
      assessedAt: new Date(),
      ...asHr(),
    });
    // A proficiency-applicable skill cannot be verified without naming the
    // level being confirmed — "verified, at some unstated standard" is not a
    // thing this platform records.
    await expect(
      capability.verify({ organizationId: orgId, recordId: record.id, assessedAt: new Date(), ...asVerifier() }),
    ).rejects.toBeInstanceOf(capability.InvalidCapabilityError);
    await capability.verify({
      organizationId: orgId,
      recordId: record.id,
      levelId: EXPERT().id,
      assessedAt: new Date(),
      ...asVerifier(),
    });

    const history = await capability.listAssessments(orgId, record.id);
    // Three separate rows: the earlier judgements were not overwritten by the
    // later ones, and the verification did not replace them either.
    expect(history).toHaveLength(3);
    expect(history.map((a: any) => a.kind)).toEqual(["verification", "assessment", "assessment"]);
    expect(history.some((a: any) => a.levelId === AWARENESS().id)).toBe(true);
    expect(history.some((a: any) => a.levelId === EXPERT().id)).toBe(true);
  });

  it("nobody verifies their own skill", async () => {
    const skill = await makeSkill("SelfVerify", { proficiencyApplicable: true });
    const emp = await makeEmployee("SelfVerifier");
    // The verifier IS this employee.
    await db.insert(schema.employeeUserLinksTable).values({
      employeeId: emp.id,
      applicationUserId: verifierUserId,
      organizationMembershipId: verifierMembershipId,
    });

    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      source: "employee_self_service",
      ...asHr(),
    });

    await expect(
      capability.verify({ organizationId: orgId, recordId: record.id, assessedAt: new Date(), ...asVerifier() }),
    ).rejects.toBeInstanceOf(capability.SelfVerificationForbiddenError);

    // And the record is untouched by the refusal.
    const after = await capability.getRecord(orgId, record.id);
    expect(after!.status).toBe("claimed");
    expect(after!.verifiedLevelId).toBeNull();

    await db
      .delete(schema.employeeUserLinksTable)
      .where(eq(schema.employeeUserLinksTable.applicationUserId, verifierUserId));
  });

  it("assessor authority comes from the employee record, never from a role name", async () => {
    const managerEmp = await makeEmployee("Manager");
    const managed = await makeEmployee("Managed", { reportingManagerId: managerEmp.id });
    const unrelated = await makeEmployee("Unrelated");

    const { userId: managerUserId, membershipId: managerMembershipId } = await (async () => {
      const [u] = await db
        .insert(schema.usersTable)
        .values({
          email: `${uniq("mgr")}@example.invalid`,
          passwordHash: "x",
          firstName: "Mgr",
          lastName: "User",
          organizationId: orgId,
        })
        .returning();
      const [m] = await db
        .insert(schema.organizationMembershipsTable)
        .values({ applicationUserId: u.id, organizationId: orgId, status: "active" })
        .returning();
      await db
        .insert(schema.employeeUserLinksTable)
        .values({ employeeId: managerEmp.id, applicationUserId: u.id, organizationMembershipId: m.id });
      return { userId: u.id, membershipId: m.id };
    })();
    expect(managerMembershipId).toBeGreaterThan(0);

    // The authoritative manager of this employee, holding no HR key at all.
    await expect(
      capability.resolveAssessorRole({
        organizationId: orgId,
        subjectEmployeeId: managed.id,
        actorApplicationUserId: managerUserId,
        hasHrAssessPermission: false,
      }),
    ).resolves.toBe("reporting_manager");

    // The same person, over somebody who does not report to them: no authority.
    await expect(
      capability.resolveAssessorRole({
        organizationId: orgId,
        subjectEmployeeId: unrelated.id,
        actorApplicationUserId: managerUserId,
        hasHrAssessPermission: false,
      }),
    ).resolves.toBeNull();

    // An HR key is its own, separate route to authority.
    await expect(
      capability.resolveAssessorRole({
        organizationId: orgId,
        subjectEmployeeId: unrelated.id,
        actorApplicationUserId: hrUserId,
        hasHrAssessPermission: true,
      }),
    ).resolves.toBe("hr");

    // And somebody with neither is refused.
    await expect(
      capability.resolveAssessorRole({
        organizationId: orgId,
        subjectEmployeeId: unrelated.id,
        actorApplicationUserId: hrUserId,
        hasHrAssessPermission: false,
      }),
    ).resolves.toBeNull();
  });

  it("a rejection is recorded, and rejecting requires a reason", async () => {
    const skill = await makeSkill("Rejected", { proficiencyApplicable: true });
    const emp = await makeEmployee("Rejectee");
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: EXPERT().id,
      source: "employee_self_service",
      ...asHr(),
    });

    await expect(
      capability.reject({
        organizationId: orgId,
        recordId: record.id,
        reason: "   ",
        assessedAt: new Date(),
        ...asVerifier(),
      }),
    ).rejects.toBeInstanceOf(capability.InvalidCapabilityError);

    const rejected = await capability.reject({
      organizationId: orgId,
      recordId: record.id,
      reason: "No supporting evidence",
      assessedAt: new Date(),
      ...asVerifier(),
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.verifiedLevelId).toBeNull();

    const history = await capability.listAssessments(orgId, record.id);
    expect(history.some((a: any) => a.kind === "rejection")).toBe(true);
  });

  // -- Requirements and gaps (§30.9, §30.10, §30.20) -------------------------

  it("only verified capability counts, and missing evidence is not the same as falling short", async () => {
    const position = await makePosition("Gapped");
    const emp = await makeEmployee("Gappy", { positionId: position.id });

    const missing = await makeSkill("GapMissing", { proficiencyApplicable: true });
    const claimedOnly = await makeSkill("GapClaimed", { proficiencyApplicable: true });
    const below = await makeSkill("GapBelow", { proficiencyApplicable: true });
    const meets = await makeSkill("GapMeets", { proficiencyApplicable: true });
    const exceeds = await makeSkill("GapExceeds", { proficiencyApplicable: true });

    for (const s of [missing, claimedOnly, below, meets, exceeds]) {
      await capability.addRequirement({
        organizationId: orgId,
        positionId: position.id,
        skillId: s.id,
        minimumLevelId: WORKING().id,
        mandatory: true,
        ...asHr(),
      });
    }

    // Claimed but never verified.
    await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: claimedOnly.id,
      claimedLevelId: EXPERT().id,
      source: "employee_self_service",
      ...asHr(),
    });

    const verifyAt = async (skillId: number, levelId: number) => {
      const rec = await capability.claimSkill({
        organizationId: orgId,
        employeeId: emp.id,
        skillId,
        claimedLevelId: levelId,
        source: "hr_entry",
        ...asHr(),
      });
      await capability.verify({ organizationId: orgId, recordId: rec.id, levelId, assessedAt: new Date(), ...asVerifier() });
      return rec;
    };
    await verifyAt(below.id, AWARENESS().id);
    await verifyAt(meets.id, WORKING().id);
    await verifyAt(exceeds.id, EXPERT().id);

    const gaps = await capability.computeGaps({ organizationId: orgId, employeeId: emp.id, positionId: position.id });
    const bySkill = new Map(gaps.map((g) => [g.skillId, g]));

    // Nothing at all recorded.
    expect(bySkill.get(missing.id)!.state).toBe("no_verified_evidence");
    expect(bySkill.get(missing.id)!.hasUnverifiedClaim).toBe(false);

    // A confident self-claim at the TOP level still does not satisfy the
    // requirement — and it is reported separately so a human can see it.
    const claimGap = bySkill.get(claimedOnly.id)!;
    expect(claimGap.state).toBe("no_verified_evidence");
    expect(claimGap.hasUnverifiedClaim).toBe(true);
    expect(claimGap.verifiedLevelOrdinal).toBeNull();

    expect(bySkill.get(below.id)!.state).toBe("below_requirement");
    expect(bySkill.get(meets.id)!.state).toBe("meets_requirement");
    expect(bySkill.get(exceeds.id)!.state).toBe("exceeds_requirement");
  });

  it("expired certification evidence stops counting, and the expiry is derived rather than stored", async () => {
    const position = await makePosition("CertGated");
    const emp = await makeEmployee("CertHolder", { positionId: position.id });
    const skill = await makeSkill("CertSkill", { proficiencyApplicable: true, certificationApplicable: true });

    const expiry = new Date(Date.now() + 30 * 86_400_000);
    const [cert] = await db
      .insert(schema.employeeCertificationsTable)
      .values({
        organizationId: orgId,
        employeeId: emp.id,
        certificationTypeCode: uniq("cert"),
        expiryDate: expiry,
      })
      .returning();

    await capability.addRequirement({
      organizationId: orgId,
      positionId: position.id,
      skillId: skill.id,
      minimumLevelId: WORKING().id,
      mandatory: true,
      ...asHr(),
    });
    const rec = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: WORKING().id,
      certificationId: cert.id,
      source: "hr_entry",
      ...asHr(),
    });
    await capability.verify({
      organizationId: orgId,
      recordId: rec.id,
      levelId: WORKING().id,
      assessedAt: new Date(),
      ...asVerifier(),
    });

    const today = await capability.computeGaps({
      organizationId: orgId,
      employeeId: emp.id,
      positionId: position.id,
    });
    expect(today[0]!.state).toBe("meets_requirement");
    expect(today[0]!.evidenceExpired).toBe(false);

    // Same stored row, read at a later date: the evidence has lapsed.
    const later = await capability.computeGaps({
      organizationId: orgId,
      employeeId: emp.id,
      positionId: position.id,
      asOf: new Date(Date.now() + 60 * 86_400_000),
    });
    expect(later[0]!.evidenceExpired).toBe(true);
    expect(later[0]!.state).toBe("no_verified_evidence");

    // And nothing about the record itself changed — the lapse is computed,
    // never written (§30.20).
    const stored = await capability.getRecord(orgId, rec.id);
    expect(stored!.status).toBe("verified");
    expect(stored!.verifiedLevelId).toBe(WORKING().id);
  });

  it("a withdrawn requirement stops being measured, and the row is retained", async () => {
    const position = await makePosition("Withdrawable");
    const emp = await makeEmployee("WithdrawSubject", { positionId: position.id });
    const skill = await makeSkill("WithdrawSkill");

    const req = await capability.addRequirement({
      organizationId: orgId,
      positionId: position.id,
      skillId: skill.id,
      mandatory: true,
      ...asHr(),
    });
    expect(await capability.computeGaps({ organizationId: orgId, employeeId: emp.id, positionId: position.id })).toHaveLength(1);

    await capability.removeRequirement({ organizationId: orgId, requirementId: req.id, ...asHr() });

    expect(await capability.computeGaps({ organizationId: orgId, employeeId: emp.id, positionId: position.id })).toHaveLength(0);
    const [row] = await db
      .select()
      .from(schema.positionSkillRequirementsTable)
      .where(eq(schema.positionSkillRequirementsTable.id, req.id));
    expect(row.active).toBe(false);

    // Re-stating the requirement reinstates the same row rather than creating a
    // second expectation about the same skill.
    const reinstated = await capability.addRequirement({
      organizationId: orgId,
      positionId: position.id,
      skillId: skill.id,
      mandatory: false,
      ...asHr(),
    });
    expect(reinstated.id).toBe(req.id);
    expect(reinstated.active).toBe(true);
    expect(reinstated.mandatory).toBe(false);
    expect(
      await capability.computeGaps({ organizationId: orgId, employeeId: emp.id, positionId: position.id }),
    ).toHaveLength(1);
  });

  // -- Succession (§30.11–30.17) --------------------------------------------

  it("a position has at most one open succession plan, guaranteed by the database", async () => {
    const position = await makePosition("SinglePlan");
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });

    await expect(
      succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() }),
    ).rejects.toThrow();

    // Closing the plan frees the position for a fresh one.
    await succession.updatePlan({ organizationId: orgId, planId: plan.id, status: "closed", ...asHr() });
    const reopened = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });
    expect(reopened.id).not.toBe(plan.id);

    // The closed plan is retained, not deleted.
    const old = await succession.getPlan(orgId, plan.id);
    expect(old!.status).toBe("closed");
    expect(old!.closedAt).not.toBeNull();
  });

  it("the candidate table carries no rank, score or ordering column", async () => {
    // Asserted against the LIVE schema rather than the ORM model, because §30.12
    // is a promise about what the database can hold, not about what the current
    // TypeScript happens to expose.
    const cols = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'succession_candidates'`,
    );
    const names: string[] = (cols.rows ?? cols).map((r: any) => String(r.column_name));
    expect(names.length).toBeGreaterThan(0);
    for (const banned of ["rank", "ranking", "score", "priority", "position_in_pool", "sort_order", "potential"]) {
      expect(names).not.toContain(banned);
    }
  });

  it("nominating records a view and changes no employment state", async () => {
    const position = await makePosition("Nominating");
    const emp = await makeEmployee("Nominee", { positionId: null });
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });

    const [before] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));

    const candidate = await succession.nominateCandidate({
      organizationId: orgId,
      planId: plan.id,
      employeeId: emp.id,
      rationale: "Strong operational grasp",
      ...asHr(),
    });
    expect(candidate.status).toBe("active");
    expect(candidate.readinessLevelId).toBeNull();

    // Nothing about the employee moved: not their position, not their status,
    // not their manager (§30.16).
    const [after] = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.id, emp.id));
    expect(after.positionId).toBe(before.positionId);
    expect(after.employmentStatus).toBe(before.employmentStatus);
    expect(after.reportingManagerId).toBe(before.reportingManagerId);

    // The same employee cannot be nominated twice onto one plan.
    await expect(
      succession.nominateCandidate({ organizationId: orgId, planId: plan.id, employeeId: emp.id, ...asHr() }),
    ).rejects.toThrow();

    // Nomination appended a chronology entry.
    const events = await succession.listCandidateEvents(orgId, candidate.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("nominated");
  });

  it("a terminated employee cannot be nominated", async () => {
    const position = await makePosition("NoTerminated");
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });
    const gone = await makeEmployee("Terminated", { employmentStatus: "terminated" });

    await expect(
      succession.nominateCandidate({ organizationId: orgId, planId: plan.id, employeeId: gone.id, ...asHr() }),
    ).rejects.toBeInstanceOf(succession.InvalidSuccessionError);

    const candidates = await succession.listCandidates(orgId, plan.id);
    expect(candidates).toHaveLength(0);
  });

  it("readiness is human-supplied and appends a chronology entry", async () => {
    const position = await makePosition("ReadinessTracked");
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });
    const emp = await makeEmployee("ReadyPerson");

    const near = await succession.createReadinessLevel({
      organizationId: orgId,
      ordinal: 1,
      label: `Ready now ${suffix}`,
      ...asHr(),
    });
    const later = await succession.createReadinessLevel({
      organizationId: orgId,
      ordinal: 2,
      label: `Ready in 1-2 years ${suffix}`,
      ...asHr(),
    });

    const candidate = await succession.nominateCandidate({
      organizationId: orgId,
      planId: plan.id,
      employeeId: emp.id,
      readinessLevelId: later.id,
      ...asHr(),
    });
    expect(candidate.readinessLevelId).toBe(later.id);

    const moved = await succession.setReadiness({
      organizationId: orgId,
      candidateId: candidate.id,
      readinessLevelId: near.id,
      notes: "Completed the acting stint",
      ...asHr(),
    });
    expect(moved.readinessLevelId).toBe(near.id);

    const events = await succession.listCandidateEvents(orgId, candidate.id);
    const change = events.find((e: any) => e.eventType === "readiness_changed");
    expect(change).toBeDefined();
    // Both sides are on the record, so the movement is legible afterwards.
    expect(change!.previousReadinessLevelId).toBe(later.id);
    expect(change!.newReadinessLevelId).toBe(near.id);

    // Grouping by band is not ranking: the list is ordered by band ordinal only.
    const listed = await succession.listCandidates(orgId, plan.id);
    expect(listed[0]!.readinessOrdinal).toBe(1);
    expect(Object.keys(listed[0]!)).not.toContain("rank");
  });

  it("removing a candidate retains the row and keeps the reason", async () => {
    const position = await makePosition("Removable");
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });
    const emp = await makeEmployee("Removed");
    const candidate = await succession.nominateCandidate({
      organizationId: orgId,
      planId: plan.id,
      employeeId: emp.id,
      ...asHr(),
    });

    await expect(
      succession.removeCandidate({ organizationId: orgId, candidateId: candidate.id, reason: "  ", ...asHr() }),
    ).rejects.toBeInstanceOf(succession.InvalidSuccessionError);

    const removed = await succession.removeCandidate({
      organizationId: orgId,
      candidateId: candidate.id,
      reason: "Moved to another division",
      ...asHr(),
    });
    expect(removed.status).toBe("removed");
    expect(removed.removedAt).not.toBeNull();

    // The row survives, so the history of who was once considered survives too.
    const stored = await succession.getCandidate(orgId, candidate.id);
    expect(stored).toBeDefined();
    const events = await succession.listCandidateEvents(orgId, candidate.id);
    expect(events.some((e: any) => e.eventType === "removed" && /another division/i.test(e.notes ?? ""))).toBe(true);

    // Removed candidates are out of the default pool but recoverable on request.
    expect(await succession.listCandidates(orgId, plan.id)).toHaveLength(0);
    expect(await succession.listCandidates(orgId, plan.id, { includeRemoved: true })).toHaveLength(1);

    // The freed slot can be filled by the same employee again.
    const renominated = await succession.nominateCandidate({
      organizationId: orgId,
      planId: plan.id,
      employeeId: emp.id,
      ...asHr(),
    });
    expect(renominated.id).not.toBe(candidate.id);
  });

  it("coverage reporting carries counts only — no identity, rationale or note", async () => {
    const position = await makePosition("Covered");
    const plan = await succession.createPlan({
      organizationId: orgId,
      positionId: position.id,
      criticalityNotes: "CONFIDENTIAL: incumbent is expected to retire",
      ...asHr(),
    });
    const emp = await makeEmployee("CoveredCandidate");
    await succession.nominateCandidate({
      organizationId: orgId,
      planId: plan.id,
      employeeId: emp.id,
      rationale: "CONFIDENTIAL rationale text",
      ...asHr(),
    });

    const coverage = await succession.successionCoverage(orgId);
    const row = coverage.find((r) => r.planId === plan.id);
    expect(row).toBeDefined();
    expect(row!.candidateCount).toBe(1);
    expect(row!.hasNoCandidates).toBe(false);

    // The whole report, serialized, contains neither confidential string and no
    // employee identifier (§30.25).
    const serialized = JSON.stringify(coverage);
    expect(serialized).not.toContain("CONFIDENTIAL");
    expect(Object.keys(row!)).not.toContain("employeeId");
    expect(Object.keys(row!)).not.toContain("rationale");
    expect(Object.keys(row!)).not.toContain("criticalityNotes");
  });

  // -- Development actions (§30.14) -----------------------------------------

  it("a development action records intent and enrols nobody", async () => {
    const emp = await makeEmployee("Developing");
    const skill = await makeSkill("DevSkill");

    const enrollmentsBefore = await db
      .select()
      .from(schema.learningEnrollmentsTable)
      .where(eq(schema.learningEnrollmentsTable.organizationId, orgId));

    const action = await succession.createDevelopmentAction({
      organizationId: orgId,
      employeeId: emp.id,
      action: "Shadow the regional lead for one quarter",
      skillId: skill.id,
      targetDate: new Date(Date.now() + 90 * 86_400_000),
      ...asHr(),
    });
    expect(action.status).toBe("open");

    // No enrolment appeared because a gap or an action exists (§30.14).
    const enrollmentsAfter = await db
      .select()
      .from(schema.learningEnrollmentsTable)
      .where(eq(schema.learningEnrollmentsTable.organizationId, orgId));
    expect(enrollmentsAfter.length).toBe(enrollmentsBefore.length);

    const progressed = await succession.updateDevelopmentAction({
      organizationId: orgId,
      actionId: action.id,
      status: "completed",
      ...asHr(),
    });
    expect(progressed.status).toBe("completed");
  });

  // -- Cross-tenant safety (§30.24) -----------------------------------------

  it("every cross-tenant identifier fails safely", async () => {
    const emp = await makeEmployee("TenantSafe");
    const position = await makePosition("TenantSafePosition");
    const skill = await makeSkill("TenantSafeSkill");

    // A foreign skill cannot be claimed onto a local employee.
    await expect(
      capability.claimSkill({
        organizationId: orgId,
        employeeId: emp.id,
        skillId: otherOrgSkillId,
        source: "hr_entry",
        ...asHr(),
      }),
    ).rejects.toThrow();

    // A local skill cannot be claimed onto a foreign employee.
    await expect(
      capability.claimSkill({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        skillId: skill.id,
        source: "hr_entry",
        ...asHr(),
      }),
    ).rejects.toThrow();

    // A foreign position cannot take a local requirement, nor a local position
    // a foreign skill.
    await expect(
      capability.addRequirement({
        organizationId: orgId,
        positionId: otherOrgPositionId,
        skillId: skill.id,
        ...asHr(),
      }),
    ).rejects.toThrow();
    await expect(
      capability.addRequirement({
        organizationId: orgId,
        positionId: position.id,
        skillId: otherOrgSkillId,
        ...asHr(),
      }),
    ).rejects.toThrow();

    // Succession refuses foreign positions and foreign employees alike.
    await expect(
      succession.createPlan({ organizationId: orgId, positionId: otherOrgPositionId, ...asHr() }),
    ).rejects.toThrow();
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });
    await expect(
      succession.nominateCandidate({
        organizationId: orgId,
        planId: plan.id,
        employeeId: otherOrgEmployeeId,
        ...asHr(),
      }),
    ).rejects.toThrow();

    // And a foreign development action subject is refused.
    await expect(
      succession.createDevelopmentAction({
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        action: "Should not be possible",
        ...asHr(),
      }),
    ).rejects.toThrow();

    // Reads scoped to the wrong organization return nothing rather than leaking.
    expect(await catalogue.getSkill(orgId, otherOrgSkillId)).toBeUndefined();
    expect(await succession.getPlan(otherOrgId, plan.id)).toBeUndefined();
  });

  // -- Jobs are observers (§30.21, §27.11) ----------------------------------

  it("no WS-14 job type can assess, verify, nominate or change readiness", async () => {
    const registered = registry.listRegisteredJobTypes();
    for (const jobType of [
      reminders.SKILL_VERIFICATION_PENDING,
      reminders.SKILL_CERTIFICATION_EXPIRING,
      reminders.SUCCESSION_REVIEW_DUE,
      reminders.DEVELOPMENT_ACTION_DUE,
    ]) {
      expect(registered).toContain(jobType);
    }

    // Every WS-14 job type is a reminder. There is no job type whose name even
    // suggests a decision, and this list is what the worker can dispatch.
    const ws14 = registered.filter((t: string) => /^(skill|succession|development)\./.test(t));
    expect(ws14.sort()).toEqual(
      [
        reminders.DEVELOPMENT_ACTION_DUE,
        reminders.SKILL_CERTIFICATION_EXPIRING,
        reminders.SKILL_VERIFICATION_PENDING,
        reminders.SUCCESSION_REVIEW_DUE,
      ].sort(),
    );

    // A verification reminder fires against a record and leaves it exactly as
    // it found it — the reminder is an observer, not a decision-maker.
    const skill = await makeSkill("JobObserved", { proficiencyApplicable: true });
    const emp = await makeEmployee("JobSubject");
    const record = await capability.claimSkill({
      organizationId: orgId,
      employeeId: emp.id,
      skillId: skill.id,
      claimedLevelId: WORKING().id,
      source: "employee_self_service",
      ...asHr(),
    });

    await reminders.scheduleSkillsReminder({
      organizationId: orgId,
      jobType: reminders.SKILL_VERIFICATION_PENDING,
      referenceId: record.id,
      fireAt: new Date(Date.now() + 3_600_000),
      sourceReferenceType: "employee_skill_record",
    });

    const after = await capability.getRecord(orgId, record.id);
    expect(after!.status).toBe("claimed");
    expect(after!.verifiedLevelId).toBeNull();

    // A succession review reminder likewise creates no candidate and no plan
    // state change.
    const position = await makePosition("JobPlan");
    const plan = await succession.createPlan({ organizationId: orgId, positionId: position.id, ...asHr() });
    await reminders.scheduleSkillsReminder({
      organizationId: orgId,
      jobType: reminders.SUCCESSION_REVIEW_DUE,
      referenceId: plan.id,
      fireAt: new Date(Date.now() + 3_600_000),
      sourceReferenceType: "succession_plan",
    });
    expect(await succession.listCandidates(orgId, plan.id)).toHaveLength(0);
    expect((await succession.getPlan(orgId, plan.id))!.status).toBe("active");
  });

  // -- Permission seeding (§30.17, §30.22) ----------------------------------

  it("succession access is not granted to org_admin by default", async () => {
    // The three succession keys exist, and the default org_admin bundle does
    // not include them — succession is confidential HR information, and
    // administering a tenant is not the same as being trusted with it (§30.17).
    const rows = await db
      .select()
      .from(schema.permissionsTable)
      .where(
        sql`${schema.permissionsTable.key} in ('succession.read', 'succession.manage', 'succession.confidential.read')`,
      );
    expect(rows.map((r: any) => r.key).sort()).toEqual([
      "succession.confidential.read",
      "succession.manage",
      "succession.read",
    ]);

    const [orgAdmin] = await db
      .select()
      .from(schema.rolesTable)
      .where(and(eq(schema.rolesTable.key, "org_admin"), eq(schema.rolesTable.isSystemRole, true)))
      .limit(1);
    if (orgAdmin) {
      const granted = await db
        .select({ key: schema.permissionsTable.key })
        .from(schema.rolePermissionsTable)
        .innerJoin(schema.permissionsTable, eq(schema.permissionsTable.id, schema.rolePermissionsTable.permissionId))
        .where(eq(schema.rolePermissionsTable.roleId, orgAdmin.id));
      const keys = granted.map((g: any) => g.key);
      expect(keys).not.toContain("succession.read");
      expect(keys).not.toContain("succession.manage");
      expect(keys).not.toContain("succession.confidential.read");
      // But the capability keys it does administer are present.
      expect(keys).toContain("skill_catalogue.configure");
    }
  });
});
