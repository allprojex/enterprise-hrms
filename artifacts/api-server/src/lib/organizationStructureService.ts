/**
 * Organization Structure Service (ADR-012): the one shared home for
 * branch/department/position business rules — hierarchy validation,
 * dependency validation, archive validation, and restructuring — instead of
 * three parallel, ad-hoc implementations in each route file.
 */
import { and, eq } from "drizzle-orm";
import { db, branchesTable, departmentsTable, positionsTable } from "@workspace/db";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { recordAuditEvent } from "./auditLog";

export { CrossOrganizationReferenceError };

export class HierarchyCycleError extends Error {
  constructor() {
    super("A department cannot be its own ancestor");
    this.name = "HierarchyCycleError";
  }
}

export class StructureDependencyError extends Error {
  constructor(label: string) {
    super(`${label} still has dependents and cannot be archived`);
    this.name = "StructureDependencyError";
  }
}

export class StructureNotFoundError extends Error {
  constructor(label: string) {
    super(`${label} not found in this organization`);
    this.name = "StructureNotFoundError";
  }
}

/**
 * Hierarchy validation: branchId/parentDepartmentId (if given) must belong
 * to this organization, and — when moving an existing department
 * (departmentId given) — the new parent must not be the department itself
 * or one of its own descendants.
 */
export async function assertValidDepartmentPlacement(params: {
  organizationId: number;
  departmentId?: number;
  branchId?: number | null;
  parentDepartmentId?: number | null;
}): Promise<void> {
  await assertBelongsToOrganization(branchesTable, params.branchId, params.organizationId, "Branch");
  await assertBelongsToOrganization(
    departmentsTable,
    params.parentDepartmentId,
    params.organizationId,
    "Parent department",
  );

  if (params.departmentId == null || params.parentDepartmentId == null) return;

  let ancestorId: number | null = params.parentDepartmentId;
  const visited = new Set<number>();
  while (ancestorId != null) {
    if (ancestorId === params.departmentId) throw new HierarchyCycleError();
    if (visited.has(ancestorId)) break; // pre-existing cycle unrelated to this move; not this call's concern
    visited.add(ancestorId);
    const [row] = await db
      .select({ parentDepartmentId: departmentsTable.parentDepartmentId })
      .from(departmentsTable)
      .where(eq(departmentsTable.id, ancestorId))
      .limit(1);
    ancestorId = row?.parentDepartmentId ?? null;
  }
}

/** Hierarchy validation for a position: departmentId (if given) must belong to this organization. */
export async function assertValidPositionPlacement(params: {
  organizationId: number;
  departmentId?: number | null;
}): Promise<void> {
  await assertBelongsToOrganization(departmentsTable, params.departmentId, params.organizationId, "Department");
}

/** Dependency validation: a branch can't be archived while departments still reference it. */
export async function assertBranchArchivable(organizationId: number, branchId: number): Promise<void> {
  const [dependent] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.branchId, branchId), eq(departmentsTable.organizationId, organizationId)))
    .limit(1);
  if (dependent) throw new StructureDependencyError("Branch");
}

/** Dependency validation: a department can't be archived while child departments or positions still reference it. */
export async function assertDepartmentArchivable(organizationId: number, departmentId: number): Promise<void> {
  const [childDepartment] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.parentDepartmentId, departmentId), eq(departmentsTable.organizationId, organizationId)))
    .limit(1);
  if (childDepartment) throw new StructureDependencyError("Department");

  const [dependentPosition] = await db
    .select({ id: positionsTable.id })
    .from(positionsTable)
    .where(and(eq(positionsTable.departmentId, departmentId), eq(positionsTable.organizationId, organizationId)))
    .limit(1);
  if (dependentPosition) throw new StructureDependencyError("Department");
}

