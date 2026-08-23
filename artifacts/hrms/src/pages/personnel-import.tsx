import { useRef, useState } from 'react';
import { Upload, Download, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { getStoredToken } from '@/lib/auth';
import {
  useGetMe,
  getGetMeQueryKey,
  usePreviewPersonnelImport,
  useCommitPersonnelImport,
  getGetPersonnelImportTemplateUrl,
} from '@workspace/api-client-react';
import type { PersonnelImportValidationSummary, PersonnelImportCommitResult } from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  valid: CheckCircle2,
  warning: AlertTriangle,
  invalid: XCircle,
};
const STATUS_LABEL: Record<string, string> = {
  valid: 'Valid',
  warning: 'Warning',
  invalid: 'Invalid',
};

/**
 * Legacy Import (Phase 3H, W119, Decision 19) — the frozen V1 workflow:
 * choose a CSV → preview (validate only, nothing written) → review
 * row-level valid/warning/invalid results (never color-only — every row
 * carries an icon AND a text label) → commit the SAME file. Never
 * auto-submits on file selection; commit is only enabled once a preview
 * with zero invalid rows exists for the currently-selected file.
 */
export default function PersonnelImport() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<PersonnelImportValidationSummary | null>(null);
  const [commitResult, setCommitResult] = useState<PersonnelImportCommitResult | null>(null);

  const previewMutation = usePreviewPersonnelImport();
  const commitMutation = useCommitPersonnelImport();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setSummary(null);
    setCommitResult(null);
  };

  const handlePreview = () => {
    if (!selectedFile || organizationId <= 0) return;
    previewMutation.mutate(
      { organizationId, data: { file: selectedFile } },
      {
        onSuccess: (data) => {
          setSummary(data);
          setCommitResult(null);
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not validate file', description: message ?? 'Please check the file and try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleCommit = () => {
    if (!selectedFile || organizationId <= 0 || !summary || summary.invalidCount > 0) return;
    commitMutation.mutate(
      { organizationId, data: { file: selectedFile } },
      {
        onSuccess: (data) => {
          setCommitResult(data);
          toast({ title: `${data.count} employee(s) imported` });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Import failed', description: message ?? 'Nothing was imported — please review and try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleDownloadTemplate = async () => {
    try {
      const token = getStoredToken();
      const res = await fetch(getGetPersonnelImportTemplateUrl(organizationId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'personnel-import-template.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Could not download template', description: 'Please try again.', variant: 'destructive' });
    }
  };

  const canCommit = !!summary && summary.invalidCount === 0 && !commitMutation.isPending && !commitResult;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Upload className="h-7 w-7 text-primary" aria-hidden="true" />
          Legacy Personnel Import
        </h1>
        <p className="text-muted-foreground">
          Bring existing staff numbers, PIF numbers, and personnel records into the platform without regenerating them. A generic, platform-defined CSV format — download the template below.
        </p>
      </div>

      {isForbidden(previewMutation.error) || isForbidden(commitMutation.error) ? (
        <QueryError title="Access denied" message="You don't have permission to import personnel records." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>1. Choose a CSV file</CardTitle>
              <CardDescription>Required: firstName, lastName. Everything else is optional or conditionally required — see the template.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" onClick={handleDownloadTemplate} data-testid="button-download-import-template">
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Download Template
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-import-file"
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-choose-import-file">
                {selectedFile ? selectedFile.name : 'Choose File'}
              </Button>
              <Button
                type="button"
                onClick={handlePreview}
                disabled={!selectedFile || previewMutation.isPending}
                data-testid="button-preview-import"
              >
                {previewMutation.isPending ? 'Validating…' : '2. Validate (Preview)'}
              </Button>
            </CardContent>
          </Card>

          {summary && (
            <Card>
              <CardHeader>
                <CardTitle>3. Review</CardTitle>
                <CardDescription>
                  {summary.totalRows} row(s) — <span data-testid="text-import-valid-count">{summary.validCount} valid</span>, {summary.warningCount} with warnings, {summary.invalidCount} invalid.
                  {summary.invalidCount > 0 && ' Fix every invalid row and re-validate before committing — nothing is imported until every row is valid.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table aria-label="Import validation results">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.rows.map((row) => {
                        const Icon = STATUS_ICON[row.status] ?? CheckCircle2;
                        return (
                          <TableRow key={row.rowNumber} data-testid={`row-import-${row.rowNumber}`}>
                            <TableCell>{row.rowNumber}</TableCell>
                            <TableCell>
                              <Badge
                                variant={row.status === 'invalid' ? 'destructive' : 'secondary'}
                                className="inline-flex items-center gap-1"
                              >
                                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                {STATUS_LABEL[row.status] ?? row.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {[...row.errors, ...row.warnings].join('; ') || '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {summary && !commitResult && (
            <Card>
              <CardHeader>
                <CardTitle>4. Commit</CardTitle>
                <CardDescription>Creates every valid row's employee, staff-number allocation, and personnel file in one all-or-nothing operation.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={handleCommit} disabled={!canCommit} data-testid="button-commit-import">
                  {commitMutation.isPending ? 'Importing…' : `Commit ${summary.validCount + summary.warningCount} Row(s)`}
                </Button>
              </CardContent>
            </Card>
          )}

          {commitResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-chart-3" aria-hidden="true" />
                  Import Complete
                </CardTitle>
                <CardDescription data-testid="text-import-result-count">{commitResult.count} employee(s) created.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table aria-label="Import result">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Employee ID</TableHead>
                        <TableHead>Staff Number</TableHead>
                        <TableHead>PIF Number</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commitResult.created.map((row) => (
                        <TableRow key={row.rowNumber} data-testid={`row-import-result-${row.rowNumber}`}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>{row.employeeId}</TableCell>
                          <TableCell>{row.employeeNumber ?? '—'}</TableCell>
                          <TableCell>{row.pifNumber ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
