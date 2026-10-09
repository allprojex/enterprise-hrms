import { and, desc, eq } from "drizzle-orm";
import { db, employeeDocumentsTable, type EmployeeDocument } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { writeOrgFile, deleteOrgFile } from "./fileStorage";
import { validateDocumentUpload } from "./documentValidation";

export class EmployeeDocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "EmployeeDocumentNotFoundError";
  }
}

/**
 * Org-scoped documents for one employee, most recently uploaded first.
 *
 * `includeConfidential: false` returns `normal` documents only. The WS-12
 * confidentiality tiers (schema/employee-documents.ts) reserve `confidential`
 * and `restricted` documents for callers holding the owning domain's
 * permission, so a caller who can see the list only because it is their own
 * record must not receive even the metadata (title, category, size) of those.
 * The filter is applied in SQL, not after the fact.
 */
export async function listEmployeeDocuments(
  organizationId: number,
  employeeId: number,
  options: { includeConfidential: boolean },
): Promise<EmployeeDocument[]> {
  const conditions = [eq(employeeDocumentsTable.organizationId, organizationId), eq(employeeDocumentsTable.employeeId, employeeId)];
  if (!options.includeConfidential) conditions.push(eq(employeeDocumentsTable.confidentiality, "normal"));
  return db
    .select()
    .from(employeeDocumentsTable)
    .where(and(...conditions))
    .orderBy(desc(employeeDocumentsTable.createdAt));
}

/**
 * Validates the upload (signature-checked, not just Content-Type — same
 * rigor as profile picture upload), stores the file, and records a new
 * document row. Re-uploading never overwrites a prior row — each upload is
 * its own row; removing one deletes just that file and row.
 */
export async function uploadEmployeeDocument(params: {
  organizationId: number;
  employeeId: number;
  categoryCode: string;
  file: { mimetype: string; size: number; buffer: Buffer; originalname: string };
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeDocument> {
  const extension = validateDocumentUpload(params.file);
  const storageKey = await writeOrgFile(params.organizationId, "documents", extension, params.file.buffer);

  const [document] = await db
    .insert(employeeDocumentsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      categoryCode: params.categoryCode,
      fileName: params.file.originalname,
      storageKey,
      mimeType: params.file.mimetype,
      fileSize: params.file.size,
      uploadedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_document.uploaded",
    targetType: "employee",
    targetId: String(params.employeeId),
    metadata: { documentId: document.id, categoryCode: document.categoryCode, fileName: document.fileName },
  });

  return document;
}

/** Deletes the stored file and its row. Throws EmployeeDocumentNotFoundError if it isn't in this org/employee's scope. */
export async function removeEmployeeDocument(params: {
  organizationId: number;
  employeeId: number;
  documentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(employeeDocumentsTable)
    .where(
      and(
        eq(employeeDocumentsTable.id, params.documentId),
        eq(employeeDocumentsTable.organizationId, params.organizationId),
        eq(employeeDocumentsTable.employeeId, params.employeeId),
      ),
    )
    .limit(1);
  if (!existing) throw new EmployeeDocumentNotFoundError();

  await deleteOrgFile(params.organizationId, existing.storageKey);
  await db.delete(employeeDocumentsTable).where(eq(employeeDocumentsTable.id, params.documentId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_document.removed",
    targetType: "employee",
    targetId: String(params.employeeId),
    metadata: { documentId: existing.id, categoryCode: existing.categoryCode, fileName: existing.fileName },
  });
}
