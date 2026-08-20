/**
 * Learning Certificates (Phase 3D, W90 — Certificates & Evidence):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §10.4/§21/§29 W90.
 *
 * Certificate ISSUANCE itself lives in `learningEnrollments.ts`'s own
 * `completeEnrollment` — nested inside that function's completion
 * transaction, per §10.4 rule 4 ("the same atomic action as the
 * completion transition itself"). This file owns only the read
 * surfaces (own/org-wide) and the revoke action — there is no "create a
 * certificate" entry point here at all, matching the frozen model:
 * certificates are exclusively a system-triggered consequence of
 * completion, never a direct HR/L&D-initiated create.
 *
 * learning_certificates remains completely separate from
 * employee_certifications (Owner Decision 3) and never touches
 * employee_skills — this file writes to neither, ever.
 */
import { and, eq, count, desc } from "drizzle-orm";
import { db, learningCertificatesTable, type LearningCertificate } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class LearningCertificateNotFoundError extends Error {
  constructor() {
    super("Certificate not found");
    this.name = "LearningCertificateNotFoundError";
  }
}

export class LearningCertificateConflictError extends Error {
  constructor(message = "This certificate is already revoked") {
    super(message);
    this.name = "LearningCertificateConflictError";
  }
}

export class InvalidLearningCertificateError extends Error {}

export async function listMyCertificates(organizationId: number, employeeId: number): Promise<LearningCertificate[]> {
  return db
    .select()
    .from(learningCertificatesTable)
    .where(and(eq(learningCertificatesTable.organizationId, organizationId), eq(learningCertificatesTable.employeeId, employeeId)))
    .orderBy(desc(learningCertificatesTable.issuedAt));
}

export interface ListCertificatesFilters {
  organizationId: number;
  employeeId?: number;
  status?: string;
  page: number;
  pageSize: number;
}

export interface ListCertificatesResult {
  items: LearningCertificate[];
  total: number;
  page: number;
  pageSize: number;
}

/** Org-wide, paginated, filterable — learning.manage only, mirroring listEnrollments' own established shape exactly (§21: no manager/instructor certificate visibility is frozen anywhere, so none is built). */
export async function listCertificates(filters: ListCertificatesFilters): Promise<ListCertificatesResult> {
  const conditions = [eq(learningCertificatesTable.organizationId, filters.organizationId)];
  if (filters.employeeId != null) conditions.push(eq(learningCertificatesTable.employeeId, filters.employeeId));
  if (filters.status != null) conditions.push(eq(learningCertificatesTable.status, filters.status as never));
  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(learningCertificatesTable).where(where);
  const total = totalRow?.value ?? 0;

  const items = await db
    .select()
    .from(learningCertificatesTable)
    .where(where)
    .orderBy(desc(learningCertificatesTable.issuedAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export interface RevokeCertificateParams {
  organizationId: number;
  certificateId: number;
  reason: string | undefined;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * §10.4 rule 8: learning.manage only, mandatory revokeReason, permanently
 * terminal — no restore/un-revoke/reopen path exists anywhere in this
 * file. Atomic conditional UPDATE ... WHERE status = 'active' — a
 * repeat or concurrent revocation affects zero rows and returns a
 * controlled 409, never a silent no-op.
 */
export async function revokeCertificate(params: RevokeCertificateParams): Promise<LearningCertificate> {
  if (!params.reason || !params.reason.trim()) {
    throw new InvalidLearningCertificateError("A revokeReason is required");
  }

  const [existing] = await db
    .select()
    .from(learningCertificatesTable)
    .where(and(eq(learningCertificatesTable.id, params.certificateId), eq(learningCertificatesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!existing) throw new LearningCertificateNotFoundError();

  const [updated] = await db
    .update(learningCertificatesTable)
    .set({ status: "revoked", revokedByMembershipId: params.actorMembershipId, revokedAt: new Date(), revokeReason: params.reason })
    .where(
      and(
        eq(learningCertificatesTable.id, params.certificateId),
        eq(learningCertificatesTable.organizationId, params.organizationId),
        eq(learningCertificatesTable.status, "active"),
      ),
    )
    .returning();
  if (!updated) throw new LearningCertificateConflictError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "learning_certificate.revoked",
    targetType: "learning_certificate",
    targetId: String(params.certificateId),
    metadata: { employeeId: existing.employeeId, enrollmentId: existing.enrollmentId, reason: params.reason },
  });

  return updated;
}
