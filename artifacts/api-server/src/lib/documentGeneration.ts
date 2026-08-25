/**
 * WS-5 (§19, §24, §26, §40-42) — the reusable document-generation engine.
 *
 * This is a platform service, not an Offer-only implementation: it turns
 * (template version + merge context) into a stored PDF plus an immutable
 * generated_documents row, and knows nothing about *why* a letter is being
 * issued. Deciding when an offer/appointment/confirmation/warning letter is
 * appropriate belongs to WS-9/WS-10/WS-12; those workstreams call
 * generateDocument and record the result against their own entity.
 *
 * Three boundaries this file is responsible for:
 *
 *   Isolation (§40) — the template, the source entity, and the output all
 *   belong to one organization. Every load is scoped, so an Org A template
 *   can never render for Org B, and no caller can pass an organization id
 *   that was not already proved by requireMembership.
 *
 *   Immutability (§24) — generation resolves the template's *active version*
 *   once, renders from that exact content, and stores the version id
 *   alongside the artifact. Later template edits create new versions and
 *   never touch a stored artifact or its lineage. Nothing here regenerates
 *   historical letters.
 *
 *   Preview safety (§42) — previewSample renders a template against
 *   obviously-synthetic data (buildSampleContext), never a real employee.
 *   A template editor holds document_template.manage, which conveys no
 *   entitlement to any individual's record, so preview must not become a
 *   way to read one by guessing merge fields. Preview also writes nothing:
 *   no storage object, no generated_documents row, no audit event.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  generatedDocumentsTable,
  organizationsTable,
  employeesTable,
  positionsTable,
  departmentsTable,
  branchesTable,
  type GeneratedDocument,
  type DocumentTemplateVersion,
} from "@workspace/db";
import { writeOrgFile, deleteOrgFile } from "./fileStorage";
import { renderTextPdf, type PdfLine } from "./pdfWriter";
import { renderTemplate, buildSampleContext, type MergeContext } from "./documentMerge";
import { getTemplate, getActiveVersion, NoActiveTemplateVersionError, DocumentTemplateNotFoundError } from "./documentTemplates";
import { getNamespaceConfig } from "../services/organizationConfig";
import { recordAuditEvent } from "./auditLog";

const STORAGE_SUBDIR = "generated-documents";

export class EmployeeNotFoundForGenerationError extends Error {
  constructor() {
    super("Employee not found in this organization");
    this.name = "EmployeeNotFoundForGenerationError";
  }
}

/**
 * Organization-level merge values, assembled from the organization's own
 * record and its `general` config namespace — never hard-coded for any
 * customer (§26/§62). Every organization gets its own identity through the
 * same code path.
 */
async function buildOrganizationContext(organizationId: number): Promise<MergeContext> {
  const [organization] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);

  const general = await getNamespaceConfig(organizationId, "general");
  const data = general.data as { contactEmail?: string; contactPhone?: string; address?: string };

  return {
    "organization.name": organization?.name ?? "",
    "organization.address": data.address ?? "",
    "organization.contactEmail": data.contactEmail ?? "",
    "organization.contactPhone": data.contactPhone ?? "",
  };
}

function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Employee-scoped merge values, resolved server-side from the employee's own
 * record — never from caller-supplied strings, so a caller cannot inject a
 * different person's details into a letter. Scoped to the organization, so a
 * source entity in Org B cannot be merged into an Org A template (§40).
 */
export async function buildEmployeeContext(organizationId: number, employeeId: number): Promise<MergeContext> {
  const [row] = await db
    .select({
      employee: employeesTable,
      position: positionsTable,
      department: departmentsTable,
      branch: branchesTable,
    })
    .from(employeesTable)
    .leftJoin(positionsTable, eq(positionsTable.id, employeesTable.positionId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, employeesTable.departmentId))
    .leftJoin(branchesTable, eq(branchesTable.id, employeesTable.branchId))
    .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.id, employeeId)))
    .limit(1);

  if (!row) throw new EmployeeNotFoundForGenerationError();

  const { employee, position, department, branch } = row;
  const fullName = [employee.firstName, employee.lastName].filter(Boolean).join(" ");

  return {
    "employee.fullName": fullName,
    "employee.firstName": employee.firstName ?? "",
    "employee.lastName": employee.lastName ?? "",
    "employee.employeeNumber": employee.employeeNumber ?? "",
    "employee.email": employee.workEmail ?? "",
    "position.title": position?.title ?? "",
    "department.name": department?.name ?? "",
    "branch.name": branch?.name ?? "",
  };
}

/**
 * Turns rendered text into PDF lines. A blank source line becomes vertical
 * space; every other line is body text with a small paragraph gap. The
 * template author controls the document's structure through their own line
 * breaks — there is no layout language to learn and none to exploit.
 */
