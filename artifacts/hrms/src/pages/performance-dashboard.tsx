import { useState } from 'react';
import { LayoutDashboard, CalendarRange, Users, ListChecks } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetPerformanceDashboard,
  getGetPerformanceDashboardQueryKey,
  useListPerformanceCycles,
  getListPerformanceCyclesQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const ALL = '__all__';

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  self_assessment: 'Self-Assessment',
  manager_review: 'Manager Review',
  hr_review: 'HR Review',
  finalized: 'Finalized',
  acknowledged: 'Acknowledged',
};

const REVIEW_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  self_assessment: 'outline',
  manager_review: 'outline',
  hr_review: 'secondary',
  finalized: 'default',
  acknowledged: 'default',
};

export default function PerformanceDashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [cycleId, setCycleId] = useState(ALL);
  const params = { cycleId: cycleId === ALL ? undefined : Number(cycleId) };

  const { data: cycles } = useListPerformanceCycles(organizationId, {
    query: { queryKey: getListPerformanceCyclesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useGetPerformanceDashboard(organizationId, params, {
    query: { queryKey: getGetPerformanceDashboardQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
          Performance Dashboard
        </h1>
        <p className="text-muted-foreground">
          Lifecycle tile breakdown — organization-wide for HR/admins, your own reviews and those you review otherwise.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="dashboard-cycle">Cycle</Label>
            <Select value={cycleId} onValueChange={setCycleId}>
              <SelectTrigger id="dashboard-cycle" className="w-64" data-testid="select-dashboard-cycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All cycles</SelectItem>
                {(cycles ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isForbidden(error) ? (
        <QueryError title="Access denied" message="You don't have permission to view Performance reporting." />
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
            <Card data-testid="card-active-cycles">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <CalendarRange className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.activeCycleCount}</p>
                  <p className="text-sm text-muted-foreground">Active cycle(s)</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-employees-assigned">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <Users className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.employeesAssignedCount}</p>
                  <p className="text-sm text-muted-foreground">Employees assigned</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-proposed-goals">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <ListChecks className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.proposedGoalsAwaitingDecisionCount}</p>
                  <p className="text-sm text-muted-foreground">Proposed goals awaiting decision</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Self-Assessment</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Badge variant="outline" className="text-sm px-3 py-1.5" data-testid="tile-self-assessment-pending">Pending: {dashboard.selfAssessmentPendingCount}</Badge>
              <Badge variant="secondary" className="text-sm px-3 py-1.5" data-testid="tile-self-assessment-submitted">Submitted: {dashboard.selfAssessmentSubmittedCount}</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manager Review</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Badge variant="outline" className="text-sm px-3 py-1.5" data-testid="tile-manager-review-pending">Pending: {dashboard.managerReviewPendingCount}</Badge>
              <Badge variant="secondary" className="text-sm px-3 py-1.5" data-testid="tile-manager-review-submitted">Submitted: {dashboard.managerReviewSubmittedCount}</Badge>
            </CardContent>
          </Card>

          <Card data-testid="card-status-breakdown">
            <CardHeader>
              <CardTitle className="text-base">Lifecycle Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3" data-testid="performance-dashboard-tiles">
                {dashboard.statusBreakdown.map((item) => (
                  <Badge
                    key={item.status}
                    variant={REVIEW_STATUS_VARIANT[item.status] ?? 'outline'}
                    className="text-sm px-3 py-1.5"
                    data-testid={`status-badge-${item.status}`}
                  >
                    {REVIEW_STATUS_LABEL[item.status] ?? item.status}: {item.count}
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
