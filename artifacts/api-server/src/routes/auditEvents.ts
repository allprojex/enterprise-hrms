import { Router } from "express";
import { eq, and, desc, count, type SQL } from "drizzle-orm";
import { db, auditEventsTable } from "@workspace/db";
import { ListAuditEventsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";

const router = Router();

function formatEvent(event: typeof auditEventsTable.$inferSelect) {
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    actorApplicationUserId: event.actorApplicationUserId,
    actorMembershipId: event.actorMembershipId,
    organizationId: event.organizationId,
    eventType: event.eventType,
    targetType: event.targetType,
    targetId: event.targetId,
    beforeState: event.beforeState,
    afterState: event.afterState,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    metadata: event.metadata,
  };
}

// GET /organizations/:organizationId/audit-events
router.get(
  "/organizations/:organizationId/audit-events",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("audit.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ListAuditEventsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const { page, pageSize, eventType, targetType, targetId, actorApplicationUserId } = parsed.data;

    const conditions: SQL[] = [eq(auditEventsTable.organizationId, organizationId)];
    if (eventType) conditions.push(eq(auditEventsTable.eventType, eventType));
    if (targetType) conditions.push(eq(auditEventsTable.targetType, targetType));
    if (targetId) conditions.push(eq(auditEventsTable.targetId, targetId));
    if (actorApplicationUserId != null) conditions.push(eq(auditEventsTable.actorApplicationUserId, actorApplicationUserId));
    const where = and(...conditions);

    const [totalRow] = await db.select({ value: count() }).from(auditEventsTable).where(where);
    const total = totalRow?.value ?? 0;

    const items = await db
      .select()
      .from(auditEventsTable)
      .where(where)
      .orderBy(desc(auditEventsTable.occurredAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    res.json({ items: items.map(formatEvent), total, page, pageSize });
  },
);

export default router;