/** Restructuring: moves a department to a different branch and/or parent department, validated and audit-logged. */
export async function restructureDepartment(params: {
  organizationId: number;
  departmentId: number;
  branchId?: number | null;
  parentDepartmentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, params.departmentId), eq(departmentsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Department");

  await assertValidDepartmentPlacement({
    organizationId: params.organizationId,
    departmentId: params.departmentId,
    branchId: params.branchId,
    parentDepartmentId: params.parentDepartmentId,
  });

  const patch: Record<string, unknown> = {};
  if (params.branchId !== undefined) patch.branchId = params.branchId;
  if (params.parentDepartmentId !== undefined) patch.parentDepartmentId = params.parentDepartmentId;

  const [updated] = await db
    .update(departmentsTable)
    .set(patch)
    .where(eq(departmentsTable.id, params.departmentId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "department.restructured",
    targetType: "department",
    targetId: String(params.departmentId),
    beforeState: { branchId: before.branchId, parentDepartmentId: before.parentDepartmentId },
    afterState: { branchId: updated.branchId, parentDepartmentId: updated.parentDepartmentId },
  });

  return updated;
}

/** Restructuring: moves a position to a different department, validated and audit-logged. */
export async function restructurePosition(params: {
  organizationId: number;
  positionId: number;
  departmentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(positionsTable)
    .where(and(eq(positionsTable.id, params.positionId), eq(positionsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Position");

  await assertValidPositionPlacement({ organizationId: params.organizationId, departmentId: params.departmentId });

  const [updated] = await db
    .update(positionsTable)
    .set({ departmentId: params.departmentId })
    .where(eq(positionsTable.id, params.positionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "position.restructured",
    targetType: "position",
    targetId: String(params.positionId),
    beforeState: { departmentId: before.departmentId },
    afterState: { departmentId: updated.departmentId },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Field updates and lifecycle (archive/reactivate) — W13, Branch/Organizational
// Unit/Position Completion. Structural placement stays in restructure* above;
// these only ever touch each entity's own fields (name/code/title/status).
// ---------------------------------------------------------------------------

export async function updateBranch(params: {
  organizationId: number;
  branchId: number;
  name?: string;
  code?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(branchesTable)
    .where(and(eq(branchesTable.id, params.branchId), eq(branchesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Branch");

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.code !== undefined) patch.code = params.code;

  const [updated] = await db.update(branchesTable).set(patch).where(eq(branchesTable.id, params.branchId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "branch.updated",
    targetType: "branch",
    targetId: String(params.branchId),
    beforeState: { name: before.name, code: before.code },
    afterState: { name: updated.name, code: updated.code },
  });

  return updated;
}

async function setBranchStatus(params: {
  organizationId: number;
  branchId: number;
  status: "active" | "inactive";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(branchesTable)
    .where(and(eq(branchesTable.id, params.branchId), eq(branchesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Branch");

  if (params.status === "inactive") {
    await assertBranchArchivable(params.organizationId, params.branchId);
  }

  const [updated] = await db
    .update(branchesTable)
    .set({ status: params.status })
    .where(eq(branchesTable.id, params.branchId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "branch",
    targetId: String(params.branchId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export const archiveBranch = (params: {
  organizationId: number;
  branchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setBranchStatus({ ...params, status: "inactive", eventType: "branch.archived" });

export const reactivateBranch = (params: {
  organizationId: number;
  branchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setBranchStatus({ ...params, status: "active", eventType: "branch.reactivated" });

export async function updateDepartment(params: {
  organizationId: number;
  departmentId: number;
  name?: string;
  code?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, params.departmentId), eq(departmentsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Department");

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.code !== undefined) patch.code = params.code;

  const [updated] = await db
    .update(departmentsTable)
    .set(patch)
    .where(eq(departmentsTable.id, params.departmentId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "department.updated",
    targetType: "department",
    targetId: String(params.departmentId),
    beforeState: { name: before.name, code: before.code },
    afterState: { name: updated.name, code: updated.code },
  });

  return updated;
}

async function setDepartmentStatus(params: {
  organizationId: number;
  departmentId: number;
  status: "active" | "inactive";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, params.departmentId), eq(departmentsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Department");

  if (params.status === "inactive") {
    await assertDepartmentArchivable(params.organizationId, params.departmentId);
  }

  const [updated] = await db
    .update(departmentsTable)
    .set({ status: params.status })
    .where(eq(departmentsTable.id, params.departmentId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "department",
    targetId: String(params.departmentId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export const archiveDepartment = (params: {
  organizationId: number;
  departmentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setDepartmentStatus({ ...params, status: "inactive", eventType: "department.archived" });

export const reactivateDepartment = (params: {
  organizationId: number;
  departmentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setDepartmentStatus({ ...params, status: "active", eventType: "department.reactivated" });

export async function updatePosition(params: {
  organizationId: number;
  positionId: number;
  title?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(positionsTable)
    .where(and(eq(positionsTable.id, params.positionId), eq(positionsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Position");

  const patch: Record<string, unknown> = {};
  if (params.title !== undefined) patch.title = params.title;

  const [updated] = await db
    .update(positionsTable)
    .set(patch)
    .where(eq(positionsTable.id, params.positionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "position.updated",
    targetType: "position",
    targetId: String(params.positionId),
    beforeState: { title: before.title },
    afterState: { title: updated.title },
  });

  return updated;
}

async function setPositionStatus(params: {
  organizationId: number;
  positionId: number;
  status: "active" | "inactive";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const [before] = await db
    .select()
    .from(positionsTable)
    .where(and(eq(positionsTable.id, params.positionId), eq(positionsTable.organizationId, params.organizationId)))
    .limit(1);
  if (!before) throw new StructureNotFoundError("Position");

  // Positions are leaves in the org-structure hierarchy — nothing in this
  // service's scope (branches/departments/positions) depends on one, so
  // there's no dependency check here (unlike branches/departments).
  const [updated] = await db
    .update(positionsTable)
    .set({ status: params.status })
    .where(eq(positionsTable.id, params.positionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "position",
    targetId: String(params.positionId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

export const archivePosition = (params: {
  organizationId: number;
  positionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setPositionStatus({ ...params, status: "inactive", eventType: "position.archived" });

export const reactivatePosition = (params: {
  organizationId: number;
  positionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setPositionStatus({ ...params, status: "active", eventType: "position.reactivated" });
