import { Link } from 'wouter';
import { Users, Package, Bell, CalendarClock, CalendarDays, ClipboardCheck, CalendarHeart, Percent, Hourglass, UserCheck, Briefcase, Boxes } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useListOrganizationModules,
  getListOrganizationModulesQueryKey,
} from '@workspace/api-client-react';
import { motion } from 'framer-motion';
import { useIsHrCapable } from '@/hooks/use-hr-capable';

// Core Platform / HR Foundation capabilities — always available to every
// organization, per ARCHITECTURE.md. Not part of the Module Registry (W3),
// since they aren't togglable feature modules; the registry-driven,
// per-organization-configurable modules are fetched below.
const FOUNDATION_CAPABILITIES = [
  {
    title: 'Employee Records',
    description: 'Manage comprehensive employee profiles, documents, and organizational structure',
    href: '/employees',
  },
  {
    title: 'Branches',
    description: "Manage your organisation's physical or regional locations",
    href: '/branches',
  },
  {
    title: 'Departments',
    description: 'Organise employees into functional or organisational units',
    href: '/departments',
  },
  {
    title: 'Positions',
    description: 'Define job titles employees can be assigned to',
    href: '/positions',
  },
];

export default function Dashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const isHrCapable = useIsHrCapable(organizationId);
  const { data: summary, isLoading } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  // Permission-Aware Dashboard Reconciliation: org-enablement-aware, unlike
  // the platform-wide catalog useListModules would give — a module the
  // platform has built but this ORGANIZATION hasn't turned on must never
  // read as "Available" here (rule: module disabled -> show nothing).
  const { data: orgModules } = useListOrganizationModules(organizationId, {
    query: { queryKey: getListOrganizationModulesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  // Permission-Aware Dashboard Reconciliation: every stat below now follows
  // the SAME "null from the backend -> omit the card, never a fabricated
  // zero" contract leaveMetrics already established — totalEmployees is
  // null unless the caller holds employee.write (not the broad
  // employee.read every role holds), and assetMetrics/inventoryMetrics are
  // null unless the caller holds asset_management.reports.read/
  // office_inventory.reports.read respectively, in addition to their
  // module being enabled. This is a backend permission gate, not a
  // frontend role heuristic — a custom role holding just
  // office_inventory.reports.read sees the Inventory tile without needing
  // hr_manager/org_admin.
  const stats = [
    ...(summary?.totalEmployees != null
      ? [{ title: 'Total Employees', value: summary.totalEmployees, icon: Users, color: 'text-primary' }]
      : []),
    ...(summary?.attendanceMetrics
      ? [{ title: 'Present Today', value: summary.attendanceMetrics.presentToday, icon: UserCheck, color: 'text-chart-3' }]
      : []),
    ...(summary?.assetMetrics
      ? [{ title: 'Active Assets', value: summary.assetMetrics.activeAssets, icon: Briefcase, color: 'text-chart-4' }]
      : []),
    ...(summary?.inventoryMetrics
      ? [{ title: 'Inventory Items', value: summary.inventoryMetrics.totalItems, icon: Boxes, color: 'text-chart-2' }]
      : []),
    {
      title: 'Active Modules',
      value: summary?.activeModules ?? 0,
      icon: Package,
      color: 'text-accent'
    },
    {
      title: 'Unread Notifications',
      value: summary?.unreadNotifications ?? 0,
      icon: Bell,
      color: 'text-chart-5'
    }
  ];

  // W40 — HR Operations Dashboard: leaveMetrics is null (not zero-filled)
  // when the "leave" module is disabled for this organisation, per the
  // frozen plan — omit the whole section rather than rendering fabricated
  // zeros in that case.
  const leaveMetrics = summary?.leaveMetrics ?? null;
  const leaveStats = leaveMetrics
    ? [
        { title: 'Employees on Leave', value: leaveMetrics.employeesOnLeave, icon: CalendarClock, color: 'text-primary' },
        { title: 'Upcoming Approved Leave', value: leaveMetrics.upcomingApprovedLeave, icon: CalendarDays, color: 'text-accent' },
        { title: 'Pending Approvals', value: leaveMetrics.pendingApprovalCount, icon: ClipboardCheck, color: 'text-chart-5' },
        { title: 'Upcoming Public Holidays', value: leaveMetrics.upcomingPublicHolidays, icon: CalendarHeart, color: 'text-primary' },
        { title: 'Leave Utilization', value: `${leaveMetrics.leaveUtilizationPercent}%`, icon: Percent, color: 'text-accent' },
        { title: 'Expiring Carry-Forward', value: leaveMetrics.expiringCarryForwardBalances, icon: Hourglass, color: 'text-chart-5' },
      ]
    : [];

  const enabledOrgModules = (orgModules ?? []).filter((m) => m.enabled);

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome back, {user?.firstName}
        </h1>
        <p className="text-muted-foreground">
          Here's an overview of your HR system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card data-testid={`card-stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="text-3xl font-bold text-foreground">{stat.value}</div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Leave Section (W40) — omitted entirely, not zero-filled, when the "leave" module is disabled */}
      {!isLoading && leaveMetrics && (
        <div className="space-y-4" data-testid="section-leave-metrics">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Leave</h2>
            {/* WWM Employee Access Remediation (2026-09-07): the backend already
                scopes these figures (org-wide only with leave_request.manage;
                otherwise own + direct reports) — label them honestly rather than
                calling an employee's own numbers "your organisation". */}
            <p className="text-muted-foreground" data-testid="text-leave-metrics-scope">
              {leaveMetrics.scope === 'organization'
                ? 'Real-time Leave metrics for your organisation'
                : 'Real-time Leave metrics for you and your direct reports'}
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {leaveStats.map((stat, i) => (
              <motion.div
                key={stat.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card data-testid={`card-leave-stat-${stat.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {stat.title}
                    </CardTitle>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-foreground">{stat.value}</div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
          <Card data-testid="card-leave-requests-by-status">
            <CardHeader>
              <CardTitle className="text-base">Leave Requests by Status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="outline">Pending: {leaveMetrics.requestsByStatus.pending}</Badge>
              <Badge variant="secondary">Approved: {leaveMetrics.requestsByStatus.approved}</Badge>
              <Badge variant="destructive">Rejected: {leaveMetrics.requestsByStatus.rejected}</Badge>
              <Badge variant="outline">Cancelled: {leaveMetrics.requestsByStatus.cancelled}</Badge>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Modules Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Available Modules</h2>
            <p className="text-muted-foreground">Organisation and workforce management modules</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FOUNDATION_CAPABILITIES.map((capability, i) => (
            <motion.div
              key={capability.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.05 }}
            >
              <Link
                href={capability.href}
                data-testid={`link-module-${capability.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Card
                  className="h-full transition-shadow hover:shadow-md hover:border-primary/50"
                  data-testid={`card-module-${capability.title.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">{capability.title}</CardTitle>
                      <Badge variant="default" className="text-xs">Available</Badge>
                    </div>
                    <CardDescription className="text-sm leading-relaxed">
                      {capability.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </motion.div>
          ))}
          {/* Permission-Aware Dashboard Reconciliation: this registry is an
              informational/administrative overview of the organization's
              module configuration (no card here is a functional entry
              point — none of them link anywhere), so it's shown only to
              HR-capable users, matching the sidebar's own treatment of
              every module listed here (attendance/performance/learning/
              assets/office_inventory/recruitment are all isHrCapable-gated
              nav groups). Only modules actually ENABLED for this
              organization appear — a module the platform has built but
              this org hasn't turned on is omitted entirely, never shown as
              "Available" or "Coming Soon". */}
          {isHrCapable &&
            enabledOrgModules.map((module, i) => (
              <motion.div
                key={module.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + (FOUNDATION_CAPABILITIES.length + i) * 0.05 }}
              >
                <Card
                  className="h-full"
                  data-testid={`card-module-${module.key.replace(/_/g, '-')}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">{module.name}</CardTitle>
                      <Badge variant="default" className="text-xs">Available</Badge>
                    </div>
                    <CardDescription className="text-sm leading-relaxed">
                      {module.description}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </motion.div>
            ))}
        </div>
      </div>

      {/* Info Banner */}
      <Card className="bg-muted/30 border-muted">
        <CardHeader>
          <CardTitle className="text-base">System Status</CardTitle>
          <CardDescription>
            Authentication, organisation management, and the employee/branch/department/position
            directory are live.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
