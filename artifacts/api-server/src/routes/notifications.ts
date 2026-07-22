import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router = Router();

function formatNotification(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    createdAt: n.createdAt,
  };
}

// GET /notifications
router.get("/notifications", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(notificationsTable.createdAt);

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

export default router;
