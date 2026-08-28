import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  documentAcknowledgementsTable,
  organizationDocumentsTable,
  organizationDocumentVersionsTable,
  employeesTable,
  usersTable,
  type DocumentAcknowledgement,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { isUniqueViolation } from "../dbErrors";

/**
 * WS-10 — handbook and policy acknowledgement (§26.17-26.21).
 *
 * WS-5 owns the document. This file owns only the OBLIGATION: who must
 * acknowledge which exact version, and whether they have.
 *
 * Wording matters here and is deliberate: everything below records that a
 * person ACKNOWLEDGED receipt of a version. Nothing signs anything. WS-10
 * builds no electronic-signature capability and must never be described as if
 * it had (§26.19).
 */

export class AcknowledgementNotFoundError extends Error {
  constructor() {
    super("Acknowledgement not found.");
    this.name = "AcknowledgementNotFoundError";
  }
}
export class DocumentNotAcknowledgeableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentNotAcknowledgeableError";
  }
}
export class NotYourAcknowledgementError extends Error {
  constructor() {
    super("This acknowledgement belongs to someone else.");
    this.name = "NotYourAcknowledgementError";
  }
}

export type AcknowledgementAudience = DocumentAcknowledgement["audience"];

/**
 * Assigns the CURRENT version of a document to one employee.
 *
 * Idempotent by database constraint: the unique index on
 * (organization, employee, documentVersion) means a repeated assignment — from
 * a retried conversion, or from re-running an audience assignment — links to
 * the existing obligation instead of creating a second one (§26.34).
 */
