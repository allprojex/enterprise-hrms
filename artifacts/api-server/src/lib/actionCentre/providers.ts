import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  employeesTable,
  onboardingTasksTable,
  onboardingInstancesTable,
  performanceCyclesTable,
  skillsTable,
  serviceRequestTypesTable,
} from "@workspace/db";
import { getModuleAccess } from "../organizationModules";
import { hasPermission } from "../permissions";
import { listDepartmentsHeadedByMembership } from "../departmentHeads";
import { listPendingApprovals, partitionPendingApprovalsForActor } from "../leaveApprovals";
import { resolveOwnEmployeeId } from "../leaveRequests";
import { resolveLearningActorEmployeeId } from "../learningAuthorization";
import { listTeamEnrollments } from "../learningEnrollments";
import { resolvePerformanceActorEmployeeId } from "../performanceAuthorization";
import { listTeamReviews } from "../performanceManagerReview";
import { isCurrentlyResponsible } from "../onboarding/responsibility";
import { ONBOARDING_MODULE_KEY } from "../onboarding/moduleKey";
import { listPendingRequisitionApprovals } from "../requisitionApprovals";
import { listPendingOfferApprovals } from "../offerApprovals";
import * as dataChange from "../employeeRequests/dataChange";
import * as serviceRequests from "../employeeRequests/serviceRequests";
import * as grievance from "../employeeRelations/grievance";
import * as disciplinary from "../employeeRelations/disciplinary";
import { outstandingClearance } from "../employeeRelations/readModels";
import * as capability from "../skills/capability";
import * as succession from "../skills/succession";
import { findExpiringTerms } from "../employmentLifecycle/employmentTerms";
import { resolveEmploymentLifecycleConfig } from "../employmentLifecycle/config";
import type { ActionItem, ActionProvider, ProviderContext } from "./types";
import { deriveOverdue } from "./types";

/**
 * WS-15 — the fourteen P1 source providers (§31.27's frozen matrix).
 *
 * EVERY PROVIDER IS AN ADAPTER OVER ITS MODULE'S EXISTING SERVICE FUNCTIONS.
 * None of them queries another module's tables to reimplement its rules, none
 * generalizes an authority resolver, and none introduces a workflow concept.
 * Ten different authority resolvers are called here and NOT unified — that is
 * OD #14/#15 and belongs to WS-16 (§31.5, §31.7).
 *
 * THE `authorize`/`query` SPLIT IS THE CONFIDENTIALITY BOUNDARY. `authorize`
 * answers "may this actor see this source at all?" and a `false` makes the
 * source vanish — no row, no count, no zero, indistinguishable from the module
 * being disabled (§31.19). Only `query` may fail loudly, and only once
 * authorization has already succeeded, so a named unavailable source can never
 * disclose the existence of a module the actor may not see (§31.22).
 *
 * SCOPE CHANGES WHAT AUTHORITY MEANS, NOT WHAT IS SAFE TO SHOW. In
 * `my_actions` a provider returns what the actor may personally act on; in
 * `oversight` it returns what the actor may READ organization-wide. Oversight
 * therefore grants no new visibility — it is the same permission-filtered
 * provider asked a different question (§31.10) — and inline commands are
 * offered only where action authority genuinely holds.
 *
 * TITLES ARE GENERIC BY CONSTRUCTION. No provider below interpolates a
 * grievance narrative, disciplinary evidence, a leave reason, a proposed
 * sensitive value, a succession candidate or readiness, or any Payroll figure
 * (§31.14). Where naming the subject would itself be disclosure — grievances —
 * the row carries the case reference and omits the employee entirely.
 */

const NOW = () => new Date();

/** Undated sources sort deterministically without WS-15 inventing a timestamp. */
const UNDATED_EPOCH = new Date(0);

