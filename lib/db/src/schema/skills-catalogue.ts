import { pgTable, serial, integer, text, boolean, pgEnum, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { usersTable } from "./users";

/**
 * WS-14 — the typed Skills catalogue and the proficiency scale
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §30.2–30.4, OD #5).
 *
 * ONE CATALOGUE, CENTRED ON SKILLS — NO SECOND "COMPETENCY" ENTITY (§30.2).
 * "Competency" already means something else in this platform:
 * `performance_template_competencies` and `performance_review_competencies` are
 * per-template, free-text REVIEW CRITERIA carrying weights, and their own header
 * says they are "free text by default". Minting a second, differently-shaped
 * Competency entity here would leave two meanings of one word in one codebase,
 * and renaming Performance's would re-gate shipped code — the change §27.21 and
 * §28.17 refuse. Breadth is carried by `category` instead, so an organization
 * that thinks in competencies models them as behavioural or leadership skills
 * and loses nothing.
 *
 * THE `skill` MASTER DATA DOMAIN IS NOT WIDENED (§30.4). It stays exactly as it
 * is: `master_data_items` is shared by 25 other domains, and hanging WS-14
 * metadata off it would impose this workstream's shape on all of them. The
 * catalogue instead offers a one-way, idempotent IMPORT from those items.
 */

/**
 * Deliberately a small closed set plus `other`. Categories exist to let an
 * organization group and filter, not to become a taxonomy engine — a free-text
 * category would reproduce exactly the untyped `skillCode` problem §30.1(1)
 * records.
 */
export const skillCategoryEnum = pgEnum("skill_category", [
  "technical",
  "behavioural",
  "leadership",
  "functional",
  "compliance",
  "other",
]);

export const skillsTable = pgTable(
  "skills",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    /** Stable per organization. Referenced by requirements, reporting and the Master Data import. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: skillCategoryEnum("category").notNull().default("technical"),
    active: boolean("active").notNull().default(true),
    /**
     * Whether a proficiency level is meaningful for this skill. A binary
     * capability — holding a licence, say — is either present or not, and
     * forcing a level onto it would invent precision the organization never
     * asserted.
     */
    proficiencyApplicable: boolean("proficiency_applicable").notNull().default(true),
    /** Whether the organization expects supporting evidence before verifying. */
    evidenceExpected: boolean("evidence_expected").notNull().default(false),
    /**
     * Whether a certification backs this skill. Where true, an EXPIRED
     * certification means the evidence is no longer current (§30.20) — a
     * derived state, never a stored one.
     */
    certificationApplicable: boolean("certification_applicable").notNull().default(false),
    /**
     * Provenance when the row came from the `skill` Master Data domain. It is
     * what makes the import idempotent (§30.4): a second run finds the existing
     * row instead of creating a duplicate.
     */
    sourceMasterDataCode: text("source_master_data_code"),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("skills_org_code_unique").on(table.organizationId, table.code),
    index("skills_org_active_idx").on(table.organizationId, table.active),
    index("skills_org_category_idx").on(table.organizationId, table.category),
  ],
);

/**
 * WS-14 — the proficiency scale (§30.3).
 *
 * STRUCTURALLY MODELLED ON PERFORMANCE'S RATING SCALE, DELIBERATELY NOT REUSING
 * IT. `performance_rating_scales` is the proven shape, but sharing the tables
 * would mean an edit to a performance scale silently changed what a capability
 * REQUIREMENT means — coupling two modules that have no business being coupled.
 *
 * ONE ACTIVE SCALE PER ORGANIZATION, guaranteed by the partial unique index
 * below rather than by a read-then-write check two concurrent edits could both
 * pass. §30.27 item 2 left versioning conditional; the evidence did not show a
 * live requirement for it, so the simpler shape ships and archived scales are
 * retained rather than deleted, which keeps historical assessments readable.
 */
export const proficiencyScalesTable = pgTable(
  "proficiency_scales",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("proficiency_scales_active_per_org_unique")
      .on(table.organizationId)
      .where(sql`active = true`),
    index("proficiency_scales_org_idx").on(table.organizationId),
  ],
);

/**
 * One named level on a scale.
 *
 * `ordinal` is the comparison key: a requirement is met when the employee's
 * verified ordinal is greater than or equal to the required one. It is an
 * ordering WITHIN one organization's own labels and **must never be surfaced as
 * though it were an objective universal competence score** (§30.3) — the API
 * and UI show the label, and the ordinal stays an implementation detail of
 * comparison.
 */
export const proficiencyLevelsTable = pgTable(
  "proficiency_levels",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    scaleId: integer("scale_id")
      .notNull()
      .references(() => proficiencyScalesTable.id, { onDelete: "cascade" }),
    /** 1-based. Higher means more proficient. */
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("proficiency_levels_scale_ordinal_unique").on(table.scaleId, table.ordinal),
    index("proficiency_levels_org_scale_idx").on(table.organizationId, table.scaleId),
  ],
);

export const insertSkillSchema = createInsertSchema(skillsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertProficiencyScaleSchema = createInsertSchema(proficiencyScalesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProficiencyLevelSchema = createInsertSchema(proficiencyLevelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skillsTable.$inferSelect;
export type InsertProficiencyScale = z.infer<typeof insertProficiencyScaleSchema>;
export type ProficiencyScale = typeof proficiencyScalesTable.$inferSelect;
export type InsertProficiencyLevel = z.infer<typeof insertProficiencyLevelSchema>;
export type ProficiencyLevel = typeof proficiencyLevelsTable.$inferSelect;
