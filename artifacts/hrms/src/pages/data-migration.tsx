import { useMemo, useRef, useState } from 'react';
import {
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  ShieldCheck,
  PlayCircle,
  Ban,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMigrations,
  getListMigrationsQueryKey,
  useListMigrationEntityTypes,
  getListMigrationEntityTypesQueryKey,
  useGetMigration,
  getGetMigrationQueryKey,
  useGetMigrationIssues,
  getGetMigrationIssuesQueryKey,
  useGetMigrationReconciliation,
  getGetMigrationReconciliationQueryKey,
  useCreateMigration,
  useUploadMigrationSource,
  useSetMigrationSourceMapping,
  useValidateMigration,
  useApproveMigration,
  useExecuteMigration,
  useCancelMigration,
  getGetMigrationTemplateUrl,
} from '@workspace/api-client-react';
import type {
  MigrationBatch,
  MigrationEntityType,
  MigrationSourceUploadResult,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

/**
 * Status presentation is never color-only — every badge carries an icon AND
 * a text label, matching the existing Legacy Import page's own accessibility
 * precedent.
 */
const STATUS_META: Record<string, { icon: typeof CheckCircle2; label: string; tone: string }> = {
  draft: { icon: FileSpreadsheet, label: 'Draft', tone: 'bg-muted text-muted-foreground' },
  mapped: { icon: FileSpreadsheet, label: 'Mapped', tone: 'bg-muted text-muted-foreground' },
  validated: { icon: CheckCircle2, label: 'Validated', tone: 'bg-blue-100 text-blue-800' },
  approved: { icon: ShieldCheck, label: 'Approved', tone: 'bg-blue-100 text-blue-800' },
  running: { icon: PlayCircle, label: 'Running', tone: 'bg-amber-100 text-amber-900' },
  completed: { icon: CheckCircle2, label: 'Completed', tone: 'bg-green-100 text-green-800' },
  completed_with_errors: { icon: AlertTriangle, label: 'Completed with errors', tone: 'bg-amber-100 text-amber-900' },
  failed: { icon: XCircle, label: 'Failed', tone: 'bg-red-100 text-red-800' },
  cancelled: { icon: Ban, label: 'Cancelled', tone: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { icon: FileSpreadsheet, label: status, tone: 'bg-muted text-muted-foreground' };
  const Icon = meta.icon;
  return (
    <Badge className={`gap-1 ${meta.tone}`} variant="secondary">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

/**
 * WS-7 — Data Migration. The full workflow in one place: create a migration
 * → upload one file per entity type → confirm each file's column mapping →
 * run the dry run → review every issue → approve → execute → reconcile.
 *
 * Deliberately a separate surface from the existing single-file Legacy
 * Import page, which is untouched and still works: this one imports many
 * entity types together with cross-entity references between them.
 */
export default function DataMigration() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [uploadEntityType, setUploadEntityType] = useState('');
  const [pendingUpload, setPendingUpload] = useState<MigrationSourceUploadResult | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: number; name: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listQuery = useListMigrations(organizationId, {
    query: { queryKey: getListMigrationsQueryKey(organizationId), enabled },
  });
  const entityTypesQuery = useListMigrationEntityTypes(organizationId, {
    query: { queryKey: getListMigrationEntityTypesQueryKey(organizationId), enabled },
  });
  const detailQuery = useGetMigration(organizationId, selectedId ?? 0, {
    query: { queryKey: getGetMigrationQueryKey(organizationId, selectedId ?? 0), enabled: enabled && selectedId != null },
  });
  const issuesQuery = useGetMigrationIssues(organizationId, selectedId ?? 0, {
    query: { queryKey: getGetMigrationIssuesQueryKey(organizationId, selectedId ?? 0), enabled: enabled && selectedId != null },
  });
  const reconciliationQuery = useGetMigrationReconciliation(organizationId, selectedId ?? 0, {
    query: {
      queryKey: getGetMigrationReconciliationQueryKey(organizationId, selectedId ?? 0),
      enabled: enabled && selectedId != null,
    },
  });

  const createMutation = useCreateMigration();
  const uploadMutation = useUploadMigrationSource();
  const mappingMutation = useSetMigrationSourceMapping();
  const validateMutation = useValidateMigration();
  const approveMutation = useApproveMigration();
  const executeMutation = useExecuteMigration();
  const cancelMutation = useCancelMigration();

  const entityTypes: MigrationEntityType[] = entityTypesQuery.data?.entityTypes ?? [];
  const migration: MigrationBatch | undefined = detailQuery.data?.migration;
  const sources = detailQuery.data?.sources ?? [];
  const executionPolicy = detailQuery.data?.executionPolicy;

  const selectedAdapter = useMemo(
    () => entityTypes.find((e) => e.entityType === (pendingUpload ? uploadEntityType : '')),
    [entityTypes, pendingUpload, uploadEntityType],
  );

  const refetchAll = async () => {
    await Promise.all([listQuery.refetch(), detailQuery.refetch(), issuesQuery.refetch(), reconciliationQuery.refetch()]);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createMutation.mutateAsync({ organizationId, data: { name: newName.trim() } });
      setNewName('');
      setSelectedId(created.id);
      await listQuery.refetch();
      toast({ title: 'Migration created', description: `"${created.name}" is ready for source files.` });
    } catch {
      toast({ title: 'Could not create migration', variant: 'destructive' });
    }
  };

  const handleUpload = async (file: File) => {
    if (!selectedId || !uploadEntityType) return;
    try {
      const result = await uploadMutation.mutateAsync({
        organizationId,
        migrationId: selectedId,
        data: { file, entityType: uploadEntityType },
      });
      setPendingUpload(result);
      setMapping(result.autoMapping as Record<string, string>);
      if (result.unmappedHeaders.length > 0 || result.missingRequiredFields.length > 0) {
        toast({
          title: 'Check the column mapping',
          description: 'Some columns could not be matched confidently — confirm them below before continuing.',
        });
      }
    } catch (err) {
      toast({
        title: 'Upload failed',
        description: err instanceof Error ? err.message : 'The file could not be read.',
        variant: 'destructive',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveMapping = async () => {
    if (!selectedId || !pendingUpload) return;
    try {
      const result = await mappingMutation.mutateAsync({
        organizationId,
        migrationId: selectedId,
        sourceId: pendingUpload.source.id,
        data: { mapping },
      });
      setPendingUpload(null);
      setUploadEntityType('');
      await refetchAll();
      toast({
        title: 'Columns mapped',
        description: `${result.stagedRowCount} row(s) staged${result.rowsWithErrors > 0 ? `, ${result.rowsWithErrors} with problems` : ''}.`,
      });
    } catch (err) {
      toast({
        title: 'Mapping rejected',
        description: err instanceof Error ? err.message : 'Check the required fields.',
        variant: 'destructive',
      });
    }
  };

  const runStep = async (
    label: string,
    fn: () => Promise<unknown>,
    describe: (result: never) => string,
  ) => {
    try {
      const result = await fn();
      await refetchAll();
      toast({ title: label, description: describe(result as never) });
    } catch (err) {
      toast({
        title: `${label} failed`,
        description: err instanceof Error ? err.message : 'See the issues list for details.',
        variant: 'destructive',
      });
    }
  };

  // Same toasts and refetch as runStep, but a refused cancel is re-thrown so the
  // confirmation dialog stays open instead of looking as if it succeeded.
  const handleCancelMigration = async (migrationId: number) => {
    try {
      await cancelMutation.mutateAsync({ organizationId, migrationId });
    } catch (err) {
      toast({
        title: 'Migration cancelled failed',
        description: err instanceof Error ? err.message : 'See the issues list for details.',
        variant: 'destructive',
      });
      throw err;
    }
    await refetchAll();
    toast({ title: 'Migration cancelled', description: 'No data was written.' });
  };

  if (isForbidden(listQuery.error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to data migration"
          message="Importing an organization's records requires the migration permissions. Ask an organization administrator if you need access."
        />
      </div>
    );
  }

  const issues = issuesQuery.data?.issues ?? [];
  const reconciliation = reconciliationQuery.data;

  return (
    <div className="space-y-6 p-6" data-testid="page-data-migration">
      <div>
        <h1 className="text-2xl font-semibold">Data Migration</h1>
        <p className="text-muted-foreground">
          Import an organization&apos;s existing records — structure, employees, employment history, qualifications,
          leave balances and payroll opening balances — from CSV or Excel, with a full dry run before anything is
          written.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Migrations</CardTitle>
          <CardDescription>Create a new migration, or pick one to continue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow">
              <Label htmlFor="migration-name">New migration name</Label>
              <Input
                id="migration-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Head office historical records"
              />
            </div>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
              Create
            </Button>
          </div>

          {listQuery.data?.migrations?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.data.migrations.map((m) => (
                  <TableRow key={m.id} data-testid={`row-migration-${m.id}`}>
                    <TableCell>{m.name}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell>{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant={selectedId === m.id ? 'default' : 'outline'} size="sm" onClick={() => setSelectedId(m.id)}>
                        {selectedId === m.id ? 'Selected' : 'Open'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No migrations yet.</p>
          )}
        </CardContent>
      </Card>

      {migration && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {migration.name} <StatusBadge status={migration.status} />
              </CardTitle>
              <CardDescription>
                Upload one file per entity type. Structure (branches, departments, positions) is imported before
                employees, and employees before anything that references them — the order in the file list does not
                matter.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-56">
                  <Label htmlFor="entity-type">Entity type</Label>
                  <Select value={uploadEntityType} onValueChange={setUploadEntityType}>
                    <SelectTrigger id="entity-type">
                      <SelectValue placeholder="Choose what this file contains" />
                    </SelectTrigger>
                    <SelectContent>
                      {entityTypes.map((e) => (
                        <SelectItem key={e.entityType} value={e.entityType}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  disabled={!uploadEntityType}
                  onClick={() => window.open(getGetMigrationTemplateUrl(organizationId, uploadEntityType), '_blank')}
                >
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Template
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleUpload(file);
                  }}
                />
                <Button disabled={!uploadEntityType || uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                  Upload file
                </Button>
              </div>

              {sources.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{entityTypes.find((e) => e.entityType === s.entityType)?.label ?? s.entityType}</TableCell>
                        <TableCell className="font-mono text-xs">{s.fileName}</TableCell>
                        <TableCell>{s.rowCount ?? '—'}</TableCell>
                        <TableCell>{s.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {pendingUpload && (
            <Card>
              <CardHeader>
                <CardTitle>Map columns — {pendingUpload.source.fileName}</CardTitle>
                <CardDescription>
                  Columns matched confidently are pre-filled. Anything ambiguous is left blank on purpose rather than
                  guessed — a wrong mapping in a bulk import is far more damaging than one extra click.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column in your file</TableHead>
                      <TableHead>Example value</TableHead>
                      <TableHead>Imports as</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingUpload.headers.map((header, index) => (
                      <TableRow key={header}>
                        <TableCell className="font-medium">{header}</TableCell>
                        <TableCell className="text-muted-foreground">{pendingUpload.sampleRows[0]?.[index] ?? '—'}</TableCell>
                        <TableCell>
                          <Select
                            value={mapping[header] ?? '__none__'}
                            onValueChange={(value) =>
                              setMapping((prev) => {
                                const next = { ...prev };
                                if (value === '__none__') delete next[header];
                                else next[header] = value;
                                return next;
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Do not import</SelectItem>
                              {(selectedAdapter ?? entityTypes.find((e) => e.entityType === pendingUpload.source.entityType))?.fields.map(
                                (f) => (
                                  <SelectItem key={f.key} value={f.key}>
                                    {f.label}
                                    {f.required ? ' *' : ''}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex gap-2">
                  <Button onClick={handleSaveMapping} disabled={mappingMutation.isPending}>
                    Save mapping
                  </Button>
                  <Button variant="outline" onClick={() => setPendingUpload(null)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Review and run</CardTitle>
              <CardDescription>
                The dry run writes nothing. Approval freezes the exact files reviewed — if a file changes afterwards,
                execution refuses to run until it is re-validated and re-approved.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/*
                The execution model is stated BEFORE approval, never left to
                assumption. A migration that cannot be undone as a single unit
                says so in plain language, with the reason.
              */}
              {executionPolicy && (
                <div
                  role="note"
                  className={`rounded-md border p-4 ${
                    executionPolicy.policy === 'atomic'
                      ? 'border-blue-200 bg-blue-50 text-blue-900'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                  }`}
                >
                  <p className="flex items-center gap-2 font-medium">
                    {executionPolicy.policy === 'atomic' ? (
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    )}
                    {executionPolicy.policy === 'atomic'
                      ? 'This migration runs as a single all-or-nothing transaction'
                      : 'This migration cannot be undone automatically'}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
                    {executionPolicy.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {executionPolicy.policy !== 'atomic' && (
                    <p className="mt-2 text-sm">
                      Rows that fail are listed individually so they can be corrected and re-run. Re-running only
                      retries rows that have not already been imported.
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={validateMutation.isPending}
                  onClick={() =>
                    runStep(
                      'Dry run complete',
                      () => validateMutation.mutateAsync({ organizationId, migrationId: migration.id }),
                      (r: { totalRows: number; totalErrors: number }) =>
                        `${r.totalRows} row(s) checked, ${r.totalErrors} with errors.`,
                    )
                  }
                >
                  Run dry run
                </Button>
                <Button
                  variant="outline"
                  disabled={migration.status !== 'validated' || approveMutation.isPending}
                  onClick={() =>
                    runStep(
                      'Migration approved',
                      () => approveMutation.mutateAsync({ organizationId, migrationId: migration.id }),
                      () => 'Source files are now frozen for execution.',
                    )
                  }
                >
                  <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                  Approve
                </Button>
                <Button
                  disabled={migration.status !== 'approved' || executeMutation.isPending}
                  onClick={() =>
                    runStep(
                      'Migration executed',
                      () => executeMutation.mutateAsync({ organizationId, migrationId: migration.id }),
                      (r: { created?: number; failed?: number; mode?: string }) =>
                        r.mode === 'background'
                          ? 'This migration is large, so it is running in the background.'
                          : `${r.created ?? 0} imported, ${r.failed ?? 0} failed.`,
                    )
                  }
                >
                  <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  Execute
                </Button>
                <Button
                  variant="outline"
                  disabled={!['draft', 'mapped', 'validated', 'approved'].includes(migration.status) || cancelMutation.isPending}
                  onClick={() => setCancelTarget({ id: migration.id, name: migration.name })}
                >
                  <Ban className="mr-2 h-4 w-4" aria-hidden="true" />
                  Cancel
                </Button>
              </div>

              {issues.length > 0 && (
                <div>
                  <h3 className="mb-2 font-medium">Rows needing attention</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Row</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {issues.map((issue, i) => (
                        <TableRow key={`${issue.entityType}-${issue.rowNumber}-${i}`}>
                          <TableCell>{issue.entityType}</TableCell>
                          <TableCell>{issue.rowNumber}</TableCell>
                          <TableCell>
                            <StatusBadge status={issue.validationStatus === 'error' ? 'failed' : 'completed_with_errors'} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(issue.messages as { message?: string }[] | null)?.map((m) => m.message).filter(Boolean).join('; ') ||
                              '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {reconciliation && reconciliation.totals.sourceRows > 0 && (
                <div>
                  <h3 className="mb-2 font-medium">Reconciliation</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Source rows</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Skipped</TableHead>
                        <TableHead>Failed</TableHead>
                        <TableHead>Pending</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconciliation.entities.map((e) => (
                        <TableRow key={e.entityType}>
                          <TableCell>{e.label}</TableCell>
                          <TableCell>{e.sourceRows}</TableCell>
                          <TableCell>{e.created}</TableCell>
                          <TableCell>{e.skipped}</TableCell>
                          <TableCell>{e.failed}</TableCell>
                          <TableCell>{e.pending}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-medium">
                        <TableCell>Total</TableCell>
                        <TableCell>{reconciliation.totals.sourceRows}</TableCell>
                        <TableCell>{reconciliation.totals.created}</TableCell>
                        <TableCell>{reconciliation.totals.skipped}</TableCell>
                        <TableCell>{reconciliation.totals.failed}</TableCell>
                        <TableCell>{reconciliation.totals.pending}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* "cancelled" is terminal in the batch state machine and only reachable
          before execution, so nothing has been written and nothing can resume. */}
      <ConfirmActionDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        title="Cancel migration?"
        description={
          <p>
            Are you sure you want to cancel “{cancelTarget?.name}”? No data has been imported, so nothing will be written. A cancelled
            migration cannot be resumed.
          </p>
        }
        confirmLabel="Cancel Migration"
        cancelLabel="Keep Migration"
        onConfirm={() => cancelTarget && handleCancelMigration(cancelTarget.id)}
        testId="dialog-cancel-migration"
      />
    </div>
  );
}
