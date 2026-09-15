/**
 * WS-8 — Custom Fields & Form Builder routes (§24.24, §24.25, §24.26).
 *
 * Explicit endpoints only. There is deliberately no
 * `POST /custom-data/{table}` and no endpoint that accepts a schema or table
 * name: a caller names a SCOPE, which must be a member of the server-side
 * allow-list, and every entity id is re-verified against the caller's own
 * organization before anything is read or written.
 *
 * Two permission planes, per §24.25:
 *   - CONFIGURATION (defining fields and forms) → the custom_fields and
 *     custom_forms permission keys.
 *   - VALUES (data on a record) → the target domain's own permission, resolved
 *     from the scope registry. That is what keeps this from becoming a second,
 *     parallel authorization model over employee data.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { recordAuditEvent } from "../lib/auditLog";
import { toCsv } from "../lib/reporting";
// Reuses W33's established self-scope resolution (employee_user_links) rather
// than a second, parallel notion of "the caller's own employee record".
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { FIELD_TYPES, CustomFieldValidationError } from "../lib/customFields/fieldTypes";
import { SCOPES, requireScopeSpec, UnknownCustomFieldScopeError, CustomFieldEntityNotFoundError, ScopeNotYetBindableError } from "../lib/customFields/scopes";
import { VISIBILITY_OPERATORS } from "../lib/customFields/visibility";
import {
  createCustomField,
  createCustomFieldVersion,
  getCustomField,
  listCustomFields,
  listCustomFieldVersions,
  listUsedChoiceValues,
  setCustomFieldArchived,
  BreakingCustomFieldChangeError,
  CustomFieldArchivedError,
  CustomFieldNotFoundError,
  DuplicateCustomFieldKeyError,
} from "../lib/customFields/definitions";
import {
  buildCustomFieldReport,
  getSingleValue,
  getValuesForEntity,
  setValuesForEntity,
  HiddenCustomFieldWriteError,
} from "../lib/customFields/values";
import {
  createForm,
  createFormVersion,
  getForm,
  getFormVersion,
  getPublishedVersion,
  getSubmission,
  listForms,
  listFormVersions,
  listSubmissions,
  publishFormVersion,
  setFormArchived,
  submitForm,
  CustomFormNotFoundError,
  CustomFormStateError,
  DuplicateCustomFormKeyError,
} from "../lib/customFields/forms";

const router = Router();

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof CustomFieldNotFoundError || err instanceof CustomFormNotFoundError || err instanceof CustomFieldEntityNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (
    err instanceof CustomFieldValidationError ||
    err instanceof UnknownCustomFieldScopeError ||
    err instanceof ScopeNotYetBindableError ||
    err instanceof CustomFormStateError ||
    err instanceof CustomFieldArchivedError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof HiddenCustomFieldWriteError) {
    // 422: well-formed and authorized, but not applicable to this record.
    res.status(422).json({ error: err.message });
    return true;
  }
  if (err instanceof DuplicateCustomFieldKeyError || err instanceof DuplicateCustomFormKeyError || err instanceof BreakingCustomFieldChangeError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

/** Resolves the domain permission a value operation needs, from the scope registry. */
async function assertScopePermission(req: MembershipRequest, scope: string, mode: "read" | "write"): Promise<boolean> {
  const spec = requireScopeSpec(scope);
  const key = mode === "read" ? spec.readPermission : spec.writePermission;
  return hasPermission(req.membership!.id, key);
}

// --- registry metadata -------------------------------------------------------

// GET /organizations/:organizationId/custom-fields/meta
router.get(
  "/organizations/:organizationId/custom-fields/meta",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.read"),
  async (_req: MembershipRequest, res): Promise<void> => {
    res.json({
      fieldTypes: FIELD_TYPES.map((f) => ({ type: f.type, label: f.label, usesOptions: f.usesOptions, usesReference: f.usesReference })),
      scopes: SCOPES.map((s) => ({ scope: s.scope, label: s.label, bindable: s.bindable })),
      visibilityOperators: [...VISIBILITY_OPERATORS],
    });
  },
);

// --- definitions -------------------------------------------------------------

