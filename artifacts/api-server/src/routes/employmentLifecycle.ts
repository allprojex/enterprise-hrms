import { Router } from "express";
import { and, eq, desc, isNull } from "drizzle-orm";
import {
  db,
  employeesTable,
  positionsTable,
  employmentPeriodsTable,
  assetAssignmentsTable,
  officeInventoryStockMovementsTable,
  personnelFilesTable,
  type EmploymentTerm,
  type EmploymentAssignment,
} from "@workspace/db";
import {
  CreateEmploymentTermBody,
  RenewEmploymentTermBody,
  CloseEmploymentTermBody,
  StartEmploymentAssignmentBody,
  EndEmploymentAssignmentBody,
  ExtendProbationBody,
  RecordUnsuccessfulProbationBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { isSystemEventType, labelForEventType } from "../lib/employmentLifecycle/eventTypes";
import { resolveEmploymentLifecycleConfig } from "../lib/employmentLifecycle/config";
import {
  listTerms,
  getActiveTerm,
  getTerm,
  createTerm,
  renewTerm,
  closeTerm,
  findExpiringTerms,
  deriveExpiryState,
  EmploymentTermNotFoundError,
  EmployeeNotFoundForTermError,
  InvalidEmploymentTermError,
  ActiveTermAlreadyExistsError,
  TermNotActiveError,
} from "../lib/employmentLifecycle/employmentTerms";
import {
  listAssignments,
  getOpenAssignment,
  startAssignment,
  endAssignment,
  EmploymentAssignmentNotFoundError,
  EmployeeNotFoundForAssignmentError,
  InvalidAssignmentError,
  AssignmentAlreadyOpenError,
  AssignmentAlreadyEndedError,
  AssignmentTypeNotEnabledError,
} from "../lib/employmentLifecycle/assignments";
import {
  extendProbation,
  recordUnsuccessfulProbation,
  resolveProbationEnd,
  countExtensions,
  hasUnsuccessfulOutcome,
  EmployeeNotFoundForProbationError,
  EmployeeNotOnProbationForActionError,
  InvalidProbationExtensionError,
  ProbationExtensionsNotPermittedError,
  ProbationExtensionLimitReachedError,
  InvalidProbationReviewError,
} from "../lib/employmentLifecycle/probation";
import { scheduleProbationReminder, scheduleContractExpiryReminder } from "../lib/employmentLifecycle/reminders";

const router = Router();

/**
 * WS-11 — employment lifecycle (§27).
 *
 * EXPLICIT DOMAIN ROUTES ONLY. There is deliberately no
 * `POST /employee-lifecycle/{eventType}`: such an endpoint would let a client
 * name its own system event type and forge, say, a confirmation. Every route
 * below performs one named business operation, and the event it writes is
 * chosen by the server.
 *
 * Two boundaries are visible in the responses rather than merely documented:
 * nothing here separates anyone, and expiry/overdue are computed at read time
 * rather than stored.
 */

function mapDomainError(err: unknown, res: import("express").Response): boolean {
  if (
    err instanceof InvalidEmploymentTermError ||
    err instanceof TermNotActiveError ||
    err instanceof EmployeeNotFoundForTermError ||
    err instanceof EmployeeNotFoundForAssignmentError ||
    err instanceof InvalidAssignmentError ||
    err instanceof AssignmentAlreadyEndedError ||
    err instanceof AssignmentTypeNotEnabledError ||
    err instanceof EmployeeNotOnProbationForActionError ||
    err instanceof InvalidProbationExtensionError ||
    err instanceof ProbationExtensionsNotPermittedError ||
    err instanceof ProbationExtensionLimitReachedError ||
    err instanceof InvalidProbationReviewError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (
    err instanceof EmploymentTermNotFoundError ||
    err instanceof EmploymentAssignmentNotFoundError ||
    err instanceof EmployeeNotFoundForProbationError
  ) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof ActiveTermAlreadyExistsError || err instanceof AssignmentAlreadyOpenError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

function serializeTerm(term: EmploymentTerm, warningDays: number, asOf: Date): EmploymentTerm & { expiryState: string } {
  return { ...term, expiryState: deriveExpiryState(term, warningDays, asOf) };
}

async function serializeAssignment(
  assignment: EmploymentAssignment,
  asOf: Date,
): Promise<EmploymentAssignment & { overdue: boolean; actingPositionTitle: string | null }> {
  let actingPositionTitle: string | null = null;
  if (assignment.actingPositionId) {
    const [position] = await db
      .select({ title: positionsTable.title })
      .from(positionsTable)
      .where(eq(positionsTable.id, assignment.actingPositionId))
      .limit(1);
    actingPositionTitle = position?.title ?? null;
  }
  return {
    ...assignment,
    actingPositionTitle,
    overdue:
      assignment.actualEndDate == null &&
      assignment.expectedEndDate != null &&
      assignment.expectedEndDate.getTime() < asOf.getTime(),
  };
}

async function buildProbationState(organizationId: number, employeeId: number) {
  const [employee] = await db
    .select({ employmentStatus: employeesTable.employmentStatus })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  const resolved = await resolveProbationEnd(organizationId, employeeId);
  return {
    employeeId,
    onProbation: employee?.employmentStatus === "probation",
    probationEndDate: resolved.probationEndDate,
    probationEndSource: resolved.source,
    extensionCount: await countExtensions(organizationId, employeeId),
    unsuccessfulOutcomeRecorded: await hasUnsuccessfulOutcome(organizationId, employeeId),
  };
}

// ---------------------------------------------------------------------------
// Combined lifecycle state + history
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/employees/:employeeId/employment-lifecycle",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = Number(req.params["employeeId"]);
    const asOf = new Date();

    const [employee] = await db
      .select({ id: employeesTable.id, positionId: employeesTable.positionId })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
      .limit(1);
    if (!employee) {
      res.status(404).json({ error: "Employee not found in this organization." });
      return;
    }

    let substantivePositionTitle: string | null = null;
    if (employee.positionId) {
      const [position] = await db
        .select({ title: positionsTable.title })
        .from(positionsTable)
        .where(eq(positionsTable.id, employee.positionId))
        .limit(1);
      substantivePositionTitle = position?.title ?? null;
    }

    const config = await resolveEmploymentLifecycleConfig(organizationId);
    const currentTerm = await getActiveTerm(organizationId, employeeId);
    const acting = await getOpenAssignment(organizationId, employeeId, "acting");
    const secondment = await getOpenAssignment(organizationId, employeeId, "secondment");

    const rows = await db
      .select()
      .from(employmentPeriodsTable)
      .where(
        and(eq(employmentPeriodsTable.organizationId, organizationId), eq(employmentPeriodsTable.employeeId, employeeId)),
      )
      .orderBy(desc(employmentPeriodsTable.effectiveDate), desc(employmentPeriodsTable.id));

    res.json({
      employeeId,
      // The substantive position, always reported separately from any acting
      // assignment — they are different facts (§27.12).
      substantivePositionId: employee.positionId,
      substantivePositionTitle,
      currentTerm: currentTerm ? serializeTerm(currentTerm, config.contractExpiryReminderDaysBefore, asOf) : null,
      currentActingAssignment: acting ? await serializeAssignment(acting, asOf) : null,
      currentSecondment: secondment ? await serializeAssignment(secondment, asOf) : null,
      probation: await buildProbationState(organizationId, employeeId),
      history: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        // Imported history is rendered as recorded and flagged as non-system,
        // so a client can never mistake it for a controlled transition (§27.19).
        label: labelForEventType(row.eventType),
        isSystemEvent: isSystemEventType(row.eventType),
        effectiveDate: row.effectiveDate,
        previousState: row.previousState,
        newState: row.newState,
        createdAt: row.createdAt,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// Employment terms
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/employment-terms/expiring",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const rawAsOf = req.query["asOf"];
    const asOf = typeof rawAsOf === "string" && rawAsOf ? new Date(rawAsOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      res.status(400).json({ error: "asOf is not a valid date." });
      return;
    }
    const config = await resolveEmploymentLifecycleConfig(organizationId);
    const rows = await findExpiringTerms(organizationId, config.contractExpiryReminderDaysBefore, asOf);

    const items = [];
    for (const row of rows) {
      const [employee] = await db
        .select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName })
        .from(employeesTable)
        .where(eq(employeesTable.id, row.term.employeeId))
        .limit(1);
      items.push({
        term: serializeTerm(row.term, config.contractExpiryReminderDaysBefore, asOf),
        state: row.state,
        employeeName: employee ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") : null,
      });
    }
    res.json({ items });
  },
);

router.get(
  "/organizations/:organizationId/employees/:employeeId/employment-terms",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const config = await resolveEmploymentLifecycleConfig(organizationId);
    const asOf = new Date();
    const terms = await listTerms(organizationId, Number(req.params["employeeId"]));
    res.json({ terms: terms.map((t) => serializeTerm(t, config.contractExpiryReminderDaysBefore, asOf)) });
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/employment-terms",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateEmploymentTermBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = req.membership!.organizationId;
      const term = await createTerm({
        organizationId,
        employeeId: Number(req.params["employeeId"]),
        termType: parsed.data.termType as EmploymentTerm["termType"],
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        reason: parsed.data.reason ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      if (term.endDate) {
        const config = await resolveEmploymentLifecycleConfig(organizationId);
        await scheduleContractExpiryReminder({
          organizationId,
          employmentTermId: term.id,
          endDate: term.endDate,
          daysBefore: config.contractExpiryReminderDaysBefore,
          createdBy: req.userId!,
        });
      }
      res.status(201).json(term);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/employment-terms/:termId/renew",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RenewEmploymentTermBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = req.membership!.organizationId;
      const result = await renewTerm({
        organizationId,
        termId: Number(req.params["termId"]),
        termType: parsed.data.termType as EmploymentTerm["termType"],
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        reason: parsed.data.reason ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      if (result.renewed.endDate) {
        const config = await resolveEmploymentLifecycleConfig(organizationId);
        await scheduleContractExpiryReminder({
          organizationId,
          employmentTermId: result.renewed.id,
          endDate: result.renewed.endDate,
          daysBefore: config.contractExpiryReminderDaysBefore,
          createdBy: req.userId!,
        });
      }
      res.json(result);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/employment-terms/:termId/close",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CloseEmploymentTermBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      // Note: closing a term does not separate the employee (§27.6).
      const term = await closeTerm({
        organizationId: req.membership!.organizationId,
        termId: Number(req.params["termId"]),
        reason: parsed.data.reason ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(term);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Probation
// ---------------------------------------------------------------------------

router.post(
  "/organizations/:organizationId/employees/:employeeId/probation/extend",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ExtendProbationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = req.membership!.organizationId;
      const employeeId = Number(req.params["employeeId"]);
      const config = await resolveEmploymentLifecycleConfig(organizationId);
      const newEnd = new Date(parsed.data.newProbationEndDate);

      await extendProbation({
        organizationId,
        employeeId,
        newProbationEndDate: newEnd,
        effectiveDate: new Date(parsed.data.effectiveDate),
        reason: parsed.data.reason,
        probationReviewId: parsed.data.probationReviewId ?? null,
        extensionsAllowed: config.probationExtensionsAllowed,
        maxExtensions: config.maxProbationExtensions,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      await scheduleProbationReminder({
        organizationId,
        employeeId,
        probationEndDate: newEnd,
        daysBefore: config.probationReminderDaysBefore,
        createdBy: req.userId!,
      });

      res.json(await buildProbationState(organizationId, employeeId));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/probation/unsuccessful",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RecordUnsuccessfulProbationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = req.membership!.organizationId;
      const employeeId = Number(req.params["employeeId"]);
      // Records the outcome only. The employee is NOT separated and their
      // employment status is unchanged (§27.8).
      await recordUnsuccessfulProbation({
        organizationId,
        employeeId,
        effectiveDate: new Date(parsed.data.effectiveDate),
        reason: parsed.data.reason,
        probationReviewId: parsed.data.probationReviewId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(await buildProbationState(organizationId, employeeId));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Acting appointments and secondments
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/employees/:employeeId/assignments",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = req.query["assignmentType"];
    const assignmentType = raw === "acting" || raw === "secondment" ? raw : undefined;
    const rows = await listAssignments(
      req.membership!.organizationId,
      Number(req.params["employeeId"]),
      assignmentType,
    );
    const asOf = new Date();
    res.json({ assignments: await Promise.all(rows.map((row) => serializeAssignment(row, asOf))) });
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/assignments",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = StartEmploymentAssignmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const organizationId = req.membership!.organizationId;
      const config = await resolveEmploymentLifecycleConfig(organizationId);
      const assignmentType = parsed.data.assignmentType as EmploymentAssignment["assignmentType"];

      const created = await startAssignment({
        organizationId,
        employeeId: Number(req.params["employeeId"]),
        assignmentType,
        actingPositionId: parsed.data.actingPositionId ?? null,
        actingDepartmentId: parsed.data.actingDepartmentId ?? null,
        destinationDescription: parsed.data.destinationDescription ?? null,
        destinationType: (parsed.data.destinationType ?? null) as EmploymentAssignment["destinationType"],
        startDate: new Date(parsed.data.startDate),
        expectedEndDate: parsed.data.expectedEndDate ? new Date(parsed.data.expectedEndDate) : null,
        reason: parsed.data.reason ?? null,
        enabled: assignmentType === "acting" ? config.actingAppointmentsEnabled : config.secondmentsEnabled,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(await serializeAssignment(created, new Date()));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/assignments/:assignmentId/end",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = EndEmploymentAssignmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const ended = await endAssignment({
        organizationId: req.membership!.organizationId,
        assignmentId: Number(req.params["assignmentId"]),
        actualEndDate: new Date(parsed.data.actualEndDate),
        endReason: parsed.data.endReason ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(await serializeAssignment(ended, new Date()));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Separation readiness — WARNINGS ONLY (§27.20)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/employees/:employeeId/separation-readiness",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employment_lifecycle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = Number(req.params["employeeId"]);

    // Every query below is a READ. Nothing here returns an asset, moves stock,
    // closes a personnel file or blocks separation — those domains own their own
    // transitions, and §27.20 forbids a lifecycle event mutating them.
    const assets = await db
      .select({ id: assetAssignmentsTable.id })
      .from(assetAssignmentsTable)
      .where(
        and(
          eq(assetAssignmentsTable.organizationId, organizationId),
          eq(assetAssignmentsTable.employeeId, employeeId),
          isNull(assetAssignmentsTable.custodyEndedAt),
        ),
      );

    const inventory = await db
      .select({ id: officeInventoryStockMovementsTable.id })
      .from(officeInventoryStockMovementsTable)
      .where(
        and(
          eq(officeInventoryStockMovementsTable.organizationId, organizationId),
          eq(officeInventoryStockMovementsTable.holderType, "employee"),
          eq(officeInventoryStockMovementsTable.holderId, employeeId),
        ),
      );

    const [personnelFile] = await db
      .select({ id: personnelFilesTable.id })
      .from(personnelFilesTable)
      .where(
        and(eq(personnelFilesTable.organizationId, organizationId), eq(personnelFilesTable.employeeId, employeeId)),
      )
      .limit(1);

    const warnings = [];
    if (assets.length > 0) {
      warnings.push({
        kind: "assets",
        count: assets.length,
        message: `${assets.length} asset assignment(s) are still open. Return them through the Assets module.`,
      });
    }
    if (inventory.length > 0) {
      warnings.push({
        kind: "office_inventory",
        count: inventory.length,
        message: `Inventory has been issued to this employee. Reconcile it through the Office Inventory module.`,
      });
    }
    if (personnelFile) {
      warnings.push({
        kind: "personnel_file",
        count: 1,
        message: "A personnel file exists. Confirm its custody through the Personnel Files module.",
      });
    }

    res.json({ employeeId, warnings, blocksSeparation: false });
  },
);

export default router;
