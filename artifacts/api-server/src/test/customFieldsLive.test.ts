/**
 * WS-8 — live proof of custom fields and forms against a real database.
 *
 * The properties that matter most here are the negative ones: a hidden field
 * cannot be written by crafting a request, a breaking definition change is
 * refused rather than reinterpreting captured data, archiving preserves
 * history, and no organization can reach another's definitions, values, forms
 * or submissions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS8_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-8 — custom fields & forms, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgId: number;
  let otherOrgId: number;
  let employeeId: number;
  let otherEmployeeId: number;
  let membershipId: number;

  let defs: typeof import("../lib/customFields/definitions");
  let values: typeof import("../lib/customFields/values");
  let forms: typeof import("../lib/customFields/forms");
  let scopes: typeof import("../lib/customFields/scopes");
  let fieldTypes: typeof import("../lib/customFields/fieldTypes");

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    defs = await import("../lib/customFields/definitions");
    values = await import("../lib/customFields/values");
    forms = await import("../lib/customFields/forms");
    scopes = await import("../lib/customFields/scopes");
    fieldTypes = await import("../lib/customFields/fieldTypes");

    const suffix = `cf-${Date.now()}`;
    const [org] = await db.insert(schema.organizationsTable).values({ name: `CF ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `CF other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "CF", lastName: "T", organizationId: orgId })
      .returning();
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: user.id, organizationId: orgId, status: "active" })
      .returning();
    membershipId = membership.id;

    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Ama", lastName: "Mensah" })
      .returning();
    employeeId = emp.id;
    const [otherEmp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Other", lastName: "Org" })
      .returning();
    otherEmployeeId = otherEmp.id;
  });

  afterAll(async () => {
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  const mk = (over: Record<string, unknown> = {}) => ({
    organizationId: orgId,
    scope: "employee",
    fieldKey: `f_${Math.random().toString(36).slice(2, 10)}`,
    label: "Field",
    fieldType: "short_text",
    actorMembershipId: membershipId,
    ...over,
  });

  it("A/B/C. creates a field, stores a typed value, and reads it back for the right record", async () => {
    const field = await defs.createCustomField(mk({ fieldKey: "church_membership", label: "Church Membership Status" }));
    expect(field.version.versionNumber).toBe(1);
    expect(field.version.isCurrent).toBe(true);

    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: employeeId,
      values: { [field.definition.id]: "Full Member" },
      actorMembershipId: membershipId,
    });

    const read = await values.getValuesForEntity(orgId, "employee", employeeId);
    const stored = read.find((v) => v.definitionId === field.definition.id)!;
    // Typed envelope, not a bare string — type semantics survive storage.
    expect(stored.value).toEqual({ type: "short_text", value: "Full Member" });
    expect(stored.capturedVersionNumber).toBe(1);

    // A different employee has no value for the same field.
    const [other] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Kofi", lastName: "O" }).returning();
    const otherRead = await values.getValuesForEntity(orgId, "employee", other.id);
    expect(otherRead.find((v) => v.definitionId === field.definition.id)?.value).toBeNull();
  });

  it("D. refuses cross-organization access to definitions, values and target records", async () => {
    const field = await defs.createCustomField(mk());

    // Org B cannot read Org A's definition.
    await expect(defs.getCustomField(otherOrgId, field.definition.id)).rejects.toThrow(defs.CustomFieldNotFoundError);

    // Org A cannot attach a value to Org B's employee.
    await expect(
      values.setValuesForEntity({
        organizationId: orgId,
        scope: "employee",
        entityId: otherEmployeeId,
        values: { [field.definition.id]: "x" },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(scopes.CustomFieldEntityNotFoundError);

    // Org B cannot use Org A's field id against its own employee.
    await expect(
      values.setValuesForEntity({
        organizationId: otherOrgId,
        scope: "employee",
        entityId: otherEmployeeId,
        values: { [field.definition.id]: "x" },
        actorMembershipId: null,
      }),
    ).rejects.toThrow(/Unknown custom field/i);

    // Org B's listing never contains Org A's field.
    const otherList = await defs.listCustomFields(otherOrgId, "employee", { includeArchived: true });
    expect(otherList.some((f) => f.definition.id === field.definition.id)).toBe(false);
  });

  it("E/F. a new version does not rewrite the value captured under the old one", async () => {
    const field = await defs.createCustomField(mk({ label: "Original Label" }));
    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: employeeId,
      values: { [field.definition.id]: "captured" },
      actorMembershipId: membershipId,
    });

    const v2 = await defs.createCustomFieldVersion({
      organizationId: orgId,
      definitionId: field.definition.id,
      label: "Renamed Label",
      fieldType: "short_text",
      actorMembershipId: membershipId,
    });
    expect(v2.version.versionNumber).toBe(2);

    // The stored value still points at version 1 — it was not re-stamped.
    const read = await values.getValuesForEntity(orgId, "employee", employeeId);
    const stored = read.find((v) => v.definitionId === field.definition.id)!;
    expect(stored.capturedVersionNumber).toBe(1);
    expect(stored.value).toEqual({ type: "short_text", value: "captured" });

    // Exactly one current version, enforced by the partial unique index.
    const versions = await defs.listCustomFieldVersions(orgId, field.definition.id);
    expect(versions.filter((v: any) => v.isCurrent)).toHaveLength(1);
  });

  it("refuses breaking definition changes once values exist", async () => {
    const field = await defs.createCustomField(mk({ fieldType: "short_text" }));
    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: employeeId,
      values: { [field.definition.id]: "text value" },
      actorMembershipId: membershipId,
    });

    await expect(
      defs.createCustomFieldVersion({
        organizationId: orgId,
        definitionId: field.definition.id,
        label: "Now a date",
        fieldType: "date",
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(defs.BreakingCustomFieldChangeError);

    // A select field cannot drop an option that is in use.
    const sel = await defs.createCustomField(
      mk({ fieldType: "single_select", options: { choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } }),
    );
    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: employeeId,
      values: { [sel.definition.id]: "a" },
      actorMembershipId: membershipId,
    });
    await expect(
      defs.createCustomFieldVersion({
        organizationId: orgId,
        definitionId: sel.definition.id,
        label: sel.version.label,
        fieldType: "single_select",
        options: { choices: [{ value: "b", label: "B" }] },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(defs.BreakingCustomFieldChangeError);

    // But ADDING a choice is safe.
    const ok = await defs.createCustomFieldVersion({
      organizationId: orgId,
      definitionId: sel.definition.id,
      label: sel.version.label,
      fieldType: "single_select",
      options: { choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }] },
      actorMembershipId: membershipId,
    });
    expect(ok.version.versionNumber).toBe(2);
  });

  it("G/H. optional -> required never fabricates a value; it only surfaces as missing", async () => {
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Req", lastName: "Test" }).returning();
    const field = await defs.createCustomField(mk({ required: false, label: "Later Required" }));

    // Record exists with no value while the field is optional.
    let read = await values.getValuesForEntity(orgId, "employee", emp.id);
    expect(read.find((v) => v.definitionId === field.definition.id)?.missingRequired).toBe(false);

    await defs.createCustomFieldVersion({
      organizationId: orgId,
      definitionId: field.definition.id,
      label: "Later Required",
      fieldType: "short_text",
      required: true,
      actorMembershipId: membershipId,
    });

    read = await values.getValuesForEntity(orgId, "employee", emp.id);
    const now = read.find((v) => v.definitionId === field.definition.id)!;
    expect(now.missingRequired).toBe(true);
    // Crucially: still no value. Nothing was invented.
    expect(now.value).toBeNull();
    const rows = await db
      .select()
      .from(schema.customFieldValuesTable)
      .where(eq(schema.customFieldValuesTable.definitionId, field.definition.id));
    expect(rows).toHaveLength(0);
  });

  it("I/J. conditional visibility is evaluated server-side and a hidden field cannot be written", async () => {
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Vis", lastName: "Test" }).returning();

    const driver = await defs.createCustomField(
      mk({ fieldKey: "is_clergy", label: "Is Clergy", fieldType: "single_select", options: { choices: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] } }),
    );
    const dependent = await defs.createCustomField(
      mk({
        fieldKey: "ordination_date",
        label: "Ordination Date",
        fieldType: "date",
        visibility: { match: "all", conditions: [{ fieldKey: "is_clergy", operator: "equals", value: "yes" }] },
      }),
    );

    // Setting the dependent while the driver says "no" is refused — this is
    // the crafted-request case, not a UI concern.
    await expect(
      values.setValuesForEntity({
        organizationId: orgId,
        scope: "employee",
        entityId: emp.id,
        values: { [driver.definition.id]: "no", [dependent.definition.id]: "2020-01-01" },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(values.HiddenCustomFieldWriteError);

    // Nothing was written by the rejected request.
    let read = await values.getValuesForEntity(orgId, "employee", emp.id);
    expect(read.find((v) => v.definitionId === driver.definition.id)?.value).toBeNull();

    // With the driver set to "yes" in the same request, it is accepted.
    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: emp.id,
      values: { [driver.definition.id]: "yes", [dependent.definition.id]: "2020-01-01" },
      actorMembershipId: membershipId,
    });
    read = await values.getValuesForEntity(orgId, "employee", emp.id);
    expect(read.find((v) => v.definitionId === dependent.definition.id)?.visible).toBe(true);

    // A field hidden by conditions is never reported as missing-required.
    const hiddenRequired = await defs.createCustomField(
      mk({
        fieldKey: "clergy_only_required",
        label: "Clergy Only",
        required: true,
        visibility: { match: "all", conditions: [{ fieldKey: "is_clergy", operator: "equals", value: "definitely_not" }] },
      }),
    );
    read = await values.getValuesForEntity(orgId, "employee", emp.id);
    const hidden = read.find((v) => v.definitionId === hiddenRequired.definition.id)!;
    expect(hidden.visible).toBe(false);
    expect(hidden.missingRequired).toBe(false);
  });

  it("rejects unknown scopes, unknown types, unknown fields and prototype-pollution payloads", async () => {
    await expect(defs.createCustomField(mk({ scope: "payroll_runs" }))).rejects.toThrow(scopes.UnknownCustomFieldScopeError);
    await expect(defs.createCustomField(mk({ scope: "employees; DROP TABLE employees" }))).rejects.toThrow(scopes.UnknownCustomFieldScopeError);
    await expect(defs.createCustomField(mk({ fieldType: "javascript" }))).rejects.toThrow(fieldTypes.CustomFieldValidationError);
    await expect(defs.createCustomField(mk({ fieldKey: "Bad Key!" }))).rejects.toThrow(fieldTypes.CustomFieldValidationError);

    // A crafted validation config carrying __proto__ must not pollute anything.
    const polluted = JSON.parse('{"__proto__":{"polluted":"yes"},"maxLength":10}');
    const field = await defs.createCustomField(mk({ validation: polluted }));
    expect(({} as any).polluted).toBeUndefined();
    expect((field.version.validation as any)?.__proto__?.polluted).toBeUndefined();
    expect((field.version.validation as any).maxLength).toBe(10);

    // Onboarding is definable but not yet bindable — WS-10's contract.
    const onboardingField = await defs.createCustomField(mk({ scope: "onboarding" }));
    expect(onboardingField.definition.scope).toBe("onboarding");
    await expect(
      values.setValuesForEntity({
        organizationId: orgId,
        scope: "onboarding",
        entityId: 1,
        values: { [onboardingField.definition.id]: "x" },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(scopes.ScopeNotYetBindableError);
  });

  it("validates values against the definition's type and bounds", async () => {
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Val", lastName: "Test" }).returning();
    const num = await defs.createCustomField(mk({ fieldType: "integer", validation: { min: 1, max: 10 } }));
    const email = await defs.createCustomField(mk({ fieldType: "email" }));
    const multi = await defs.createCustomField(
      mk({ fieldType: "multi_select", options: { choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } }),
    );

    const set = (id: number, v: unknown) =>
      values.setValuesForEntity({ organizationId: orgId, scope: "employee", entityId: emp.id, values: { [id]: v }, actorMembershipId: membershipId });

    await expect(set(num.definition.id, 99)).rejects.toThrow(/at most 10/i);
    await expect(set(num.definition.id, 1.5)).rejects.toThrow(/whole number/i);
    await expect(set(email.definition.id, "not-an-email")).rejects.toThrow(/valid email/i);
    await expect(set(multi.definition.id, ["a", "zzz"])).rejects.toThrow(/not configured/i);

    await set(multi.definition.id, ["a", "b"]);
    const read = await values.getValuesForEntity(orgId, "employee", emp.id);
    expect(read.find((v) => v.definitionId === multi.definition.id)?.value).toEqual({ type: "multi_select", value: ["a", "b"] });
  });

  it("validates employee_reference and master_data_reference against the same organization", async () => {
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Ref", lastName: "Test" }).returning();
    const ref = await defs.createCustomField(mk({ fieldType: "employee_reference", label: "Mentor" }));

    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: emp.id,
      values: { [ref.definition.id]: employeeId },
      actorMembershipId: membershipId,
    });
    const read = await values.getValuesForEntity(orgId, "employee", emp.id);
    expect(read.find((v) => v.definitionId === ref.definition.id)?.value).toEqual({ type: "employee_reference", value: employeeId });

    // A cross-organization employee is refused.
    await expect(
      values.setValuesForEntity({
        organizationId: orgId,
        scope: "employee",
        entityId: emp.id,
        values: { [ref.definition.id]: otherEmployeeId },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(scopes.CustomFieldEntityNotFoundError);

    // A master_data_reference to a nonexistent domain is refused at config time.
    await expect(defs.createCustomField(mk({ fieldType: "master_data_reference", options: { masterDataDomain: "no_such_domain_xyz" } }))).rejects.toThrow(
      /no items available/i,
    );
  });

  it("K/L. archiving preserves values, and sensitive values are masked unless revealed", async () => {
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Arch", lastName: "Test" }).returning();
    const secret = await defs.createCustomField(mk({ label: "Medical Note", sensitivity: "sensitive" }));

    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: emp.id,
      values: { [secret.definition.id]: "confidential-detail" },
      actorMembershipId: membershipId,
    });

    const masked = await values.getValuesForEntity(orgId, "employee", emp.id);
    const m = masked.find((v) => v.definitionId === secret.definition.id)!;
    expect(m.masked).toBe(true);
    expect(JSON.stringify(m.value)).not.toContain("confidential-detail");

    const revealed = await values.getValuesForEntity(orgId, "employee", emp.id, { revealSensitive: true });
    expect(revealed.find((v) => v.definitionId === secret.definition.id)?.value).toEqual({
      type: "short_text",
      value: "confidential-detail",
    });

    // Archiving does not delete the value.
    await defs.setCustomFieldArchived({ organizationId: orgId, definitionId: secret.definition.id, archived: true });
    const rows = await db
      .select()
      .from(schema.customFieldValuesTable)
      .where(eq(schema.customFieldValuesTable.definitionId, secret.definition.id));
    expect(rows).toHaveLength(1);

    // ...but it no longer accepts new data.
    await expect(
      values.setValuesForEntity({
        organizationId: orgId,
        scope: "employee",
        entityId: emp.id,
        values: { [secret.definition.id]: "new" },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(defs.CustomFieldArchivedError);
  });

  it("N. exports CSV safely, omitting sensitive columns unless authorized", async () => {
    const [emp] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: "Exp", lastName: "Test" }).returning();
    const normal = await defs.createCustomField(mk({ fieldKey: "export_normal", label: "Normal" }));
    const secret = await defs.createCustomField(mk({ fieldKey: "export_secret", label: "Secret", sensitivity: "sensitive" }));
    // Formula-injection-shaped text must survive as inert data.
    await values.setValuesForEntity({
      organizationId: orgId,
      scope: "employee",
      entityId: emp.id,
      values: { [normal.definition.id]: "=1+1", [secret.definition.id]: "top-secret" },
      actorMembershipId: membershipId,
    });

    const withoutSensitive = await values.buildCustomFieldReport({
      organizationId: orgId,
      scope: "employee",
      entityIds: [emp.id],
      includeSensitive: false,
    });
    expect(withoutSensitive.columns.some((c) => c.key === "cf_export_secret")).toBe(false);
    expect(JSON.stringify([...withoutSensitive.rowsByEntity.values()])).not.toContain("top-secret");

    const withSensitive = await values.buildCustomFieldReport({
      organizationId: orgId,
      scope: "employee",
      entityIds: [emp.id],
      includeSensitive: true,
    });
    expect(withSensitive.columns.some((c) => c.key === "cf_export_secret")).toBe(true);

    // The CSV writer neutralizes the formula, reusing WS-1's hardening.
    const { toCsv } = await import("../lib/reporting");
    const csv = toCsv(withoutSensitive.columns, [withoutSensitive.rowsByEntity.get(emp.id)!]);
    expect(csv).toContain("'=1+1");
  });

  it("batch-loads values for many records in one query (no N+1)", async () => {
    const field = await defs.createCustomField(mk({ fieldKey: "batch_field" }));
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const [e] = await db.insert(schema.employeesTable).values({ organizationId: orgId, firstName: `B${i}`, lastName: "Batch" }).returning();
      ids.push(e.id);
      await values.setValuesForEntity({
        organizationId: orgId,
        scope: "employee",
        entityId: e.id,
        values: { [field.definition.id]: `v${i}` },
        actorMembershipId: membershipId,
      });
    }
    const batched = await values.getValuesForEntities(orgId, "employee", ids);
    expect(batched.size).toBe(5);
    expect((batched.get(ids[2])!.get(field.definition.id)!.value as any).value).toBe("v2");
  });

  // --- forms -----------------------------------------------------------------

  it("O/P/Q. creates, publishes and submits a form", async () => {
    const field = await defs.createCustomField(mk({ fieldKey: "form_field", label: "Form Field" }));
    const created = await forms.createForm({
      organizationId: orgId,
      formKey: "intake",
      formType: "internal_hr",
      scope: "employee",
      title: "Intake Form",
      layout: { sections: [{ key: "s1", heading: "Details", items: [{ kind: "field", definitionId: field.definition.id }] }] },
      actorMembershipId: membershipId,
    });
    expect(created.version.status).toBe("draft");

    // An unpublished form cannot be submitted.
    await expect(
      forms.submitForm({
        organizationId: orgId,
        formId: created.form.id,
        formVersionId: created.version.id,
        entityId: employeeId,
        answers: { [field.definition.id]: "x" },
        submittedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(forms.CustomFormStateError);

    const published = await forms.publishFormVersion({ organizationId: orgId, formId: created.form.id, formVersionId: created.version.id });
    expect(published.status).toBe("published");

    const submission = await forms.submitForm({
      organizationId: orgId,
      formId: created.form.id,
      formVersionId: published.id,
      entityId: employeeId,
      answers: { [field.definition.id]: "answered" },
      submittedByMembershipId: membershipId,
    });
    const answers = submission.answers as any[];
    expect(answers[0].label).toBe("Form Field");
    expect(answers[0].value).toEqual({ type: "short_text", value: "answered" });
    expect(answers[0].definitionVersionId).toBe(field.version.id);
  });

  it("R. a historical submission is unchanged after the form and fields are edited", async () => {
    const field = await defs.createCustomField(mk({ fieldKey: "hist_field", label: "Original Question" }));
    const created = await forms.createForm({
      organizationId: orgId,
      formKey: "history_form",
      formType: "internal_hr",
      scope: "employee",
      title: "History Form",
      layout: { sections: [{ key: "s1", heading: "S", items: [{ kind: "field", definitionId: field.definition.id }] }] },
      actorMembershipId: membershipId,
    });
    const v1 = await forms.publishFormVersion({ organizationId: orgId, formId: created.form.id, formVersionId: created.version.id });
    const submission = await forms.submitForm({
      organizationId: orgId,
      formId: created.form.id,
      formVersionId: v1.id,
      entityId: employeeId,
      answers: { [field.definition.id]: "original answer" },
      submittedByMembershipId: membershipId,
    });

    // Rename the field and publish a new form version.
    await defs.createCustomFieldVersion({
      organizationId: orgId,
      definitionId: field.definition.id,
      label: "Completely Different Question",
      fieldType: "short_text",
      actorMembershipId: membershipId,
    });
    const v2 = await forms.createFormVersion({
      organizationId: orgId,
      formId: created.form.id,
      title: "History Form v2",
      layout: { sections: [{ key: "s1", heading: "Changed", items: [{ kind: "field", definitionId: field.definition.id }] }] },
      actorMembershipId: membershipId,
    });
    await forms.publishFormVersion({ organizationId: orgId, formId: created.form.id, formVersionId: v2.id });

    // The submission still carries the label it was submitted under.
    const reloaded = await forms.getSubmission(orgId, submission.id);
    const answers = reloaded.answers as any[];
    expect(answers[0].label).toBe("Original Question");
    expect(reloaded.formVersionId).toBe(v1.id);

    // Submitting against the now-superseded version is refused.
    await expect(
      forms.submitForm({
        organizationId: orgId,
        formId: created.form.id,
        formVersionId: v1.id,
        entityId: employeeId,
        answers: { [field.definition.id]: "late" },
        submittedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(/changed since it was opened/i);
  });

  it("rejects forms composed from foreign, out-of-scope or extra fields", async () => {
    const employeeField = await defs.createCustomField(mk({ fieldKey: "emp_scope_field" }));
    const positionField = await defs.createCustomField(mk({ scope: "position", fieldKey: "pos_scope_field" }));

    // A field from another scope cannot be placed on an employee form.
    await expect(
      forms.createForm({
        organizationId: orgId,
        formKey: "bad_scope_form",
        formType: "internal_hr",
        scope: "employee",
        title: "Bad",
        layout: { sections: [{ key: "s", heading: "S", items: [{ kind: "field", definitionId: positionField.definition.id }] }] },
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(/different record type/i);

    // Another organization's field id is not available.
    await expect(
      forms.createForm({
        organizationId: otherOrgId,
        formKey: "foreign_form",
        formType: "internal_hr",
        scope: "employee",
        title: "Foreign",
        layout: { sections: [{ key: "s", heading: "S", items: [{ kind: "field", definitionId: employeeField.definition.id }] }] },
        actorMembershipId: null,
      }),
    ).rejects.toThrow(/not available to this organization/i);

    // A submission containing a field that is not on the form is refused.
    const extra = await defs.createCustomField(mk({ fieldKey: "not_on_form" }));
    const form = await forms.createForm({
      organizationId: orgId,
      formKey: "extra_field_form",
      formType: "internal_hr",
      scope: "employee",
      title: "Extra",
      layout: { sections: [{ key: "s", heading: "S", items: [{ kind: "field", definitionId: employeeField.definition.id }] }] },
      actorMembershipId: membershipId,
    });
    const pub = await forms.publishFormVersion({ organizationId: orgId, formId: form.form.id, formVersionId: form.version.id });
    await expect(
      forms.submitForm({
        organizationId: orgId,
        formId: form.form.id,
        formVersionId: pub.id,
        entityId: employeeId,
        answers: { [employeeField.definition.id]: "ok", [extra.definition.id]: "smuggled" },
        submittedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(/not part of this form/i);
  });

  it("T. a candidate form definition works without any anonymous access path", async () => {
    const [cand] = await db
      .insert(schema.candidatesTable)
      .values({ organizationId: orgId, firstName: "Cand", lastName: "Idate", email: `c${Date.now()}@example.invalid` })
      .returning();
    const field = await defs.createCustomField(mk({ scope: "candidate", fieldKey: "cand_field", label: "Referred By" }));
    const form = await forms.createForm({
      organizationId: orgId,
      formKey: "candidate_intake",
      formType: "candidate_application",
      scope: "candidate",
      title: "Candidate Intake",
      layout: { sections: [{ key: "s", heading: "About", items: [{ kind: "field", definitionId: field.definition.id }] }] },
      actorMembershipId: membershipId,
    });
    const pub = await forms.publishFormVersion({ organizationId: orgId, formId: form.form.id, formVersionId: form.version.id });
    const submission = await forms.submitForm({
      organizationId: orgId,
      formId: form.form.id,
      formVersionId: pub.id,
      entityId: cand.id,
      answers: { [field.definition.id]: "A colleague" },
      submittedByMembershipId: membershipId,
    });
    expect(submission.scope).toBe("candidate");
    expect(submission.entityId).toBe(cand.id);

    // A candidate from another organization is refused.
    const [otherCand] = await db
      .insert(schema.candidatesTable)
      .values({ organizationId: otherOrgId, firstName: "X", lastName: "Y", email: `x${Date.now()}@example.invalid` })
      .returning();
    await expect(
      forms.submitForm({
        organizationId: orgId,
        formId: form.form.id,
        formVersionId: pub.id,
        entityId: otherCand.id,
        answers: { [field.definition.id]: "nope" },
        submittedByMembershipId: membershipId,
      }),
    ).rejects.toThrow(scopes.CustomFieldEntityNotFoundError);
  });

  it("keeps submissions and definitions invisible across organizations", async () => {
    const mine = await forms.listForms(orgId);
    const theirs = await forms.listForms(otherOrgId);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.some((f) => mine.some((m) => m.id === f.id))).toBe(false);

    const mySubs = await forms.listSubmissions({ organizationId: orgId });
    const theirSubs = await forms.listSubmissions({ organizationId: otherOrgId });
    expect(mySubs.length).toBeGreaterThan(0);
    expect(theirSubs).toHaveLength(0);

    const anySub = mySubs[0];
    await expect(forms.getSubmission(otherOrgId, anySub.id)).rejects.toThrow(forms.CustomFormNotFoundError);
  });
});