// GET /organizations/:organizationId/custom-fields?scope=employee
router.get(
  "/organizations/:organizationId/custom-fields",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const scope = String(req.query.scope ?? "");
      requireScopeSpec(scope);
      const includeArchived = req.query.includeArchived === "true";
      res.json({ fields: await listCustomFields(req.membership!.organizationId, scope, { includeArchived }) });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-fields
router.post(
  "/organizations/:organizationId/custom-fields",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const created = await createCustomField({
        organizationId: req.membership!.organizationId,
        scope: String(req.body?.scope ?? ""),
        fieldKey: String(req.body?.fieldKey ?? ""),
        label: String(req.body?.label ?? ""),
        helpText: req.body?.helpText ?? null,
        fieldType: String(req.body?.fieldType ?? ""),
        required: !!req.body?.required,
        sensitivity: req.body?.sensitivity === "sensitive" ? "sensitive" : "normal",
        displayOrder: Number(req.body?.displayOrder ?? 0),
        validation: req.body?.validation ?? null,
        options: req.body?.options ?? null,
        visibility: req.body?.visibility ?? null,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_field.created",
        targetType: "custom_field_definition",
        targetId: String(created.definition.id),
        afterState: {
          scope: created.definition.scope,
          fieldKey: created.definition.fieldKey,
          fieldType: created.version.fieldType,
          sensitivity: created.version.sensitivity,
        },
      });

      res.status(201).json(created);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/custom-fields/:definitionId
router.get(
  "/organizations/:organizationId/custom-fields/:definitionId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const definitionId = Number(req.params.definitionId);
      const field = await getCustomField(organizationId, definitionId);
      res.json({
        ...field,
        versions: await listCustomFieldVersions(organizationId, definitionId),
        usedChoiceValues: await listUsedChoiceValues(definitionId),
      });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-fields/:definitionId/versions
router.post(
  "/organizations/:organizationId/custom-fields/:definitionId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const created = await createCustomFieldVersion({
        organizationId: req.membership!.organizationId,
        definitionId: Number(req.params.definitionId),
        label: String(req.body?.label ?? ""),
        helpText: req.body?.helpText ?? null,
        fieldType: String(req.body?.fieldType ?? ""),
        required: !!req.body?.required,
        sensitivity: req.body?.sensitivity === "sensitive" ? "sensitive" : "normal",
        displayOrder: Number(req.body?.displayOrder ?? 0),
        validation: req.body?.validation ?? null,
        options: req.body?.options ?? null,
        visibility: req.body?.visibility ?? null,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_field.version_created",
        targetType: "custom_field_definition",
        targetId: String(created.definition.id),
        afterState: { versionNumber: created.version.versionNumber, fieldType: created.version.fieldType, required: created.version.required },
      });

      res.status(201).json(created);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-fields/:definitionId/archive
router.post(
  "/organizations/:organizationId/custom-fields/:definitionId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const archived = req.body?.archived !== false;
      const updated = await setCustomFieldArchived({
        organizationId: req.membership!.organizationId,
        definitionId: Number(req.params.definitionId),
        archived,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: archived ? "custom_field.archived" : "custom_field.restored",
        targetType: "custom_field_definition",
        targetId: String(updated.id),
        afterState: { status: updated.status },
      });

      res.json(updated);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// --- values ------------------------------------------------------------------

// GET /organizations/:organizationId/custom-field-values/:scope/:entityId
router.get(
  "/organizations/:organizationId/custom-field-values/:scope/:entityId",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const scope = String(req.params.scope);
      const entityId = Number(req.params.entityId);
      requireScopeSpec(scope);

      if (!(await assertScopePermission(req, scope, "read"))) {
        res.status(403).json({ error: "You do not have permission to read this record" });
        return;
      }
      const { assertEntityInOrganization, assertRecruitmentEntityVisible } = await import("../lib/customFields/scopes");
      await assertEntityInOrganization(scope, entityId, organizationId);
      await assertRecruitmentEntityVisible(scope, entityId, { organizationId, membershipId: req.membership!.id, applicationUserId: req.userId! });

      // Revealing a sensitive custom value is a distinct, separately-granted
      // act — and a separately audited one (§24.14/§24.25), mirroring the
      // payroll banking reveal pattern.
      const wantsReveal = req.query.reveal === "true";
      const mayReveal = wantsReveal && (await hasPermission(req.membership!.id, "custom_fields.sensitive.read"));
      const values = await getValuesForEntity(organizationId, scope, entityId, { revealSensitive: mayReveal });

      if (mayReveal && values.some((v) => v.sensitivity === "sensitive" && v.value != null)) {
        await recordAuditEvent({
          organizationId,
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
          eventType: "custom_field_value.revealed",
          targetType: scope,
          targetId: String(entityId),
          afterState: { fieldKeys: values.filter((v) => v.sensitivity === "sensitive" && v.value != null).map((v) => v.fieldKey) },
        });
      }

      res.json({ scope, entityId, values, revealed: mayReveal });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// PUT /organizations/:organizationId/custom-field-values/:scope/:entityId
router.put(
  "/organizations/:organizationId/custom-field-values/:scope/:entityId",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const scope = String(req.params.scope);
      const entityId = Number(req.params.entityId);
      requireScopeSpec(scope);

      if (!(await assertScopePermission(req, scope, "write"))) {
        res.status(403).json({ error: "You do not have permission to update this record" });
        return;
      }

      const raw = req.body?.values;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        res.status(400).json({ error: "A values object is required" });
        return;
      }

      const result = await setValuesForEntity({
        organizationId,
        scope,
        entityId,
        values: raw as Record<number, unknown>,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_field_value.updated",
        targetType: scope,
        targetId: String(entityId),
        // Field keys and counts only — never the values themselves, which may
        // be sensitive and must not land in the audit table (§24.14).
        afterState: { definitionIds: Object.keys(raw).map(Number), written: result.written, cleared: result.cleared },
      });

      res.json({ ...result, values: await getValuesForEntity(organizationId, scope, entityId) });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/custom-field-values/:scope/:entityId/:definitionId/reveal
router.get(
  "/organizations/:organizationId/custom-field-values/:scope/:entityId/:definitionId/reveal",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.sensitive.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const scope = String(req.params.scope);
      const entityId = Number(req.params.entityId);
      const definitionId = Number(req.params.definitionId);
      requireScopeSpec(scope);

      if (!(await assertScopePermission(req, scope, "read"))) {
        res.status(403).json({ error: "You do not have permission to read this record" });
        return;
      }
      const { assertEntityInOrganization, assertRecruitmentEntityVisible } = await import("../lib/customFields/scopes");
      await assertEntityInOrganization(scope, entityId, organizationId);
      await assertRecruitmentEntityVisible(scope, entityId, { organizationId, membershipId: req.membership!.id, applicationUserId: req.userId! });

      const { field, stored } = await getSingleValue(organizationId, definitionId, scope, entityId);
      if (field.definition.scope !== scope) {
        res.status(404).json({ error: "Custom field not found" });
        return;
      }

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_field_value.revealed",
        targetType: scope,
        targetId: String(entityId),
        afterState: { fieldKey: field.definition.fieldKey },
      });

      res.json({ definitionId, fieldKey: field.definition.fieldKey, label: field.version.label, value: stored?.value ?? null });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/custom-field-values/:scope/export.csv?entityIds=1,2,3
router.get(
  "/organizations/:organizationId/custom-fields/:scope/export.csv",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_fields.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const scope = String(req.params.scope);
      requireScopeSpec(scope);

      if (!(await assertScopePermission(req, scope, "read"))) {
        res.status(403).json({ error: "You do not have permission to read these records" });
        return;
      }

      const entityIds = String(req.query.entityIds ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 5000);
      if (entityIds.length === 0) {
        res.status(400).json({ error: "entityIds is required" });
        return;
      }

      // Sensitive columns are omitted entirely unless authorized — never
      // masked-but-present, which would look authoritative in a spreadsheet.
      const includeSensitive = await hasPermission(req.membership!.id, "custom_fields.sensitive.read");
      const { columns, rowsByEntity } = await buildCustomFieldReport({ organizationId, scope, entityIds, includeSensitive });

      const allColumns = [{ key: "entityId", label: "Record ID" }, ...columns];
      const rows = entityIds.map((id) => ({ entityId: id, ...(rowsByEntity.get(id) ?? {}) }));

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_field_value.exported",
        targetType: scope,
        targetId: String(organizationId),
        afterState: { recordCount: entityIds.length, includeSensitive, columns: columns.length },
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="custom-fields-${scope}.csv"`);
      // Reuses WS-1's formula-injection hardening.
      res.send(`${toCsv(allColumns, rows)}\n`);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// --- forms -------------------------------------------------------------------

// GET /organizations/:organizationId/custom-forms
router.get(
  "/organizations/:organizationId/custom-forms",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ forms: await listForms(req.membership!.organizationId) });
  },
);

// POST /organizations/:organizationId/custom-forms
router.post(
  "/organizations/:organizationId/custom-forms",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const created = await createForm({
        organizationId: req.membership!.organizationId,
        formKey: String(req.body?.formKey ?? ""),
        formType: String(req.body?.formType ?? ""),
        scope: String(req.body?.scope ?? ""),
        title: String(req.body?.title ?? ""),
        description: req.body?.description ?? null,
        layout: req.body?.layout ?? null,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_form.created",
        targetType: "custom_form",
        targetId: String(created.form.id),
        afterState: { formKey: created.form.formKey, formType: created.form.formType, scope: created.form.scope },
      });

      res.status(201).json(created);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/custom-forms/:formId
router.get(
  "/organizations/:organizationId/custom-forms/:formId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const formId = Number(req.params.formId);
      const form = await getForm(organizationId, formId);
      res.json({
        form,
        versions: await listFormVersions(organizationId, formId),
        publishedVersion: await getPublishedVersion(organizationId, formId),
      });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-forms/:formId/versions
router.post(
  "/organizations/:organizationId/custom-forms/:formId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const version = await createFormVersion({
        organizationId: req.membership!.organizationId,
        formId: Number(req.params.formId),
        title: String(req.body?.title ?? ""),
        description: req.body?.description ?? null,
        layout: req.body?.layout ?? null,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_form.version_created",
        targetType: "custom_form",
        targetId: String(version.formId),
        afterState: { versionNumber: version.versionNumber },
      });

      res.status(201).json(version);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-forms/:formId/versions/:versionId/publish
router.post(
  "/organizations/:organizationId/custom-forms/:formId/versions/:versionId/publish",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const published = await publishFormVersion({
        organizationId: req.membership!.organizationId,
        formId: Number(req.params.formId),
        formVersionId: Number(req.params.versionId),
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_form.version_published",
        targetType: "custom_form",
        targetId: String(published.formId),
        afterState: { versionNumber: published.versionNumber },
      });

      res.json(published);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-forms/:formId/archive
router.post(
  "/organizations/:organizationId/custom-forms/:formId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const archived = req.body?.archived !== false;
      const updated = await setFormArchived({
        organizationId: req.membership!.organizationId,
        formId: Number(req.params.formId),
        archived,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: archived ? "custom_form.archived" : "custom_form.restored",
        targetType: "custom_form",
        targetId: String(updated.id),
        afterState: { status: updated.status },
      });

      res.json(updated);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

/**
 * The renderable form: the PUBLISHED version plus the field definitions it
 * references, resolved server-side. A client never composes this itself.
 */
// GET /organizations/:organizationId/custom-forms/:formId/render
router.get(
  "/organizations/:organizationId/custom-forms/:formId/render",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const formId = Number(req.params.formId);
      const form = await getForm(organizationId, formId);
      const published = await getPublishedVersion(organizationId, formId);
      if (!published) {
        res.status(404).json({ error: "This form has no published version" });
        return;
      }
      if (!(await assertScopePermission(req, form.scope, "read"))) {
        res.status(403).json({ error: "You do not have permission to use this form" });
        return;
      }
      const fields = await listCustomFields(organizationId, form.scope, { includeArchived: true });
      res.json({ form, version: published, fields });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/custom-forms/:formId/submissions
router.post(
  "/organizations/:organizationId/custom-forms/:formId/submissions",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const formId = Number(req.params.formId);
      const form = await getForm(organizationId, formId);

      let entityId: number | null = req.body?.entityId != null ? Number(req.body.entityId) : null;

      if (form.formType === "employee_ess") {
        // §24.23 — an ESS submission is always for the caller's OWN employee
        // identity, resolved server-side. The client-supplied entityId is
        // deliberately ignored rather than validated, so there is nothing to
        // manipulate.
        const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
        if (!ownEmployeeId) {
          res.status(403).json({ error: "Your user account is not linked to an employee record" });
          return;
        }
        entityId = ownEmployeeId;
      } else if (!(await assertScopePermission(req, form.scope, "write"))) {
        res.status(403).json({ error: "You do not have permission to submit this form" });
        return;
      }

      const answers = req.body?.answers;
      if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
        res.status(400).json({ error: "An answers object is required" });
        return;
      }

      const submission = await submitForm({
        organizationId,
        formId,
        formVersionId: Number(req.body?.formVersionId),
        entityId,
        answers: answers as Record<number, unknown>,
        submittedByMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "custom_form_submission.created",
        targetType: "custom_form_submission",
        targetId: String(submission.id),
        afterState: { formId, formVersionId: submission.formVersionId, scope: submission.scope, entityId: submission.entityId },
      });

      res.status(201).json(submission);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/custom-form-submissions
router.get(
  "/organizations/:organizationId/custom-form-submissions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const formId = req.query.formId != null && req.query.formId !== "" ? Number(req.query.formId) : undefined;
      const entityId = req.query.entityId != null && req.query.entityId !== "" ? Number(req.query.entityId) : undefined;
      const scope = req.query.scope ? String(req.query.scope) : undefined;
      if (scope) requireScopeSpec(scope);
      res.json({
        submissions: await listSubmissions({ organizationId: req.membership!.organizationId, formId, scope, entityId }),
      });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/custom-form-submissions/:submissionId
router.get(
  "/organizations/:organizationId/custom-form-submissions/:submissionId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("custom_forms.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const submission = await getSubmission(organizationId, Number(req.params.submissionId));
      // Renders from the captured version, never today's definitions (§24.22).
      const version = await getFormVersion(organizationId, submission.formVersionId);
      res.json({ submission, version });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

export default router;
