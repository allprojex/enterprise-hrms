/**
 * WS-5 (§6-7) — the shared document-category domain.
 *
 * The category list itself is NOT a new table: "document_category" is
 * already a registered, organization-defined Master Data domain
 * (lib/db/src/seed/master-data-definitions.ts), already exposed through the
 * existing generic Master Data API and UI, and already the source of
 * `categoryCode` on employee_documents/candidate_documents. Adding a second
 * category-management surface would have duplicated all of that (§37), so
 * organizations continue to define categories exactly where they already do.
 *
 * What this module adds is the thin behavioral layer on top: the optional
 * per-category settings row (document_category_settings) that says whether a
 * category requires verification, supports/requires an expiry date, how
 * sensitive it is, and what retention basis applies. Resolution follows the
 * same precedence Master Data itself uses — an organization's own row wins
 * over a platform-wide (organizationId null) row, and a category with no row
 * at all falls back to DEFAULT_CATEGORY_BEHAVIOR rather than erroring.
 */
import { and, eq, isNull, or, inArray } from "drizzle-orm";
import { db, documentCategorySettingsTable, type DocumentCategorySettings } from "@workspace/db";
import { listMasterDataItems } from "./masterData";
import { recordAuditEvent } from "./auditLog";

export const DOCUMENT_CATEGORY_DOMAIN = "document_category";

export interface CategoryBehavior {
  categoryCode: string;
  verificationRequired: boolean;
  expirySupported: boolean;
  expiryRequired: boolean;
  sensitivity: "standard" | "confidential";
  retentionBasis: string | null;
  retentionPeriodMonths: number | null;
}

/**
 * What a category with no settings row means: an ordinary document that
 * needs no verification, has no expiry, is not confidential, and carries no
 * specific retention rule. Deliberately the permissive-but-unremarkable
 * default — a category the organization has not configured must not silently
 * behave as confidential (which would hide documents from users who should
 * see them) nor as expiring (which would produce false expiry alerts in
 * WS-6).
 */
export function defaultCategoryBehavior(categoryCode: string): CategoryBehavior {
  return {
    categoryCode,
    verificationRequired: false,
    expirySupported: false,
    expiryRequired: false,
    sensitivity: "standard",
    retentionBasis: null,
    retentionPeriodMonths: null,
  };
}

function toBehavior(row: DocumentCategorySettings): CategoryBehavior {
  return {
    categoryCode: row.categoryCode,
    verificationRequired: row.verificationRequired,
    expirySupported: row.expirySupported,
    expiryRequired: row.expiryRequired,
    sensitivity: row.sensitivity,
    retentionBasis: row.retentionBasis,
    retentionPeriodMonths: row.retentionPeriodMonths,
  };
}

/**
 * Settings rows visible to an organization: its own, plus platform-wide
 * defaults. Where both exist for a code, the organization's row wins — the
 * same precedence listMasterDataItems applies to the items themselves.
 */
async function loadSettings(organizationId: number, categoryCodes?: string[]): Promise<Map<string, CategoryBehavior>> {
  const scope = and(
    or(isNull(documentCategorySettingsTable.organizationId), eq(documentCategorySettingsTable.organizationId, organizationId)),
    categoryCodes && categoryCodes.length > 0 ? inArray(documentCategorySettingsTable.categoryCode, categoryCodes) : undefined,
  );

  const rows = await db.select().from(documentCategorySettingsTable).where(scope);

  const byCode = new Map<string, CategoryBehavior>();
  for (const row of rows) {
    const existing = byCode.get(row.categoryCode);
    // An organization-specific row always overrides a platform-wide one,
    // regardless of the order the database returned them in.
    if (!existing || row.organizationId !== null) {
      byCode.set(row.categoryCode, toBehavior(row));
    }
  }
  return byCode;
}

/** Behavior for one category — never throws for an unconfigured category. */
export async function getCategoryBehavior(organizationId: number, categoryCode: string): Promise<CategoryBehavior> {
  const settings = await loadSettings(organizationId, [categoryCode]);
  return settings.get(categoryCode) ?? defaultCategoryBehavior(categoryCode);
}

/**
 * Every category available to an organization (Master Data items, active
 * ones only) merged with its resolved behavior — the single call the
 * category picker and the documents list both use, so neither has to make
 * one query per category.
 */
