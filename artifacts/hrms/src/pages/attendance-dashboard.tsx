import { useState } from 'react';
import { LayoutDashboard, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QueryError } from '@/components/query-error';
import { useGetMe, getGetMeQueryKey, useGetAttendanceDashboard, getGetAttendanceDashboardQueryKey } from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

function isConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 409;
}

const STATUS_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  partial: 'Partial',
  absent: 'Absent',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  non_working_day: 'Non-Working Day',
  not_applicable: 'Not Applicable',
};

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  present: 'secondary',
  late: 'outline',
  partial: 'outline',
  absent: 'destructive',
  on_leave: 'outline',
  holiday: 'outline',
  non_working_day: 'outline',
  not_applicable: 'outline',
};

export default function AttendanceDashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  // Never browser-local: left blank until the caller explicitly picks a
  // date, so the very first load always displays the backend's own
  // organization-timezone-derived "today" (dashboard.date), never a
  // client-computed guess.
  const [dateOverride, setDateOverride] = useState('');

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useGetAttendanceDashboard(
    organizationId,
    { date: dateOverride || undefined },
    { query: { queryKey: getGetAttendanceDashboardQueryKey(organizationId, { date: dateOverride || undefined }), enabled: organizationId > 0 } },
  );

  const displayedDate = dateOverride || dashboard?.date || '';

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
          Attendance Dashboard
        </h1>
        <p className="text-muted-foreground">
          Live status breakdown for a single date — organization-wide for HR/admins, your own and your direct reports' otherwise.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="attendance-dashboard-date">Date</Label>
            <Input
              id="attendance-dashboard-date"
              type="date"
              value={displayedDate}
              max={dashboard?.date}
              onChange={(e) => setDateOverride(e.target.value)}
              className="w-48"
              data-testid="input-attendance-dashboard-date"
            />
          </div>
        </CardContent>
      </Card>

      {isForbidden(error) ? (
        <QueryError title="Access denied" message="You don't have permission to view Attendance reporting." />
      ) : isConflict(error) ? (
        <QueryError title="Timezone not configured" message="This organization's timezone must be configured before Attendance reporting is available." />
      ) : error ? (
        <QueryError title="Could not load the dashboard" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !dashboard ? null : (
        <div className="space-y-6">
          <Card data-testid="card-total-employees">
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Users className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{dashboard.totalEmployeesCount}</p>
                <p className="text-sm text-muted-foreground">Employees in scope for {dashboard.date}</p>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-status-breakdown">
            <CardHeader>
              <CardTitle>Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.totalEmployeesCount === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No employees in scope for this date.</p>
              ) : (
                <div className="flex flex-wrap gap-3" data-testid="attendance-dashboard-tiles">
                  {dashboard.statusBreakdown.map((item) => {
                    const key = item.status ?? 'not_applicable';
                    return (
                      <Badge
                        key={key}
                        variant={STATUS_VARIANT[key] ?? 'outline'}
                        className="text-sm px-3 py-1.5"
                        data-testid={`status-badge-${key}`}
                      >
                        {STATUS_LABEL[key] ?? key}: {item.count}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
