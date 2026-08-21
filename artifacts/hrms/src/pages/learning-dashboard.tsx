import { LayoutDashboard, GraduationCap, ClipboardList, AlertTriangle, BadgeCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetLearningDashboard,
  getGetLearningDashboardQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const ENROLLMENT_STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const ENROLLMENT_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  assigned: 'outline',
  in_progress: 'outline',
  completed: 'default',
  failed: 'secondary',
  cancelled: 'secondary',
};

export default function LearningDashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useGetLearningDashboard(organizationId, {
    query: { queryKey: getGetLearningDashboardQueryKey(organizationId), enabled: organizationId > 0 },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
          Learning Dashboard
        </h1>
        <p className="text-muted-foreground">
          Enrollment tile breakdown — organization-wide for HR/L&amp;D, your own and direct-report training otherwise.
        </p>
      </div>

      {isForbidden(error) ? (
        <QueryError title="Access denied" message="You don't have permission to view Learning reporting." />
      ) : error ? (
        <QueryError title="Could not load the dashboard" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !dashboard ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="card-active-courses">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <GraduationCap className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.activeCourseCount}</p>
                  <p className="text-sm text-muted-foreground">Active course(s)</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-enrollments-assigned">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <ClipboardList className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.enrollmentsAssignedCount}</p>
                  <p className="text-sm text-muted-foreground">Enrollments in scope</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-overdue">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <AlertTriangle className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.overdueCount}</p>
                  <p className="text-sm text-muted-foreground">Overdue</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-certificates-expiring-soon">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <BadgeCheck className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.certificatesExpiringSoonCount}</p>
                  <p className="text-sm text-muted-foreground">Certificates expiring within 30 days</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approvals</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Badge variant="outline" className="text-sm px-3 py-1.5" data-testid="tile-pending-approval">Pending approval: {dashboard.pendingApprovalCount}</Badge>
            </CardContent>
          </Card>

          <Card data-testid="card-status-breakdown">
            <CardHeader>
              <CardTitle className="text-base">Enrollment Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3" data-testid="learning-dashboard-tiles">
                {dashboard.statusBreakdown.map((item) => (
                  <Badge
                    key={item.status}
                    variant={ENROLLMENT_STATUS_VARIANT[item.status] ?? 'outline'}
                    className="text-sm px-3 py-1.5"
                    data-testid={`status-badge-${item.status}`}
                  >
                    {ENROLLMENT_STATUS_LABEL[item.status] ?? item.status}: {item.count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
