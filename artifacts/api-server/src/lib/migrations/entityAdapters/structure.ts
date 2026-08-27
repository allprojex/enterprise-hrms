/**
 * WS-7 (§4/§16 recon; Owner clarification A) — organizational structure
 * adapters: branch, department, position. "Organizational structure" is
 * confirmed (not assumed) to be three standalone tables in this codebase,
 * not Master Data. No dedicated creation service exists for any of the
 * three (creation is a plain inline insert in each route handler) — these
 * adapters reuse the exact same insert shape and the exact same
 * cross-organization placement validators
 * (`assertValidDepartmentPlacement`/`assertValidPositionPlacement`) those
 * routes already use, rather than inventing a parallel structure model.
 *
 * Dependency order, derived from the actual foreign keys (never assumed):
 * branch has no dependency; department optionally references a branch;
 * position optionally references a department. Positions do NOT reference
 * branches directly.
 *
 * Duplicate handling (§14): each of the three tables already enforces a
 * per-organization uniqueness constraint (branch/department by code,
 * position by title). `planRow` pre-checks it for a clean dry-run message;
 * the underlying unique index is still the final authority at execution
 * time, exactly like every other creation path in this codebase.
 */
import { eq, and } from "drizzle-orm";
import { db, branchesTable, departmentsTable, positionsTable } from "@workspace/db";
import { assertValidDepartmentPlacement, assertValidPositionPlacement, CrossOrganizationReferenceError } from "../../organizationStructureService";
import { isUniqueViolation } from "../../dbErrors";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, optionalString } from "../normalizeHelpers";
import { resolveBranchRef, resolveDepartmentRef } from "../referenceResolution";

// --- branch --------------------------------------------------------------

const BRANCH_FIELDS: readonly CanonicalField[] = [
  { key: "code", label: "Branch Code", required: true, type: "string", aliases: ["Branch Code", "Code"] },
  { key: "name", label: "Branch Name", required: true, type: "string", aliases: ["Branch Name", "Name"] },
];

export const branchAdapter: EntityAdapter = {
  entityType: "branch",
  label: "Branches",
  dependsOn: [],
  // Only tx.insert — fully rolls back with an outer transaction.
  transactional: true,
  fields: BRANCH_FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const code = requiredString(raw.code, "code", "Branch Code", messages);
    const name = requiredString(raw.name, "name", "Branch Name", messages);
    return { data: { code, name }, messages };
  },

  async planRow(_tx, _mode, data, ctx): Promise<PlanResult> {
    const [existing] = await db
      .select({ id: branchesTable.id })
      .from(branchesTable)
      .where(and(eq(branchesTable.organizationId, ctx.organizationId), eq(branchesTable.code, data.code as string)))
      .limit(1);
    if (existing) {
      return {
        operation: "error",
        messages: [{ field: "code", message: `A branch with code "${data.code}" already exists in this organization`, severity: "error" }],
      };
    }
    return { operation: "create", messages: [] };
  },

  async executeRow(tx, data, ctx) {
    try {
      const [branch] = await tx
        .insert(branchesTable)
        .values({ organizationId: ctx.organizationId, code: data.code as string, name: data.name as string })
        .returning();
      return { status: "created", resultId: branch.id };
    } catch (err) {
      if (isUniqueViolation(err)) throw new Error(`A branch with code "${data.code}" already exists`);
      throw err;
    }
  },
};

// --- department ------------------------------------------------------------

const DEPARTMENT_FIELDS: readonly CanonicalField[] = [
  { key: "code", label: "Department Code", required: true, type: "string", aliases: ["Department Code", "Code"] },
  { key: "name", label: "Department Name", required: true, type: "string", aliases: ["Department Name", "Name"] },
  { key: "branchCode", label: "Branch Code", required: false, type: "string", aliases: ["Branch Code", "Branch"] },
];