/** `offer_versions.expiry_date` is a DATE column and arrives as a string. */
function offerExpiry(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Batch-joins employee names once per provider, never per item. */
export async function nameMap(organizationId: number, employeeIds: number[]) {
  const ids = [...new Set(employeeIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map<number, { firstName: string; lastName: string }>();
  const rows = await db
    .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
    .from(employeesTable)
    .where(and(eq(employeesTable.organizationId, organizationId), inArray(employeesTable.id, ids)));
  return new Map(rows.map((r) => [r.id, { firstName: r.firstName, lastName: r.lastName }]));
}

export function withName(
  names: Map<number, { firstName: string; lastName: string }>,
  employeeId: number | null,
): Pick<ActionItem, "employeeId" | "employeeFirstName" | "employeeLastName"> {
  if (employeeId == null) return { employeeId: null, employeeFirstName: null, employeeLastName: null };
  const n = names.get(employeeId);
  return {
    employeeId,
    employeeFirstName: n?.firstName ?? null,
    employeeLastName: n?.lastName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Leave (§31.27) — inline approve/reject
// ---------------------------------------------------------------------------

const leaveProvider: ActionProvider = {
  sourceModule: "leave",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "leave")).enabled) return false;
    return hasPermission(ctx.membershipId, "leave_request.approve");
  },
  async query(ctx) {
    // Department-Head-scoped for a plain approver, organization-wide for a
    // holder of leave_request.manage — the identical resolution Manager Portal
    // already uses, not a second interpretation of Leave's authority.
    const isOrgWideHr = await hasPermission(ctx.membershipId, "leave_request.manage");
    const headedDepartmentIds = isOrgWideHr
      ? []
      : await listDepartmentsHeadedByMembership(ctx.organizationId, ctx.membershipId);
    if (!isOrgWideHr && headedDepartmentIds.length === 0) return [];

    const visible = await listPendingApprovals(ctx.organizationId, { isOrgWideHr, headedDepartmentIds });
    // My Actions carries only requests at a stage THIS actor can decide: a
    // request still with the Department Head is visible to HR but is not
    // HR's to approve, and offering inline approve/reject on it would only
    // earn a NotAuthorizedForStageError. Oversight keeps the full visible
    // queue, deep-link only.
    const isOversight = ctx.scope === "oversight";
    const requests = isOversight
      ? visible
      : (
          await partitionPendingApprovalsForActor(ctx.organizationId, visible, {
            membershipId: ctx.membershipId,
            employeeId: await resolveOwnEmployeeId(ctx.organizationId, ctx.applicationUserId),
            isHr: isOrgWideHr,
          })
        ).actionable;
    const names = await nameMap(
      ctx.organizationId,
      requests.map((r) => r.employeeId),
    );
    return requests.map((r) => ({
      sourceModule: "leave" as const,
      sourceType: "leave_request",
      sourceId: r.id,
      actionKind: "approve" as const,
      // Never the leave reason (§31.14) — the Manager Portal precedent exactly.
      title: "Leave request",
      ...withName(names, r.employeeId),
      status: r.status,
      createdAt: r.createdAt,
      dueAt: null,
      overdue: null,
      deepLink: "/leave-approvals",
      inlineCommands: (isOversight ? [] : ["leave.approve", "leave.reject"]) as never,
    }));
  },
};

// ---------------------------------------------------------------------------
// Learning (§31.27) — inline approve/reject
// ---------------------------------------------------------------------------

const learningProvider: ActionProvider = {
  sourceModule: "learning",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "learning")).enabled) return false;
    return (
      (await hasPermission(ctx.membershipId, "learning.review.write")) ||
      (await hasPermission(ctx.membershipId, "learning.manage"))
    );
  },
  async query(ctx) {
    const managerEmployeeId = await resolveLearningActorEmployeeId(ctx.organizationId, ctx.applicationUserId);
    if (managerEmployeeId == null) return [];
    // Learning's own manager-of-record snapshot, never a live relationship —
    // substituting one for the other is exactly what Manager Portal's own
    // header warns against.
    const enrollments = (await listTeamEnrollments(ctx.organizationId, managerEmployeeId)).filter(
      (e) => e.approvalStatus === "pending",
    );
    const names = await nameMap(
      ctx.organizationId,
      enrollments.map((e) => e.employeeId),
    );
    return enrollments.map((e) => ({
      sourceModule: "learning" as const,
      sourceType: "learning_enrollment",
      sourceId: e.id,
      actionKind: "approve" as const,
      title: e.courseTitleSnapshot,
      ...withName(names, e.employeeId),
      status: e.approvalStatus,
      createdAt: e.createdAt,
      dueAt: e.dueDate ?? null,
      overdue: deriveOverdue(e.dueDate ?? null, NOW()),
      deepLink: "/learning-enrollments",
      inlineCommands: ["learning.approve", "learning.reject"] as never,
    }));
  },
};

