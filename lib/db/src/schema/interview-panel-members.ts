import { pgTable, text, serial, timestamp, integer, boolean, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { interviewsTable } from "./interviews";
import { organizationMembershipsTable } from "./organization-memberships";

// Interview Panel Members (Phase 3A, W54 — Interviews & Scheduling): panel
// composition only — independent from interview results (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md
// §9 `interview_panel_members` row). `interviewerMembershipId` is nullable
// to allow an external interviewer, captured by name/email only, no login
// (§17 decision 13 — no external-interviewer portal). `conflictDeclared` is
// a plain self-declared flag (§17 citation) with no automated behavior
// attached in this workstream — storing/returning it is the entire scope.
export const interviewPanelMemberRoleEnum = pgEnum("interview_panel_member_role", ["lead", "member"]);

export const interviewPanelMembersTable = pgTable(
  "interview_panel_members",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    interviewId: integer("interview_id")
      .notNull()
      .references(() => interviewsTable.id, { onDelete: "cascade" }),
    interviewerMembershipId: integer("interviewer_membership_id").references(() => organizationMembershipsTable.id, { onDelete: "set null" }),
    externalInterviewerName: text("external_interviewer_name"),
    externalInterviewerEmail: text("external_interviewer_email"),
    role: interviewPanelMemberRoleEnum("role").notNull().default("member"),
    conflictDeclared: boolean("conflict_declared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial unique index — only applies when interviewerMembershipId is
    // not null, mirroring `recruitment_workflows`'s `isDefault` partial-index
    // shape — lets several external interviewers (all null) coexist freely
    // on one interview while still preventing the same internal interviewer
    // from being added to the same interview's panel twice.
    uniqueIndex("interview_panel_members_interview_interviewer_unique")
      .on(table.interviewId, table.interviewerMembershipId)
      .where(sql`${table.interviewerMembershipId} is not null`),
    index("interview_panel_members_org_idx").on(table.organizationId),
    index("interview_panel_members_interview_idx").on(table.interviewId),
  ],
);

export const insertInterviewPanelMemberSchema = createInsertSchema(interviewPanelMembersTable).omit({ id: true, createdAt: true });
export type InsertInterviewPanelMember = z.infer<typeof insertInterviewPanelMemberSchema>;
export type InterviewPanelMember = typeof interviewPanelMembersTable.$inferSelect;
