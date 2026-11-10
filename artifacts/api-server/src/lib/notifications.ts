/**
 * WS-6 (§17-19, §36) — the in-app notification foundation.
 *
 * This EXTENDS a table that already existed before WS-6: `notifications`
 * shipped with working routes and a working frontend bell/list page, but a
 * repo-wide search found zero `.insert(notificationsTable...)` call sites
 * anywhere in the codebase's history — a live, deployed delivery surface
 * nothing had ever written to. Building a second, parallel notification
 * table would have duplicated that surface instead of completing it, so
 * `notifyUser` below is that table's first writer, and the six original
 * columns (id, userId, title, message, type, read, createdAt) are untouched
 * — every pre-existing route and the existing frontend keep working exactly
 * as before.
 *
 * The recipient resolver (§18) is deliberately minimal — five concrete
 * resolver kinds, not a rule DSL ("do not build a universal audience-rule
 * DSL"). Every kind resolves to a concrete user id and is validated against
 * that user's actual, current membership in the target organization before
 * a row is ever inserted (§19: "notification existence itself can leak
 * information" — a notification is only ever created for someone with a
 * real, live relationship to the organization it concerns, not merely
 * because a domain module thinks they should see it).
 */
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  organizationMembershipsTable,
  employeesTable,
  employeeUserLinksTable,
  rolePermissionsTable,
  membershipRolesTable,
  rolesTable,
  permissionsTable,
  type Notification,
} from "@workspace/db";
import { roleOwnedByMembershipOrganization } from "./permissions";
import { activeAndUnexpired } from "./membership";

export type RecipientSpec =
  | { kind: "user"; userId: number }
  | { kind: "membership"; membershipId: number }
  | { kind: "employee"; employeeId: number }
  | { kind: "manager_of_employee"; employeeId: number }
  | { kind: "permission_holders"; permissionKey: string };

export class RecipientNotAuthorizedError extends Error {
  constructor() {
    super("The resolved recipient has no active membership in this organization");
    this.name = "RecipientNotAuthorizedError";
  }
}

export class RecipientNotFoundError extends Error {
  constructor(kind: string) {
    super(`Could not resolve a recipient for "${kind}" — no matching, active relationship exists`);
    this.name = "RecipientNotFoundError";
  }
}

/**
 * Structurally accepts either the global `db` or a `db.transaction(...)`
 * callback's `tx` (the same alias as lib/auditLog.ts). A caller already inside
 * a transaction passes its `tx` so the notification commits or rolls back
 * with the change it describes, and recipients are resolved against that
 * transaction's own view of the data. Every existing call site passes nothing
 * and is unchanged.
 */
export type NotificationQueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** One resolved, membership-verified recipient. */
interface ResolvedRecipient {
  userId: number;
}

async function activeMembershipUserId(userId: number, organizationId: number, client: NotificationQueryClient): Promise<number | null> {
  const [row] = await client
    .select({ userId: organizationMembershipsTable.applicationUserId })
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.applicationUserId, userId),
        eq(organizationMembershipsTable.organizationId, organizationId),
        activeAndUnexpired(),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Resolves a `RecipientSpec` to a list of user ids, each independently
 * verified to hold an active, unexpired membership in `organizationId` at
 * resolution time — the authoritative-relationship check §18 requires.
 * "Active" is lib/membership.ts's activeAndUnexpired(), the same predicate
 * sign-in and every org-scoped route use, so a membership past its expiry
 * stops receiving notifications exactly when it stops being able to act on
 * them. Every kind also pins the recipient's membership to `organizationId`
 * itself, never only the employee row, so an employee link that points at
 * another organization's membership can never carry a notification across
 * tenants. A spec that
 * resolves to nobody with a valid membership returns an empty list rather
 * than throwing, except `user`/`membership`/`employee` (a single, named
 * target the caller explicitly asked for), where an unauthorized or
 * nonexistent target is a caller error worth surfacing distinctly.
 */
