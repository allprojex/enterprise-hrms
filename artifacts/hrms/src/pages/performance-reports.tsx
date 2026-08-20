import { useState } from 'react';
import { FileBarChart, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  useRunPerformanceReport,
  getRunPerformanceReportQueryKey,
  getRunPerformanceReportUrl,
  useListPerformanceCycles,
  getListPerformanceCyclesQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListPositions,
  getListPositionsQueryKey,
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

export default function PerformanceReports() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [selectedReportKey, setSelectedReportKey] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [cycleId, setCycleId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [positionId, setPositionId] = useState(ALL);
  const [reviewerId, setReviewerId] = useState(ALL);
  const [employeeId, setEmployeeId] = useState(ALL);

  const { data: allReports, isLoading: catalogLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const reports = (allReports ?? []).filter((r) => r.category === 'performance');

  const reportKey = reports.some((r) => r.key === selectedReportKey) ? selectedReportKey : (reports[0]?.key ?? '');

  const { data: cycles } = useListPerformanceCycles(organizationId, {
    query: { queryKey: getListPerformanceCyclesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const employees = employeesPage?.items ?? [];
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: positions } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const params = {
    cycleId: cycleId === ALL ? undefined : Number(cycleId),
    status: status === ALL ? undefined : (status as 'draft' | 'self_assessment' | 'manager_review' | 'hr_review' | 'finalized' | 'acknowledged'),
    departmentId: departmentId === ALL ? undefined : Number(departmentId),
    positionId: positionId === ALL ? undefined : Number(positionId),
    reviewerId: reviewerId === ALL ? undefined : Number(reviewerId),
    employeeId: employeeId === ALL ? undefined : Number(employeeId),
  };

  const {
    data: result,
    isLoading: resultLoading,
    error,
    refetch,
  } = useRunPerformanceReport(organizationId, reportKey, params, {
    query: { queryKey: getRunPerformanceReportQueryKey(organizationId, reportKey, params), enabled: organizationId > 0 && !!reportKey },
  });

  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(getRunPerformanceReportUrl(organizationId, reportKey, { ...params, format: 'csv' }), {
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
          Performance Reports
        </h1>
        <p className="text-muted-foreground">Detailed Performance review breakdowns — scoped to your organization-wide or own/reviewer-of-record access.</p>
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
            <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-3 items-end">
              <div className="space-y-1">
                <Label htmlFor="performance-report-select">Report</Label>
                <Select value={reportKey} onValueChange={setSelectedReportKey}>
                  <SelectTrigger id="performance-report-select" data-testid="select-performance-report">
                    <SelectValue placeholder="Choose a report" />
                  </SelectTrigger>
                  <SelectContent>
                    {reports.map((r) => (
                      <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="performance-report-cycle">Cycle</Label>
                <Select value={cycleId} onValueChange={setCycleId}>
                  <SelectTrigger id="performance-report-cycle" data-testid="select-performance-report-cycle">
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
              <div className="space-y-1">
                <Label htmlFor="performance-report-status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="performance-report-status" data-testid="select-performance-report-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {Object.entries(REVIEW_STATUS_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="performance-report-employee">Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger id="performance-report-employee" data-testid="select-performance-report-employee">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All employees</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="performance-report-reviewer">Reviewer</Label>
                <Select value={reviewerId} onValueChange={setReviewerId}>
                  <SelectTrigger id="performance-report-reviewer" data-testid="select-performance-report-reviewer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All reviewers</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="performance-report-department">Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger id="performance-report-department" data-testid="select-performance-report-department">
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
              <div className="space-y-1">
                <Label htmlFor="performance-report-position">Position</Label>
                <Select value={positionId} onValueChange={setPositionId}>
                  <SelectTrigger id="performance-report-position" data-testid="select-performance-report-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All positions</SelectItem>
                    {(positions ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardContent className="pt-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={!reportKey || isDownloading}
                data-testid="button-download-performance-report-csv"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download CSV
              </Button>
            </CardContent>
          </Card>

          {isForbidden(error) ? (
            <QueryError title="Access denied" message="You don't have permission to view Performance reporting." />
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
                        <TableRow key={i} data-testid={`row-performance-report-${i}`}>
                          {result.columns.map((col) => (
                            <TableCell key={col.key}>{row[col.key] == null ? '—' : String(row[col.key])}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
