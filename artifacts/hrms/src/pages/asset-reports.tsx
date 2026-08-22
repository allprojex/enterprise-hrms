import { useState } from 'react';
import { FileBarChart, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { getStoredToken } from '@/lib/auth';
import {
  useGetMe,
  getGetMeQueryKey,
  useListReports,
  getListReportsQueryKey,
  useRunAssetReport,
  getRunAssetReportQueryKey,
  getRunAssetReportUrl,
  useListAssets,
  getListAssetsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListMasterDataItems,
  getListMasterDataItemsQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const ALL = '__all__';

const ASSET_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  assigned: 'Assigned',
  maintenance: 'Maintenance',
  lost: 'Lost',
  retired: 'Retired',
};
const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Asset Reports (Phase 3E, W102 per the frozen plan's own §24 numbering):
 * §17's own exactly 3 frozen reports. Filters are rendered per-report only
 * — asset_register (categoryCode/status/branchId, organization-wide only),
 * asset_unreturned_by_employee (employeeId/departmentId, own/manager-
 * current/organization-wide), asset_maintenance_history (assetId/status/
 * dateFrom/dateTo, organization-wide only) — never a control the backend
 * would silently ignore (W93's own precedent finding). No client-side
 * calculation anywhere — this page renders exactly the server DTO.
 */
export default function AssetReports() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [selectedReportKey, setSelectedReportKey] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [categoryCode, setCategoryCode] = useState('');
  const [status, setStatus] = useState(ALL);
  const [branchId, setBranchId] = useState(ALL);
  const [employeeId, setEmployeeId] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [assetId, setAssetId] = useState(ALL);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: allReports, isLoading: catalogLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const reports = (allReports ?? []).filter((r) => r.category === 'asset_management');

  const reportKey = reports.some((r) => r.key === selectedReportKey) ? selectedReportKey : (reports[0]?.key ?? '');
  const isAssetRegister = reportKey === 'asset_register';
  const isUnreturned = reportKey === 'asset_unreturned_by_employee';
  const isMaintenanceHistory = reportKey === 'asset_maintenance_history';

  const { data: assetsPage } = useListAssets(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListAssetsQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 && isMaintenanceHistory },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 && isAssetRegister },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 && isUnreturned },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 && isUnreturned },
  });
  const { data: categoryItems } = useListMasterDataItems(organizationId, 'asset_category', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'asset_category'), enabled: organizationId > 0 && isAssetRegister },
  });

  const params = {
    categoryCode: isAssetRegister && categoryCode.trim() ? categoryCode.trim() : undefined,
    status: (isAssetRegister || isMaintenanceHistory) && status !== ALL ? status : undefined,
    branchId: isAssetRegister && branchId !== ALL ? Number(branchId) : undefined,
    employeeId: isUnreturned && employeeId !== ALL ? Number(employeeId) : undefined,
    departmentId: isUnreturned && departmentId !== ALL ? Number(departmentId) : undefined,
    assetId: isMaintenanceHistory && assetId !== ALL ? Number(assetId) : undefined,
    dateFrom: isMaintenanceHistory && dateFrom ? dateFrom : undefined,
    dateTo: isMaintenanceHistory && dateTo ? dateTo : undefined,
  };

  const {
    data: result,
    isLoading: resultLoading,
    error,
    refetch,
  } = useRunAssetReport(organizationId, reportKey, params, {
    query: { queryKey: getRunAssetReportQueryKey(organizationId, reportKey, params), enabled: organizationId > 0 && !!reportKey },
  });

  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(getRunAssetReportUrl(organizationId, reportKey, { ...params, format: 'csv' }), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportKey}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Could not download report', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <FileBarChart className="h-7 w-7 text-primary" aria-hidden="true" />
          Asset Reports
        </h1>
        <p className="text-muted-foreground">Detailed Asset breakdowns — asset_register and asset_maintenance_history are organization-wide only; unreturned-by-employee follows your own/current-manager/organization-wide access.</p>
      </div>

      {catalogLoading ? (
        <Skeleton className="h-12 w-64" />
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileBarChart className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No reports available</h3>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 items-end">
              <div className="space-y-1">
                <Label htmlFor="asset-report-select">Report</Label>
                <Select value={reportKey} onValueChange={setSelectedReportKey}>
                  <SelectTrigger id="asset-report-select" data-testid="select-asset-report">
                    <SelectValue placeholder="Choose a report" />
                  </SelectTrigger>
                  <SelectContent>
                    {reports.map((r) => (
                      <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isAssetRegister && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-category">Category</Label>
                  <Input
                    id="asset-report-category"
                    value={categoryCode}
                    onChange={(e) => setCategoryCode(e.target.value)}
                    list="asset-report-category-suggestions"
                    placeholder="All categories"
                    data-testid="input-asset-report-category"
                  />
                  <datalist id="asset-report-category-suggestions">
                    {(categoryItems ?? []).map((item) => (
                      <option key={item.id} value={item.code}>{item.label}</option>
                    ))}
                  </datalist>
                </div>
              )}

              {(isAssetRegister || isMaintenanceHistory) && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-status">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger id="asset-report-status" data-testid="select-asset-report-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {Object.entries(isAssetRegister ? ASSET_STATUS_LABEL : MAINTENANCE_STATUS_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isAssetRegister && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-branch">Branch</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger id="asset-report-branch" data-testid="select-asset-report-branch">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All branches</SelectItem>
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isUnreturned && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-employee">Employee</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId}>
                    <SelectTrigger id="asset-report-employee" data-testid="select-asset-report-employee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All employees</SelectItem>
                      {(employeesPage?.items ?? []).map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isUnreturned && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-department">Department (at issue time)</Label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger id="asset-report-department" data-testid="select-asset-report-department">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All departments</SelectItem>
                      {(departments ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isMaintenanceHistory && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-asset">Asset</Label>
                  <Select value={assetId} onValueChange={setAssetId}>
                    <SelectTrigger id="asset-report-asset" data-testid="select-asset-report-asset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All assets</SelectItem>
                      {(assetsPage?.items ?? []).map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.assetTag} — {a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isMaintenanceHistory && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-date-from">From</Label>
                  <Input id="asset-report-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="input-asset-report-date-from" />
                </div>
              )}

              {isMaintenanceHistory && (
                <div className="space-y-1">
                  <Label htmlFor="asset-report-date-to">To</Label>
                  <Input id="asset-report-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="input-asset-report-date-to" />
                </div>
              )}
            </CardContent>
            <CardContent className="pt-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={!reportKey || isDownloading}
                data-testid="button-download-asset-report-csv"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download CSV
              </Button>
            </CardContent>
          </Card>

          {isForbidden(error) ? (
            <QueryError title="Access denied" message="You don't have permission to view this report." />
          ) : error ? (
            <QueryError title="Failed to run report" message="Could not compute this report." onRetry={() => refetch()} />
          ) : resultLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading report">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !result || typeof result === 'string' ? null : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileBarChart className="h-5 w-5 text-primary" aria-hidden="true" />
                  {result.label}
                </CardTitle>
                <CardDescription>
                  {result.description} · Generated {new Date(result.generatedAt).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No data for this selection.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table aria-label={result.label}>
                      <TableHeader>
                        <TableRow>
                          {result.columns.map((col) => (
                            <TableHead key={col.key}>{col.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.rows.map((row, i) => (
                          <TableRow key={i} data-testid={`row-asset-report-${i}`}>
                            {result.columns.map((col) => (
                              <TableCell key={col.key}>{row[col.key] == null ? '—' : String(row[col.key])}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