export async function resolveRecipients(
  spec: RecipientSpec,
  organizationId: number,
  client: NotificationQueryClient = db,
): Promise<ResolvedRecipient[]> {
  switch (spec.kind) {
    case "user": {
      const userId = await activeMembershipUserId(spec.userId, organizationId, client);
      if (!userId) throw new RecipientNotAuthorizedError();
      return [{ userId }];
    }

    case "membership": {
      const [membership] = await client
        .select()
        .from(organizationMembershipsTable)
        .where(
          and(
            eq(organizationMembershipsTable.id, spec.membershipId),
            eq(organizationMembershipsTable.organizationId, organizationId),
            activeAndUnexpired(),
          ),
        )
        .limit(1);
      if (!membership) throw new RecipientNotAuthorizedError();
      return [{ userId: membership.applicationUserId }];
    }

    case "employee": {
      const [link] = await client
        .select({ userId: employeeUserLinksTable.applicationUserId, membershipId: employeeUserLinksTable.organizationMembershipId })
        .from(employeeUserLinksTable)
        .innerJoin(employeesTable, eq(employeesTable.id, employeeUserLinksTable.employeeId))
        .innerJoin(organizationMembershipsTable, eq(organizationMembershipsTable.id, employeeUserLinksTable.organizationMembershipId))
        .where(
          and(
            eq(employeeUserLinksTable.employeeId, spec.employeeId),
            eq(employeesTable.organizationId, organizationId),
            eq(organizationMembershipsTable.organizationId, organizationId),
            activeAndUnexpired(),
          ),
        )
        .limit(1);
      if (!link) throw new RecipientNotAuthorizedError();
      return [{ userId: link.userId }];
    }

    case "manager_of_employee": {
      // Live-resolved from employees.reportingManagerId at call time — the
      // same "never cached, never a snapshot" precedent
      // assetReporting.ts/attendanceReporting.ts already establish for
      // manager relationships in this codebase.
      const [employee] = await client
        .select({ reportingManagerId: employeesTable.reportingManagerId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, spec.employeeId), eq(employeesTable.organizationId, organizationId)))
        .limit(1);
      if (!employee?.reportingManagerId) return [];

      // Both the manager's employee row and the membership their login link
      // points at must belong to this organization: reportingManagerId is a
      // plain id, so neither is guaranteed by the reference alone.
      const [link] = await client
        .select({ userId: employeeUserLinksTable.applicationUserId })
        .from(employeeUserLinksTable)
        .innerJoin(employeesTable, eq(employeesTable.id, employeeUserLinksTable.employeeId))
        .innerJoin(organizationMembershipsTable, eq(organizationMembershipsTable.id, employeeUserLinksTable.organizationMembershipId))
        .where(
          and(
            eq(employeeUserLinksTable.employeeId, employee.reportingManagerId),
            eq(employeesTable.organizationId, organizationId),
            eq(organizationMembershipsTable.organizationId, organizationId),
            activeAndUnexpired(),
          ),
        )
        .limit(1);
      return link ? [{ userId: link.userId }] : [];
    }

    case "permission_holders": {
      const rows = await client
        .selectDistinct({ userId: organizationMembershipsTable.applicationUserId })
        .from(organizationMembershipsTable)
        .innerJoin(membershipRolesTable, eq(membershipRolesTable.membershipId, organizationMembershipsTable.id))
        .innerJoin(rolesTable, eq(rolesTable.id, membershipRolesTable.roleId))
        .innerJoin(rolePermissionsTable, eq(rolePermissionsTable.roleId, membershipRolesTable.roleId))
        .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissionsTable.permissionId))
        .where(
          and(
            eq(organizationMembershipsTable.organizationId, organizationId),
            activeAndUnexpired(),
            // A role another organization owns never makes a member a holder.
            roleOwnedByMembershipOrganization(),
            eq(permissionsTable.key, spec.permissionKey),
          ),
        );
      return rows;
    }
  }
}

export interface NotifyUserParams {
  recipient: RecipientSpec;
  organizationId: number;
  title: string;
  message: string;
  type?: Notification["type"];
  sourceReferenceType?: string | null;
  sourceReferenceId?: number | null;
  sourceJobId?: number | null;
  actionPath?: string | null;
  expiresAt?: Date | null;
}

/**
 * Creates a notification for a resolved, membership-verified recipient.
 *
 * Idempotent with respect to a retried job: when `sourceJobId` is set, an
 * existing notification already created by that same job is returned
 * as-is rather than duplicated — the second half of §13's "retries do not
 * create duplicate notifications" guarantee (the first half is
 * scheduled_jobs' own idempotency key, which prevents the *job* from
 * running twice in the ordinary case; this covers the narrower case of a
 * job that legitimately re-executes, e.g. after a crash/reclaim, and must
 * not re-notify).
 */
export async function notifyUser(params: NotifyUserParams, client: NotificationQueryClient = db): Promise<Notification[]> {
  const recipients = await resolveRecipients(params.recipient, params.organizationId, client);
  if (recipients.length === 0) return [];

  const created: Notification[] = [];
  for (const recipient of recipients) {
    if (params.sourceJobId != null) {
      const [existing] = await client
        .select()
        .from(notificationsTable)
        .where(and(eq(notificationsTable.sourceJobId, params.sourceJobId), eq(notificationsTable.userId, recipient.userId)))
        .limit(1);
      if (existing) {
        created.push(existing);
        continue;
      }
    }

    const [row] = await client
      .insert(notificationsTable)
      .values({
        userId: recipient.userId,
        organizationId: params.organizationId,
        title: params.title,
        message: params.message,
        type: params.type ?? "info",
        sourceReferenceType: params.sourceReferenceType ?? null,
        sourceReferenceId: params.sourceReferenceId ?? null,
        sourceJobId: params.sourceJobId ?? null,
        actionPath: params.actionPath ?? null,
        expiresAt: params.expiresAt ?? null,
      })
      .returning();
    created.push(row);
  }
  return created;
}

