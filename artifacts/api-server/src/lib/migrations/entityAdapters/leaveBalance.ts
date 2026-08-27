/**
 * WS-7 (§7 entity list; Owner clarification S) — leave balances (opening
 * balances only, imported as a `postLedgerEntry` "opening_balance" entry —
 * never a bespoke balance table, since none exists: the ledger itself
 * (`leave_balance_entries`) IS the balance, computed as the running sum of
 * its entries).
 *
 * Reuses `postLedgerEntry` (lib/leaveBalances.ts) directly. Idempotency
 * comes from that function's own `sourceReference` unique index
 * (`organizationId, employeeId, leaveTypeId, entryType, sourceReference`),
 * given a deterministic value derived from this batch/row — a retried
 * execution of the same staged row can never double-post.
 *
 * MATERIAL FINDING, disclosed rather than silently handled: neither
 * `postLedgerEntry` nor `createLegacyPersonnelFile`-style primitives accept
 * a `tx` QueryClient — `postLedgerEntry` always runs against the global
 * `db` and commits its own insert independently of this adapter's caller.
 * This means a leave-balance row's ledger post is NOT part of the same SQL
 * transaction as the `migration_staged_rows.executionStatus` update the
 * orchestration layer makes afterward. This is the same
 * partial-failure boundary every other adapter already has at the
 * statement level (a crash between the two statements is possible), and is
 * exactly why `executionStatus` — not "did the outer transaction commit" —
 * is this workstream's real idempotency guard (§26): re-running a batch
 * only ever re-attempts rows still `pending`, and `postLedgerEntry`'s own
 * `sourceReference` uniqueness makes a genuine double-post impossible even
 * if a staged row is mistakenly re-attempted.
 *
 * `postLedgerEntry` also enforces leave-policy eligibility internally
 * (`resolveApplicablePolicy`) and throws if the employee has no active
 * policy for the leave type — a real, not hypothetical, business-rule
 * failure this adapter surfaces as a validation/execution error rather
 * than working around, since inventing a policy would misrepresent the
 * organization's actual leave configuration.
 */
import { and, eq } from "drizzle-orm";
import { db, leaveTypesTable, type Employee } from "@workspace/db";
import { postLedgerEntry, LeaveBalanceValidationError, DuplicateLedgerEntryError } from "../../leaveBalances";
import { resolveApplicablePolicy } from "../../leaveRequests";
import { getEmployeeById } from "../../employees";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, optionalString, parseDate, parseNumber, toDateOnlyString } from "../normalizeHelpers";
import { resolveEmployeeRef } from "../referenceResolution";

const FIELDS: readonly CanonicalField[] = [
  { key: "employeeNumber", label: "Employee Number", required: true, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number"] },
  { key: "leaveTypeCode", label: "Leave Type Code", required: true, type: "string", aliases: ["Leave Type Code", "Leave Type"] },
  { key: "amount", label: "Opening Balance (Days)", required: true, type: "number", aliases: ["Opening Balance", "Balance", "Days"] },
  { key: "effectiveDate", label: "Effective Date", required: true, type: "date", aliases: ["Effective Date", "As Of Date", "Date"] },
  { key: "reason", label: "Reason / Notes", required: false, type: "string", aliases: ["Reason", "Notes"] },
];

async function findActiveLeaveType(organizationId: number, code: string): Promise<{ id: number } | null> {
  const [row] = await db
    .select({ id: leaveTypesTable.id })
    .from(leaveTypesTable)
    .where(and(eq(leaveTypesTable.organizationId, organizationId), eq(leaveTypesTable.code, code), eq(leaveTypesTable.status, "active")))
    .limit(1);
  return row ?? null;
}

export const leaveBalanceAdapter: EntityAdapter = {
  entityType: "leave_balance",
  label: "Leave Balances",
  dependsOn: ["employee"],
  // postLedgerEntry writes via the global db.
  transactional: false,
  fields: FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const employeeNumber = requiredString(raw.employeeNumber, "employeeNumber", "Employee Number", messages);
    const leaveTypeCode = requiredString(raw.leaveTypeCode, "leaveTypeCode", "Leave Type Code", messages);
    const amount = parseNumber(raw.amount, "amount", "Opening Balance (Days)", true, messages);
    if (amount != null && amount <= 0) {
      messages.push({ field: "amount", message: "Opening Balance (Days) must be greater than zero", severity: "error" });
    }
    const effectiveDate = parseDate(raw.effectiveDate, "effectiveDate", "Effective Date", true, messages);
    const reason = optionalString(raw.reason);
    return { data: { employeeNumber, leaveTypeCode, amount, effectiveDate, reason }, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];

    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, mode, data.employeeNumber as string);
    if (!employee.found) {
      messages.push({ field: "employeeNumber", message: `Employee "${data.employeeNumber}" was not found`, severity: "error" });
    }

    const leaveType = await findActiveLeaveType(ctx.organizationId, data.leaveTypeCode as string);
    if (!leaveType) {
      messages.push({ field: "leaveTypeCode", message: `Leave type "${data.leaveTypeCode}" was not found or is not active`, severity: "error" });
    }

    // Policy eligibility can only be pre-checked once the employee actually
    // exists in the live table (id is null when only found via an earlier
    // staged row in dry_run mode) — otherwise this is deferred to execution,
    // matching every other adapter's staged-fallback boundary.
    if (employee.found && employee.id != null && leaveType) {
      const employeeRow = await getEmployeeById(ctx.organizationId, employee.id);
      if (employeeRow) {
        const policy = await resolveApplicablePolicy(ctx.organizationId, leaveType.id, employeeRow as Employee);
        if (!policy) {
          messages.push({
            field: "leaveTypeCode",
            message: `Employee "${data.employeeNumber}" is not eligible for any policy under leave type "${data.leaveTypeCode}"`,
            severity: "error",
          });
        }
      }
    }

    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, "execute", data.employeeNumber as string);
    if (!employee.found || employee.id == null) throw new Error(`Employee "${data.employeeNumber}" was not found`);

    const leaveType = await findActiveLeaveType(ctx.organizationId, data.leaveTypeCode as string);
    if (!leaveType) throw new Error(`Leave type "${data.leaveTypeCode}" was not found or is not active`);

    try {
      const entry = await postLedgerEntry({
        organizationId: ctx.organizationId,
        employeeId: employee.id,
        entryType: "opening_balance",
        amount: data.amount as number,
        effectiveDate: toDateOnlyString(data.effectiveDate as Date),
        reason: (data.reason as string | null) ?? "Imported opening balance (WS-7 migration)",
        leaveTypeId: leaveType.id,
        sourceReference: `migration:${ctx.batchId}:leave_balance:${data.employeeNumber}:${leaveType.id}`,
        createdBy: ctx.actorApplicationUserId,
      });
      return { status: "created", resultId: entry.id };
    } catch (err) {
      if (err instanceof DuplicateLedgerEntryError || err instanceof LeaveBalanceValidationError) throw new Error(err.message);
      throw err;
    }
  },
};