// ---------------------------------------------------------------------------
// Onboarding (§31.27) — inline complete
// ---------------------------------------------------------------------------

const onboardingProvider: ActionProvider = {
  sourceModule: "onboarding",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, ONBOARDING_MODULE_KEY)).enabled) return false;
    if (ctx.scope === "oversight") return hasPermission(ctx.membershipId, "onboarding.read");
    return hasPermission(ctx.membershipId, "onboarding.task.complete");
  },
  async query(ctx) {
    const rows = await db
      .select({ task: onboardingTasksTable, employeeId: onboardingInstancesTable.employeeId })
      .from(onboardingTasksTable)
      .innerJoin(onboardingInstancesTable, eq(onboardingInstancesTable.id, onboardingTasksTable.instanceId))
      .where(
        and(
          eq(onboardingTasksTable.organizationId, ctx.organizationId),
          eq(onboardingTasksTable.status, "pending"),
          inArray(onboardingInstancesTable.status, ["not_started", "in_progress"]),
        ),
      );

    // My Actions narrows to tasks this actor is CURRENTLY responsible for,
    // through WS-10's own resolver. Note the shipped completion route gates on
    // `onboarding.task.complete` alone; requiring responsibility as well is
    // strictly more restrictive, so WS-15 can never offer an action the module
    // would refuse — the invariant that matters (§31.7).
    const mine: typeof rows = [];
    if (ctx.scope === "oversight") {
      mine.push(...rows);
    } else {
      for (const row of rows) {
        const responsible = await isCurrentlyResponsible(
          ctx.organizationId,
          row.employeeId,
          {
            resolver: row.task.responsibleResolver,
            permissionKey: row.task.responsiblePermissionKey,
            membershipId: row.task.responsibleMembershipId,
          },
          ctx.membershipId,
        );
        if (responsible) mine.push(row);
      }
    }

    const canComplete = await hasPermission(ctx.membershipId, "onboarding.task.complete");
    const names = await nameMap(
      ctx.organizationId,
      mine.map((r) => r.employeeId),
    );
    return mine.map((r) => ({
      sourceModule: "onboarding" as const,
      sourceType: "onboarding_task",
      sourceId: r.task.id,
      actionKind: "complete" as const,
      title: r.task.title,
      ...withName(names, r.employeeId),
      status: r.task.status,
      createdAt: r.task.createdAt,
      dueAt: r.task.dueAt ?? null,
      overdue: deriveOverdue(r.task.dueAt ?? null, NOW()),
      deepLink: "/onboarding",
      // Oversight may see the task without being the one who may tick it.
      inlineCommands: (ctx.scope === "oversight" || !canComplete ? [] : ["onboarding.complete"]) as never,
    }));
  },
};

// ---------------------------------------------------------------------------
// WS-14 skills (§31.27) — inline verification decision
// ---------------------------------------------------------------------------

