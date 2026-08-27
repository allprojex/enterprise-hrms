/**
 * WS-8 — Form Builder service (§24.20–24.24).
 *
 * A form composes custom fields into sections. It creates no tables, executes
 * no code, runs no workflow and bypasses no domain service.
 *
 * The two properties this file is responsible for:
 *
 *   1. A layout is never trusted from the client. Every referenced field is
 *      re-resolved against this organization and this form's scope before a
 *      version is stored, so an administrator cannot compose a form that
 *      reaches another tenant's fields or a field from an unrelated scope.
 *
 *   2. A submission is frozen. It snapshots the field label, type and
 *      definition version alongside each answer, so a historical submission
 *      renders exactly as submitted even after the live definitions move on
 *      (§24.22).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  customFormsTable,
  customFormVersionsTable,
  customFormSubmissionsTable,
  type CustomForm,
  type CustomFormVersion,
  type CustomFormSubmission,
} from "@workspace/db";
import { isUniqueViolation } from "../dbErrors";
import { coerceAndValidateValue, CustomFieldValidationError, type TypedValue } from "./fieldTypes";
import { isFieldVisible } from "./visibility";
import { getCustomFieldsByIds, parsedOptions, parsedValidation, parsedVisibility, type CustomFieldWithVersion } from "./definitions";
import { assertEmployeeReferenceValid, assertEntityInOrganization, requireScopeSpec } from "./scopes";
import { HiddenCustomFieldWriteError } from "./values";

export class CustomFormNotFoundError extends Error {
  constructor() {
    super("Form not found");
    this.name = "CustomFormNotFoundError";
  }
}

export class DuplicateCustomFormKeyError extends Error {
  constructor(formKey: string) {
    super(`A form with key "${formKey}" already exists in this organization`);
    this.name = "DuplicateCustomFormKeyError";
  }
}

export class CustomFormStateError extends Error {}

const FORM_KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;
const MAX_SECTIONS = 50;
const MAX_ITEMS_PER_SECTION = 100;

export interface LayoutFieldItem {
  kind: "field";
  definitionId: number;
}
export interface LayoutTextItem {
  kind: "heading" | "help";
  text: string;
}
export type LayoutItem = LayoutFieldItem | LayoutTextItem;

export interface LayoutSection {
  key: string;
  heading: string;
  helpText?: string | null;
  items: LayoutItem[];
}

export interface FormLayout {
  sections: LayoutSection[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates a layout AND proves every referenced field is real, active, owned
 * by this organization and bound to this form's scope.
 */
export async function validateLayout(organizationId: number, scope: string, raw: unknown): Promise<FormLayout> {
  if (!isPlainObject(raw)) throw new CustomFieldValidationError("Layout must be an object");
  const sections = raw.sections;
  if (!Array.isArray(sections) || sections.length === 0) throw new CustomFieldValidationError("A form needs at least one section");
  if (sections.length > MAX_SECTIONS) throw new CustomFieldValidationError(`A form may not have more than ${MAX_SECTIONS} sections`);

  const referencedIds: number[] = [];
  const sectionKeys = new Set<string>();
  const parsedSections: LayoutSection[] = sections.map((s, index) => {
    if (!isPlainObject(s)) throw new CustomFieldValidationError("Each section must be an object");
    const key = typeof s.key === "string" && s.key.trim() ? s.key.trim() : `section_${index + 1}`;
    if (sectionKeys.has(key)) throw new CustomFieldValidationError(`Duplicate section key "${key}"`);
    sectionKeys.add(key);
    const heading = typeof s.heading === "string" ? s.heading.trim() : "";
    if (!heading) throw new CustomFieldValidationError("Each section needs a heading");

    const items = s.items;
    if (!Array.isArray(items)) throw new CustomFieldValidationError("Each section needs an items list");
    if (items.length > MAX_ITEMS_PER_SECTION) {
      throw new CustomFieldValidationError(`A section may not have more than ${MAX_ITEMS_PER_SECTION} items`);
    }

    const parsedItems: LayoutItem[] = items.map((item) => {
      if (!isPlainObject(item)) throw new CustomFieldValidationError("Each layout item must be an object");
      if (item.kind === "field") {
        const definitionId = Number(item.definitionId);
        if (!Number.isInteger(definitionId) || definitionId <= 0) {
          throw new CustomFieldValidationError("A field item must reference a custom field");
        }
        referencedIds.push(definitionId);
        return { kind: "field", definitionId };
      }
      if (item.kind === "heading" || item.kind === "help") {
        const text = typeof item.text === "string" ? item.text.trim() : "";
        if (!text) throw new CustomFieldValidationError("Heading and help items need text");
        if (text.length > 2000) throw new CustomFieldValidationError("Layout text is too long");
        return { kind: item.kind, text };
      }
      throw new CustomFieldValidationError(`"${String(item.kind)}" is not a supported layout item`);
    });

    return { key, heading, helpText: typeof s.helpText === "string" ? s.helpText.trim() || null : null, items: parsedItems };
  });

  const unique = [...new Set(referencedIds)];
  if (unique.length !== referencedIds.length) throw new CustomFieldValidationError("A field may only appear once in a form");

  const resolved = await getCustomFieldsByIds(organizationId, unique);
  const byId = new Map(resolved.map((f) => [f.definition.id, f]));
  for (const id of unique) {
    const field = byId.get(id);
    // Identical error for "not yours" and "does not exist" — the composer
    // learns nothing about other organizations' field ids.
    if (!field) throw new CustomFieldValidationError(`Custom field ${id} is not available to this organization`);
    if (field.definition.scope !== scope) {
      throw new CustomFieldValidationError(`"${field.version.label}" belongs to a different record type and cannot be used on this form`);
    }
    if (field.definition.status === "archived") {
      throw new CustomFieldValidationError(`"${field.version.label}" is archived and cannot be added to a form`);
    }
  }

  return { sections: parsedSections };
}

