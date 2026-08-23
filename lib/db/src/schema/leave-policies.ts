import { pgTable, text, serial, timestamp, integer, boolean, numeric, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organizationsTable } from "./organizations";
import { leaveTypesTable } from "./leave-types";
import { branchesTable } from "./branches";
import { departmentsTable } from "./departments";
import { positionsTable } from "./positions";
import { employmentTypeEnum, genderEnum } from "./employees";

// Leave Policies (Phase 2B, W32): eligibility + entitlement rules attached
// to a Leave Type. A type may have zero, one, or several policies; which
// policy applies to a given employee (position > department > branch >
// employment type > org-wide default) is resolved in the service layer, not
// the schema. `leaveTypeId` cascades — a policy has no meaning without its
// type — everything else is a nullable "unscoped/applies to all" eligibility
// dimension, the same convention departments/positions already use for
// optional placement FKs. Reuses employees.ts's employmentTypeEnum/
// genderEnum rather than redefining them. Has its own active/inactive
// lifecycle, independent of the parent leave type's.
export const leavePolicyStatusEnum = pgEnum("leave_policy_status", ["active", "inactive"]);
export const leaveAccrualMethodEnum = pgEnum("leave_accrual_method", [
  "annual",
  "monthly",
  "per_pay_period",
  "none",
]);
export const leaveEntitlementPeriodEnum = pgEnum("leave_entitlement_period", ["calendar_year", "anniversary_year"]);

export const leavePoliciesTable = pgTable(
  "leave_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "restrict" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    // Eligibility — null means "unscoped on this dimension" (applies to all).
    employmentType: employmentTypeEnum("employment_type"),
    branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
    departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
    positionId: integer("position_id").references(() => positionsTable.id, { onDelete: "set null" }),
    gender: genderEnum("gender"),
    minimumServiceMonths: integer("minimum_service_months"),
    probationRestricted: boolean("probation_restricted").notNull().default(false),

    // Entitlement / accrual
    annualEntitlementDays: numeric("annual_entitlement_days", { precision: 6, scale: 2 }).notNull(),
    isPaid: boolean("is_paid").notNull().default(true),
    accrualMethod: leaveAccrualMethodEnum("accrual_method").notNull().default("annual"),
    accrualRate: numeric("accrual_rate", { precision: 6, scale: 2 }),
    entitlementPeriod: leaveEntitlementPeriodEnum("entitlement_period").notNull().default("calendar_year"),

    // Carry-forward
    carryForwardAllowed: boolean("carry_forward_allowed").notNull().default(false),
    maxCarryForwardDays: numeric("max_carry_forward_days", { precision: 6, scale: 2 }),
    carryForwardExpiryMonths: integer("carry_forward_expiry_months"),

    // Request constraints
    minRequestDurationDays: numeric("min_request_duration_days", { precision: 6, scale: 2 }),
    maxRequestDurationDays: numeric("max_request_duration_days", { precision: 6, scale: 2 }),
    noticePeriodDays: integer("notice_period_days"),
    // Phase 3H, W117 (frozen plan Decision 11). Nullable, defaulting to unset
    // — every existing policy's calendar-day notice-period behavior is
    // completely unchanged until an organization explicitly sets this. When
    // true, createLeaveRequest's noticePeriodDays hard-block counts only
    // working days (weekends skipped, organization holidays optionally
    // skipped via the same resolveHolidayDatesInRange helper Leave already
    // uses for calculateLeaveDays) rather than calendar days.
    noticePeriodCountsWorkingDaysOnly: boolean("notice_period_counts_working_days_only"),
    attachmentRequired: boolean("attachment_required").notNull().default(false),

    // Day-counting rules (applied server-side by a future workstream, not W32)
    countWeekends: boolean("count_weekends").notNull().default(false),
    countPublicHolidays: boolean("count_public_holidays").notNull().default(false),
    allowNegativeBalance: boolean("allow_negative_balance").notNull().default(false),

    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),

    status: leavePolicyStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("leave_policies_org_type_idx").on(table.organizationId, table.leaveTypeId),
  ],
);

export const insertLeavePolicySchema = createInsertSchema(leavePoliciesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLeavePolicy = z.infer<typeof insertLeavePolicySchema>;
export type LeavePolicy = typeof leavePoliciesTable.$inferSelect;
