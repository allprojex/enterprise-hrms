import * as React from 'react';
import { useCapabilities } from '@/hooks/use-capabilities';
import {
  Users,
  UserCheck,
  CalendarClock,
  ListChecks,
  CalendarDays,
  ClipboardCheck,
  Percent,
  Hourglass,
  Clock,
  UserCog,
  TrendingUp,
  FolderLock,
  Laptop,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetHrCommandCentre,
  getGetHrCommandCentreQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useListOrganizationModules,
  getListOrganizationModulesQueryKey,
  type HrAttentionCardKey,
} from '@workspace/api-client-react';
import { PageContainer, PageHeader, SectionHeader, MetricCard } from '@/components/foundation';
import { DashboardMetricLink } from '@/components/dashboard/dashboard-metric-link';
import { MyHrTasks } from '@/components/dashboard/my-hr-tasks';
import { WorkspaceGrid } from '@/components/dashboard/workspace-grid';
import { RecentActivityCard, UpcomingHolidaysCard } from '@/components/dashboard/dashboard-secondary';
import { useMyMembership } from '@/hooks/use-hr-capable';
import {
  ATTENTION_META,
  attentionSupporting,
  orderedAttention,
  resolveWorkspaceCards,
} from '@/lib/hr-dashboard';

const ATTENTION_ICONS: Record<HrAttentionCardKey, React.ReactNode> = {
  attendance_exceptions: <Clock aria-hidden="true" />,
  probation_reviews_due: <UserCog aria-hidden="true" />,
  performance_reviews_due: <TrendingUp aria-hidden="true" />,
  personnel_files_attention: <FolderLock aria-hidden="true" />,
  assets_awaiting_return: <Laptop aria-hidden="true" />,
  forms_awaiting_review: <FileText aria-hidden="true" />,
};

const SECTION_LABEL: Record<string, string> = {
  forms: 'Forms',
  performance: 'Performance',
  probation: 'Probation',
  attendance: 'Attendance',
  personnel_files: 'Personnel files',
  assets: 'Assets',
  holidays: 'Public holidays',
  activity: 'Recent activity',
};

/**
 * HR Dashboard Command Centre.
 *
 * Hierarchy: Workforce Summary → My HR Tasks → Leave + HR Attention → Quick
 * Access → Recent Activity / Holidays. Every section follows the server's
 * "null or absent means hidden, never a fabricated zero" contract: the page
 * renders what the caller is authorized to see and nothing else. Two
 * aggregated requests feed it (GET /dashboard/summary and GET
 * /organizations/:id/dashboard/command-centre), not one request per card.
 */