const skillsProvider: ActionProvider = {
  sourceModule: "skills",
  async authorize(ctx) {
    if (ctx.scope === "oversight") return hasPermission(ctx.membershipId, "employee_skill.read");
    return hasPermission(ctx.membershipId, "skill_verification.decide");
  },
  async query(ctx) {
    const records = (await capability.listRecords(ctx.organizationId, {})).filter(
      (r) => r.status === "claimed" || r.status === "assessed",
    );
    if (records.length === 0) return [];

    const skillIds = [...new Set(records.map((r) => r.skillId))];
    const skills = await db
      .select({ id: skillsTable.id, name: skillsTable.name })
      .from(skillsTable)
      .where(and(eq(skillsTable.organizationId, ctx.organizationId), inArray(skillsTable.id, skillIds)));
    const skillNameById = new Map(skills.map((s) => [s.id, s.name]));

    const canDecide = ctx.scope !== "oversight" && (await hasPermission(ctx.membershipId, "skill_verification.decide"));
    const names = await nameMap(
      ctx.organizationId,
      records.map((r) => r.employeeId),
    );
    return records.map((r) => ({
      sourceModule: "skills" as const,
      sourceType: "employee_skill_record",
      sourceId: r.id,
      actionKind: "verify" as const,
      title: skillNameById.get(r.skillId) ?? "Skill verification",
      ...withName(names, r.employeeId),
      status: r.status,
      createdAt: r.createdAt,
      dueAt: null,
      overdue: null,
      deepLink: "/capability",
      inlineCommands: (canDecide ? ["skill.verify", "skill.reject"] : []) as never,
    }));
  },
};

// ---------------------------------------------------------------------------
// Deep-link-only providers (§31.9, §31.27)
// ---------------------------------------------------------------------------

const performanceProvider: ActionProvider = {
  sourceModule: "performance",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "performance")).enabled) return false;
    return hasPermission(ctx.membershipId, "performance.review.write");
  },
  async query(ctx) {
    const reviewerEmployeeId = await resolvePerformanceActorEmployeeId(ctx.organizationId, ctx.applicationUserId);
    if (reviewerEmployeeId == null) return [];
    // Performance's reviewer-of-record snapshot, not a live manager relationship.
    const reviews = (await listTeamReviews(ctx.organizationId, reviewerEmployeeId)).filter(
      (r) => r.status === "manager_review",
    );
    if (reviews.length === 0) return [];

    const cycleIds = [...new Set(reviews.map((r) => r.cycleId))];
    const cycles = await db
      .select({ id: performanceCyclesTable.id, name: performanceCyclesTable.name })
      .from(performanceCyclesTable)
      .where(inArray(performanceCyclesTable.id, cycleIds));
    const cycleNameById = new Map(cycles.map((c) => [c.id, c.name]));

    const names = await nameMap(
      ctx.organizationId,
      reviews.map((r) => r.employeeId),
    );
    return reviews.map((r) => ({
      sourceModule: "performance" as const,
      sourceType: "performance_review",
      sourceId: r.id,
      actionKind: "review" as const,
      // A cycle name, never a score, a rating or review content (§31.14).
      title: `Performance review — ${cycleNameById.get(r.cycleId) ?? "Cycle"}`,
      ...withName(names, r.employeeId),
      status: r.status,
      createdAt: r.createdAt,
      dueAt: null,
      overdue: null,
      deepLink: "/performance-team",
      inlineCommands: [] as never,
    }));
  },
};

const requisitionProvider: ActionProvider = {
  sourceModule: "recruitment",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "recruitment")).enabled) return false;
    return hasPermission(ctx.membershipId, "requisition.approve");
  },
  async query(ctx) {
    const requisitions = await listPendingRequisitionApprovals(ctx.organizationId);
    return requisitions.map((r) => ({
      sourceModule: "recruitment" as const,
      sourceType: "job_requisition",
      sourceId: r.id,
      actionKind: "approve" as const,
      title: "Requisition approval",
      employeeId: null,
      employeeFirstName: null,
      employeeLastName: null,
      status: r.status,
      createdAt: r.createdAt,
      dueAt: null,
      overdue: null,
      deepLink: "/requisition-approvals",
      // Staged approval is complex workflow and stays in-module (§31.9).
      inlineCommands: [] as never,
    }));
  },
};

