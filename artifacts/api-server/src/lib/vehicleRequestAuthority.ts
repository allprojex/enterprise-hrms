/**
 * VR-02A — "may this membership decide THIS stage of THIS vehicle request?"
 *
 * One bounded question, three server-defined resolvers, and no engine. A stage
 * NAMES a resolver and supplies data; it can never supply code, which is what
 * keeps "who may approve" analyzable and is why authority is never inferred
 * from a role NAME (the WS-9 ruling, applied here).
 *
 * THE COMPOSITION RULE, STATED ONCE:
 *
 *     source permission  AND  resolver match  AND  source business state
 *
 * This module supplies only the MIDDLE term, exactly as authorityDelegations.ts
 * supplies only the middle term of its own rule. It grants nothing: a caller
 * still needs `vehicle_request.approve` in its own right, and the request must
 * still actually be sitting at that stage. `requirePermission` enforces the
 * first term at the route, the service enforces the third, and neither is
 * re-implemented here.
 *
 * `department_head` resolves against the REQUEST's own
 * `requestingDepartmentId` — the department snapshotted at submission, never
 * the requester's current department — so approval authority for a historical
 * request is evaluated against the department it was actually raised from.
 * It composes `resolveDepartmentHeadAuthority`, so a currently-valid delegate
 * resolves too, and a vacancy resolves to nobody rather than being silently
 * rerouted to a fallback approver.
 *
 * Re-derive this at the moment of every decision. Never cache it across a
 * request's lifetime — a delegation can be revoked, and a Head replaced,
 * between reading a queue and acting on it.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  organizationMembershipsTable,
  type VehicleRequestApprovalStage,
  type VehicleRequest,
} from "@workspace/db";
import { resolveDepartmentHeadAuthority } from "./authorityDelegations";
import { hasPermission } from "./permissions";

/** The permission every approver must hold in their own right, whatever the resolver says. */
export const VEHICLE_REQUEST_APPROVE_PERMISSION = "vehicle_request.approve";

/**
 * How a stage was satisfied. Shaped so a decision record can attribute the act
 * correctly: `actedAsDelegate` plus the head being stood in for, never an
 * attribution as though the head acted personally.
 */
export interface VehicleRequestStageAuthority {
  resolverType: VehicleRequestApprovalStage["resolverType"];
  actedAsDelegate: boolean;
  /** The head a delegate is standing in for; null for every non-delegated basis. */
  delegatorHeadMembershipId: number | null;
}

/** Narrow, validated views of `resolverConfig`. */
export interface PermissionHolderConfig {
  permissionKey: string;
}
export interface SpecificMembershipConfig {
  membershipId: number;
}

export function readPermissionHolderConfig(config: unknown): PermissionHolderConfig | null {
  if (typeof config !== "object" || config === null) return null;
  const key = (config as { permissionKey?: unknown }).permissionKey;
  return typeof key === "string" && key.trim().length > 0 ? { permissionKey: key } : null;
}

export function readSpecificMembershipConfig(config: unknown): SpecificMembershipConfig | null {
  if (typeof config !== "object" || config === null) return null;
  const id = (config as { membershipId?: unknown }).membershipId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? { membershipId: id } : null;
}

/** True only for a membership that is both in this organization and currently active. */
async function isActiveMember(organizationId: number, membershipId: number): Promise<boolean> {
  const [membership] = await db
    .select({ id: organizationMembershipsTable.id, status: organizationMembershipsTable.status })
    .from(organizationMembershipsTable)
    .where(and(eq(organizationMembershipsTable.id, membershipId), eq(organizationMembershipsTable.organizationId, organizationId)))
    .limit(1);
  return membership?.status === "active";
}

/**
 * The middle term. Returns how the actor satisfies this stage, or null if they
 * do not — never throws for an ordinary "no".
 *
 * `request` supplies the department for `department_head`; it is the request's
 * own snapshotted `requestingDepartmentId`, not a live lookup.
 */
export async function resolveStageAuthority(params: {
  organizationId: number;
  stage: Pick<VehicleRequestApprovalStage, "resolverType" | "resolverConfig">;
  request: Pick<VehicleRequest, "requestingDepartmentId">;
  actorMembershipId: number;
}): Promise<VehicleRequestStageAuthority | null> {
  const { organizationId, stage, request, actorMembershipId } = params;

  // An inactive or foreign membership satisfies nothing, whatever a stage names.
  if (!(await isActiveMember(organizationId, actorMembershipId))) return null;

  switch (stage.resolverType) {
    case "department_head": {
      const authority = await resolveDepartmentHeadAuthority(organizationId, request.requestingDepartmentId, actorMembershipId);
      if (!authority) return null;
      const delegated = authority.basis === "delegated";
      return {
        resolverType: "department_head",
        actedAsDelegate: delegated,
        delegatorHeadMembershipId: delegated ? authority.directAuthorityHolderMembershipId : null,
      };
    }
    case "permission_holder": {
      const config = readPermissionHolderConfig(stage.resolverConfig);
      if (!config) return null; // malformed configuration authorizes nobody
      if (!(await hasPermission(actorMembershipId, config.permissionKey))) return null;
      return { resolverType: "permission_holder", actedAsDelegate: false, delegatorHeadMembershipId: null };
    }
    case "specific_membership": {
      const config = readSpecificMembershipConfig(stage.resolverConfig);
      if (!config) return null;
      if (config.membershipId !== actorMembershipId) return null;
      return { resolverType: "specific_membership", actedAsDelegate: false, delegatorHeadMembershipId: null };
    }
    default:
      return null;
  }
}

/**
 * The WHOLE rule, for callers that want one answer: the approve permission AND
 * the resolver match. The third term — that the request is actually sitting at
 * this stage — belongs to the service that owns the transaction (VR-02C), and
 * is deliberately not evaluated here.
 */
export async function resolveApprovalAuthority(params: {
  organizationId: number;
  stage: Pick<VehicleRequestApprovalStage, "resolverType" | "resolverConfig">;
  request: Pick<VehicleRequest, "requestingDepartmentId">;
  actorMembershipId: number;
}): Promise<VehicleRequestStageAuthority | null> {
  if (!(await hasPermission(params.actorMembershipId, VEHICLE_REQUEST_APPROVE_PERMISSION))) return null;
  return resolveStageAuthority(params);
}
