import { pgTable, text, serial, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orgTypeEnum = pgEnum("org_type", [
  "business",
  "church",
  "ngo",
  "school",
  "hospital",
  "hotel",
  "government",
  "other",
]);

export const orgStatusEnum = pgEnum("org_status", [
  "active",
  "suspended",
  "trial",
]);

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: orgTypeEnum("type").notNull().default("business"),
  status: orgStatusEnum("status").notNull().default("trial"),
  logoUrl: text("logo_url"),
  industry: text("industry"),
  employeeCount: integer("employee_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;
