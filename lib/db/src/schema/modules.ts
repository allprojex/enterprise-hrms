import { pgTable, serial, text, varchar, jsonb, boolean, timestamp, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The platform-wide catalog of togglable feature modules (Recruitment,
// Attendance, ...) — Core Platform and HR Foundation capabilities
// (Authentication, Employees, Branches, ...) are not modules; they're the
// baseline every organization always has, per ARCHITECTURE.md.
//
// This is the registry only: which modules exist, what depends on what, and
// whether a module is ready to be seen at all. Per-organization enablement
// is a separate table (organization_modules, W4) — a row here does not mean
// any organization has it turned on.
export const moduleStatusEnum = pgEnum("module_status", ["active", "beta", "hidden", "deprecated"]);

export const modulesTable = pgTable(
  "modules",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description").notNull().default(""),
    category: varchar("category", { length: 64 }).notNull(),
    version: varchar("version", { length: 32 }).notNull().default("1.0.0"),
    status: moduleStatusEnum("status").notNull().default("hidden"),
    defaultEnabled: boolean("default_enabled").notNull().default(false),
    // string[] of other modules' `key` — validated against the registry at
    // seed time (see seed-modules.ts), not enforced by a DB constraint: the
    // set of modules is small and code-owned, not user-authored data.
    requiredModuleKeys: jsonb("required_module_keys").notNull().default([]),
    optionalModuleKeys: jsonb("optional_module_keys").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("modules_key_unique").on(table.key)],
);

export const insertModuleSchema = createInsertSchema(modulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertModule = z.infer<typeof insertModuleSchema>;
export type Module = typeof modulesTable.$inferSelect;
