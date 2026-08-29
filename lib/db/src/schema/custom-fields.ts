import { pgTable, serial, integer, text, boolean, timestamp, jsonb, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { organizationMembershipsTable } from "./organization-memberships";

/**
 * WS-8 — Custom Fields (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §24).
 *
 * The split that drives this whole schema (§24.4):
 *
 *   DEFINITION = organization-scoped CONFIGURATION. Portable between
 *   organizations as a template. Lives in `custom_field_definitions` +
 *   `custom_field_definition_versions`.
 *
 *   VALUE = tenant-isolated BUSINESS DATA attached to a real record. Lives in
 *   `custom_field_values`, never inside configuration JSON.
 *
 * There is deliberately no dynamic DDL anywhere: a custom field never becomes
 * a physical column, and no domain table is ever ALTERed (§24.27).
 */

/**
 * The server-controlled scope allow-list (§24.8). A definition binds to one of
 * these, never to an arbitrary table name — which is what stops "custom
 * fields" from becoming an arbitrary write primitive over the whole database.
 *
 * The prohibited domains from §24.3 (payroll transactions/runs, leave,
 * attendance, asset and inventory movements, disciplinary findings, audit
 * records, security identities) are absent by construction: they are simply
 * not members of this enum, so no request can name them.
 */
export const customFieldScopeEnum = pgEnum("custom_field_scope", [
  "employee",
  "candidate",
  "application",
  "onboarding",
  "organization_profile",
  "position",
  // WS-12 (§28.15, §28.19) — the exit-interview questionnaire reuses this
  // engine rather than introducing a second one. It binds to the exit INTERVIEW
  // rather than the employee so responses stay tied to the correct separation
  // cycle; an employee who leaves, returns and leaves again would otherwise have
  // their second interview overwrite their first.
  //
  // Disciplinary findings are still absent by construction, and must stay
  // absent: §24.3 prohibits them, and §28.19 upholds that prohibition. Findings
  // use typed columns owned by WS-12.
  "exit_interview",
]);

/** §24.5 — the approved initial registry. No formulas, scripts, SQL, HTML or file uploads. */
export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "short_text",
  "long_text",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "single_select",
  "multi_select",
  "email",
  "phone",
  "url",
  "employee_reference",
  "master_data_reference",
]);

/** §24.14 — sensitivity drives WS-3 masking/reveal, never a bespoke per-field ACL. */
export const customFieldSensitivityEnum = pgEnum("custom_field_sensitivity", ["normal", "sensitive"]);

export const customFieldStatusEnum = pgEnum("custom_field_status", ["active", "archived"]);

/**
 * Stable field identity (§24.11). Survives every revision: `fieldKey` and `id`
 * never change, so a value captured years ago still resolves to the same
 * logical field even after its label, help text or options have moved on.
 *
 * `fieldKey` is the organization-local stable code that makes a definition
 * portable between organizations without carrying values (§24.19).
 */
export const customFieldDefinitionsTable = pgTable(
  "custom_field_definitions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    scope: customFieldScopeEnum("scope").notNull(),
    fieldKey: text("field_key").notNull(),
    status: customFieldStatusEnum("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("custom_field_definitions_org_scope_key_unique").on(table.organizationId, table.scope, table.fieldKey),
    index("custom_field_definitions_org_scope_idx").on(table.organizationId, table.scope),
  ],
);

/**
 * One immutable revision of a field's configuration (§24.11).
 *
 * Editing a field never rewrites a version — it creates the next one. Exactly
 * one version per definition may be `isCurrent`, enforced by a partial unique
 * index in the migration (Drizzle cannot express a partial unique index here,
 * so it is added as raw SQL alongside the generated statements).
 *
 * `fieldType` lives on the VERSION rather than the definition on purpose: a
 * type change is a breaking change (§24.11) and the service refuses it on a
 * definition that already has values, but keeping the type versioned means a
 * historical value can always be interpreted under the type it was captured
 * with, never under a later one.
 */
export const customFieldDefinitionVersionsTable = pgTable(
  "custom_field_definition_versions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => customFieldDefinitionsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    fieldType: customFieldTypeEnum("field_type").notNull(),
    required: boolean("required").notNull().default(false),
    sensitivity: customFieldSensitivityEnum("sensitivity").notNull().default("normal"),
    displayOrder: integer("display_order").notNull().default(0),
    /** Declarative only — min/max length, min/max value, date bounds. Never an expression (§24.6). */
    validation: jsonb("validation"),
    /** Select options, or a master-data domain reference. Shape validated by the service against `fieldType`. */
    options: jsonb("options"),
    /** Declarative condition tree with a fixed operator set, evaluated server-side (§24.10). */
    visibility: jsonb("visibility"),
    /** Typed default, stored in the same envelope shape as a value. */
    defaultValue: jsonb("default_value"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("custom_field_definition_versions_def_number_unique").on(table.definitionId, table.versionNumber),
    index("custom_field_definition_versions_def_idx").on(table.definitionId),
    index("custom_field_definition_versions_org_idx").on(table.organizationId),
  ],
);

/**
 * A stored value — business data (§24.4).
 *
 * `definitionVersionId` records the exact configuration the value was captured
 * under, which is what makes §24.11's "historical values retain their
 * capture-time version" true rather than aspirational: reading an old value
 * never reinterprets it through today's definition.
 *
 * `entityId` is an integer id within the scope's authoritative table. The
 * server resolves scope -> table through an allow-list and verifies the target
 * belongs to the same organization before any write (§24.24) — a raw
 * (scope, entityId) pair from a client is never trusted on its own.
 */
export const customFieldValuesTable = pgTable(
  "custom_field_values",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => customFieldDefinitionsTable.id, { onDelete: "restrict" }),
    definitionVersionId: integer("definition_version_id")
      .notNull()
      .references(() => customFieldDefinitionVersionsTable.id, { onDelete: "restrict" }),
    scope: customFieldScopeEnum("scope").notNull(),
    entityId: integer("entity_id").notNull(),
    /**
     * Typed envelope: `{ "type": "<fieldType>", "value": <json> }`. Never a
     * bare string — §24.27 requires type semantics to survive storage and
     * reporting. SQL NULL means "no value"; it is never coerced to "".
     */
    value: jsonb("value"),
    createdByMembershipId: integer("created_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    updatedByMembershipId: integer("updated_by_membership_id").references(() => organizationMembershipsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One authoritative value per field per record.
    uniqueIndex("custom_field_values_definition_entity_unique").on(table.definitionId, table.scope, table.entityId),
    // The index that makes list rendering a single batched query rather than
    // one query per field per row (§24.27's EAV/N+1 warning).
    index("custom_field_values_org_scope_entity_idx").on(table.organizationId, table.scope, table.entityId),
  ],
);

export const insertCustomFieldDefinitionSchema = createInsertSchema(customFieldDefinitionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCustomFieldDefinition = z.infer<typeof insertCustomFieldDefinitionSchema>;
export type CustomFieldDefinition = typeof customFieldDefinitionsTable.$inferSelect;
export type CustomFieldDefinitionVersion = typeof customFieldDefinitionVersionsTable.$inferSelect;
export type CustomFieldValue = typeof customFieldValuesTable.$inferSelect;
export type CustomFieldScope = CustomFieldDefinition["scope"];
export type CustomFieldType = CustomFieldDefinitionVersion["fieldType"];
