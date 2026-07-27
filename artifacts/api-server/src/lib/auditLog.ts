import { db, auditEventsTable } from "@workspace/db";

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
}

/** Records a sensitive state-changing event. Append-only — nothing should ever update or delete these rows. */
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
  });
}