const offerProvider: ActionProvider = {
  sourceModule: "recruitment",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "recruitment")).enabled) return false;
    return hasPermission(ctx.membershipId, "offer.approve");
  },
  async query(ctx) {
    const offers = await listPendingOfferApprovals(ctx.organizationId);
    return offers.map((o) => ({
      sourceModule: "recruitment" as const,
      sourceType: "offer_version",
      sourceId: o.id,
      actionKind: "approve" as const,
      // No particulars, no salary, no terms in the row (§31.14).
      title: "Offer approval",
      employeeId: null,
      employeeFirstName: null,
      employeeLastName: null,
      status: o.status,
      createdAt: o.createdAt,
      // `expiry_date` is a DATE column, so it arrives as a string; parsed once
      // here rather than leaking a string into the frozen Date contract.
      dueAt: offerExpiry(o.expiryDate),
      overdue: deriveOverdue(offerExpiry(o.expiryDate), NOW()),
      deepLink: "/offers",
      inlineCommands: [] as never,
    }));
  },
};

const dataChangeProvider: ActionProvider = {
  sourceModule: "employee_requests",
  async authorize(ctx) {
    if (ctx.scope === "my_actions") return hasPermission(ctx.membershipId, "data_change.approve");
    return hasPermission(ctx.membershipId, "data_change.read");
  },
  async query(ctx) {
    const all = await dataChange.listRequests(ctx.organizationId, {});
    const open = all.filter((r) => r.status === "pending" || r.status === "returned" || r.status === "stale");
    const names = await nameMap(
      ctx.organizationId,
      open.map((r) => r.employeeId),
    );
    return open.map((r) => ({
      sourceModule: "employee_requests" as const,
      sourceType: "data_change_request",
      sourceId: r.id,
      actionKind: "decide" as const,
      // No field label and no proposed value: a data-change row names the work,
      // not its content. OD #23 masking lives in WS-13's own approval view, and
      // this row never becomes a route around it (§31.14).
      title: "Employee data change",
      ...withName(names, r.employeeId),
      status: r.status,
      createdAt: r.requestedAt,
      dueAt: null,
      overdue: null,
      deepLink: "/requests",
      // Maker-checker, stale detection and application stay entirely WS-13's (§31.9).
      inlineCommands: [] as never,
    }));
  },
};

const serviceRequestProvider: ActionProvider = {
  sourceModule: "employee_requests",
  async authorize(ctx) {
    if (ctx.scope === "my_actions") return hasPermission(ctx.membershipId, "service_request.manage");
    return hasPermission(ctx.membershipId, "service_request.read");
  },
  async query(ctx) {
    // Assigned Work is the one scope with a genuine assignment concept here
    // (§31.10) — it is never fabricated for the dynamic-authority sources.
    const filters =
      ctx.scope === "assigned" ? { assignedMembershipId: ctx.membershipId } : ({} as Record<string, never>);
    const all = await serviceRequests.listRequests(ctx.organizationId, filters);
    const open = all.filter(
      (r) => r.status === "submitted" || r.status === "acknowledged" || r.status === "in_progress",
    );
    if (open.length === 0) return [];

    const typeIds = [...new Set(open.map((r) => r.typeId))];
    const types = await db
      .select({
        id: serviceRequestTypesTable.id,
        name: serviceRequestTypesTable.name,
        targetDays: serviceRequestTypesTable.targetDays,
      })
      .from(serviceRequestTypesTable)
      .where(
        and(
          eq(serviceRequestTypesTable.organizationId, ctx.organizationId),
          inArray(serviceRequestTypesTable.id, typeIds),
        ),
      );
    const typeById = new Map(types.map((t) => [t.id, t]));

    const names = await nameMap(
      ctx.organizationId,
      open.map((r) => r.employeeId),
    );
    return open.map((r) => {
      const type = typeById.get(r.typeId);
      // WS-13's OWN SEMANTICS ONLY: a configured target in days from
      // submission, never an SLA this workstream invents and never derived from
      // age (§31.16).
      const dueAt =
        type?.targetDays != null && r.submittedAt != null
          ? new Date(r.submittedAt.getTime() + type.targetDays * 86_400_000)
          : null;
      return {
        sourceModule: "employee_requests" as const,
        sourceType: "service_request",
        sourceId: r.id,
        actionKind: "fulfil" as const,
        // The request TYPE, never the employee's free-text subject or details.
        title: type?.name ?? "HR service request",
        ...withName(names, r.employeeId),
        status: r.status,
        createdAt: r.submittedAt,
        dueAt,
        overdue: deriveOverdue(dueAt, NOW()),
        deepLink: "/requests",
        inlineCommands: [] as never,
      };
    });
  },
};

