# HR Dashboard Command Centre

The dashboard (`/dashboard`) is an operational HR command centre. It answers:
what is happening in the workforce, what needs HR's attention, and what the
signed-in user must do now. It is organization-neutral: every section is
derived from the active organization, its enabled modules, the caller's
effective permissions and live operational data. Nothing is tenant-specific
and nothing is stored.

## Information hierarchy

1. **Workforce Summary**: Total Employees, Present Today, On Leave, Pending HR Actions
2. **My HR Tasks**: work the current membership can perform now
3. **Leave** and **HR Attention**
4. **Quick Access**: the HR workspace
5. **Recent HR Activity** and **Upcoming Public Holidays**

The shell's "Operating in: *Organization*" indicator is unchanged. The page
header repeats it as its eyebrow.

## Data flow: two aggregated requests

| Request | Supplies |
|---|---|
| `GET /dashboard/summary` (existing) | workforce counts, attendance, leave metrics |
| `GET /organizations/{id}/dashboard/command-centre` (new) | tasks, attention cards, holidays, recent activity |

The page makes these two aggregated requests, not one per card. The new
endpoint requires `requireAuth` and `requireMembership`, and takes the
organization from the verified membership. A break-glass request with no
membership gets 403. No permission was added.

Service: `artifacts/api-server/src/lib/hrCommandCentre.ts`. Each section is
**authorized, then queried**, using the Action Centre's three outcomes:

- **hidden**: the module is disabled or the permission is missing. There is no card, no count and no zero.
- **failed**: the caller is authorized but the query threw. The section is named in `unavailableSections`.
- **ok**: a real value; `0` means there is genuinely nothing.

## Metric definitions

| Metric | Definition | Gate | Opens |
|---|---|---|---|
| Total Employees | employees with status `active`, `probation` or `on_leave` | `employee.write` (existing summary gate) | `/employees` |
| Present Today | attendance status `present` today, in the viewer's attendance scope | module `attendance` | `/attendance-dashboard` |
| On Leave | distinct employees with approved leave spanning today | module `leave`; org-wide with `leave_request.manage` | `/leave-calendar` |
| Pending HR Actions | `tasks.total` (see My HR Tasks) | any authorized task source | `#my-hr-tasks` |
| Upcoming Approved Leave | approved requests starting within 30 days | module `leave` | `/leave-calendar` |
| Pending Leave Approvals | `awaitingMyActionCount`; `awaitingOtherStageCount` is shown as context | `leave_request.approve` | `/leave-approvals` |
| Leave Utilization | ledger usage ÷ credited (existing W40) | module `leave` | `/leave-balances` |
| Expiring Carry-Forward | carry-forward entries expiring within 30 days (existing W40) | module `leave` | `/leave-balances` |
| Attendance Exceptions | today's `late` + `partial` + `absent`, organization-wide scope only | module `attendance` + org-wide attendance access | `/attendance-dashboard` |
| Probation Reviews Due | employees on `probation` whose `probationEndDate` is on or before today + `probationReminderDaysBefore` | `employment_lifecycle.read` | `/employees` |
| Performance Reviews Due | reviews in `hr_review` | module `performance` + `performance.manage` | `/performance-reviews` |
| Personnel Files Requiring Attention | rows of report `personnel_checked_out_overdue_files` flagged overdue | `personnel_file.read` | `/personnel-reports` |
| Assets Awaiting Return | `overdueReturnCount` from the asset dashboard | module `asset_management` + `asset_management.reports.read` | `/assets-dashboard` |
| Forms Awaiting HR Review | submissions whose current stage resolves to the viewer; `secondaryCount` = other pending submissions | `form.read` | `/forms` |

## My HR Tasks: monitor is not action

A task is **only** something the current membership can perform now. Sources:

- **Action Centre My Actions** (`collectActionItems(ctx, "my_actions")`): the frozen WS-15 P1 providers, unchanged except for the Leave correction below.
- **Forms** (`listSubmissionsAwaitingViewer`): `pending_approval` submissions whose current stage `membershipSatisfiesFormStage` resolves to the viewer, and where at least one of the stage's actions survives maker-checker (a subject or creator may only `complete`). A form waiting at another stage is excluded, even for HR. An HR-assisted (on-behalf) draft is excluded because it is a draft, not a stage.
- **Performance**: `hr_review` reviews, for holders of `performance.finalize`.
- **Probation**: the probation-due list, for holders of `employment_lifecycle.manage`. The end date is shown as context, not as `dueAt` (§31.16).

Ordering is the Action Centre's deterministic four tiers (`sortActionItems`):
overdue, then due soon, then undated oldest first. No priority is invented
(§31.17). The response returns at most 25 rows plus the true total.

### Leave stage correction

`listPendingApprovals` gives HR both `pending` (still with the Department
Head) and `pending_hr`. The approve and reject calls only let HR act on
`pending_hr`; `pending` belongs to the employee's current Department Head.

`partitionPendingApprovalsForActor` (in `lib/leaveApprovals.ts`) applies
exactly that rule, and never treats the actor's own request as their task. It
is used in two places:

- **Action Centre leave provider:** My Actions now carries only actionable rows; Oversight keeps the full queue as deep-link only.
- **Dashboard summary:** it supplies the additive `awaitingMyActionCount` and `awaitingOtherStageCount` fields.

## Quick Access

`artifacts/hrms/src/lib/hr-dashboard.ts` (`resolveWorkspaceCards`) shows a card
only when the destination's module is accessible (`isModuleAccessible`) **and**
the caller holds one of its permission keys (`MembershipSummary.permissions`).
If either input is unknown, gated cards stay hidden.

- Master data (Branches, Departments, Positions) requires the `*.manage` key.
- The Reports card opens the first report area the caller can access.
- Badges show real counts ("3 pending", "2 due", "No pending items") or "Open". They never make up a count.

## Recent HR Activity

This section reads audit events in the `hr` category only, even for an
`audit.read` holder. Each item carries only id, time, event type, target type
and actor name; no before/after state, IP, user agent or metadata is returned.
The caller needs `audit.read` or `audit.read.hr`.

## Not yet available

- **Announcements:** the platform has no announcements capability, so no card is shown.
- **Query-string filters:** no destination page reads them, so cards open each module's default view.
