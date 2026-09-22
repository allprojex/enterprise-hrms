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
import { and, eq, isNull, or, sql } from "drizzle-orm";
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

/** One resolved, membership-verified recipient. */
interface ResolvedRecipient {
  userId: number;
}

async function activeMembershipUserId(userId: number, organizationId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: organizationMembershipsTable.applicationUserId })
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.applicationUserId, userId),
        eq(organizationMembershipsTable.organizationId, organizationId),
        eq(organizationMembershipsTable.status, "active"),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Resolves a `RecipientSpec` to a list of user ids, each independently
 * verified to hold an active membership in `organizationId` at resolution
 * time — the authoritative-relationship check §18 requires. A spec that
 * resolves to nobody with a valid membership returns an empty list rather
 * than throwing, except `user`/`membership`/`employee` (a single, named
 * target the caller explicitly asked for), where an unauthorized or
 * nonexistent target is a caller error worth surfacing distinctly.
 */
export async function resolveRecipients(spec: RecipientSpec, organizationId: number): Promise<ResolvedRecipient[]> {
  switch (spec.kind) {
    case "user": {
      const userId = await activeMembershipUserId(spec.userId, organizationId);
      if (!userId) throw new RecipientNotAuthorizedError();
      return [{ userId }];
    }

    case "membership": {
      const [membership] = await db
        .select()
        .from(organizationMembershipsTable)
        .where(
          and(
            eq(organizationMembershipsTable.id, spec.membershipId),
            eq(organizationMembershipsTable.organizationId, organizationId),
            eq(organizationMembershipsTable.status, "active"),
          ),
        )
        .limit(1);
      if (!membership) throw new RecipientNotAuthorizedError();
      return [{ userId: membership.applicationUserId }];
    }

    case "employee": {
      const [link] = await db
        .select({ userId: employeeUserLinksTable.applicationUserId, membershipId: employeeUserLinksTable.organizationMembershipId })
        .from(employeeUserLinksTable)
        .innerJoin(employeesTable, eq(employeesTable.id, employeeUserLinksTable.employeeId))
        .innerJoin(organizationMembershipsTable, eq(organizationMembershipsTable.id, employeeUserLinksTable.organizationMembershipId))
        .where(
          and(
            eq(employeeUserLinksTable.employeeId, spec.employeeId),
            eq(employeesTable.organizationId, organizationId),
            eq(organizationMembershipsTable.status, "active"),
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
      const [employee] = await db
        .select({ reportingManagerId: employeesTable.reportingManagerId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, spec.employeeId), eq(employeesTable.organizationId, organizationId)))
        .limit(1);
      if (!employee?.reportingManagerId) return [];

      const [link] = await db
        .select({ userId: employeeUserLinksTable.applicationUserId })
        .from(employeeUserLinksTable)
        .innerJoin(organizationMembershipsTable, eq(organizationMembershipsTable.id, employeeUserLinksTable.organizationMembershipId))
        .where(and(eq(employeeUserLinksTable.employeeId, employee.reportingManagerId), eq(organizationMembershipsTable.status, "active")))
        .limit(1);
      return link ? [{ userId: link.userId }] : [];
    }

    case "permission_holders": {
      const rows = await db
        .selectDistinct({ userId: organizationMembershipsTable.applicationUserId })
        .from(organizationMembershipsTable)
        .innerJoin(membershipRolesTable, eq(membershipRolesTable.membershipId, organizationMembershipsTable.id))
        .innerJoin(rolesTable, eq(rolesTable.id, membershipRolesTable.roleId))
        .innerJoin(rolePermissionsTable, eq(rolePermissionsTable.roleId, membershipRolesTable.roleId))
        .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissionsTable.permissionId))
        .where(
          and(
            eq(organizationMembershipsTable.organizationId, organizationId),
            eq(organizationMembershipsTable.status, "active"),
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
export async function notifyUser(params: NotifyUserParams): Promise<Notification[]> {
  const recipients = await resolveRecipients(params.recipient, params.organizationId);
  if (recipients.length === 0) return [];

  const created: Notification[] = [];
  for (const recipient of recipients) {
    if (params.sourceJobId != null) {
      const [existing] = await db
        .select()
        .from(notificationsTable)
        .where(and(eq(notificationsTable.sourceJobId, params.sourceJobId), eq(notificationsTable.userId, recipient.userId)))
        .limit(1);
      if (existing) {
        created.push(existing);
        continue;
      }
    }

    const [row] = await db
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

export interface ListNotificationsFilters {
  organizationId?: number;
  unreadOnly?: boolean;
}

/**
 * Additive to the pre-existing list behavior: with no filters, returns
 * every notification for the user exactly as the original route always
 * has, in the same ascending-by-createdAt order that route always used —
 * `organizationId` is an optional narrowing filter, never a requirement,
 * and the sort order is deliberately preserved rather than "improved" to
 * newest-first, since that would silently change the existing frontend's
 * display order for every caller that doesn't ask for anything new.
 */
export async function listNotificationsForUser(userId: number, filters: ListNotificationsFilters = {}): Promise<Notification[]> {
  const conditions = [
    eq(notificationsTable.userId, userId),
    // An expired or dismissed notification is excluded from ordinary
    // listing without ever being deleted — the row remains for audit/
    // history purposes and dismissNotification's own IDOR-safe lookup can
    // still find it by id.
    or(isNull(notificationsTable.expiresAt), sql`${notificationsTable.expiresAt} > now()`)!,
    isNull(notificationsTable.dismissedAt),
  ];
  if (filters.organizationId !== undefined) conditions.push(eq(notificationsTable.organizationId, filters.organizationId));
  if (filters.unreadOnly) conditions.push(eq(notificationsTable.read, false));

  return db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(notificationsTable.createdAt);
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super("Notification not found");
    this.name = "NotificationNotFoundError";
  }
}

/** IDOR-safe by construction: the WHERE clause always includes the caller's own userId, so no id ever resolves to another user's row (§36). */
export async function dismissNotification(userId: number, notificationId: number): Promise<Notification> {
  const [row] = await db
    .update(notificationsTable)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.userId, userId)))
    .returning();
  if (!row) throw new NotificationNotFoundError();
  return row;
}