export async function createForm(params: {
  organizationId: number;
  formKey: string;
  formType: string;
  scope: string;
  title: string;
  description?: string | null;
  layout: unknown;
  actorMembershipId: number | null;
}): Promise<{ form: CustomForm; version: CustomFormVersion }> {
  const scopeSpec = requireScopeSpec(params.scope);
  const formKey = params.formKey.trim().toLowerCase();
  if (!FORM_KEY_RE.test(formKey)) {
    throw new CustomFieldValidationError("Form key must start with a letter and contain only lowercase letters, numbers and underscores");
  }
  const title = params.title?.trim();
  if (!title) throw new CustomFieldValidationError("Title is required");

  const layout = await validateLayout(params.organizationId, scopeSpec.scope, params.layout);

  try {
    return await db.transaction(async (tx) => {
      const [form] = await tx
        .insert(customFormsTable)
        .values({
          organizationId: params.organizationId,
          formKey,
          formType: params.formType as CustomForm["formType"],
          scope: scopeSpec.scope,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      const [version] = await tx
        .insert(customFormVersionsTable)
        .values({
          organizationId: params.organizationId,
          formId: form.id,
          versionNumber: 1,
          title,
          description: params.description?.trim() || null,
          layout,
          status: "draft",
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      return { form, version };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateCustomFormKeyError(formKey);
    throw err;
  }
}

export async function getForm(organizationId: number, formId: number): Promise<CustomForm> {
  const [form] = await db
    .select()
    .from(customFormsTable)
    .where(and(eq(customFormsTable.id, formId), eq(customFormsTable.organizationId, organizationId)))
    .limit(1);
  if (!form) throw new CustomFormNotFoundError();
  return form;
}

export async function listForms(organizationId: number): Promise<CustomForm[]> {
  return db
    .select()
    .from(customFormsTable)
    .where(eq(customFormsTable.organizationId, organizationId))
    .orderBy(asc(customFormsTable.id));
}

export async function listFormVersions(organizationId: number, formId: number): Promise<CustomFormVersion[]> {
  await getForm(organizationId, formId);
  return db
    .select()
    .from(customFormVersionsTable)
    .where(eq(customFormVersionsTable.formId, formId))
    .orderBy(desc(customFormVersionsTable.versionNumber));
}

export async function getFormVersion(organizationId: number, formVersionId: number): Promise<CustomFormVersion> {
  const [version] = await db
    .select()
    .from(customFormVersionsTable)
    .where(and(eq(customFormVersionsTable.id, formVersionId), eq(customFormVersionsTable.organizationId, organizationId)))
    .limit(1);
  if (!version) throw new CustomFormNotFoundError();
  return version;
}

export async function getPublishedVersion(organizationId: number, formId: number): Promise<CustomFormVersion | null> {
  const [version] = await db
    .select()
    .from(customFormVersionsTable)
    .where(
      and(
        eq(customFormVersionsTable.organizationId, organizationId),
        eq(customFormVersionsTable.formId, formId),
        eq(customFormVersionsTable.status, "published"),
      ),
    )
    .limit(1);
  return version ?? null;
}

/** Creates the next DRAFT version. A published version is never edited in place (§24.22). */
export async function createFormVersion(params: {
  organizationId: number;
  formId: number;
  title: string;
  description?: string | null;
  layout: unknown;
  actorMembershipId: number | null;
}): Promise<CustomFormVersion> {
  const form = await getForm(params.organizationId, params.formId);
  if (form.status === "archived") throw new CustomFormStateError("This form is archived");
  const title = params.title?.trim();
  if (!title) throw new CustomFieldValidationError("Title is required");

  const layout = await validateLayout(params.organizationId, form.scope, params.layout);

  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`COALESCE(MAX(${customFormVersionsTable.versionNumber}), 0)::int` })
    .from(customFormVersionsTable)
    .where(eq(customFormVersionsTable.formId, params.formId));

  const [version] = await db
    .insert(customFormVersionsTable)
    .values({
      organizationId: params.organizationId,
      formId: params.formId,
      versionNumber: maxVersion + 1,
      title,
      description: params.description?.trim() || null,
      layout,
      status: "draft",
      createdByMembershipId: params.actorMembershipId,
    })
    .returning();
  return version;
}

/** Publishes a draft, retiring whichever version was published before it. */
export async function publishFormVersion(params: {
  organizationId: number;
  formId: number;
  formVersionId: number;
}): Promise<CustomFormVersion> {
  const form = await getForm(params.organizationId, params.formId);
  if (form.status === "archived") throw new CustomFormStateError("This form is archived");
  const target = await getFormVersion(params.organizationId, params.formVersionId);
  if (target.formId !== params.formId) throw new CustomFormNotFoundError();
  if (target.status === "published") return target;
  if (target.status === "archived") throw new CustomFormStateError("An archived version cannot be published");

  return db.transaction(async (tx) => {
    // Retire the incumbent first so the partial unique index holds throughout.
    await tx
      .update(customFormVersionsTable)
      .set({ status: "archived" })
      .where(and(eq(customFormVersionsTable.formId, params.formId), eq(customFormVersionsTable.status, "published")));

    const [published] = await tx
      .update(customFormVersionsTable)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(customFormVersionsTable.id, params.formVersionId))
      .returning();
    return published;
  });
}

export async function setFormArchived(params: { organizationId: number; formId: number; archived: boolean }): Promise<CustomForm> {
  await getForm(params.organizationId, params.formId);
  const [updated] = await db
    .update(customFormsTable)
    .set({ status: params.archived ? "archived" : "active", archivedAt: params.archived ? new Date() : null })
    .where(eq(customFormsTable.id, params.formId))
    .returning();
  return updated;
}

/** One frozen answer inside a submission. */
export interface SubmissionAnswer {
  definitionId: number;
  definitionVersionId: number;
  fieldKey: string;
  label: string;
  fieldType: string;
  value: unknown;
}

export interface SubmitFormParams {
  organizationId: number;
  formId: number;
  /** The version the client rendered. Must match what is currently published (§24.24 — forged versions are rejected). */
  formVersionId: number;
  entityId: number | null;
  answers: Record<number, unknown>;
  submittedByMembershipId: number | null;
}

/**
 * Validates and stores a submission. Everything is re-derived server-side: the
 * published version, the field membership of that version, each field's type
 * and validation, and each field's visibility.
 */
export async function submitForm(params: SubmitFormParams): Promise<CustomFormSubmission> {
  const form = await getForm(params.organizationId, params.formId);
  if (form.status === "archived") throw new CustomFormStateError("This form is archived and no longer accepts submissions");

  const published = await getPublishedVersion(params.organizationId, params.formId);
  if (!published) throw new CustomFormStateError("This form has no published version");
  if (published.id !== params.formVersionId) {
    // Refusing rather than silently accepting means a stale or forged client
    // never writes against a layout the server did not authorize.
    throw new CustomFormStateError("This form has changed since it was opened — reload and try again");
  }

  const scopeSpec = requireScopeSpec(form.scope);
  if (params.entityId != null) {
    await assertEntityInOrganization(form.scope, params.entityId, params.organizationId);
  } else if (scopeSpec.bindable) {
    throw new CustomFieldValidationError("A target record is required for this form");
  }

  const layout = published.layout as FormLayout;
  const memberIds = layout.sections.flatMap((s) => s.items.filter((i): i is LayoutFieldItem => i.kind === "field").map((i) => i.definitionId));
  const memberSet = new Set(memberIds);

  for (const rawId of Object.keys(params.answers)) {
    if (!memberSet.has(Number(rawId))) {
      throw new CustomFieldValidationError(`Field ${rawId} is not part of this form`);
    }
  }

  const fields = await getCustomFieldsByIds(params.organizationId, memberIds);
  const byId = new Map(fields.map((f) => [f.definition.id, f]));

  // Coerce everything first so a later failure leaves nothing written.
  const prepared: { field: CustomFieldWithVersion; typed: TypedValue | null }[] = [];
  for (const definitionId of memberIds) {
    const field = byId.get(definitionId);
    if (!field) throw new CustomFieldValidationError(`Custom field ${definitionId} is no longer available`);
    const raw = Object.prototype.hasOwnProperty.call(params.answers, definitionId) ? params.answers[definitionId] : null;
    prepared.push({ field, typed: coerceAndValidateValueForSubmission(field, raw) });
  }

  const projected = new Map<string, unknown>();
  for (const p of prepared) projected.set(p.field.definition.fieldKey, p.typed);

  for (const p of prepared) {
    const visible = isFieldVisible(parsedVisibility(p.field.version), projected);
    if (!visible && p.typed != null) throw new HiddenCustomFieldWriteError(p.field.version.label);
    // Required only bites when the field is actually applicable.
    if (visible && p.field.version.required && p.typed == null) {
      throw new CustomFieldValidationError(`${p.field.version.label} is required`, p.field.version.label);
    }
    if (p.typed?.type === "employee_reference") {
      await assertEmployeeReferenceValid(Number(p.typed.value), params.organizationId);
    }
  }

  const answers: SubmissionAnswer[] = prepared
    .filter((p) => isFieldVisible(parsedVisibility(p.field.version), projected))
    .map((p) => ({
      definitionId: p.field.definition.id,
      definitionVersionId: p.field.version.id,
      fieldKey: p.field.definition.fieldKey,
      // Label and type are snapshotted so a historical submission renders as
      // submitted, not as the definition looks today (§24.22).
      label: p.field.version.label,
      fieldType: p.field.version.fieldType,
      value: p.typed,
    }));

  const [submission] = await db
    .insert(customFormSubmissionsTable)
    .values({
      organizationId: params.organizationId,
      formId: params.formId,
      formVersionId: published.id,
      scope: form.scope,
      entityId: params.entityId,
      answers,
      submittedByMembershipId: params.submittedByMembershipId,
    })
    .returning();
  return submission;
}

function coerceAndValidateValueForSubmission(field: CustomFieldWithVersion, raw: unknown): TypedValue | null {
  return coerceAndValidateValue({
    fieldType: field.version.fieldType,
    label: field.version.label,
    // Required is enforced after visibility is known, not here.
    required: false,
    validation: parsedValidation(field.version),
    options: parsedOptions(field.version),
    raw,
  });
}

export async function listSubmissions(params: {
  organizationId: number;
  formId?: number;
  scope?: string;
  entityId?: number;
  limit?: number;
}): Promise<CustomFormSubmission[]> {
  const conditions = [eq(customFormSubmissionsTable.organizationId, params.organizationId)];
  if (params.formId != null) conditions.push(eq(customFormSubmissionsTable.formId, params.formId));
  if (params.scope) conditions.push(eq(customFormSubmissionsTable.scope, params.scope as CustomFormSubmission["scope"]));
  if (params.entityId != null) conditions.push(eq(customFormSubmissionsTable.entityId, params.entityId));

  return db
    .select()
    .from(customFormSubmissionsTable)
    .where(and(...conditions))
    .orderBy(desc(customFormSubmissionsTable.submittedAt))
    .limit(params.limit ?? 200);
}

export async function getSubmission(organizationId: number, submissionId: number): Promise<CustomFormSubmission> {
  const [row] = await db
    .select()
    .from(customFormSubmissionsTable)
    .where(and(eq(customFormSubmissionsTable.id, submissionId), eq(customFormSubmissionsTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new CustomFormNotFoundError();
  return row;
}
