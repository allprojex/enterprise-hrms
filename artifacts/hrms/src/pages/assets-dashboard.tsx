import { LayoutDashboard, Boxes, Users, Clock, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetAssetDashboard,
  getGetAssetDashboardQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  assigned: 'Assigned',
  maintenance: 'Maintenance',
  lost: 'Lost',
  retired: 'Retired',
};
const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  available: 'secondary',
  assigned: 'outline',
  maintenance: 'outline',
  lost: 'destructive',
  retired: 'outline',
};

/**
 * Asset Dashboard (Phase 3E, W102 per the frozen plan's own §24 numbering —
 * this workstream's own prompt used "W101," reconciled with the user
 * before implementation since the frozen plan's actual W101 is a separate,
 * still-unbuilt "Internal Asset Workspace"): §18's own frozen 5
 * deterministic tiles, no financial/rate/KPI tile, no chart for its own
 * sake. Scope (own/manager-current-only/organization-wide) is resolved
 * entirely server-side from asset_management.reports.read — this page
 * renders exactly the server DTO, no client-side aggregation.
 */
export default function AssetsDashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useGetAssetDashboard(organizationId, {
    query: { queryKey: getGetAssetDashboardQueryKey(organizationId), enabled: organizationId > 0 },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
          Asset Dashboard
        </h1>
        <p className="text-muted-foreground">
          Organization-wide for HR/asset admins; your own currently-held assets, or your current direct reports' assets, otherwise.
        </p>
      </div>

      {isForbidden(error) ? (
        <QueryError title="Access denied" message="You don't have permission to view Asset reporting." />
      ) : error ? (
        <QueryError title="Could not load the dashboard" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !dashboard ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="asset-dashboard-tiles">
            <Card data-testid="card-total-assets">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <Boxes className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.totalAssetCount}</p>
                  <p className="text-sm text-muted-foreground">Total assets in scope</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-employees-with-assets">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <Users className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.employeesWithAssignedAssetsCount}</p>
                  <p className="text-sm text-muted-foreground">Employees currently holding an asset</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-overdue-returns">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <Clock className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.overdueReturnCount}</p>
                  <p className="text-sm text-muted-foreground">Overdue returns</p>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-open-incidents">
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <ShieldAlert className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{dashboard.openIncidentCount}</p>
                  <p className="text-sm text-muted-foreground">Open incidents</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-status-breakdown">
            <CardHeader>
              <CardTitle className="text-base">Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3" data-testid="asset-dashboard-status-breakdown">
                {dashboard.statusBreakdown.map((item) => (
                  <Badge
                    key={item.status}
                    variant={STATUS_VARIANT[item.status] ?? 'outline'}
                    className="text-sm px-3 py-1.5"
                    data-testid={`status-badge-${item.status}`}
                  >
                    {STATUS_LABEL[item.status] ?? item.status}: {item.count}
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
