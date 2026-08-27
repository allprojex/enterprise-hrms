/**
 * WS-7 (§5 recon; Owner clarification per the disclosed architectural
 * finding) — employment history.
 *
 * MATERIAL FINDING, resolved here rather than silently assumed:
 * `employment_periods` is NOT a start/end period-range table — it is an
 * append-only, free-text-`eventType` dated event log (transfer/promotion/
 * confirmation/separation/rehire), mirroring `audit_events`' own shape
 * exactly, with no overlap concept because there is nothing to overlap
 * (each row is a discrete point-in-time event, not a range). The WS-7
 * brief's "validate impossible overlaps according to current domain
 * rules" therefore has no rule to apply here — none exists — so this
 * adapter does not invent one. It imports each history row as a single
 * dated event with an explicit `eventType`, `previousState: null` (a
 * fresh migration has no authoritative prior state to reconstruct), and
 * `newState` holding exactly the structured fields the source row
 * supplied. This never touches `employees`' own current-state columns
 * (§18: "do not rewrite historical employment as current employee
 * state") — inserting a history event is the entire effect.
 *
 * Reuses `recordEmploymentPeriodEvent` (lib/employmentLifecycleService.ts)
 * — the same insert path transferEmployee/promoteEmployee/confirmEmployee
 * already use — rather than a bespoke insert.
 */
import { recordEmploymentPeriodEvent } from "../../employmentLifecycleService";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, optionalString, parseDate, toDate } from "../normalizeHelpers";
import { resolveEmployeeRef } from "../referenceResolution";

// The event types the codebase's own live workflows already use
// (transferEmployee/promoteEmployee/confirmEmployee/separate/rehire) are
// offered as the recommended vocabulary, but eventType remains free text
// on the underlying table (matching every other writer of this table) —
// this adapter validates only that it is present and reasonably sized,
// never forcing an imported history row into a stricter taxonomy than the
// domain itself enforces.
const MAX_EVENT_TYPE_LENGTH = 64;

const FIELDS: readonly CanonicalField[] = [
  { key: "employeeNumber", label: "Employee Number", required: true, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number"] },
  { key: "eventType", label: "Event Type", required: true, type: "string", aliases: ["Event Type", "Event"] },
  { key: "effectiveDate", label: "Effective Date", required: true, type: "date", aliases: ["Effective Date", "Date"] },
  { key: "positionTitle", label: "Position Title", required: false, type: "string", aliases: ["Position Title", "Position"] },
  { key: "departmentCode", label: "Department Code", required: false, type: "string", aliases: ["Department Code", "Department"] },
  { key: "branchCode", label: "Branch Code", required: false, type: "string", aliases: ["Branch Code", "Branch"] },
  { key: "notes", label: "Notes", required: false, type: "string", aliases: ["Notes", "Description", "Remarks"] },
];

export const employmentHistoryAdapter: EntityAdapter = {
  entityType: "employment_history",
  label: "Employment History",
  dependsOn: ["employee", "branch", "department", "position"],
  // recordEmploymentPeriodEvent writes via the global db — escapes any
  // outer transaction.
  transactional: false,
  fields: FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const employeeNumber = requiredString(raw.employeeNumber, "employeeNumber", "Employee Number", messages);
    const eventType = requiredString(raw.eventType, "eventType", "Event Type", messages);
    if (eventType && eventType.length > MAX_EVENT_TYPE_LENGTH) {
      messages.push({ field: "eventType", message: `Event Type must be ${MAX_EVENT_TYPE_LENGTH} characters or fewer`, severity: "error" });
    }
    const effectiveDate = parseDate(raw.effectiveDate, "effectiveDate", "Effective Date", true, messages);
    const positionTitle = optionalString(raw.positionTitle);
    const departmentCode = optionalString(raw.departmentCode);
    const branchCode = optionalString(raw.branchCode);
    const notes = optionalString(raw.notes);
    return { data: { employeeNumber, eventType, effectiveDate, positionTitle, departmentCode, branchCode, notes }, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, mode, data.employeeNumber as string);
    if (!employee.found) {
      messages.push({ field: "employeeNumber", message: `Employee "${data.employeeNumber}" was not found`, severity: "error" });
    }
    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, "execute", data.employeeNumber as string);
    if (!employee.found || employee.id == null) throw new Error(`Employee "${data.employeeNumber}" was not found`);

    const newState: Record<string, unknown> = {};
    if (data.positionTitle) newState.positionTitle = data.positionTitle;
    if (data.departmentCode) newState.departmentCode = data.departmentCode;
    if (data.branchCode) newState.branchCode = data.branchCode;
    if (data.notes) newState.notes = data.notes;
    newState.source = "migration";

    const period = await recordEmploymentPeriodEvent({
      organizationId: ctx.organizationId,
      employeeId: employee.id,
      eventType: data.eventType as string,
      effectiveDate: toDate(data.effectiveDate)!,
      newState,
      actorApplicationUserId: ctx.actorApplicationUserId,
      actorMembershipId: ctx.actorMembershipId,
    });
    return { status: "created", resultId: period.id };
  },
};