const grievanceProvider: ActionProvider = {
  sourceModule: "employee_relations",
  async authorize(ctx) {
    // `grievance.read` is deliberately withheld from org_admin (§28.17). A
    // failure here makes the whole source vanish — no row, no count, nothing to
    // infer from (§31.11).
    return hasPermission(ctx.membershipId, "grievance.read");
  },
  async query(ctx) {
    const all = await grievance.listCases(ctx.organizationId, {});
    const open = all
      .filter((c) => c.status === "submitted" || c.status === "acknowledged" || c.status === "under_review")
      // Grievance's own list function takes no assignee filter, so Assigned Work
      // narrows on the column WS-12 already owns rather than WS-15 adding one.
      .filter((c) => ctx.scope !== "assigned" || c.assignedMembershipId === ctx.membershipId);
    return open.map((c) => ({
      sourceModule: "employee_relations" as const,
      sourceType: "grievance_case",
      sourceId: c.id,
      actionKind: "decide" as const,
      // CASE REFERENCE ONLY. No narrative, no evidence, and deliberately NO
      // SUBJECT NAME — naming the complainant is itself the disclosure §31.14
      // forbids, so the employee fields stay null even for an authorized reader.
      title: `Grievance case #${c.id}`,
      employeeId: null,
      employeeFirstName: null,
      employeeLastName: null,
      status: c.status,
      createdAt: c.submittedAt,
      dueAt: null,
      overdue: null,
      deepLink: "/employee-relations",
      inlineCommands: [] as never,
    }));
  },
};

const disciplinaryProvider: ActionProvider = {
  sourceModule: "employee_relations",
  async authorize(ctx) {
    return hasPermission(ctx.membershipId, "employee_relations.read");
  },
  async query(ctx) {
    const open = await disciplinary.listCases(ctx.organizationId, { status: "open" });
    return open.map((c) => ({
      sourceModule: "employee_relations" as const,
      sourceType: "disciplinary_case",
      sourceId: c.id,
      actionKind: "decide" as const,
      // Case reference only — no stage detail, no allegation, no evidence.
      title: `Disciplinary case #${c.id}`,
      employeeId: null,
      employeeFirstName: null,
      employeeLastName: null,
      status: c.status,
      createdAt: c.openedAt,
      dueAt: null,
      overdue: null,
      deepLink: "/employee-relations",
      inlineCommands: [] as never,
    }));
  },
};

const clearanceProvider: ActionProvider = {
  sourceModule: "employee_relations",
  async authorize(ctx) {
    // Clearance is operational rather than confidential-evidence work (§28), so
    // it uses the offboarding read key rather than the grievance one.
    return hasPermission(ctx.membershipId, "offboarding.read");
  },
  async query(ctx) {
    // Department-scoped for a plain clearance desk; organization-wide for a
    // holder of offboarding.manage.
    const isOrgWide = await hasPermission(ctx.membershipId, "offboarding.manage");
    const headed = isOrgWide ? [] : await listDepartmentsHeadedByMembership(ctx.organizationId, ctx.membershipId);
    if (!isOrgWide && headed.length === 0) return [];

    const rows = isOrgWide
      ? await outstandingClearance(ctx.organizationId)
      : (
          await Promise.all(
            headed.map((departmentId) => outstandingClearance(ctx.organizationId, { responsibleDepartmentId: departmentId })),
          )
        ).flat();

    const names = await nameMap(
      ctx.organizationId,
      rows.map((r) => r.employeeId),
    );
    return rows.map((r) => ({
      sourceModule: "employee_relations" as const,
      sourceType: "clearance_item",
      sourceId: r.clearanceItemId,
      actionKind: "complete" as const,
      title: r.label,
      ...withName(names, r.employeeId),
      status: r.status,
      // The clearance read model carries no timestamp, and WS-15 does not add
      // one: an invented createdAt would be a fabricated fact. Undated items
      // sort by this stable epoch and then by source id (§31.18).
      createdAt: UNDATED_EPOCH,
      dueAt: null,
      overdue: null,
      deepLink: "/offboarding",
      inlineCommands: [] as never,
    }));
  },
};

