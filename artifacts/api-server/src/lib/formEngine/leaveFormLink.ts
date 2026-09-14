/**
 * Leave ↔ Leave-Application-Form linkage (Owner Decision D1/D2).
 *
 * OWNERSHIP IS NOT SHARED. `leave_requests` is the sole canonical owner of
 * leave status, approval decisions and balance effects. The WWM Leave
 * Application Form is a signed documentary representation of a leave request —
 * never a second approval workflow, never a second source of truth. Nothing in
 * this module reads or writes leave status, and nothing in the forms engine may
 * advance, approve, reject or cancel a leave request.
 *
 * The Leave module already implements the canonical workflow this represents:
 * `pending → pending_hr → approved|rejected|cancelled`, with Department Head
 * authority at `pending` (resolved live through lib/departmentHeads.ts, never
 * from reportingManagerId) and HR authority at `pending_hr`, and with HR able to
 * SEE every non-terminal request from the moment of submission while being
 * unable to act on one still awaiting its Department Head. None of that is
 * reimplemented here.
 *
 * WHERE THE LINK IS CREATED, and why.
 *
 * Three candidate points were considered:
 *
 *   (a) at leave-request creation — rejected. It would force a form submission
 *       into existence for every leave request, including tenants that never
 *       adopt the official form, and would couple the Leave module to the forms
 *       engine in its hottest write path.
 *   (b) at first official-form save — rejected as the primary trigger. A draft
 *       may be abandoned; linking on save would leave orphan associations
 *       pointing at live leave requests.
 *   (c) at explicit association, in the same request that creates the form
 *       submission for a known leave request — CHOSEN. It is the existing
 *       governed path (`form_submission_links`), it is idempotent, it is
 *       audited, and it keeps the dependency pointing one way: forms know about
 *       leave, leave knows nothing about forms.
 *
 * The employee therefore never types the leave request twice: the canonical
 * request is created first in the Leave module, and the form submission is
 * created FOR that request and prefilled from it. The remaining work to make
 * this one continuous screen is UI wiring, not a second data model.
 */
import { and, eq } from "drizzle-orm";
import { db, leaveRequestsTable, formSubmissionsTable } from "@workspace/db";
import { createSubmissionLink, listSubmissionLinks } from "./domainLinks";
import type { FormActor } from "./submissions";

export class LeaveFormLinkError extends Error {}

/** The relation recorded on the link row: this form documents that leave request. */
export const LEAVE_FORM_RELATION = "represents";

export interface LeaveRequestPrefill {
  leaveRequestId: number;
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  daysRequested: string;
  reason: string | null;
  status: string;
}

/**
 * Reads the canonical leave request so the official form can be prefilled from
 * it. Organization-scoped; a request from another tenant is simply absent.
 * READ ONLY — this is the direction the dependency is allowed to point.
 */
export async function getLeaveRequestForPrefill(
  organizationId: number,
  leaveRequestId: number,
): Promise<LeaveRequestPrefill | null> {
  const [row] = await db
    .select({
      leaveRequestId: leaveRequestsTable.id,
      employeeId: leaveRequestsTable.employeeId,
      leaveTypeId: leaveRequestsTable.leaveTypeId,
      startDate: leaveRequestsTable.startDate,
      endDate: leaveRequestsTable.endDate,
      daysRequested: leaveRequestsTable.daysRequested,
      reason: leaveRequestsTable.reason,
      status: leaveRequestsTable.status,
    })
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.id, leaveRequestId), eq(leaveRequestsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Associates an existing form submission with an existing canonical leave
 * request.
 *
 * Both sides are re-read under the caller's organization id, so a submission
 * and a leave request from different tenants can never be joined — and neither
 * can a submission from tenant A be linked to a leave request the caller merely
 * guessed the id of. The underlying `createSubmissionLink` re-validates the
 * domain record in-organization as well; that duplication is deliberate.
 *
 * The subject employee of the form must BE the employee the leave belongs to.
 * Without that check a form about employee X could be filed as the documentary
 * record of employee Y's leave.
 *
 * Idempotent: linking the same pair twice returns the existing link.
 */
export async function linkSubmissionToLeaveRequest(params: {
  organizationId: number;
  submissionId: number;
  leaveRequestId: number;
  actor: FormActor;
}) {
  const { organizationId, submissionId, leaveRequestId, actor } = params;

  const [submission] = await db
    .select({ id: formSubmissionsTable.id, subjectEmployeeId: formSubmissionsTable.subjectEmployeeId })
    .from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.organizationId, organizationId)))
    .limit(1);
  if (!submission) throw new LeaveFormLinkError("Form submission not found in this organization");

  const leave = await getLeaveRequestForPrefill(organizationId, leaveRequestId);
  if (!leave) throw new LeaveFormLinkError("Leave request not found in this organization");

  if (leave.employeeId !== submission.subjectEmployeeId) {
    throw new LeaveFormLinkError("The form's subject employee is not the employee this leave request belongs to");
  }

  const existing = await listSubmissionLinks(organizationId, submissionId);
  const already = existing.find((l) => l.domainType === "leave_request" && l.domainEntityId === leaveRequestId);
  if (already) return already;

  return createSubmissionLink({
    organizationId,
    submissionId,
    domainType: "leave_request",
    domainEntityId: leaveRequestId,
    relationType: LEAVE_FORM_RELATION,
    actor,
  });
}
