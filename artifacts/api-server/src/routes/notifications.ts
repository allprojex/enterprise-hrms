import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { listNotificationsForUser, dismissNotification, NotificationNotFoundError } from "../lib/notifications";

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

// GET /notifications
// `organizationId` is an optional, additive narrowing filter (§20:
// tenant-scoped listing) — omitting it preserves the exact original
// behavior (every notification for the caller, regardless of organization).
router.get("/notifications", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const organizationId = typeof req.query.organizationId === "string" ? parseInt(req.query.organizationId, 10) : undefined;
  const notifications = await listNotificationsForUser(req.userId!, {
    organizationId: organizationId != null && !isNaN(organizationId) ? organizationId : undefined,
  });

  res.json(notifications.map(formatNotification));
});

// PATCH /notifications/:id/read
router.patch("/notifications/:id/read", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const updated = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!)))
    .returning();

  if (!updated.length) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  res.json(formatNotification(updated[0]));
});

// POST /notifications/read-all
router.post("/notifications/read-all", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(eq(notificationsTable.userId, req.userId!));

  res.json({ message: "All notifications marked as read" });
});

// PATCH /notifications/:id/dismiss
// IDOR-safe by construction (§36): dismissNotification's WHERE clause
// always includes the caller's own userId, so no id — however guessed —
// ever resolves to another user's notification.
router.patch("/notifications/:id/dismiss", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  try {
    res.json(formatNotification(await dismissNotification(req.userId!, id)));
  } catch (err) {
    if (err instanceof NotificationNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