const successionProvider: ActionProvider = {
  sourceModule: "succession",
  async authorize(ctx) {
    // `succession.manage` is withheld from org_admin by default (§30.17). As
    // with grievances, a false here erases the source entirely.
    return hasPermission(ctx.membershipId, "succession.manage");
  },
  async query(ctx) {
    const plans = await succession.listPlans(ctx.organizationId, {});
    const asOf = NOW();
    const due = plans.filter(
      (p) => p.status !== "closed" && p.reviewDueAt != null && p.reviewDueAt.getTime() <= asOf.getTime(),
    );
    return due.map((p) => ({
      sourceModule: "succession" as const,
      sourceType: "succession_plan",
      sourceId: p.id,
      actionKind: "review" as const,
      // NAMES NOTHING: not the position, not a candidate, not a readiness band,
      // not a criticality note (§30.17, §31.14). The generic label is the point.
      title: "Succession plan review due",
      employeeId: null,
      employeeFirstName: null,
      employeeLastName: null,
      status: p.status,
      createdAt: p.createdAt,
      dueAt: p.reviewDueAt,
      overdue: deriveOverdue(p.reviewDueAt, asOf),
      deepLink: "/succession",
      // No inline succession decision, readiness change, nomination or removal.
      inlineCommands: [] as never,
    }));
  },
};

const lifecycleProvider: ActionProvider = {
  sourceModule: "employment_lifecycle",
  async authorize(ctx) {
    return hasPermission(ctx.membershipId, "employment_lifecycle.read");
  },
  async query(ctx) {
    const config = await resolveEmploymentLifecycleConfig(ctx.organizationId);
    const expiring = await findExpiringTerms(ctx.organizationId, config.contractExpiryReminderDaysBefore);
    const names = await nameMap(
      ctx.organizationId,
      expiring.map((e) => e.term.employeeId),
    );
    return expiring.map(({ term, state }) => ({
      sourceModule: "employment_lifecycle" as const,
      sourceType: "employment_term",
      sourceId: term.id,
      actionKind: "review" as const,
      title: "Fixed-term contract expiring",
      ...withName(names, term.employeeId),
      status: state,
      createdAt: term.createdAt,
      // §31.16: a contract end date is a fact about employment, not a deadline
      // for the actor reading this row. Relabelling it as `dueAt` would
      // misrepresent what the source means.
      dueAt: null,
      overdue: null,
      deepLink: `/employees/${term.employeeId}`,
      inlineCommands: [] as never,
    }));
  },
};

/**
 * The frozen P1 provider set (§31.27).
 *
 * Payroll is DEFERRED and Assets, Office Inventory and Attendance are EXCLUDED
 * — deliberately absent, not forgotten. Adding one is an architecture change.
 */
export const P1_PROVIDERS: readonly ActionProvider[] = [
  leaveProvider,
  learningProvider,
  onboardingProvider,
  skillsProvider,
  performanceProvider,
  requisitionProvider,
  offerProvider,
  dataChangeProvider,
  serviceRequestProvider,
  grievanceProvider,
  disciplinaryProvider,
  clearanceProvider,
  successionProvider,
  lifecycleProvider,
];

/** Sources that genuinely support Assigned Work (§31.10). Assignment is never fabricated. */
export const ASSIGNABLE_PROVIDERS: readonly ActionProvider[] = [serviceRequestProvider, grievanceProvider];