export default function Dashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const membership = useMyMembership(organizationId);
  const permissions = membership?.permissions;
  const can = (key: string) => permissions?.includes(key) ?? false;

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() },
  });
  const commandCentreQuery = useGetHrCommandCentre(organizationId, {
    query: { queryKey: getGetHrCommandCentreQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const commandCentre = commandCentreQuery.data;
  const { data: orgModules } = useListOrganizationModules(organizationId, {
    query: { queryKey: getListOrganizationModulesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const leave = summary?.leaveMetrics ?? null;
  // Responsibility, not role name. See hooks/use-capabilities.ts.
  const capabilities = useCapabilities(organizationId);
  const { isManager, isHrOperational } = capabilities;

  const tasks = commandCentre?.tasks ?? null;
  const attention = orderedAttention(commandCentre?.attention ?? []);
  const workspaceCards = resolveWorkspaceCards({
    modules: orgModules,
    permissions,
    relationships: {
      isDepartmentHead: capabilities.isDepartmentHead,
      hasDirectReports: capabilities.hasDirectReports,
      isInventoryApprovalDelegate: capabilities.isInventoryApprovalDelegate,
    },
    summary,
    commandCentre,
  });
  const unavailable = commandCentre?.unavailableSections ?? [];
  const showTasks = commandCentreQuery.isLoading || commandCentreQuery.isError || tasks != null;

  const workforceCards: React.ReactNode[] = [];
  if (summaryLoading) {
    for (let i = 0; i < 4; i++) workforceCards.push(<MetricCard key={`loading-${i}`} size="sm" label="Loading" value="" loading />);
  } else {
    if (summary?.activeEmployees != null) {
      workforceCards.push(
        <DashboardMetricLink
          key="total"
          testId="card-stat-total-employees"
          label="Total Employees"
          value={summary.activeEmployees}
          supporting="Active, probation or on leave"
          icon={<Users aria-hidden="true" />}
          href={can('employee.read') ? '/employees' : null}
        />,
      );
    }
    if (summary?.attendanceMetrics) {
      workforceCards.push(
        <DashboardMetricLink
          key="present"
          testId="card-stat-present-today"
          label="Present Today"
          value={summary.attendanceMetrics.presentToday}
          supporting={`of ${summary.attendanceMetrics.totalEmployeesInScope} in scope`}
          icon={<UserCheck aria-hidden="true" />}
          href={can('attendance.read.own') ? '/attendance-dashboard' : null}
        />,
      );
    }
    if (leave) {
      workforceCards.push(
        <DashboardMetricLink
          key="on-leave"
          testId="card-stat-on-leave"
          label="On Leave"
          value={leave.employeesOnLeave}
          supporting={leave.scope === 'organization' ? 'Approved leave today' : 'You and your direct reports'}
          icon={<CalendarClock aria-hidden="true" />}
          href={can('leave_request.read.own') ? '/leave-calendar' : null}
        />,
      );
    }
  }
  if (tasks) {
    workforceCards.push(
      <DashboardMetricLink
        key="pending"
        testId="card-stat-pending-hr-actions"
        label={isHrOperational ? 'Pending HR Actions' : isManager ? 'Pending Approvals' : 'My Pending Actions'}
        value={tasks.total}
        supporting={tasks.overdue > 0 ? `${tasks.overdue} overdue` : 'None overdue'}
        delta={tasks.overdue > 0 ? { text: 'Needs attention', tone: 'danger' } : undefined}
        icon={<ListChecks aria-hidden="true" />}
        href="#my-hr-tasks"
      />,
    );
  }

  const leaveCards = leave
    ? [
        <DashboardMetricLink
          key="upcoming"
          testId="card-leave-upcoming-approved"
          label="Upcoming Approved Leave"
          value={leave.upcomingApprovedLeave}
          supporting="Starting in the next 30 days"
          icon={<CalendarDays aria-hidden="true" />}
          href={can('leave_request.read.own') ? '/leave-calendar' : null}
        />,
        // leave_request.approve is held by every employee and only gates "may
        // attempt"; the approval queue is real only for a department head or
        // an HR holder of leave_request.manage — the same rule the sidebar's
        // Leave Approvals entry uses.
        ...(capabilities.isDepartmentHead || can('leave_request.manage')
          ? [
              <DashboardMetricLink
                key="approvals"
                testId="card-leave-pending-approvals"
                label="Pending Leave Approvals"
                value={leave.awaitingMyActionCount}
                supporting={
                  leave.awaitingOtherStageCount > 0
                    ? `${leave.awaitingOtherStageCount} with another approver`
                    : 'Awaiting your decision'
                }
                icon={<ClipboardCheck aria-hidden="true" />}
                href="/leave-approvals"
              />,
            ]
          : []),
        <DashboardMetricLink
          key="utilization"
          testId="card-leave-utilization"
          label="Leave Utilization"
          value={`${leave.leaveUtilizationPercent}%`}
          supporting="Of credited leave used"
          icon={<Percent aria-hidden="true" />}
          href={can('leave_request.read.own') ? '/leave-balances' : null}
        />,
        <DashboardMetricLink
          key="carry-forward"
          testId="card-leave-expiring-carry-forward"
          label="Expiring Carry-Forward"
          value={leave.expiringCarryForwardBalances}
          supporting="Expiring in the next 30 days"
          icon={<Hourglass aria-hidden="true" />}
          href={can('leave_request.read.own') ? '/leave-balances' : null}
        />,
      ]
    : [];

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          membership?.organizationName ? (
            <span data-testid="dashboard-org-context">Operating in: {membership.organizationName}</span>
          ) : undefined
        }
        title={user?.firstName ? `Welcome back, ${user.firstName}` : 'Welcome back'}
        description="What is happening in your workforce, and what needs your attention."
      />

      {unavailable.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-body-sm text-warning-soft-foreground" role="status" data-testid="text-unavailable-sections">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Some dashboard information could not be loaded: {unavailable.map((s) => SECTION_LABEL[s] ?? s).join(', ')}.
        </p>
      )}

      {workforceCards.length > 0 && (
        <section aria-labelledby="workforce-heading" className="space-y-3" data-testid="section-workforce-summary">
          <SectionHeader
            title={
              <span id="workforce-heading">
                {isHrOperational ? 'Workforce Summary' : isManager ? 'My Team' : 'My Summary'}
              </span>
            }
          />
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">{workforceCards}</div>
        </section>
      )}

      {showTasks && (
        <MyHrTasks
          heading={isHrOperational ? 'My HR Tasks' : isManager ? 'My Actions' : 'My Tasks'}
          tasks={tasks}
          isLoading={commandCentreQuery.isLoading}
          isError={commandCentreQuery.isError}
          onRetry={() => void commandCentreQuery.refetch()}
          canOpenActionCentre={tasks != null}
        />
      )}

      {(leave || attention.length > 0) && (
        <div className="grid gap-8 xl:grid-cols-2">
          {leave && (
            <section aria-labelledby="leave-heading" className="space-y-3" data-testid="section-leave-metrics">
              <SectionHeader
                title={<span id="leave-heading">Leave</span>}
                description={
                  <span data-testid="text-leave-metrics-scope">
                    {leave.scope === 'organization' ? 'Across your organisation' : 'For you and your direct reports'}
                  </span>
                }
              />
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{leaveCards}</div>
            </section>
          )}
          {attention.length > 0 && (
            <section aria-labelledby="attention-heading" className="space-y-3" data-testid="section-hr-attention">
              <SectionHeader
                title={
                  <span id="attention-heading">
                    {isHrOperational ? 'HR Attention' : isManager ? 'Team Attention' : 'Needs Your Attention'}
                  </span>
                }
                description={isHrOperational ? 'Operational items to keep an eye on' : 'Items assigned to you'}
              />
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                {attention.map((card) => (
                  <DashboardMetricLink
                    key={card.key}
                    testId={`card-attention-${card.key}`}
                    label={ATTENTION_META[card.key].title}
                    value={card.count}
                    supporting={attentionSupporting(card)}
                    icon={ATTENTION_ICONS[card.key]}
                    href={card.deepLink}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <WorkspaceGrid cards={workspaceCards} />

      {(commandCentre?.recentActivity || commandCentre?.upcomingHolidays) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {commandCentre?.recentActivity && <RecentActivityCard items={commandCentre.recentActivity} />}
          {commandCentre?.upcomingHolidays && <UpcomingHolidaysCard items={commandCentre.upcomingHolidays} />}
        </div>
      )}
    </PageContainer>
  );
}
