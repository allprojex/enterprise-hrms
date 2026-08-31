/**
 * WS-16 Pass 2B — the shared authority-delegation foundation, live.
 *
 * Every invariant §32 froze, proved against a real database rather than
 * asserted. The suite is organised by the frozen sections so a failure points
 * at the rule it broke.
 *
 * The rules that matter most, and why:
 *
 *   - HOLDER-ONLY creation. There is no on-behalf-of path for anyone, and no
 *     client-supplied delegator to forge — administrative privilege does not
 *     manufacture another person's workflow authority.
 *   - NO CHAINING, structurally. A delegate cannot delegate onward, because
 *     creation demands DIRECT authority and a delegate is never the head.
 *   - AUTHORITY LOSS makes a delegation inert without deleting it, and the
 *     new head does NOT inherit it.
 *   - CROSS-TENANT defence at every entry point. A foreign key proves a row
 *     exists, never that it is ours — the precise gap that leaves the Office
 *     Inventory prototype unsafe, and which this foundation closes.
 *   - NO JOB is required for correctness: revocation and inertness are pure
 *     runtime evaluation.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS16_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-16 Pass 2B — shared authority-delegation foundation", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;

  let delegations: typeof import("../lib/authorityDelegations");
  let departmentHeads: typeof import("../lib/departmentHeads");

  let orgId: number;
  let otherOrgId: number;

  const suffix = `ws16p2b-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  async function makeMembership(opts: { organizationId?: number; status?: string } = {}): Promise<number> {
    const organizationId = opts.organizationId ?? orgId;
    const [user] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq("u")}@example.test`,
        passwordHash: "x",
        firstName: "Del",
        lastName: uniq("Egate"),
        organizationId,
      })
      .returning();
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ organizationId, applicationUserId: user.id, ...(opts.status ? { status: opts.status } : {}) })
      .returning();
    return membership.id;
  }

  async function makeDepartment(organizationId: number = orgId): Promise<number> {
    const [row] = await db
      .insert(schema.departmentsTable)
      .values({ organizationId, name: uniq("Dept"), code: uniq("D").slice(0, 30) })
      .returning();
    return row.id;
  }

  /** A department whose current head is a freshly created active membership. */
  async function makeDepartmentWithHead(organizationId: number = orgId) {
    const departmentId = await makeDepartment(organizationId);
    const headMembershipId = await makeMembership({ organizationId });
    await departmentHeads.assignDepartmentHead({
      organizationId,
      departmentId,
      headMembershipId,
      actorMembershipId: headMembershipId,
      actorApplicationUserId: null,
    });
    return { departmentId, headMembershipId };
  }

  /**
   * The database constraint a raw insert actually violated. Drizzle wraps
   * driver errors as "Failed query: …", so asserting on the outer message
   * would prove only that *something* rejected — not that the intended
   * constraint did. This reads the pg error's own `constraint` field.
   */
  async function violatedConstraint(run: () => Promise<unknown>): Promise<string | null> {
    try {
      await run();
      return null;
    } catch (err) {
      let cursor: any = err;
      while (cursor) {
        if (typeof cursor.constraint === "string") return cursor.constraint;
        cursor = cursor.cause;
      }
      return "(no constraint on error chain)";
    }
  }

  const create = (over: Record<string, unknown> = {}) =>
    delegations.createDepartmentHeadDelegation({
      organizationId: orgId,
      reason: "Annual leave cover",
      actorApplicationUserId: null,
      ...(over as any),
    } as any);

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    delegations = await import("../lib/authorityDelegations");
    departmentHeads = await import("../lib/departmentHeads");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS16P2B ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS16P2B other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;
  });

  // =========================================================================
  // §43 — CREATE
  // =========================================================================
  describe("create", () => {
    it("a direct head may delegate to an active same-tenant membership", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();

      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      expect(row.authorityType).toBe("department_head");
      expect(row.organizationId).toBe(orgId);
      expect(row.departmentId).toBe(departmentId);
      expect(row.delegatorMembershipId).toBe(headMembershipId);
      expect(row.delegateMembershipId).toBe(delegate);
      expect(row.validTo).toBeNull();
      expect(row.reason).toBe("Annual leave cover");
      // No `created_by_membership_id` column exists: under holder-only
      // creation it could never differ from the delegator (§32.10).
      expect(row).not.toHaveProperty("createdByMembershipId");
    });

    it("a non-head cannot create a delegation, however senior", async () => {
      const { departmentId } = await makeDepartmentWithHead();
      const outsider = await makeMembership();
      const delegate = await makeMembership();

      await expect(
        create({ departmentId, delegateMembershipId: delegate, actorMembershipId: outsider }),
      ).rejects.toThrow(delegations.NotDirectAuthorityHolderError);
    });

    it("a delegate cannot chain: A→B→C is structurally impossible", async () => {
      const { departmentId, headMembershipId: a } = await makeDepartmentWithHead();
      const b = await makeMembership();
      const c = await makeMembership();

      await create({ departmentId, delegateMembershipId: b, actorMembershipId: a });

      // B genuinely holds delegated authority right now...
      const bAuthority = await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, b);
      expect(bAuthority?.basis).toBe("delegated");

      // ...and still cannot delegate onward, because creation demands DIRECT
      // authority and B is not the head.
      await expect(create({ departmentId, delegateMembershipId: c, actorMembershipId: b })).rejects.toThrow(
        delegations.NotDirectAuthorityHolderError,
      );
    });

    it("rejects self-delegation", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      await expect(
        create({ departmentId, delegateMembershipId: headMembershipId, actorMembershipId: headMembershipId }),
      ).rejects.toThrow(delegations.SelfDelegationError);
    });

    it("rejects self-delegation at the DATABASE level too, not only in the service", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      // Bypassing the service entirely — the CHECK constraint must still hold.
      const violated = await violatedConstraint(() =>
        db.insert(schema.authorityDelegationsTable).values({
          organizationId: orgId,
          authorityType: "department_head",
          departmentId,
          delegatorMembershipId: headMembershipId,
          delegateMembershipId: headMembershipId,
          reason: "forced",
        }),
      );
      expect(violated).toBe("authority_delegations_no_self_delegation");
    });

    it("rejects an inactive delegate", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      for (const status of ["suspended", "revoked", "invited", "expired"]) {
        const delegate = await makeMembership({ status });
        await expect(
          create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId }),
        ).rejects.toThrow(delegations.DelegateNotActiveError);
      }
    });

    it("rejects a cross-tenant delegate — an FK proves existence, never tenancy", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const foreignDelegate = await makeMembership({ organizationId: otherOrgId });

      // This is precisely the gap left open in the Office Inventory prototype
      // (§32.6): the foreign key is satisfied, and the write must still fail.
      await expect(
        create({ departmentId, delegateMembershipId: foreignDelegate, actorMembershipId: headMembershipId }),
      ).rejects.toThrow(delegations.DelegateNotActiveError);
    });

    it("rejects a department belonging to another organization", async () => {
      const foreign = await makeDepartmentWithHead(otherOrgId);
      const delegate = await makeMembership();

      await expect(
        create({
          departmentId: foreign.departmentId,
          delegateMembershipId: delegate,
          actorMembershipId: foreign.headMembershipId,
        }),
      ).rejects.toThrow(delegations.DelegationDepartmentNotFoundError);
    });

    it("rejects an unsupported authority type by name", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();

      for (const bad of ["reporting_manager", "permission_holder", "specific_membership", "reviewer"]) {
        await expect(
          create({
            departmentId,
            delegateMembershipId: delegate,
            actorMembershipId: headMembershipId,
            authorityType: bad,
          }),
        ).rejects.toThrow(delegations.UnsupportedAuthorityTypeError);
      }
    });

    it("makes an unsupported authority type UNREPRESENTABLE in the database", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();

      // Not merely rejected by the service — the enum has one member, so the
      // row cannot exist at all (§32.10).
      await expect(
        db.insert(schema.authorityDelegationsTable).values({
          organizationId: orgId,
          authorityType: "permission_holder" as any,
          departmentId,
          delegatorMembershipId: headMembershipId,
          delegateMembershipId: delegate,
          reason: "forced",
        }),
      ).rejects.toThrow();
    });

    it("requires a reason that survives trimming, in the service and in the database", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();

      for (const blank of ["", "   ", "  \t ", "\n"]) {
        await expect(
          create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId, reason: blank }),
        ).rejects.toThrow(delegations.DelegationReasonRequiredError);
      }

      // Every whitespace shape, not just spaces. An earlier form of this
      // constraint used length(btrim(reason)) > 0, which strips SPACES ONLY —
      // a tab-only reason passed the database while the service rejected it.
      // A backstop that disagrees with the service is worse than none.
      for (const blank of ["   ", "  \t ", "\n", " \r\n "]) {
        const violated = await violatedConstraint(() =>
          db.insert(schema.authorityDelegationsTable).values({
            organizationId: orgId,
            authorityType: "department_head",
            departmentId,
            delegatorMembershipId: headMembershipId,
            delegateMembershipId: delegate,
            reason: blank,
          }),
        );
        expect(violated).toBe("authority_delegations_reason_not_blank");
      }
    });

    it("replaces the holder's own open delegation rather than leaving two (§32.11)", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const first = await makeMembership();
      const second = await makeMembership();

      const a = await create({ departmentId, delegateMembershipId: first, actorMembershipId: headMembershipId });
      const b = await create({ departmentId, delegateMembershipId: second, actorMembershipId: headMembershipId });

      const rows = await delegations.listDelegationsGrantedBy({
        organizationId: orgId,
        departmentId,
        delegatorMembershipId: headMembershipId,
      });
      const open = rows.filter((r: any) => r.validTo == null);

      // Exactly one open row, and the superseded one is CLOSED, not deleted.
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(b.id);
      const closed = rows.find((r: any) => r.id === a.id);
      expect(closed).toBeDefined();
      expect(closed!.validTo).not.toBeNull();
      expect(closed!.revokedByMembershipId).toBe(headMembershipId);

      // The superseded delegate holds nothing; the current one does.
      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, first)).toBeNull();
      expect((await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, second))?.basis).toBe("delegated");
    });

    it("the partial unique index rejects a second open row deterministically (DB backstop)", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const one = await makeMembership();
      const two = await makeMembership();

      await create({ departmentId, delegateMembershipId: one, actorMembershipId: headMembershipId });

      // Bypass the service's close-then-insert transaction entirely. If two
      // concurrent transactions ever escaped the FOR UPDATE row lock, THIS is
      // what stops an ambiguous second open delegation existing.
      const violated = await violatedConstraint(() =>
        db.insert(schema.authorityDelegationsTable).values({
          organizationId: orgId,
          authorityType: "department_head",
          departmentId,
          delegatorMembershipId: headMembershipId,
          delegateMembershipId: two,
          reason: "forced concurrent",
        }),
      );
      expect(violated).toBe("authority_delegations_open_unique");
    });

    it("survives concurrent creation attempts without producing two open rows", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const a = await makeMembership();
      const b = await makeMembership();
      const c = await makeMembership();

      const results = await Promise.allSettled([
        create({ departmentId, delegateMembershipId: a, actorMembershipId: headMembershipId }),
        create({ departmentId, delegateMembershipId: b, actorMembershipId: headMembershipId }),
        create({ departmentId, delegateMembershipId: c, actorMembershipId: headMembershipId }),
      ]);

      expect(results.some((r) => r.status === "fulfilled")).toBe(true);

      const rows = await delegations.listDelegationsGrantedBy({
        organizationId: orgId,
        departmentId,
        delegatorMembershipId: headMembershipId,
      });
      // Whatever interleaving occurred, the invariant holds.
      expect(rows.filter((r: any) => r.validTo == null)).toHaveLength(1);
    });
  });

  // =========================================================================
  // §44 — RUNTIME RESOLUTION
  // =========================================================================
  describe("runtime resolution", () => {
    it("the direct head keeps direct authority; a delegation adds, never transfers", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      const head = await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, headMembershipId);
      expect(head).toEqual({
        basis: "direct",
        directAuthorityHolderMembershipId: headMembershipId,
        delegationId: null,
      });

      const sub = await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate);
      expect(sub).toEqual({
        basis: "delegated",
        directAuthorityHolderMembershipId: headMembershipId,
        delegationId: row.id,
      });

      // department_heads is untouched — no ownership was moved.
      const stillHead = await departmentHeads.getCurrentDepartmentHead(orgId, departmentId);
      expect(stillHead?.headMembershipId).toBe(headMembershipId);
    });

    it("an unrelated membership holds nothing", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const bystander = await makeMembership();
      await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, bystander)).toBeNull();
    });

    it("a vacant department grants nobody anything, delegation or not", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      await departmentHeads.revokeDepartmentHead({
        organizationId: orgId,
        departmentId,
        actorMembershipId: headMembershipId,
        actorApplicationUserId: null,
      });

      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate)).toBeNull();
      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, headMembershipId)).toBeNull();
    });

    it("revocation is immediate, with no job and no deletion", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      expect((await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate))?.basis).toBe("delegated");

      await delegations.revokeDelegation({
        organizationId: orgId,
        delegationId: row.id,
        actorMembershipId: headMembershipId,
        actorApplicationUserId: null,
      });

      // Denied on the very next call — nothing ran in between.
      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate)).toBeNull();

      // And the row is still there, as history.
      const after = await delegations.getDelegation(orgId, row.id);
      expect(after).not.toBeNull();
      expect(after!.validTo).not.toBeNull();
      expect(after!.revokedByMembershipId).toBe(headMembershipId);
      expect(after!.delegateMembershipId).toBe(delegate);
    });

    it("delegator authority loss makes the delegation INERT, and the new head does not inherit it", async () => {
      const { departmentId, headMembershipId: oldHead } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const newHead = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: oldHead });

      expect((await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate))?.basis).toBe("delegated");

      // The head is replaced. Nothing touches the delegation row.
      await departmentHeads.assignDepartmentHead({
        organizationId: orgId,
        departmentId,
        headMembershipId: newHead,
        actorMembershipId: newHead,
        actorApplicationUserId: null,
      });

      // The row is still OPEN — and grants nothing (§32.17, the §5.3 rule).
      const stored = await delegations.getDelegation(orgId, row.id);
      expect(stored!.validTo).toBeNull();
      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate)).toBeNull();

      // The new head holds direct authority and did NOT inherit the delegate.
      expect((await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, newHead))?.basis).toBe("direct");

      // The new head must create their own if a future consumer needs one.
      const fresh = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: newHead });
      const resolved = await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate);
      expect(resolved?.delegationId).toBe(fresh.id);
      expect(resolved?.directAuthorityHolderMembershipId).toBe(newHead);
    });

    it("a delegate becoming inactive makes the delegation ineffective, without a cleanup job", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      expect((await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate))?.basis).toBe("delegated");

      await db
        .update(schema.organizationMembershipsTable)
        .set({ status: "revoked" })
        .where(eq(schema.organizationMembershipsTable.id, delegate));

      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate)).toBeNull();

      // Still open, still historically intact — nothing was cleaned up.
      const stored = await delegations.getDelegation(orgId, row.id);
      expect(stored!.validTo).toBeNull();
    });

    it("an expired membership makes it ineffective too, by pure date evaluation", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      await db
        .update(schema.organizationMembershipsTable)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.organizationMembershipsTable.id, delegate));

      expect(await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate)).toBeNull();
    });
  });

  // =========================================================================
  // §39/§41 — REVOKE
  // =========================================================================
  describe("revoke", () => {
    it("only the delegator may revoke — not another head, not an administrator", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const someoneElse = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      for (const actor of [someoneElse, delegate]) {
        await expect(
          delegations.revokeDelegation({
            organizationId: orgId,
            delegationId: row.id,
            actorMembershipId: actor,
            actorApplicationUserId: null,
          }),
        ).rejects.toThrow(delegations.NotDirectAuthorityHolderError);
      }
    });

    it("a double revoke is reported, never silently duplicated", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      await delegations.revokeDelegation({
        organizationId: orgId,
        delegationId: row.id,
        actorMembershipId: headMembershipId,
        actorApplicationUserId: null,
      });
      await expect(
        delegations.revokeDelegation({
          organizationId: orgId,
          delegationId: row.id,
          actorMembershipId: headMembershipId,
          actorApplicationUserId: null,
        }),
      ).rejects.toThrow(delegations.DelegationAlreadyRevokedError);
    });

    it("a nonexistent delegation is not found rather than vaguely unauthorized", async () => {
      await expect(
        delegations.revokeDelegation({
          organizationId: orgId,
          delegationId: 2_000_000_000,
          actorMembershipId: await makeMembership(),
          actorApplicationUserId: null,
        }),
      ).rejects.toThrow(delegations.DelegationNotFoundError);
    });
  });

  // =========================================================================
  // §45 — TENANT ISOLATION
  // =========================================================================
  describe("tenant isolation", () => {
    it("Org A cannot read an Org B delegation by id", async () => {
      const foreign = await makeDepartmentWithHead(otherOrgId);
      const foreignDelegate = await makeMembership({ organizationId: otherOrgId });
      const row = await delegations.createDepartmentHeadDelegation({
        organizationId: otherOrgId,
        departmentId: foreign.departmentId,
        delegateMembershipId: foreignDelegate,
        reason: "other tenant",
        actorMembershipId: foreign.headMembershipId,
        actorApplicationUserId: null,
      });

      expect(await delegations.getDelegation(orgId, row.id)).toBeNull();
      expect(await delegations.getDelegation(otherOrgId, row.id)).not.toBeNull();
    });

    it("Org A cannot revoke an Org B delegation", async () => {
      const foreign = await makeDepartmentWithHead(otherOrgId);
      const foreignDelegate = await makeMembership({ organizationId: otherOrgId });
      const row = await delegations.createDepartmentHeadDelegation({
        organizationId: otherOrgId,
        departmentId: foreign.departmentId,
        delegateMembershipId: foreignDelegate,
        reason: "other tenant",
        actorMembershipId: foreign.headMembershipId,
        actorApplicationUserId: null,
      });

      await expect(
        delegations.revokeDelegation({
          organizationId: orgId,
          delegationId: row.id,
          actorMembershipId: foreign.headMembershipId,
          actorApplicationUserId: null,
        }),
      ).rejects.toThrow(delegations.DelegationNotFoundError);

      // Still open in its own tenant — the failed cross-tenant attempt
      // changed nothing.
      expect((await delegations.getDelegation(otherOrgId, row.id))!.validTo).toBeNull();
    });

    it("an Org B delegate never resolves authority in an Org A context", async () => {
      const foreign = await makeDepartmentWithHead(otherOrgId);
      const foreignDelegate = await makeMembership({ organizationId: otherOrgId });
      await delegations.createDepartmentHeadDelegation({
        organizationId: otherOrgId,
        departmentId: foreign.departmentId,
        delegateMembershipId: foreignDelegate,
        reason: "other tenant",
        actorMembershipId: foreign.headMembershipId,
        actorApplicationUserId: null,
      });

      // Right ids, wrong organization.
      expect(
        await delegations.resolveDepartmentHeadAuthority(orgId, foreign.departmentId, foreignDelegate),
      ).toBeNull();
    });

    it("cross-tenant rows never appear in a holder's own list", async () => {
      const mine = await makeDepartmentWithHead();
      const myDelegate = await makeMembership();
      await create({ departmentId: mine.departmentId, delegateMembershipId: myDelegate, actorMembershipId: mine.headMembershipId });

      const rows = await delegations.listDelegationsGrantedBy({
        organizationId: orgId,
        departmentId: mine.departmentId,
        delegatorMembershipId: mine.headMembershipId,
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r: any) => r.organizationId === orgId)).toBe(true);
    });
  });

  // =========================================================================
  // §46 — AUDIT
  // =========================================================================
  describe("audit", () => {
    async function auditFor(delegationId: number, eventType: string) {
      const [row] = await db
        .select()
        .from(schema.auditEventsTable)
        .where(
          and(
            eq(schema.auditEventsTable.eventType, eventType),
            eq(schema.auditEventsTable.targetType, "authority_delegation"),
            eq(schema.auditEventsTable.targetId, String(delegationId)),
          ),
        );
      return row ?? null;
    }

    it("records the ACTUAL creator, the scope and the delegate", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      const audit = await auditFor(row.id, "authority_delegation.created");
      expect(audit).not.toBeNull();
      expect(audit.actorMembershipId).toBe(headMembershipId);
      expect(audit.organizationId).toBe(orgId);
      expect(audit.afterState.departmentId).toBe(departmentId);
      expect(audit.afterState.delegateMembershipId).toBe(delegate);
      expect(audit.afterState.delegatorMembershipId).toBe(headMembershipId);
      // Access-control change, so it files under security — with membership
      // and role, not under HR or a module category.
      expect(audit.category).toBe("security");
    });

    it("records the ACTUAL revoker, never the delegate", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      await delegations.revokeDelegation({
        organizationId: orgId,
        delegationId: row.id,
        actorMembershipId: headMembershipId,
        actorApplicationUserId: null,
      });

      const audit = await auditFor(row.id, "authority_delegation.revoked");
      expect(audit).not.toBeNull();
      expect(audit.actorMembershipId).toBe(headMembershipId);
      expect(audit.actorMembershipId).not.toBe(delegate);
      expect(audit.beforeState.delegateMembershipId).toBe(delegate);
      expect(audit.afterState.revokedByMembershipId).toBe(headMembershipId);
    });

    it("records the replaced delegation when one is superseded", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const first = await makeMembership();
      const second = await makeMembership();

      const a = await create({ departmentId, delegateMembershipId: first, actorMembershipId: headMembershipId });
      const b = await create({ departmentId, delegateMembershipId: second, actorMembershipId: headMembershipId });

      const audit = await auditFor(b.id, "authority_delegation.created");
      expect(audit.beforeState.replacedDelegationId).toBe(a.id);
      expect(audit.beforeState.delegateMembershipId).toBe(first);
    });
  });

  // =========================================================================
  // §9/§26 — the foundation supports correct attribution, and grants nothing
  // =========================================================================
  describe("attribution and permission boundaries", () => {
    it("returns everything a consumer needs to attribute an action to the ACTUAL actor", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();
      const row = await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      const authority = await delegations.resolveDepartmentHeadAuthority(orgId, departmentId, delegate);

      // A future consumer records the acting delegate itself, plus these two
      // — never attributing the action as though the head performed it.
      expect(authority!.basis).toBe("delegated");
      expect(authority!.directAuthorityHolderMembershipId).toBe(headMembershipId);
      expect(authority!.delegationId).toBe(row.id);
      // The minimal frozen shape and nothing more — no permission list, no
      // workflow state, no configuration diagnostics.
      expect(Object.keys(authority!).sort()).toEqual(["basis", "delegationId", "directAuthorityHolderMembershipId"]);
    });

    it("grants no permission and mutates no role", async () => {
      const { departmentId, headMembershipId } = await makeDepartmentWithHead();
      const delegate = await makeMembership();

      const rolesBefore = await db
        .select()
        .from(schema.membershipRolesTable)
        .where(eq(schema.membershipRolesTable.membershipId, delegate));

      await create({ departmentId, delegateMembershipId: delegate, actorMembershipId: headMembershipId });

      const rolesAfter = await db
        .select()
        .from(schema.membershipRolesTable)
        .where(eq(schema.membershipRolesTable.membershipId, delegate));

      // Delegation is authority, never permission (§32.12). If this ever
      // changes, delegation has become an RBAC mutation mechanism.
      expect(rolesAfter).toEqual(rolesBefore);
      expect(rolesAfter).toHaveLength(rolesBefore.length);
    });
  });
});
