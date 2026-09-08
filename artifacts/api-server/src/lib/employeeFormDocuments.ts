/**
 * WS-26C (U4) — surface an employee's FINALIZED WS-26 form documents through the
 * existing governed document store.
 *
 * No new document subsystem and no schema: it reads the existing
 * generated_documents (WS-26 finals land there as category "form_final",
 * source_type "form_submission") joined to form_submissions, resolving the
 * SUBJECT employee server-side. All four forms map to form_submissions.subject_employee_id
 * (PIF → subject, Leave → requesting/subject, Evaluation → evaluated,
 * Probation → assessed), so ownership is one trusted relationship, never a
 * client-supplied id.
 *
 * Only FINALIZED submissions surface (immutable snapshot + hash). This module
 * returns METADATA only and a download PATH that points at the existing
 * sensitivity-aware forms download route — it never streams raw bytes, so PIF
 * sensitivity/redaction is enforced identically whether the document is opened
 * from Forms or from Employee Documents.
 */
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  formSubmissionsTable,
  formTemplatesTable,
  formTemplateVersionsTable,
  generatedDocumentsTable,
} from "@workspace/db";

export interface EmployeeFinalizedFormDocument {
  submissionId: number;
  templateId: number;
  templateKey: string;
  templateTitle: string;
  formType: string;
  versionNumber: number;
  finalizedAt: Date | null;
  sha256: string | null;
  generatedDocumentId: number;
  fileName: string;
  /**
   * Download only through the governed, sensitivity-aware forms route — never a
   * raw generated-documents byte path. That route enforces form.final.read OR
   * subject AND redacts sensitive values for callers who lack access.
   */
  downloadPath: string;
}

/** Finalized WS-26 forms whose subject is `employeeId`, org-scoped. Drafts/pending/returned/rejected are excluded. */
export async function listEmployeeFinalizedForms(organizationId: number, employeeId: number): Promise<EmployeeFinalizedFormDocument[]> {
  const rows = await db
    .select({
      submissionId: formSubmissionsTable.id,
      templateId: formTemplatesTable.id,
      templateKey: formTemplatesTable.templateKey,
      templateTitle: formTemplatesTable.title,
      formType: formTemplatesTable.formType,
      versionNumber: formTemplateVersionsTable.versionNumber,
      finalizedAt: formSubmissionsTable.finalizedAt,
      sha256: formSubmissionsTable.finalSha256,
      generatedDocumentId: generatedDocumentsTable.id,
      fileName: generatedDocumentsTable.fileName,
    })
    .from(formSubmissionsTable)
    .innerJoin(formTemplatesTable, eq(formTemplatesTable.id, formSubmissionsTable.templateId))
    .innerJoin(formTemplateVersionsTable, eq(formTemplateVersionsTable.id, formSubmissionsTable.templateVersionId))
    .innerJoin(
      generatedDocumentsTable,
      and(eq(generatedDocumentsTable.id, formSubmissionsTable.finalDocumentId), eq(generatedDocumentsTable.organizationId, organizationId)),
    )
    .where(
      and(
        eq(formSubmissionsTable.organizationId, organizationId),
        eq(formSubmissionsTable.subjectEmployeeId, employeeId),
        eq(formSubmissionsTable.status, "finalized"),
      ),
    )
    .orderBy(desc(formSubmissionsTable.finalizedAt));

  return rows.map((r) => ({
    submissionId: r.submissionId,
    templateId: r.templateId,
    templateKey: r.templateKey,
    templateTitle: r.templateTitle,
    formType: r.formType,
    versionNumber: r.versionNumber,
    finalizedAt: r.finalizedAt,
    sha256: r.sha256,
    generatedDocumentId: r.generatedDocumentId,
    fileName: r.fileName,
    downloadPath: `/api/organizations/${organizationId}/form-submissions/${r.submissionId}/document.pdf?kind=final`,
  }));
}
