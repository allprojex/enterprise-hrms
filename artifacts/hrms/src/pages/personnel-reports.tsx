import { useState } from 'react';
import { FileBarChart, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  useRunPersonnelReport,
  getRunPersonnelReportQueryKey,
  getRunPersonnelReportUrl,
  useListEmployees,
  getListEmployeesQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const ALL = '__all__';

/**
 * Personnel Records Reports (Phase 3H, W119) — the five frozen Decision-18
 * reports, gated personnel_file.read (never the broad employee.read). Every
 * report's own description states plainly whether it reads CURRENT state or
 * HISTORICAL allocation history (frozen plan §3/§6) — this page renders
 * exactly that description, never inventing its own framing.
 */
export default function PersonnelReports() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [selectedReportKey, setSelectedReportKey] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [employeeId, setEmployeeId] = useState(ALL);

  const { data: allReports, isLoading: catalogLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const reports = (allReports ?? []).filter((r) => r.category === 'personnel_records');

  const reportKey = reports.some((r) => r.key === selectedReportKey) ? selectedReportKey : (reports[0]?.key ?? '');

  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });

  const params = { employeeId: employeeId !== ALL ? Number(employeeId) : undefined };

  const {
    data: result,
    isLoading: resultLoading,
    error,
    refetch,
  } = useRunPersonnelReport(organizationId, reportKey, params, {
    query: { queryKey: getRunPersonnelReportQueryKey(organizationId, reportKey, params), enabled: organizationId > 0 && !!reportKey },
  });

  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(getRunPersonnelReportUrl(organizationId, reportKey, { ...params, format: 'csv' }), {
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
          Personnel Records Reports
        </h1>
        <p className="text-muted-foreground">Staff-number allocations, physical filing, and separation warnings — each report states whether it reflects current state or full history.</p>
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
            <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
              <div className="space-y-1">
                <Label htmlFor="personnel-report-select">Report</Label>
                <Select value={reportKey} onValueChange={setSelectedReportKey}>
                  <SelectTrigger id="personnel-report-select" data-testid="select-personnel-report">
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
                <Label htmlFor="personnel-report-employee">Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger id="personnel-report-employee" data-testid="select-personnel-report-employee">
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
            </CardContent>
            <CardContent className="pt-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={!reportKey || isDownloading}
                data-testid="button-download-personnel-report-csv"
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
                          <TableRow key={i} data-testid={`row-personnel-report-${i}`}>
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