/** Page-size bounds for the notification centre. */
export const NOTIFICATION_PAGE_DEFAULT = 50;
export const NOTIFICATION_PAGE_MAX = 100;

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  /** Page size, clamped to 1..NOTIFICATION_PAGE_MAX. Defaults to NOTIFICATION_PAGE_DEFAULT. */
  limit?: number;
  /**
   * Keyset cursor: the id of the last notification on the previous page.
   * Only rows strictly older than it, in (createdAt, id) order, are
   * returned. The cursor row is looked up under the same user and
   * organization as the page itself, so a cursor naming somebody else's
   * notification, or one from another organization, matches nothing and
   * yields an empty page. It never reveals whether that id exists.
   */
  before?: number;
}

/**
 * Everything a notification centre may show: the caller's own rows in
 * exactly one organization, neither dismissed nor expired. An expired or
 * dismissed notification is excluded without ever being deleted: the row
 * remains for history, and the id-addressed operations below can still
 * find it.
 *
 * `organizationId` is required. A notification whose organization is null
 * (none exist today, and notifyUser cannot create one) is therefore never
 * returned by a tenant-scoped query. Platform-level notifications get an
 * explicit scope of their own (P1b) rather than appearing on every tenant
 * host.
 */
function visibleTo(userId: number, organizationId: number) {
  return and(
    eq(notificationsTable.userId, userId),
    eq(notificationsTable.organizationId, organizationId),
    or(isNull(notificationsTable.expiresAt), sql`${notificationsTable.expiresAt} > now()`)!,
    isNull(notificationsTable.dismissedAt),
  )!;
}

/**
 * One page of the caller's notifications in one organization, newest first.
 * Ordered by (createdAt, id) descending so rows sharing a timestamp still
 * page deterministically.
 */
export async function listNotificationsForUser(
  userId: number,
  organizationId: number,
  options: ListNotificationsOptions = {},
): Promise<Notification[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? NOTIFICATION_PAGE_DEFAULT), 1), NOTIFICATION_PAGE_MAX);
  const conditions = [visibleTo(userId, organizationId)];
  if (options.unreadOnly) conditions.push(eq(notificationsTable.read, false));
  if (options.before !== undefined) {
    conditions.push(
      sql`(${notificationsTable.createdAt}, ${notificationsTable.id}) < (
        select c.created_at, c.id from notifications c
        where c.id = ${options.before} and c.user_id = ${userId} and c.organization_id = ${organizationId}
      )`,
    );
  }

  return db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
    .limit(limit);
}

/** The unread badge: the same visibility rule as the list, so the two can never disagree. */
export async function countUnreadNotifications(userId: number, organizationId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(visibleTo(userId, organizationId), eq(notificationsTable.read, false)));
  return row?.n ?? 0;
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super("Notification not found");
    this.name = "NotificationNotFoundError";
  }
}

/**
 * The id-addressed operations below are IDOR-safe by construction (§36):
 * every WHERE clause includes the caller's own userId AND the active
 * organization, so no id, however guessed, resolves to another user's row
 * or to the caller's own row in a different tenant. A miss is always the
 * same 404, whichever of the two it was.
 */
function ownedBy(userId: number, organizationId: number, notificationId: number) {
  return and(
    eq(notificationsTable.id, notificationId),
    eq(notificationsTable.userId, userId),
    eq(notificationsTable.organizationId, organizationId),
  );
}

export async function markNotificationRead(userId: number, organizationId: number, notificationId: number): Promise<Notification> {
  const [row] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(ownedBy(userId, organizationId, notificationId))
    .returning();
  if (!row) throw new NotificationNotFoundError();
  return row;
}

/** Marks every unread notification the caller has in this organization only. Returns how many changed. */
export async function markAllNotificationsRead(userId: number, organizationId: number): Promise<number> {
  const rows = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.organizationId, organizationId),
        eq(notificationsTable.read, false),
      ),
    )
    .returning({ id: notificationsTable.id });
  return rows.length;
}

export async function dismissNotification(userId: number, organizationId: number, notificationId: number): Promise<Notification> {
  const [row] = await db
    .update(notificationsTable)
    .set({ dismissedAt: new Date() })
    .where(ownedBy(userId, organizationId, notificationId))
    .returning();
  if (!row) throw new NotificationNotFoundError();
  return row;
}