function toPdfLines(text: string): PdfLine[] {
  return text.split("\n").map((line) => ({
    text: line,
    spaceBefore: line.trim() === "" ? 0 : 4,
  }));
}

export interface GenerationResult {
  generated: GeneratedDocument;
  templateVersion: DocumentTemplateVersion;
}

/**
 * Generates and stores an official document from a template's active
 * version.
 *
 * Storage-before-database ordering and the compensating delete mirror
 * organizationDocuments.createDocument's own rationale (§50): a failed row
 * insert must not leave a generated_documents record pointing at a file that
 * does not exist, and must never produce a "finalized" row for a generation
 * that did not complete.
 */
export async function generateDocument(params: {
  organizationId: number;
  templateId: number;
  /** Server-resolved merge values. Callers build these with buildEmployeeContext etc., never from raw request input. */
  entityContext: MergeContext;
  sourceType?: string | null;
  sourceId?: number | null;
  effectiveDate?: string | null;
  reference?: string | null;
  fileName?: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<GenerationResult> {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template) throw new DocumentTemplateNotFoundError();

  const version = await getActiveVersion(params.organizationId, params.templateId);
  if (!version) throw new NoActiveTemplateVersionError();

  const context: MergeContext = {
    ...(await buildOrganizationContext(params.organizationId)),
    ...params.entityContext,
    "letter.date": formatDate(new Date()),
    "letter.effectiveDate": params.effectiveDate ? formatDate(params.effectiveDate) : "",
    "letter.reference": params.reference ?? "",
  };

  const body = renderTemplate(version.content, context);
  const pdf = renderTextPdf(toPdfLines(body), { title: template.name });
  const fileName = params.fileName ?? `${template.name.replace(/[^A-Za-z0-9-_ ]/g, "").trim() || "document"}.pdf`;

  const storageKey = await writeOrgFile(params.organizationId, STORAGE_SUBDIR, "pdf", pdf);

  try {
    const [generated] = await db
      .insert(generatedDocumentsTable)
      .values({
        organizationId: params.organizationId,
        templateId: template.id,
        templateVersionId: version.id,
        categoryCode: template.categoryCode,
        sourceType: params.sourceType ?? null,
        sourceId: params.sourceId ?? null,
        storageKey,
        fileName,
        mimeType: "application/pdf",
        fileSize: pdf.length,
        generatedBy: params.actorApplicationUserId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "generated_document.generated",
      targetType: "generated_document",
      targetId: String(generated.id),
      // Lineage and provenance only — never the rendered document text
      // (§33: document contents never go into audit metadata).
      metadata: {
        templateId: template.id,
        templateVersionId: version.id,
        templateVersionNumber: version.versionNumber,
        sourceType: params.sourceType ?? null,
        sourceId: params.sourceId ?? null,
      },
    });

    return { generated, templateVersion: version };
  } catch (err) {
    await deleteOrgFile(params.organizationId, storageKey);
    throw err;
  }
}

/**
 * Renders a template against synthetic sample data and returns the text —
 * no storage write, no database row, no audit event, and no access to any
 * real person's record (§42).
 *
 * Any version (including a draft) may be previewed, which is the point:
 * preview exists so an author can check a draft before activating it.
 */
export async function previewTemplateVersion(params: {
  organizationId: number;
  templateVersion: DocumentTemplateVersion;
}): Promise<{ text: string }> {
  const organizationContext = await buildOrganizationContext(params.organizationId);
  const sample = buildSampleContext(organizationContext["organization.name"] || "Your Organization");

  return {
    text: renderTemplate(params.templateVersion.content, { ...sample, ...organizationContext }),
  };
}

export async function listGeneratedDocuments(
  organizationId: number,
  filters: { sourceType?: string; sourceId?: number; templateId?: number } = {},
): Promise<GeneratedDocument[]> {
  const conditions = [eq(generatedDocumentsTable.organizationId, organizationId)];
  if (filters.sourceType) conditions.push(eq(generatedDocumentsTable.sourceType, filters.sourceType));
  if (filters.sourceId !== undefined) conditions.push(eq(generatedDocumentsTable.sourceId, filters.sourceId));
  if (filters.templateId !== undefined) conditions.push(eq(generatedDocumentsTable.templateId, filters.templateId));
  return db.select().from(generatedDocumentsTable).where(and(...conditions));
}

/** One generated artifact, re-proved against the organization before any storage read. */
export async function getGeneratedDocument(organizationId: number, generatedId: number): Promise<GeneratedDocument | null> {
  const [row] = await db
    .select()
    .from(generatedDocumentsTable)
    .where(and(eq(generatedDocumentsTable.organizationId, organizationId), eq(generatedDocumentsTable.id, generatedId)))
    .limit(1);
  return row ?? null;
}
