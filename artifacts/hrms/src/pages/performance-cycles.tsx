import { useState } from 'react';
import { CalendarRange, Plus, Settings, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListPerformanceCycles,
  getListPerformanceCyclesQueryKey,
  useGetPerformanceCycle,
  getGetPerformanceCycleQueryKey,
  useListPerformanceReviewTemplates,
  getListPerformanceReviewTemplatesQueryKey,
  useListPerformanceRatingScales,
  getListPerformanceRatingScalesQueryKey,
  useCreatePerformanceCycle,
  useUpdatePerformanceCycle,
  useGeneratePerformanceReviews,
  type CreatePerformanceCycleInputCycleType,
  type CreatePerformanceCycleInputApplicabilityScope,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { isHrCapableRole } from '@/hooks/use-hr-capable';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const CYCLE_TYPES: CreatePerformanceCycleInputCycleType[] = ['annual', 'semiannual', 'quarterly', 'monthly', 'probation', 'ad_hoc'];
const APPLICABILITY_LABEL: Record<string, string> = {
  all_active: 'All active employees',
  department: 'Specific departments',
  position: 'Specific positions',
  manual: 'Manually assigned',
};

function parseIdList(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

export default function PerformanceCycles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = isHrCapableRole(currentOrg?.roles);

  const {
    data: cycles,
    isLoading,
    error,
    refetch,
  } = useListPerformanceCycles(organizationId, {
    query: { queryKey: getListPerformanceCyclesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const { data: templates } = useListPerformanceReviewTemplates(organizationId, {
    query: { queryKey: getListPerformanceReviewTemplatesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const activeTemplates = (templates ?? []).filter((t) => t.status === 'active');
  const templateNameById = new Map((templates ?? []).map((t) => [t.id, t.name]));

  const { data: ratingScales } = useListPerformanceRatingScales(organizationId, {
    query: { queryKey: getListPerformanceRatingScalesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const activeScales = (ratingScales ?? []).filter((s) => s.status === 'active');
  const scaleNameById = new Map((ratingScales ?? []).map((s) => [s.id, s.name]));

  // --- Create ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<CreatePerformanceCycleInputCycleType>('annual');
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd] = useState('');
  const [createTemplateId, setCreateTemplateId] = useState('');
  const [createRatingScaleId, setCreateRatingScaleId] = useState('');
  const [createScope, setCreateScope] = useState<CreatePerformanceCycleInputApplicabilityScope>('all_active');
  const [createDeptIds, setCreateDeptIds] = useState('');
  const [createPosIds, setCreatePosIds] = useState('');
  const createMutation = useCreatePerformanceCycle();

  const resetCreateForm = () => {
    setCreateName('');
    setCreateType('annual');
    setCreateStart('');
    setCreateEnd('');
    setCreateTemplateId('');
    setCreateRatingScaleId('');
    setCreateScope('all_active');
    setCreateDeptIds('');
    setCreatePosIds('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organizationId,
        data: {
          name: createName.trim(),
          cycleType: createType,
          startDate: createStart,
          endDate: createEnd,
          templateId: Number(createTemplateId),
          ratingScaleId: Number(createRatingScaleId),
          applicabilityScope: createScope,
          applicabilityDepartmentIds: createScope === 'department' ? parseIdList(createDeptIds) : undefined,
          applicabilityPositionIds: createScope === 'position' ? parseIdList(createPosIds) : undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceCyclesQueryKey(organizationId) });
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: 'Performance cycle created' });
        },
        onError: (err) => toast({ title: 'Could not create cycle', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Manage ---
  const [manageId, setManageId] = useState<number | null>(null);
  const {
    data: cycle,
    isLoading: detailLoading,
    error: detailError,
  } = useGetPerformanceCycle(organizationId, manageId ?? 0, {
    query: { queryKey: getGetPerformanceCycleQueryKey(organizationId, manageId ?? 0), enabled: organizationId > 0 && manageId != null },
  });

  const [manualEmployeeIds, setManualEmployeeIds] = useState('');
  const updateMutation = useUpdatePerformanceCycle();
  const generateMutation = useGeneratePerformanceReviews();

  const closeManage = () => {
    setManageId(null);
    setManualEmployeeIds('');
  };

  const isDraft = cycle?.status === 'draft';
  const isOpen = cycle?.status === 'open';
  const isClosed = cycle?.status === 'closed';

  const handleGenerateReviews = () => {
    if (manageId == null) return;
    generateMutation.mutate(
      {
        organizationId,
        id: manageId,
        data: cycle?.applicabilityScope === 'manual' ? { employeeIds: parseIdList(manualEmployeeIds) } : {},
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceCyclesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceCycleQueryKey(organizationId, manageId) });
          toast({ title: 'Reviews generated', description: `${result.reviewsCreated} review(s) created and opened for self-assessment.` });
        },
        onError: (err) => toast({ title: 'Could not generate reviews', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleTransition = (status: 'closed' | 'archived') => {
    if (manageId == null) return;
    updateMutation.mutate(
      { organizationId, id: manageId, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceCyclesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceCycleQueryKey(organizationId, manageId) });
          toast({ title: status === 'closed' ? 'Cycle closed' : 'Cycle archived' });
        },
        onError: (err) => toast({ title: 'Could not update cycle', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
    draft: 'outline',
    open: 'secondary',
    closed: 'default',
    archived: 'outline',
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <CalendarRange className="h-7 w-7 text-primary" aria-hidden="true" />
            Performance Cycles
          </h1>
          <p className="text-muted-foreground">Configure review periods and assign Performance reviews to eligible employees.</p>
        </div>
        {isHrCapable && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-cycle" disabled={activeTemplates.length === 0 || activeScales.length === 0}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Cycle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add Performance Cycle</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="cycle-name">Name</Label>
                    <Input id="cycle-name" value={createName} onChange={(e) => setCreateName(e.target.value)} required data-testid="input-cycle-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cycle-type">Cycle Type</Label>
                    <Select value={createType} onValueChange={(v) => setCreateType(v as CreatePerformanceCycleInputCycleType)}>
                      <SelectTrigger id="cycle-type" data-testid="select-cycle-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CYCLE_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cycle-start">Start Date</Label>
                      <Input id="cycle-start" type="date" value={createStart} onChange={(e) => setCreateStart(e.target.value)} required data-testid="input-cycle-start" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cycle-end">End Date</Label>
                      <Input id="cycle-end" type="date" value={createEnd} onChange={(e) => setCreateEnd(e.target.value)} required data-testid="input-cycle-end" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cycle-template">Review Template</Label>
                    <Select value={createTemplateId} onValueChange={setCreateTemplateId}>
                      <SelectTrigger id="cycle-template" data-testid="select-cycle-template">
                        <SelectValue placeholder="Choose a template" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeTemplates.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cycle-scale">Rating Scale</Label>
                    <Select value={createRatingScaleId} onValueChange={setCreateRatingScaleId}>
                      <SelectTrigger id="cycle-scale" data-testid="select-cycle-scale">
                        <SelectValue placeholder="Choose a rating scale" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeScales.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cycle-scope">Applicability</Label>
                    <Select value={createScope} onValueChange={(v) => setCreateScope(v as CreatePerformanceCycleInputApplicabilityScope)}>
                      <SelectTrigger id="cycle-scope" data-testid="select-cycle-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(APPLICABILITY_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {createScope === 'department' && (
                    <div className="space-y-2">
                      <Label htmlFor="cycle-dept-ids">Department IDs (comma-separated)</Label>
                      <Input id="cycle-dept-ids" value={createDeptIds} onChange={(e) => setCreateDeptIds(e.target.value)} placeholder="5, 6" data-testid="input-cycle-dept-ids" />
                    </div>
                  )}
                  {createScope === 'position' && (
                    <div className="space-y-2">
                      <Label htmlFor="cycle-pos-ids">Position IDs (comma-separated)</Label>
                      <Input id="cycle-pos-ids" value={createPosIds} onChange={(e) => setCreatePosIds(e.target.value)} placeholder="7, 8" data-testid="input-cycle-pos-ids" />
                    </div>
                  )}
                  {createScope === 'manual' && (
                    <p className="text-sm text-muted-foreground">Eligible employees are selected individually when you generate reviews for this cycle.</p>
                  )}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending || !createTemplateId || !createRatingScaleId} data-testid="button-submit-cycle">
                    {createMutation.isPending ? 'Creating…' : 'Create Cycle'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {(activeTemplates.length === 0 || activeScales.length === 0) && !isLoading && (
        <p className="text-sm text-muted-foreground">Add an active rating scale and an active review template before creating a cycle.</p>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading cycles">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load cycles" message="Could not fetch Performance cycles. Try again." onRetry={() => refetch()} />
      ) : !cycles || cycles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <CalendarRange className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Performance cycles yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add a cycle to start assigning Performance reviews to employees.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Performance cycles">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycles.map((c) => (
                <TableRow key={c.id} data-testid={`row-cycle-${c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{c.cycleType.replace('_', ' ')}</TableCell>
                  <TableCell className="text-muted-foreground">{c.startDate} – {c.endDate}</TableCell>
                  <TableCell className="text-muted-foreground">{templateNameById.get(c.templateId) ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]} className="capitalize">{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setManageId(c.id)} data-testid={`button-manage-cycle-${c.id}`}>
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={manageId !== null} onOpenChange={(open) => !open && closeManage()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manage Performance Cycle</DialogTitle>
            <DialogDescription>Review the cycle's configuration, generate reviews, or transition its status.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : detailError ? (
            <QueryError title="Could not load this cycle" message={errorMessage(detailError) ?? 'Please try again.'} />
          ) : !cycle ? null : (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium" data-testid="text-manage-cycle-name">{cycle.name}</p>
                  <p className="text-sm text-muted-foreground">{cycle.startDate} – {cycle.endDate}</p>
                </div>
                <Badge variant={STATUS_VARIANT[cycle.status]} className="capitalize" data-testid="text-manage-cycle-status">{cycle.status}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Template</div>
                <div>{templateNameById.get(cycle.templateId) ?? '—'}</div>
                <div className="text-muted-foreground">Rating Scale</div>
                <div>{scaleNameById.get(cycle.ratingScaleId) ?? '—'}</div>
                <div className="text-muted-foreground">Applicability</div>
                <div>{APPLICABILITY_LABEL[cycle.applicabilityScope] ?? cycle.applicabilityScope}</div>
              </div>

              {isDraft && (
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    Generate Reviews
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Opens this cycle and creates a Performance review for every eligible employee. This can only be done once per cycle.
                  </p>
                  {cycle.applicabilityScope === 'manual' && (
                    <div className="space-y-2">
                      <Label htmlFor="manual-employee-ids">Employee IDs (comma-separated)</Label>
                      <Input
                        id="manual-employee-ids"
                        value={manualEmployeeIds}
                        onChange={(e) => setManualEmployeeIds(e.target.value)}
                        placeholder="1, 2, 3"
                        data-testid="input-manual-employee-ids"
                      />
                    </div>
                  )}
                  <div className="flex justify-between">
                    <Button type="button" variant="destructive" onClick={() => handleTransition('archived')} disabled={updateMutation.isPending} data-testid="button-archive-cycle">
                      Archive Draft
                    </Button>
                    <Button
                      type="button"
                      onClick={handleGenerateReviews}
                      disabled={generateMutation.isPending || (cycle.applicabilityScope === 'manual' && parseIdList(manualEmployeeIds).length === 0)}
                      data-testid="button-generate-reviews"
                    >
                      {generateMutation.isPending ? 'Generating…' : 'Generate Reviews'}
                    </Button>
                  </div>
                </div>
              )}

              {isOpen && (
                <div className="border-t pt-4 flex justify-end">
                  <Button type="button" variant="outline" onClick={() => handleTransition('closed')} disabled={updateMutation.isPending} data-testid="button-close-cycle">
                    Close Cycle
                  </Button>
                </div>
              )}

              {isClosed && (
                <div className="border-t pt-4 flex justify-end">
                  <Button type="button" variant="outline" onClick={() => handleTransition('archived')} disabled={updateMutation.isPending} data-testid="button-archive-closed-cycle">
                    Archive Cycle
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