export async function assignDocumentToEmployee(params: {
  organizationId: number;
  employeeId: number;
  documentId: number;
  audience: AcknowledgementAudience;
  onboardingInstanceId?: number | null;
  dueAt?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<{ acknowledgement: DocumentAcknowledgement; created: boolean }> {
  const [document] = await db
    .select({
      id: organizationDocumentsTable.id,
      status: organizationDocumentsTable.status,
      currentVersionId: organizationDocumentsTable.currentVersionId,
      requiresAcknowledgement: organizationDocumentsTable.requiresAcknowledgement,
    })
    .from(organizationDocumentsTable)
    .where(
      and(
        eq(organizationDocumentsTable.id, params.documentId),
        eq(organizationDocumentsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!document) throw new DocumentNotAcknowledgeableError("That document does not belong to this organization.");
  if (document.status === "archived") throw new DocumentNotAcknowledgeableError("That document is archived.");
  if (!document.currentVersionId) throw new DocumentNotAcknowledgeableError("That document has no current version.");

  // Cross-tenant guard on the employee as well: both sides of the obligation
  // must belong to the same organization (§26.30).
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!employee) throw new DocumentNotAcknowledgeableError("That employee does not belong to this organization.");

  try {
    const [created] = await db
      .insert(documentAcknowledgementsTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        documentId: params.documentId,
        documentVersionId: document.currentVersionId,
        audience: params.audience,
        onboardingInstanceId: params.onboardingInstanceId ?? null,
        dueAt: params.dueAt ?? null,
        assignedBy: params.actorApplicationUserId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "onboarding.document_assigned",
      targetType: "document_acknowledgement",
      targetId: String(created.id),
      afterState: {
        employeeId: params.employeeId,
        documentId: params.documentId,
        documentVersionId: document.currentVersionId,
        audience: params.audience,
      },
    });
    return { acknowledgement: created, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await db
      .select()
      .from(documentAcknowledgementsTable)
      .where(
        and(
          eq(documentAcknowledgementsTable.organizationId, params.organizationId),
          eq(documentAcknowledgementsTable.employeeId, params.employeeId),
          eq(documentAcknowledgementsTable.documentVersionId, document.currentVersionId),
        ),
      )
      .limit(1);
    if (!existing) throw err;
    return { acknowledgement: existing, created: false };
  }
}

export interface AudienceSelector {
  audience: AcknowledgementAudience;
  branchId?: number | null;
  departmentId?: number | null;
  positionId?: number | null;
  employmentType?: (typeof employeesTable.$inferSelect)["employmentType"];
  employeeIds?: number[];
}

/**
 * Resolves an audience to concrete employees and raises one obligation each.
 *
 * The audience model is a fixed allow-list of five attributes plus explicit
 * selection — not a rules engine, not a query the caller writes (§26.21).
 * Employees who already hold an obligation for this exact version are skipped
 * by the unique index, so re-running an assignment is safe.
 */
export async function assignDocumentToAudience(params: {
  organizationId: number;
  documentId: number;
  selector: AudienceSelector;
  dueAt?: Date | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<{ assigned: number; alreadyAssigned: number }> {
  const { selector } = params;
  const filters = [eq(employeesTable.organizationId, params.organizationId), eq(employeesTable.employmentStatus, "active")];

  switch (selector.audience) {
    case "all_employees":
      break;
    case "branch":
      if (!selector.branchId) throw new DocumentNotAcknowledgeableError("Select a branch.");
      filters.push(eq(employeesTable.branchId, selector.branchId));
      break;
    case "department":
      if (!selector.departmentId) throw new DocumentNotAcknowledgeableError("Select a department.");
      filters.push(eq(employeesTable.departmentId, selector.departmentId));
      break;
    case "position":
      if (!selector.positionId) throw new DocumentNotAcknowledgeableError("Select a position.");
      filters.push(eq(employeesTable.positionId, selector.positionId));
      break;
    case "employment_type":
      if (!selector.employmentType) throw new DocumentNotAcknowledgeableError("Select an employment type.");
      filters.push(eq(employeesTable.employmentType, selector.employmentType));
      break;
    case "specific_employees":
      if (!selector.employeeIds || selector.employeeIds.length === 0) {
        throw new DocumentNotAcknowledgeableError("Select at least one employee.");
      }
      filters.push(inArray(employeesTable.id, selector.employeeIds));
      break;
    case "onboarding":
      throw new DocumentNotAcknowledgeableError("The onboarding audience is assigned by the onboarding process itself.");
  }

  const employees = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(...filters));

  let assigned = 0;
  let alreadyAssigned = 0;
  for (const employee of employees) {
    const result = await assignDocumentToEmployee({
      organizationId: params.organizationId,
      employeeId: employee.id,
      documentId: params.documentId,
      audience: selector.audience,
      dueAt: params.dueAt ?? null,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    if (result.created) assigned += 1;
    else alreadyAssigned += 1;
  }
  return { assigned, alreadyAssigned };
}

/**
 * Raises fresh obligations after a document gains a new current version
 * (§26.20).
 *
 * Only for documents whose organization configured `reacknowledgeOnNewVersion`.
 * Every earlier acknowledgement stays exactly as it is — the new obligation is
 * a NEW row against the NEW version, which is what makes "previous
 * acknowledgement remains historical evidence" true by construction rather than
 * by discipline.
 */
export async function raiseReacknowledgements(params: {
  organizationId: number;
  documentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<{ raised: number }> {
  const [document] = await db
    .select({
      currentVersionId: organizationDocumentsTable.currentVersionId,
      reacknowledgeOnNewVersion: organizationDocumentsTable.reacknowledgeOnNewVersion,
      status: organizationDocumentsTable.status,
    })
    .from(organizationDocumentsTable)
    .where(
      and(
        eq(organizationDocumentsTable.id, params.documentId),
        eq(organizationDocumentsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!document?.currentVersionId) throw new DocumentNotAcknowledgeableError("That document has no current version.");
  if (!document.reacknowledgeOnNewVersion) return { raised: 0 };

  // Everyone who ever held an obligation for this document — including people
  // who already acknowledged an earlier version, which is exactly who a new
  // effective version is aimed at.
  const priorHolders = await db
    .selectDistinct({ employeeId: documentAcknowledgementsTable.employeeId, audience: documentAcknowledgementsTable.audience })
    .from(documentAcknowledgementsTable)
    .where(
      and(
        eq(documentAcknowledgementsTable.organizationId, params.organizationId),
        eq(documentAcknowledgementsTable.documentId, params.documentId),
      ),
    );

  let raised = 0;
  for (const holder of priorHolders) {
    const result = await assignDocumentToEmployee({
      organizationId: params.organizationId,
      employeeId: holder.employeeId,
      documentId: params.documentId,
      audience: holder.audience,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    if (result.created) raised += 1;
  }
  return { raised };
}

export async function listForEmployee(
  organizationId: number,
  employeeId: number,
  filters?: { status?: DocumentAcknowledgement["status"] },
): Promise<(DocumentAcknowledgement & { documentTitle: string; versionNumber: number })[]> {
  const conditions = [
    eq(documentAcknowledgementsTable.organizationId, organizationId),
    eq(documentAcknowledgementsTable.employeeId, employeeId),
  ];
  if (filters?.status) conditions.push(eq(documentAcknowledgementsTable.status, filters.status));

  const rows = await db
    .select({
      acknowledgement: documentAcknowledgementsTable,
      documentTitle: organizationDocumentsTable.title,
      versionNumber: organizationDocumentVersionsTable.versionNumber,
    })
    .from(documentAcknowledgementsTable)
    .innerJoin(organizationDocumentsTable, eq(organizationDocumentsTable.id, documentAcknowledgementsTable.documentId))
    .innerJoin(
      organizationDocumentVersionsTable,
      eq(organizationDocumentVersionsTable.id, documentAcknowledgementsTable.documentVersionId),
    )
    .where(and(...conditions));

  return rows.map((r) => ({ ...r.acknowledgement, documentTitle: r.documentTitle, versionNumber: r.versionNumber }));
}

export async function listOutstandingForOrganization(
  organizationId: number,
): Promise<(DocumentAcknowledgement & { documentTitle: string })[]> {
  const rows = await db
    .select({ acknowledgement: documentAcknowledgementsTable, documentTitle: organizationDocumentsTable.title })
    .from(documentAcknowledgementsTable)
    .innerJoin(organizationDocumentsTable, eq(organizationDocumentsTable.id, documentAcknowledgementsTable.documentId))
    .where(
      and(
        eq(documentAcknowledgementsTable.organizationId, organizationId),
        eq(documentAcknowledgementsTable.status, "pending"),
      ),
    );
  return rows.map((r) => ({ ...r.acknowledgement, documentTitle: r.documentTitle }));
}

/**
 * Records that an employee acknowledged receipt of the exact assigned version.
 *
 * `employeeId` is resolved by the CALLER from the authenticated user's own
 * identity and passed here — it is never taken from the request body, so a
 * caller cannot acknowledge on someone else's behalf by supplying their id
 * (§26.26). This function re-checks ownership anyway.
 *
 * Already-acknowledged rows are returned unchanged rather than re-stamped, so
 * the original timestamp survives a double submit.
 */
export async function acknowledge(params: {
  organizationId: number;
  acknowledgementId: number;
  employeeId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentAcknowledgement> {
  const [existing] = await db
    .select()
    .from(documentAcknowledgementsTable)
    .where(
      and(
        eq(documentAcknowledgementsTable.id, params.acknowledgementId),
        eq(documentAcknowledgementsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new AcknowledgementNotFoundError();
  if (existing.employeeId !== params.employeeId) throw new NotYourAcknowledgementError();
  if (existing.status === "acknowledged") return existing;

  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, params.actorApplicationUserId))
    .limit(1);
  const name = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || null : null;

  const [updated] = await db
    .update(documentAcknowledgementsTable)
    .set({
      status: "acknowledged",
      acknowledgedAt: new Date(),
      acknowledgedBy: params.actorApplicationUserId,
      acknowledgedByName: name,
    })
    .where(
      and(eq(documentAcknowledgementsTable.id, params.acknowledgementId), eq(documentAcknowledgementsTable.status, "pending")),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.document_acknowledged",
    targetType: "document_acknowledgement",
    targetId: String(params.acknowledgementId),
    afterState: {
      employeeId: params.employeeId,
      documentId: existing.documentId,
      documentVersionId: existing.documentVersionId,
    },
  });
  return updated ?? existing;
}