export const departmentAdapter: EntityAdapter = {
  entityType: "department",
  label: "Departments",
  dependsOn: ["branch"],
  // tx.insert + a read-only placement assert.
  transactional: true,
  fields: DEPARTMENT_FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const code = requiredString(raw.code, "code", "Department Code", messages);
    const name = requiredString(raw.name, "name", "Department Name", messages);
    const branchCode = optionalString(raw.branchCode);
    return { data: { code, name, branchCode }, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];
    let branchId: number | null = null;

    if (data.branchCode) {
      const resolved = await resolveBranchRef(tx, ctx.organizationId, ctx.batchId, mode, data.branchCode as string);
      if (!resolved.found) {
        messages.push({ field: "branchCode", message: `Branch "${data.branchCode}" was not found`, severity: "error" });
      }
      branchId = resolved.id;
    }

    const [existing] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.organizationId, ctx.organizationId), eq(departmentsTable.code, data.code as string)))
      .limit(1);
    if (existing) {
      messages.push({ field: "code", message: `A department with code "${data.code}" already exists in this organization`, severity: "error" });
    }

    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    void branchId;
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    let branchId: number | null = null;
    if (data.branchCode) {
      const resolved = await resolveBranchRef(tx, ctx.organizationId, ctx.batchId, "execute", data.branchCode as string);
      if (!resolved.found) throw new Error(`Branch "${data.branchCode}" was not found`);
      branchId = resolved.id;
    }

    try {
      // tx passed so an atomic batch sees a branch created earlier in the same transaction.
      await assertValidDepartmentPlacement({ organizationId: ctx.organizationId, branchId, parentDepartmentId: null }, tx);
      const [department] = await tx
        .insert(departmentsTable)
        .values({ organizationId: ctx.organizationId, code: data.code as string, name: data.name as string, branchId })
        .returning();
      return { status: "created", resultId: department.id };
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) throw new Error(err.message);
      if (isUniqueViolation(err)) throw new Error(`A department with code "${data.code}" already exists`);
      throw err;
    }
  },
};

// --- position ----------------------------------------------------------

const POSITION_FIELDS: readonly CanonicalField[] = [
  { key: "title", label: "Position Title", required: true, type: "string", aliases: ["Position Title", "Title", "Designation"] },
  { key: "departmentCode", label: "Department Code", required: false, type: "string", aliases: ["Department Code", "Department"] },
];

export const positionAdapter: EntityAdapter = {
  entityType: "position",
  label: "Positions",
  dependsOn: ["department"],
  transactional: true,
  fields: POSITION_FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const title = requiredString(raw.title, "title", "Position Title", messages);
    const departmentCode = optionalString(raw.departmentCode);
    return { data: { title, departmentCode }, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];

    if (data.departmentCode) {
      const resolved = await resolveDepartmentRef(tx, ctx.organizationId, ctx.batchId, mode, data.departmentCode as string);
      if (!resolved.found) {
        messages.push({ field: "departmentCode", message: `Department "${data.departmentCode}" was not found`, severity: "error" });
      }
    }

    const [existing] = await db
      .select({ id: positionsTable.id })
      .from(positionsTable)
      .where(and(eq(positionsTable.organizationId, ctx.organizationId), eq(positionsTable.title, data.title as string)))
      .limit(1);
    if (existing) {
      messages.push({ field: "title", message: `A position titled "${data.title}" already exists in this organization`, severity: "error" });
    }

    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    let departmentId: number | null = null;
    if (data.departmentCode) {
      const resolved = await resolveDepartmentRef(tx, ctx.organizationId, ctx.batchId, "execute", data.departmentCode as string);
      if (!resolved.found) throw new Error(`Department "${data.departmentCode}" was not found`);
      departmentId = resolved.id;
    }

    try {
      await assertValidPositionPlacement({ organizationId: ctx.organizationId, departmentId }, tx);
      const [position] = await tx
        .insert(positionsTable)
        .values({ organizationId: ctx.organizationId, title: data.title as string, departmentId })
        .returning();
      return { status: "created", resultId: position.id };
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) throw new Error(err.message);
      if (isUniqueViolation(err)) throw new Error(`A position titled "${data.title}" already exists`);
      throw err;
    }
  },
};
