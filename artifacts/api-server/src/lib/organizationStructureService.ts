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
