/**
 * P1a — notification organization isolation, live against real Postgres and
 * through the real app.
 *
 * Proves, for a person who belongs to TWO organizations:
 *   - every notification route acts in the active organization only, pinned
 *     to the tenant host (list, unread count, read, read-all, dismiss);
 *   - a caller-supplied organizationId is an assertion, never a switch;
 *   - the list is newest first and keyset-paged deterministically, even
 *     across identical timestamps, and a foreign cursor yields nothing;
 *   - the unread count and the list share one visibility rule;
 *   - recipient resolution ignores expired memberships and never follows an
 *     employee link into another organization's membership.
 *
 * Opt-in (NOTIFICATIONS_LIVE_DATABASE_URL, a disposable LOCAL database —
 * liveDbGuard refuses anything else). Run this file alone.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("NOTIFICATIONS_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("P1a notification isolation (live)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let inArray: any;
  let app: any;
  let notifications: typeof import("../lib/notifications");

  const suffix = `p1a-${Date.now().toString(36)}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  let orgA: number;
  let orgB: number;
  let hostA: string;
  let hostB: string;
  const orgIds: number[] = [];

  /** One person with live memberships in both A and B. */
  let dual: { userId: number; membershipA: number; membershipB: number };
  let other: { userId: number };

  async function makeOrg(): Promise<number> {
    const [org] = await db.insert(schema.organizationsTable).values({ name: uniq("Org"), slug: uniq("org") }).returning();
    orgIds.push(org.id);
    return org.id;
  }

  async function makeUser(homeOrganizationId: number): Promise<number> {
    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${uniq("u")}@example.test`, passwordHash: "x", firstName: "Notif", lastName: uniq("P"), organizationId: homeOrganizationId })
      .returning();
    return user.id;
  }

  async function makeMembership(userId: number, organizationId: number, extra: Record<string, unknown> = {}): Promise<number> {
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId, status: "active", ...extra })
      .returning();
    return m.id;
  }

  async function session(userId: number, activeOrganizationId: number | null): Promise<string> {
    const token = `p1a-${randomUUID()}`;
    await db.insert(schema.sessionsTable).values({ token, userId, activeOrganizationId, expiresAt: new Date(Date.now() + 3_600_000) });
    return token;
  }

  /** Inserts a notification directly, with an explicit createdAt so ordering is under the test's control. */
  async function insertNotification(userId: number, organizationId: number | null, title: string, extra: Record<string, unknown> = {}) {
    const [row] = await db
      .insert(schema.notificationsTable)
      .values({ userId, organizationId, title, message: "x", ...extra })
      .returning();
    return row;
  }

  const call = (method: "get" | "patch" | "post", path: string, token: string, host?: string) => {
    const r = (request(app) as any)[method](path).set("Authorization", `Bearer ${token}`);
    return host ? r.set("Host", host) : r;
  };

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    inArray = drizzle.inArray;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    notifications = await import("../lib/notifications");
    app = (await import("../app")).default;

    orgA = await makeOrg();
    orgB = await makeOrg();
    hostA = `${uniq("a")}.notif.test`;
    hostB = `${uniq("b")}.notif.test`;
    await db.insert(schema.organizationDomainsTable).values([
      { organizationId: orgA, hostname: hostA, domainType: "custom_domain", status: "active", isPrimary: true },
      { organizationId: orgB, hostname: hostB, domainType: "custom_domain", status: "active", isPrimary: true },
    ]);

    const dualUser = await makeUser(orgA);
    dual = { userId: dualUser, membershipA: await makeMembership(dualUser, orgA), membershipB: await makeMembership(dualUser, orgB) };
    const otherUser = await makeUser(orgA);
    await makeMembership(otherUser, orgA);
    other = { userId: otherUser };
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.notificationsTable).where(inArray(schema.notificationsTable.organizationId, orgIds)).catch(() => undefined);
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  describe("HTTP routes act in the active organization only", () => {
    let inA: any;
    let inB: any;
    let othersInA: any;

    beforeAll(async () => {
      inA = await insertNotification(dual.userId, orgA, "only-in-A");
      inB = await insertNotification(dual.userId, orgB, "only-in-B");
      othersInA = await insertNotification(other.userId, orgA, "someone-else");
      // Org-less rows exist nowhere today; prove one could never surface on a tenant host.
      await insertNotification(dual.userId, null, "org-less");
    });

    it("lists only the active organization's notifications, on its own host", async () => {
      const token = await session(dual.userId, orgA);
      const res = await call("get", "/api/notifications", token, hostA);
      expect(res.status).toBe(200);
      const titles = res.body.map((n: any) => n.title);
      expect(titles).toContain("only-in-A");
      expect(titles).not.toContain("only-in-B");
      expect(titles).not.toContain("someone-else");
      expect(titles).not.toContain("org-less");
      expect(res.body.every((n: any) => n.organizationId === orgA)).toBe(true);
    });

    it("refuses a host pinned to a different organization than the active one", async () => {
      const token = await session(dual.userId, orgA);
      for (const path of ["/api/notifications", "/api/notifications/unread-count"]) {
        expect((await call("get", path, token, hostB)).status).toBe(403);
      }
      expect((await call("post", "/api/notifications/read-all", token, hostB)).status).toBe(403);
      expect((await call("patch", `/api/notifications/${inA.id}/read`, token, hostB)).status).toBe(403);
      expect((await call("patch", `/api/notifications/${inB.id}/dismiss`, token, hostB)).status).toBe(403);
    });

    it("treats ?organizationId as an assertion: another organization is 403, never a switch", async () => {
      const token = await session(dual.userId, orgA);
      expect((await call("get", `/api/notifications?organizationId=${orgB}`, token, hostA)).status).toBe(403);
      // Also refused off any tenant host, where nothing else would stop it.
      expect((await call("get", `/api/notifications?organizationId=${orgB}`, token)).status).toBe(403);
      const same = await call("get", `/api/notifications?organizationId=${orgA}`, token, hostA);
      expect(same.status).toBe(200);
      expect(same.body.map((n: any) => n.title)).toContain("only-in-A");
    });

    it("counts unread in the active organization only", async () => {
      const tokenA = await session(dual.userId, orgA);
      const tokenB = await session(dual.userId, orgB);
      const a = await call("get", "/api/notifications/unread-count", tokenA, hostA);
      const b = await call("get", "/api/notifications/unread-count", tokenB, hostB);
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ unreadCount: await notifications.countUnreadNotifications(dual.userId, orgA) });
      expect(b.body).toEqual({ unreadCount: await notifications.countUnreadNotifications(dual.userId, orgB) });
      expect(a.body.unreadCount).toBeGreaterThanOrEqual(1);
      expect(b.body.unreadCount).toBeGreaterThanOrEqual(1);
    });

    it("cannot mark read or dismiss the caller's own notification from another organization, or someone else's", async () => {
      const token = await session(dual.userId, orgA);
      expect((await call("patch", `/api/notifications/${inB.id}/read`, token, hostA)).status).toBe(404);
      expect((await call("patch", `/api/notifications/${inB.id}/dismiss`, token, hostA)).status).toBe(404);
      expect((await call("patch", `/api/notifications/${othersInA.id}/read`, token, hostA)).status).toBe(404);
      expect((await call("patch", `/api/notifications/${othersInA.id}/dismiss`, token, hostA)).status).toBe(404);

      const [b] = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.id, inB.id));
      const [o] = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.id, othersInA.id));
      expect(b.read).toBe(false);
      expect(b.dismissedAt).toBeNull();
      expect(o.read).toBe(false);
      expect(o.dismissedAt).toBeNull();

      const own = await call("patch", `/api/notifications/${inA.id}/read`, token, hostA);
      expect(own.status).toBe(200);
      expect(own.body.read).toBe(true);
    });

    it("read-all marks the active organization only", async () => {
      const unreadInB = await insertNotification(dual.userId, orgB, "B-stays-unread");
      await insertNotification(dual.userId, orgA, "A-gets-read");
      const token = await session(dual.userId, orgA);
      expect((await call("post", "/api/notifications/read-all", token, hostA)).status).toBe(200);

      expect(await notifications.countUnreadNotifications(dual.userId, orgA)).toBe(0);
      const [b] = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.id, unreadInB.id));
      expect(b.read).toBe(false);
      const [o] = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.id, othersInA.id));
      expect(o.read).toBe(false);
    });

    it("a caller with no live membership gets an empty list and a zero count, and can change nothing", async () => {
      const loner = await makeUser(orgA);
      await makeMembership(loner, orgA, { status: "revoked" });
      const row = await insertNotification(loner, orgA, "stale-row");
      const token = await session(loner, orgA);

      const list = await call("get", "/api/notifications", token);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);
      expect((await call("get", "/api/notifications/unread-count", token)).body).toEqual({ unreadCount: 0 });
      expect((await call("patch", `/api/notifications/${row.id}/read`, token)).status).toBe(404);
      expect((await call("post", "/api/notifications/read-all", token)).status).toBe(200);
      const [after] = await db.select().from(schema.notificationsTable).where(eq(schema.notificationsTable.id, row.id));
      expect(after.read).toBe(false);
    });

    it("fails closed (503) when the tenant-host lookup itself failed, even for a caller with a live membership", async () => {
      const { resolveActiveOrganizationScope } = await import("../lib/activeOrganizationScope");
      const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.id, dual.userId));
      const req = { userId: dual.userId, user, session: { activeOrganizationId: orgA }, tenantResolutionFailed: true } as any;
      expect(await resolveActiveOrganizationScope(req)).toEqual({ kind: "denied", status: 503, error: "Tenant resolution is temporarily unavailable" });
      expect((await resolveActiveOrganizationScope({ ...req, tenantResolutionFailed: false })).kind).toBe("organization");
    });

    it("rejects malformed paging parameters", async () => {
      const token = await session(dual.userId, orgA);
      for (const q of ["limit=0", "limit=101", "limit=abc", "before=-1", "before=1.5", "organizationId=x", "before=2147483648", "before=9999999999"]) {
        expect((await call("get", `/api/notifications?${q}`, token, hostA)).status, q).toBe(400);
      }
      // Ids beyond Postgres int4 are a 400, never an "out of range" 500.
      expect((await call("patch", "/api/notifications/3000000000/read", token, hostA)).status).toBe(400);
      expect((await call("patch", "/api/notifications/3000000000/dismiss", token, hostA)).status).toBe(400);
      expect((await call("get", "/api/notifications?before=2147483647", token, hostA)).status).toBe(200);
    });

    it("pins the host to the organization actually resolved, not the session's stale one", async () => {
      // The session still names A, but the A membership was revoked, so
      // resolution falls back to the person's live membership in B.
      const mover = await makeUser(orgA);
      await makeMembership(mover, orgA, { status: "revoked" });
      await makeMembership(mover, orgB);
      await insertNotification(mover, orgB, "b-only");
      const token = await session(mover, orgA);

      for (const path of ["/api/notifications", "/api/notifications/unread-count"]) {
        expect((await call("get", path, token, hostA)).status, path).toBe(403);
      }
      expect((await call("post", "/api/notifications/read-all", token, hostA)).status).toBe(403);

      const onB = await call("get", "/api/notifications", token, hostB);
      expect(onB.status).toBe(200);
      expect(onB.body.map((n: any) => n.title)).toEqual(["b-only"]);
    });
  });

  describe("ordering, paging and visibility", () => {
    let pager: number;

    beforeAll(async () => {
      pager = await makeUser(orgA);
      await makeMembership(pager, orgA);
      const base = Date.now() - 3_600_000;
      // Five rows; the middle three share one timestamp so only the id breaks the tie.
      const stamps = [base, base + 1000, base + 1000, base + 1000, base + 2000];
      for (let i = 0; i < stamps.length; i += 1) {
        await insertNotification(pager, orgA, `page-${i}`, { createdAt: new Date(stamps[i]) });
      }
    });

    it("lists newest first by (createdAt, id) and pages without gaps or repeats", async () => {
      const all = await notifications.listNotificationsForUser(pager, orgA);
      const expected = [...all].sort((x: any, y: any) => +y.createdAt - +x.createdAt || y.id - x.id).map((n: any) => n.id);
      expect(all.map((n: any) => n.id)).toEqual(expected);
      expect(all[0].title).toBe("page-4");

      const token = await session(pager, orgA);
      const seen: number[] = [];
      let before: number | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const res = await call("get", `/api/notifications?limit=2${before ? `&before=${before}` : ""}`, token, hostA);
        expect(res.status).toBe(200);
        seen.push(...res.body.map((n: any) => n.id));
        if (res.body.length < 2) break;
        before = res.body[res.body.length - 1].id;
      }
      expect(seen).toEqual(expected);
    });

    it("a cursor naming another user's or another organization's notification yields an empty page", async () => {
      const foreign = await insertNotification(dual.userId, orgA, "foreign-cursor");
      const inOtherOrg = await insertNotification(pager, orgB, "other-org-cursor");
      expect(await notifications.listNotificationsForUser(pager, orgA, { before: foreign.id })).toEqual([]);
      expect(await notifications.listNotificationsForUser(pager, orgA, { before: inOtherOrg.id })).toEqual([]);
      expect(await notifications.listNotificationsForUser(pager, orgA, { before: 2_000_000_000 })).toEqual([]);
    });

    it("a dismissed or expired cursor row still pages: the centre hides dismissed rows in place and pages from them", async () => {
      const reader = await makeUser(orgA);
      await makeMembership(reader, orgA);
      const base = Date.now() - 600_000;
      const older = await insertNotification(reader, orgA, "older", { createdAt: new Date(base) });
      const dismissed = await insertNotification(reader, orgA, "dismissed-cursor", { createdAt: new Date(base + 1000), dismissedAt: new Date() });
      const expired = await insertNotification(reader, orgA, "expired-cursor", {
        createdAt: new Date(base + 2000),
        expiresAt: new Date(Date.now() - 60_000),
      });

      expect((await notifications.listNotificationsForUser(reader, orgA, { before: dismissed.id })).map((n: any) => n.id)).toEqual([older.id]);
      expect((await notifications.listNotificationsForUser(reader, orgA, { before: expired.id })).map((n: any) => n.id)).toEqual([older.id]);
    });

    it("clamps the page size to the maximum", async () => {
      const rows = await notifications.listNotificationsForUser(pager, orgA, { limit: 10_000 });
      expect(rows.length).toBeLessThanOrEqual(notifications.NOTIFICATION_PAGE_MAX);
      expect(await notifications.listNotificationsForUser(pager, orgA, { limit: 1 })).toHaveLength(1);
    });

    it("the unread count excludes exactly what the list excludes: dismissed, expired, read and other organizations", async () => {
      const viewer = await makeUser(orgA);
      await makeMembership(viewer, orgA);
      await makeMembership(viewer, orgB);
      await insertNotification(viewer, orgA, "visible-unread");
      await insertNotification(viewer, orgA, "read", { read: true });
      await insertNotification(viewer, orgA, "dismissed", { dismissedAt: new Date() });
      await insertNotification(viewer, orgA, "expired", { expiresAt: new Date(Date.now() - 60_000) });
      await insertNotification(viewer, orgA, "not-yet-expired", { expiresAt: new Date(Date.now() + 3_600_000) });
      await insertNotification(viewer, orgB, "other-org");
      await insertNotification(viewer, null, "org-less");

      const listed = (await notifications.listNotificationsForUser(viewer, orgA)).map((n: any) => n.title).sort();
      expect(listed).toEqual(["not-yet-expired", "read", "visible-unread"]);
      expect(await notifications.countUnreadNotifications(viewer, orgA)).toBe(2);
    });
  });

  describe("recipient resolution", () => {
    let permissionKey: string;

    beforeAll(async () => {
      permissionKey = `p1a.notify.${suffix}`;
      await db.insert(schema.permissionsTable).values({ key: permissionKey, resource: "p1a", action: "notify" });
    });

    async function holder(organizationId: number, extra: Record<string, unknown> = {}) {
      const [p] = await db.select().from(schema.permissionsTable).where(eq(schema.permissionsTable.key, permissionKey));
      const [role] = await db
        .insert(schema.rolesTable)
        .values({ key: uniq("role"), organizationId, label: uniq("Role"), isSystemRole: false })
        .returning();
      await db.insert(schema.rolePermissionsTable).values({ roleId: role.id, permissionId: p.id });
      const userId = await makeUser(organizationId);
      const membershipId = await makeMembership(userId, organizationId, extra);
      await db.insert(schema.membershipRolesTable).values({ membershipId, roleId: role.id });
      return { userId, membershipId };
    }

    async function linkedEmployee(organizationId: number, userId: number, membershipId: number, extra: Record<string, unknown> = {}) {
      const [e] = await db
        .insert(schema.employeesTable)
        .values({ organizationId, firstName: "Emp", lastName: uniq("E"), employeeNumber: uniq("EMP"), ...extra })
        .returning();
      await db.insert(schema.employeeUserLinksTable).values({ employeeId: e.id, applicationUserId: userId, organizationMembershipId: membershipId });
      return e.id as number;
    }

    const past = () => new Date(Date.now() - 60_000);

    it("an expired-but-active membership receives nothing, under every recipient kind", async () => {
      const expiredUser = await makeUser(orgA);
      const expiredMembership = await makeMembership(expiredUser, orgA, { expiresAt: past() });
      const expiredEmployee = await linkedEmployee(orgA, expiredUser, expiredMembership);
      const report = await linkedEmployee(orgA, other.userId, (await db
        .select()
        .from(schema.organizationMembershipsTable)
        .where(eq(schema.organizationMembershipsTable.applicationUserId, other.userId)))[0].id, { reportingManagerId: expiredEmployee });

      await expect(notifications.resolveRecipients({ kind: "user", userId: expiredUser }, orgA)).rejects.toThrow(notifications.RecipientNotAuthorizedError);
      await expect(notifications.resolveRecipients({ kind: "membership", membershipId: expiredMembership }, orgA)).rejects.toThrow(
        notifications.RecipientNotAuthorizedError,
      );
      await expect(notifications.resolveRecipients({ kind: "employee", employeeId: expiredEmployee }, orgA)).rejects.toThrow(
        notifications.RecipientNotAuthorizedError,
      );
      expect(await notifications.resolveRecipients({ kind: "manager_of_employee", employeeId: report }, orgA)).toEqual([]);

      const live = await holder(orgA);
      const expired = await holder(orgA, { expiresAt: past() });
      const future = await holder(orgA, { expiresAt: new Date(Date.now() + 3_600_000) });
      const ids = (await notifications.resolveRecipients({ kind: "permission_holders", permissionKey }, orgA)).map((r) => r.userId);
      expect(ids).toContain(live.userId);
      expect(ids).toContain(future.userId);
      expect(ids).not.toContain(expired.userId);
    });

    /** A fresh person with live memberships in both A and B: links are unique per (user, membership). */
    async function twoOrgPerson() {
      const userId = await makeUser(orgA);
      return { userId, membershipA: await makeMembership(userId, orgA), membershipB: await makeMembership(userId, orgB) };
    }

    async function reportTo(managerEmployeeId: number) {
      const [report] = await db
        .insert(schema.employeesTable)
        .values({ organizationId: orgA, firstName: "Rep", lastName: uniq("R"), employeeNumber: uniq("REP"), reportingManagerId: managerEmployeeId })
        .returning();
      return report.id as number;
    }

    it("an employee link pointing at another organization's membership never carries a notification across tenants", async () => {
      // Employee row in A, but the login link's membership is the person's membership in B.
      const p1 = await twoOrgPerson();
      const crossEmployee = await linkedEmployee(orgA, p1.userId, p1.membershipB);
      await expect(notifications.resolveRecipients({ kind: "employee", employeeId: crossEmployee }, orgA)).rejects.toThrow(
        notifications.RecipientNotAuthorizedError,
      );

      // A manager whose only login link is a membership in B is not reachable as A's manager.
      const p2 = await twoOrgPerson();
      const crossManager = await linkedEmployee(orgA, p2.userId, p2.membershipB);
      expect(await notifications.resolveRecipients({ kind: "manager_of_employee", employeeId: await reportTo(crossManager) }, orgA)).toEqual([]);

      // A reportingManagerId naming an employee of B resolves to nobody in A.
      const p3 = await twoOrgPerson();
      const managerInB = await linkedEmployee(orgB, p3.userId, p3.membershipB);
      expect(await notifications.resolveRecipients({ kind: "manager_of_employee", employeeId: await reportTo(managerInB) }, orgA)).toEqual([]);

      // ...even when that B employee's login link is the person's live membership in A.
      const p5 = await twoOrgPerson();
      const managerInBLinkedToA = await linkedEmployee(orgB, p5.userId, p5.membershipA);
      expect(
        await notifications.resolveRecipients({ kind: "manager_of_employee", employeeId: await reportTo(managerInBLinkedToA) }, orgA),
      ).toEqual([]);

      // The correctly linked case still resolves.
      const p4 = await twoOrgPerson();
      const goodManager = await linkedEmployee(orgA, p4.userId, p4.membershipA);
      expect(await notifications.resolveRecipients({ kind: "manager_of_employee", employeeId: await reportTo(goodManager) }, orgA)).toEqual([
        { userId: p4.userId },
      ]);
    });
  });
});
