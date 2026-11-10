import { Router, type Response } from "express";
import type { notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import type { MembershipRequest } from "../middlewares/requireMembership";
import { resolveActiveOrganizationScope } from "../lib/activeOrganizationScope";
import {
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  NotificationNotFoundError,
  NOTIFICATION_PAGE_MAX,
} from "../lib/notifications";

const router = Router();

// WS-6 additive fields (organizationId, sourceReferenceType/Id, actionPath,
// dismissedAt) alongside the six original ones — every pre-existing
// consumer of this shape keeps working unchanged; nothing here removes or
// renames a field.
function formatNotification(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    createdAt: n.createdAt,
    organizationId: n.organizationId,
    sourceReferenceType: n.sourceReferenceType,
    sourceReferenceId: n.sourceReferenceId,
    actionPath: n.actionPath,
    dismissedAt: n.dismissedAt,
  };
}

/**
 * Every notification route acts in exactly one organization: the caller's
 * active one, pinned to the tenant host (lib/activeOrganizationScope.ts).
 * Returns that organization's id, `null` when the caller has no live
 * membership anywhere (nothing to show), or `undefined` after it has
 * already answered the request with a 403/503.
 */
async function scopeOrRespond(req: MembershipRequest, res: Response): Promise<number | null | undefined> {
  const scope = await resolveActiveOrganizationScope(req);
  if (scope.kind === "denied") {
    res.status(scope.status).json({ error: scope.error });
    return undefined;
  }
  return scope.kind === "organization" ? scope.organizationId : null;
}

/** A positive integer query parameter, `undefined` when absent, or `null` when present but malformed. */
function positiveIntParam(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function idParam(req: MembershipRequest): number | null {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return positiveIntParam(raw) ?? null;
}

// GET /notifications
// One page, newest first, of the caller's notifications in the active
// organization only. `organizationId` is still accepted for compatibility,
// but only as an assertion: naming any organization other than the active
// one is refused, never honoured.
router.get("/notifications", requireAuth as any, async (req: MembershipRequest, res): Promise<void> => {
  const limit = positiveIntParam(req.query.limit);
  const before = positiveIntParam(req.query.before);
  const requestedOrganizationId = positiveIntParam(req.query.organizationId);
  if (limit === null || (limit !== undefined && limit > NOTIFICATION_PAGE_MAX)) {
    res.status(400).json({ error: `limit must be an integer from 1 to ${NOTIFICATION_PAGE_MAX}` });
    return;
  }
  if (before === null || requestedOrganizationId === null) {
    res.status(400).json({ error: "Invalid query parameter" });
    return;
  }

  const organizationId = await scopeOrRespond(req, res);
  if (organizationId === undefined) return;
  if (requestedOrganizationId !== undefined && requestedOrganizationId !== organizationId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (organizationId === null) {
    res.json([]);
    return;
  }

  const notifications = await listNotificationsForUser(req.userId!, organizationId, { limit, before });
  res.json(notifications.map(formatNotification));
});

// GET /notifications/unread-count
// The badge count, under exactly the list's own visibility rule.
router.get("/notifications/unread-count", requireAuth as any, async (req: MembershipRequest, res): Promise<void> => {
  const organizationId = await scopeOrRespond(req, res);
  if (organizationId === undefined) return;
  res.json({ unreadCount: organizationId === null ? 0 : await countUnreadNotifications(req.userId!, organizationId) });
});

// PATCH /notifications/:id/read
router.patch("/notifications/:id/read", requireAuth as any, async (req: MembershipRequest, res): Promise<void> => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  const organizationId = await scopeOrRespond(req, res);
  if (organizationId === undefined) return;

  try {
    if (organizationId === null) throw new NotificationNotFoundError();
    res.json(formatNotification(await markNotificationRead(req.userId!, organizationId, id)));
  } catch (err) {
    if (err instanceof NotificationNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// POST /notifications/read-all
// The active organization only: reading WWM's notifications never marks
// another tenant's as read.
router.post("/notifications/read-all", requireAuth as any, async (req: MembershipRequest, res): Promise<void> => {
  const organizationId = await scopeOrRespond(req, res);
  if (organizationId === undefined) return;
  if (organizationId !== null) await markAllNotificationsRead(req.userId!, organizationId);
  res.json({ message: "All notifications marked as read" });
});

// PATCH /notifications/:id/dismiss
// IDOR-safe by construction (§36): the lookup always includes the caller's
// own userId and the active organization, so no id — however guessed —
// ever resolves to another user's notification or another tenant's.
router.patch("/notifications/:id/dismiss", requireAuth as any, async (req: MembershipRequest, res): Promise<void> => {
  const id = idParam(req);
  if (id === null) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  const organizationId = await scopeOrRespond(req, res);
  if (organizationId === undefined) return;

  try {
    if (organizationId === null) throw new NotificationNotFoundError();
    res.json(formatNotification(await dismissNotification(req.userId!, organizationId, id)));
  } catch (err) {
    if (err instanceof NotificationNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
