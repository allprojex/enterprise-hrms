import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { branchesTable } from "./branches";

export const departmentsTable = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    parentDepartmentId: integer("parent_department_id").references(
      (): AnyPgColumn => departmentsTable.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("departments_org_code_unique").on(table.organizationId, table.code),
    index("departments_org_idx").on(table.organizationId),
  ],
);

export const insertDepartmentSchema = createInsertSchema(departmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departmentsTable.$inferSelect;
