import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  onboardingTasksTable,
  onboardingInstancesTable,
  documentAcknowledgementsTable,
  organizationDocumentsTable,
  serviceRequestsTable,
  serviceRequestTypesTable,
} from "@workspace/db";
import { getModuleAccess } from "../organizationModules";
import { resolveOwnEmployeeId } from "../leaveRequests";
import { ONBOARDING_MODULE_KEY } from "../onboarding/moduleKey";
import { type ActionItem, deriveOverdue } from "./types";

/**
 * WS-15 — ESS My Actions (§31.13).
 *
 * EXACTLY THREE SOURCES, AND THE NARROWNESS IS THE DESIGN. Only work the
 * employee is genuinely being asked to do appears here: an onboarding task
 * assigned to them, a document awaiting their acknowledgement, and a service
 * request the organization has put back to them.
 *
 * Own Leave history, Learning progress, performance history, a skill claim
 * merely awaiting HR, Payroll, grievances, succession and general notifications
 * are DELIBERATELY EXCLUDED. None is work the employee must do, and treating
 * "pending somewhere else" as "your action" would make this surface dishonest —
 * a to-do list nobody can empty. Extending this list is an architecture change.
 *
 * THE SUBJECT IS SERVER-DERIVED ON EVERY REQUEST. `resolveOwnEmployeeId` reads
 * the employee link; no request carries an employee identifier and none is read
 * if one is supplied, so tampering cannot surface somebody else's work.
 *
 * NOTHING CONFIDENTIAL REACHES THIS SURFACE. A row carries a document or task
 * label and a date. There is no grievance, no succession, no pay figure and no
 * case content anywhere in it.
 */

export async function resolveEssActions(
  organizationId: number,
  applicationUserId: number,
): Promise<{ linked: boolean; items: ActionItem[] }> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  // Not linked is a legitimate state, not an error — the same shape Manager
  // Portal and My Onboarding already use.
  if (!employeeId) return { linked: false, items: [] };

  const asOf = new Date();
  const items: ActionItem[] = [];

  // Both onboarding sources sit behind the Onboarding module, so an
  // organization with it disabled correctly sees neither (§31.13).
  const onboardingEnabled = (await getModuleAccess(organizationId, ONBOARDING_MODULE_KEY)).enabled;

  if (onboardingEnabled) {
    // 1. Onboarding tasks this employee owns themselves.
    const tasks = await db
      .select({ task: onboardingTasksTable })
      .from(onboardingTasksTable)
      .innerJoin(onboardingInstancesTable, eq(onboardingInstancesTable.id, onboardingTasksTable.instanceId))
      .where(
        and(
          eq(onboardingTasksTable.organizationId, organizationId),
          eq(onboardingInstancesTable.employeeId, employeeId),
          eq(onboardingTasksTable.status, "pending"),
          eq(onboardingTasksTable.responsibleResolver, "employee_self"),
          inArray(onboardingInstancesTable.status, ["not_started", "in_progress"]),
        ),
      );

    for (const { task } of tasks) {
      items.push({
        sourceModule: "onboarding",
        sourceType: "onboarding_task",
        sourceId: task.id,
        actionKind: "complete",
        title: task.title,
        employeeId,
        employeeFirstName: null,
        employeeLastName: null,
        status: task.status,
        createdAt: task.createdAt,
        dueAt: task.dueAt ?? null,
        overdue: deriveOverdue(task.dueAt ?? null, asOf),
        deepLink: "/my-onboarding",
        inlineCommands: [],
      });
    }

    // 2. Documents awaiting this employee's acknowledgement.
    const acknowledgements = await db
      .select({
        ack: documentAcknowledgementsTable,
        documentTitle: organizationDocumentsTable.title,
      })
      .from(documentAcknowledgementsTable)
      .leftJoin(
        organizationDocumentsTable,
        eq(organizationDocumentsTable.id, documentAcknowledgementsTable.documentId),
      )
      .where(
        and(
          eq(documentAcknowledgementsTable.organizationId, organizationId),
          eq(documentAcknowledgementsTable.employeeId, employeeId),
          eq(documentAcknowledgementsTable.status, "pending"),
        ),
      );

    for (const row of acknowledgements) {
      items.push({
        sourceModule: "onboarding",
        sourceType: "document_acknowledgement",
        sourceId: row.ack.id,
        actionKind: "acknowledge",
        // A document title, never its content.
        title: row.documentTitle ?? "Document acknowledgement",
        employeeId,
        employeeFirstName: null,
        employeeLastName: null,
        status: row.ack.status,
        createdAt: row.ack.createdAt,
        dueAt: row.ack.dueAt ?? null,
        overdue: deriveOverdue(row.ack.dueAt ?? null, asOf),
        deepLink: "/my-onboarding",
        inlineCommands: [],
      });
    }
  }

  // 3. Service requests the organization has put back to this employee.
  const requests = await db
    .select({ request: serviceRequestsTable, typeName: serviceRequestTypesTable.name })
    .from(serviceRequestsTable)
    .leftJoin(serviceRequestTypesTable, eq(serviceRequestTypesTable.id, serviceRequestsTable.typeId))
    .where(
      and(
        eq(serviceRequestsTable.organizationId, organizationId),
        eq(serviceRequestsTable.employeeId, employeeId),
        eq(serviceRequestsTable.status, "awaiting_employee"),
      ),
    );

  for (const row of requests) {
    items.push({
      sourceModule: "employee_requests",
      sourceType: "service_request",
      sourceId: row.request.id,
      actionKind: "complete",
      // The request type, never the employee's own free-text details.
      title: row.typeName ?? "HR service request",
      employeeId,
      employeeFirstName: null,
      employeeLastName: null,
      status: row.request.status,
      createdAt: row.request.submittedAt,
      dueAt: null,
      overdue: null,
      deepLink: "/my-requests",
      inlineCommands: [],
    });
  }

  // The same four-tier order as the HR queue (§31.18), applied here so an
  // employee's overdue acknowledgement sits above an undated request.
  const { sortActionItems } = await import("./aggregate");
  return { linked: true, items: sortActionItems(items) };
}
