import { Router } from "express";
import { eq, and, inArray, desc, count, type SQL } from "drizzle-orm";
import { db, auditEventsTable } from "@workspace/db";
import { ListAuditEventsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { resolveAllowedAuditCategories } from "../lib/auditAuthorization";
import { AUDIT_CATEGORIES, type AuditCategory } from "../lib/auditCategories";

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
    category: event.category,
    requestId: event.requestId,
    outcome: event.outcome,
  };
}

function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

// GET /organizations/:organizationId/audit-events
// WS-3 (Owner Decision #17): authorization is no longer one flat permission
// — resolveAllowedAuditCategories() (never the frontend) decides which
// categories this specific caller may see, and the SQL query itself is
// filtered accordingly (never "fetch everything, hide some client-side").
// A caller with none of the audit.read* permissions gets 403, matching the
// pre-existing behavior for a caller who lacked "audit.read" before this
// workstream.
router.get(
  "/organizations/:organizationId/audit-events",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ListAuditEventsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const allowed = await resolveAllowedAuditCategories(req.membership!.id);
    if (allowed !== "all" && allowed.length === 0) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const { page, pageSize, eventType, targetType, targetId, actorApplicationUserId, category } = parsed.data;

    if (category) {
      if (!isAuditCategory(category)) {
        res.status(400).json({ error: `Unknown audit category "${category}"` });
        return;
      }
      if (allowed !== "all" && !allowed.includes(category)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const conditions: SQL[] = [eq(auditEventsTable.organizationId, organizationId)];
    if (eventType) conditions.push(eq(auditEventsTable.eventType, eventType));
    if (targetType) conditions.push(eq(auditEventsTable.targetType, targetType));
    if (targetId) conditions.push(eq(auditEventsTable.targetId, targetId));
    if (actorApplicationUserId != null) conditions.push(eq(auditEventsTable.actorApplicationUserId, actorApplicationUserId));

    if (category) {
      conditions.push(eq(auditEventsTable.category, category));
    } else if (allowed !== "all") {
      // No explicit category requested: return the union of every category
      // this caller is allowed to see (never everything, never nothing).
      conditions.push(inArray(auditEventsTable.category, allowed));
    }

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

    res.json({ items: items.map(formatEvent), total, page, pageSize, allowedCategories: allowed });
  },
);

export default router;
