/**
 * WS-26C — generic submission↔domain linkage service (Option A).
 *
 * Associates a governed WS-26 form submission with an existing business-domain
 * record. It ONLY records the link — it never creates, approves, mutates, or
 * confirms anything in the Leave, Performance or employee-lifecycle domains;
 * those modules remain the sole authority over their data. Every link is
 * tenant-scoped: both the submission and the linked record must belong to the
 * caller's organization (a cross-tenant id fails closed), and each write is
 * audited. Organization-neutral: `domainType` is validated against a small
 * allow-list, not hard-coded to any tenant.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  formSubmissionLinksTable,
  formSubmissionsTable,
  leaveRequestsTable,
  performanceReviewsTable,
  employeesTable,
  type FormSubmissionLink,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import type { FormActor } from "./submissions";

export class DomainLinkNotFoundError extends Error {}
export class DomainLinkValidationError extends Error {}
export class DomainLinkConflictError extends Error {}

export type DomainType = "leave_request" | "performance_review" | "employee";

/**
 * Same-organization existence check per supported domain. Adding a domain here
 * (not a WWM-specific column) is all it takes to support a new link target.
 * NONE of these mutate — they only confirm the record exists in this org.
 */
const DOMAIN_VALIDATORS: Record<DomainType, (organizationId: number, id: number) => Promise<boolean>> = {
  leave_request: async (organizationId, id) => {
    const [r] = await db.select({ id: leaveRequestsTable.id }).from(leaveRequestsTable).where(and(eq(leaveRequestsTable.id, id), eq(leaveRequestsTable.organizationId, organizationId))).limit(1);
    return !!r;
  },
  performance_review: async (organizationId, id) => {
    const [r] = await db.select({ id: performanceReviewsTable.id }).from(performanceReviewsTable).where(and(eq(performanceReviewsTable.id, id), eq(performanceReviewsTable.organizationId, organizationId))).limit(1);
    return !!r;
  },
  employee: async (organizationId, id) => {
    const [r] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(eq(employeesTable.id, id), eq(employeesTable.organizationId, organizationId))).limit(1);
    return !!r;
  },
};

export function isSupportedDomainType(t: string): t is DomainType {
  return t === "leave_request" || t === "performance_review" || t === "employee";
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

async function submissionInOrg(organizationId: number, submissionId: number): Promise<boolean> {
  const [s] = await db.select({ id: formSubmissionsTable.id }).from(formSubmissionsTable).where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.organizationId, organizationId))).limit(1);
  return !!s;
}

export async function listSubmissionLinks(organizationId: number, submissionId: number): Promise<FormSubmissionLink[]> {
  return db
    .select()
    .from(formSubmissionLinksTable)
    .where(and(eq(formSubmissionLinksTable.organizationId, organizationId), eq(formSubmissionLinksTable.submissionId, submissionId)))
    .orderBy(formSubmissionLinksTable.createdAt);
}

export async function createSubmissionLink(params: {
  organizationId: number;
  actor: FormActor;
  submissionId: number;
  domainType: string;
  domainEntityId: number;
  relationType?: string | null;
}): Promise<FormSubmissionLink> {
  const { organizationId, actor, submissionId } = params;
  if (!isSupportedDomainType(params.domainType)) throw new DomainLinkValidationError(`Unsupported domain type "${params.domainType}"`);
  if (!Number.isInteger(params.domainEntityId) || params.domainEntityId <= 0) throw new DomainLinkValidationError("A valid domain entity id is required");
  if (!(await submissionInOrg(organizationId, submissionId))) throw new DomainLinkNotFoundError();
  // Same-tenant validity: the linked record must exist in THIS org. Cross-tenant fails closed here.
  if (!(await DOMAIN_VALIDATORS[params.domainType](organizationId, params.domainEntityId))) {
    throw new DomainLinkValidationError("The linked record does not exist in this organization");
  }
  const relationType = (params.relationType && params.relationType.trim()) || "represents";
  try {
    const [row] = await db
      .insert(formSubmissionLinksTable)
      .values({ organizationId, submissionId, domainType: params.domainType, domainEntityId: params.domainEntityId, relationType, createdByMembershipId: actor.membershipId })
      .returning();
    await recordAuditEvent({
      actorApplicationUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      organizationId,
      eventType: "form.linked",
      targetType: "form_submission",
      targetId: String(submissionId),
      afterState: { linkId: row.id, domainType: params.domainType, domainEntityId: params.domainEntityId, relationType },
    });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainLinkConflictError("This link already exists");
    throw e;
  }
}

export async function removeSubmissionLink(params: {
  organizationId: number;
  actor: FormActor;
  submissionId: number;
  linkId: number;
}): Promise<void> {
  const { organizationId, actor, submissionId, linkId } = params;
  const [link] = await db
    .select()
    .from(formSubmissionLinksTable)
    .where(and(eq(formSubmissionLinksTable.id, linkId), eq(formSubmissionLinksTable.organizationId, organizationId), eq(formSubmissionLinksTable.submissionId, submissionId)))
    .limit(1);
  if (!link) throw new DomainLinkNotFoundError();
  await db.delete(formSubmissionLinksTable).where(and(eq(formSubmissionLinksTable.id, linkId), eq(formSubmissionLinksTable.organizationId, organizationId)));
  await recordAuditEvent({
    actorApplicationUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    organizationId,
    eventType: "form.unlinked",
    targetType: "form_submission",
    targetId: String(submissionId),
    beforeState: { linkId, domainType: link.domainType, domainEntityId: link.domainEntityId, relationType: link.relationType },
  });
}
