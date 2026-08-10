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
  useRunRecruitmentReport,
  getRunRecruitmentReportQueryKey,
  getRunRecruitmentReportUrl,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

export default function RecruitmentReports() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [selectedReportKey, setSelectedReportKey] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  const { data: allReports, isLoading: catalogLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const reports = (allReports ?? []).filter((r) => r.category === 'recruitment');

  // Derived, not stored: defaults to the first report until the caller
  // explicitly picks one, and re-derives cleanly if the catalog changes —
  // no effect/"sync on mount" needed, and no dependency on array identity.
  const reportKey = reports.some((r) => r.key === selectedReportKey) ? selectedReportKey : (reports[0]?.key ?? '');

  const {
    data: result,
    isLoading: resultLoading,
    error,
    refetch,
  } = useRunRecruitmentReport(
    organizationId,
    reportKey,
    {},
    { query: { queryKey: getRunRecruitmentReportQueryKey(organizationId, reportKey, {}), enabled: organizationId > 0 && !!reportKey } },
  );

  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(getRunRecruitmentReportUrl(organizationId, reportKey, { format: 'csv' }), {
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
          Recruitment Reports
        </h1>
        <p className="text-muted-foreground">Detailed recruitment breakdowns — scoped to your organization-wide or assigned workload access.</p>
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
            <CardContent className="pt-6 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="recruitment-report-select">Report</Label>
                <Select value={reportKey} onValueChange={setSelectedReportKey}>
                  <SelectTrigger id="recruitment-report-select" className="w-72" data-testid="select-recruitment-report">
                    <SelectValue placeholder="Choose a report" />
                  </SelectTrigger>
                  <SelectContent>
                    {reports.map((r) => (
                      <SelectItem key={r.key} value={r.key}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={!reportKey || isDownloading}
                data-testid="button-download-recruitment-report-csv"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download CSV
              </Button>
            </CardContent>
          </Card>

          {isForbidden(error) ? (
            <QueryError title="Access denied" message="You don't have permission to view recruitment reporting." />
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
                  <p className="text-sm text-muted-foreground py-8 text-center">No data yet.</p>
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
                        <TableRow key={i} data-testid={`row-recruitment-report-${i}`}>
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
