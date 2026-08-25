import { db, auditEventsTable } from "@workspace/db";
import { resolveAuditCategory } from "./auditCategories";
import { getCurrentRequestId, getCurrentBreakGlassGrantId } from "./requestContext";

interface AuditEventInput {
  actorApplicationUserId?: number | null;
  actorMembershipId?: number | null;
  organizationId?: number | null;
  eventType: string;
  targetType: string;
  targetId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
  // WS-3 (§9): optional — set only by call sites with a real reason to
  // record a non-success outcome (e.g. a denied sensitive-data reveal).
  // Leave unset for an ordinary successful mutation/read audit; the row
  // existing at all already means it succeeded.
  outcome?: "success" | "failure" | "denied";
}

/**
 * Records a sensitive state-changing (or, per Owner Decision #18, sensitive
 * read) event. Append-only — nothing should ever update or delete these
 * rows, now enforced at the database level too (WS-3, Owner Decision #16 —
 * see 0057_audit_events_tamper_protection.sql).
 *
 * WS-3 additions, both computed automatically so none of the pre-existing
 * ~340 call sites needed to change: `category` is derived from `eventType`
 * (lib/auditCategories.ts, Owner Decision #17); `requestId` is read from the
 * current request's AsyncLocalStorage context if one exists
 * (lib/requestContext.ts), null for background/non-HTTP callers.
 *
 * WS-4 addition (Break-Glass Access Foundation, §28-29): `breakGlassGrantId`
 * is likewise read from that same request context — set only by
 * requireMembership.ts, only on a request actually served under an active
 * grant. This is how an elevated sensitive read (WS-3's existing
 * `.read`/`.revealed` events, `personnel_file.viewed`, etc.) gets tagged as
 * elevated without becoming a second, duplicate event and without any of
 * those call sites needing to change either.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  await db.insert(auditEventsTable).values({
    actorApplicationUserId: input.actorApplicationUserId ?? null,
    actorMembershipId: input.actorMembershipId ?? null,
    organizationId: input.organizationId ?? null,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? null,
    category: resolveAuditCategory(input.eventType),
    requestId: getCurrentRequestId() ?? null,
    outcome: input.outcome ?? null,
    breakGlassGrantId: getCurrentBreakGlassGrantId() ?? null,
  });
}