export async function listCategories(organizationId: number): Promise<
  (CategoryBehavior & { label: string })[]
> {
  const items = await listMasterDataItems(organizationId, DOCUMENT_CATEGORY_DOMAIN);
  const active = items.filter((item) => item.status === "active");
  const settings = await loadSettings(
    organizationId,
    active.map((item) => item.code),
  );

  return active.map((item) => ({
    ...(settings.get(item.code) ?? defaultCategoryBehavior(item.code)),
    label: item.label,
  }));
}

/**
 * True if `categoryCode` is a category this organization can actually use.
 * Called before writing any document/template row, so a client cannot attach
 * a document to a category invented in the request body or belonging to
 * another organization (§54's "forged category references").
 *
 * Note this is a stricter rule than employee_documents/candidate_documents
 * apply to their own `categoryCode` — those predate WS-5 and accept any
 * free-text code (see employee-documents.ts's own header). Tightening them
 * retroactively would reject documents organizations have already stored, so
 * the stricter rule applies to the surfaces WS-5 introduces, and §55's
 * regression requirement (existing document flows keep working unchanged) is
 * preserved.
 */
export async function isUsableCategory(organizationId: number, categoryCode: string): Promise<boolean> {
  const items = await listMasterDataItems(organizationId, DOCUMENT_CATEGORY_DOMAIN);
  return items.some((item) => item.code === categoryCode && item.status === "active");
}

export class UnknownDocumentCategoryError extends Error {
  constructor(categoryCode: string) {
    super(`"${categoryCode}" is not an active document category for this organization`);
    this.name = "UnknownDocumentCategoryError";
  }
}

export async function assertUsableCategory(organizationId: number, categoryCode: string): Promise<void> {
  if (!(await isUsableCategory(organizationId, categoryCode))) {
    throw new UnknownDocumentCategoryError(categoryCode);
  }
}

/**
 * Creates or updates this organization's own settings row for a category.
 * Never touches a platform-wide row (organizationId null) — an organization
 * configuring its own behavior must not change every other organization's.
 */
export async function upsertCategorySettings(params: {
  organizationId: number;
  categoryCode: string;
  verificationRequired?: boolean;
  expirySupported?: boolean;
  expiryRequired?: boolean;
  sensitivity?: "standard" | "confidential";
  retentionBasis?: string | null;
  retentionPeriodMonths?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentCategorySettings> {
  await assertUsableCategory(params.organizationId, params.categoryCode);

  const [existing] = await db
    .select()
    .from(documentCategorySettingsTable)
    .where(
      and(
        eq(documentCategorySettingsTable.organizationId, params.organizationId),
        eq(documentCategorySettingsTable.categoryCode, params.categoryCode),
      ),
    )
    .limit(1);

  const values = {
    verificationRequired: params.verificationRequired ?? existing?.verificationRequired ?? false,
    expirySupported: params.expirySupported ?? existing?.expirySupported ?? false,
    expiryRequired: params.expiryRequired ?? existing?.expiryRequired ?? false,
    sensitivity: params.sensitivity ?? existing?.sensitivity ?? ("standard" as const),
    retentionBasis: params.retentionBasis !== undefined ? params.retentionBasis : (existing?.retentionBasis ?? null),
    retentionPeriodMonths:
      params.retentionPeriodMonths !== undefined ? params.retentionPeriodMonths : (existing?.retentionPeriodMonths ?? null),
  };

  // expiryRequired without expirySupported is incoherent — a category cannot
  // demand a date it does not accept. Normalized rather than rejected: the
  // caller's intent ("this category expires") is unambiguous.
  if (values.expiryRequired) values.expirySupported = true;

  const [row] = existing
    ? await db
        .update(documentCategorySettingsTable)
        .set(values)
        .where(eq(documentCategorySettingsTable.id, existing.id))
        .returning()
    : await db
        .insert(documentCategorySettingsTable)
        .values({ organizationId: params.organizationId, categoryCode: params.categoryCode, ...values })
        .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: existing ? "document_category.updated" : "document_category.configured",
    targetType: "document_category_settings",
    targetId: String(row.id),
    beforeState: existing ?? null,
    afterState: row,
  });

  return row;
}
