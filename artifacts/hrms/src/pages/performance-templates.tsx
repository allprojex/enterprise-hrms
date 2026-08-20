import { useState } from 'react';
import { FileText, Plus, Settings, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListPerformanceReviewTemplates,
  getListPerformanceReviewTemplatesQueryKey,
  useGetPerformanceReviewTemplate,
  getGetPerformanceReviewTemplateQueryKey,
  useListPerformanceRatingScales,
  getListPerformanceRatingScalesQueryKey,
  useCreatePerformanceReviewTemplate,
  useUpdatePerformanceReviewTemplate,
  useReplacePerformanceTemplateCompetencies,
  type CreatePerformanceReviewTemplateInputApplicabilityScope,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const APPLICABILITY_LABEL: Record<string, string> = {
  all_active: 'All active employees',
  department: 'Specific departments',
  position: 'Specific positions',
  manual: 'Manually assigned',
};

interface CompetencyDraft {
  key: number;
  label: string;
  description: string;
  weight: string;
  sortOrder: number;
}

let draftKeySeq = 0;
function newCompetencyDraft(sortOrder: number): CompetencyDraft {
  return { key: draftKeySeq++, label: '', description: '', weight: '', sortOrder };
}

export default function PerformanceTemplates() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'hr_manager' || r === 'super_admin') ?? false;

  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useListPerformanceReviewTemplates(organizationId, {
    query: { queryKey: getListPerformanceReviewTemplatesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const { data: ratingScales } = useListPerformanceRatingScales(organizationId, {
    query: { queryKey: getListPerformanceRatingScalesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const activeScales = (ratingScales ?? []).filter((s) => s.status === 'active');
  const scaleNameById = new Map((ratingScales ?? []).map((s) => [s.id, s.name]));

  // --- Create ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createRatingScaleId, setCreateRatingScaleId] = useState('');
  const [createGoalsWeight, setCreateGoalsWeight] = useState('60');
  const [createCompetenciesWeight, setCreateCompetenciesWeight] = useState('40');
  const [createScope, setCreateScope] = useState<CreatePerformanceReviewTemplateInputApplicabilityScope>('all_active');
  const createMutation = useCreatePerformanceReviewTemplate();

  const resetCreateForm = () => {
    setCreateName('');
    setCreateDescription('');
    setCreateRatingScaleId('');
    setCreateGoalsWeight('60');
    setCreateCompetenciesWeight('40');
    setCreateScope('all_active');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organizationId,
        data: {
          name: createName.trim(),
          description: createDescription.trim() || undefined,
          ratingScaleId: Number(createRatingScaleId),
          goalsWeight: Number(createGoalsWeight),
          competenciesWeight: Number(createCompetenciesWeight),
          applicabilityScope: createScope,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceReviewTemplatesQueryKey(organizationId) });
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: 'Review template created' });
        },
        onError: (err) => toast({ title: 'Could not create template', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Manage (detail dialog: base fields + competencies) ---
  const [manageId, setManageId] = useState<number | null>(null);
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = useGetPerformanceReviewTemplate(organizationId, manageId ?? 0, {
    query: { queryKey: getGetPerformanceReviewTemplateQueryKey(organizationId, manageId ?? 0), enabled: organizationId > 0 && manageId != null },
  });

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editRatingScaleId, setEditRatingScaleId] = useState('');
  const [editGoalsWeight, setEditGoalsWeight] = useState('');
  const [editCompetenciesWeight, setEditCompetenciesWeight] = useState('');
  const [editScope, setEditScope] = useState<CreatePerformanceReviewTemplateInputApplicabilityScope>('all_active');
  const [competencyDrafts, setCompetencyDrafts] = useState<CompetencyDraft[]>([]);
  const [synced, setSynced] = useState(false);

  const openManage = (id: number) => {
    setManageId(id);
    setSynced(false);
  };
  const closeManage = () => {
    setManageId(null);
    setCompetencyDrafts([]);
    setSynced(false);
  };

  if (detail && manageId === detail.template.id && !synced) {
    setSynced(true);
    setEditName(detail.template.name);
    setEditDescription(detail.template.description ?? '');
    setEditRatingScaleId(String(detail.template.ratingScaleId));
    setEditGoalsWeight(String(detail.template.goalsWeight));
    setEditCompetenciesWeight(String(detail.template.competenciesWeight));
    setEditScope(detail.template.applicabilityScope as CreatePerformanceReviewTemplateInputApplicabilityScope);
    setCompetencyDrafts(
      detail.competencies.map((c) => ({ key: draftKeySeq++, label: c.label, description: c.description ?? '', weight: String(c.weight), sortOrder: c.sortOrder })),
    );
  }

  const updateMutation = useUpdatePerformanceReviewTemplate();
  const replaceCompetenciesMutation = useReplacePerformanceTemplateCompetencies();
  const isArchived = detail?.template.status === 'archived';

  const handleSaveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    if (manageId == null) return;
    updateMutation.mutate(
      {
        organizationId,
        id: manageId,
        data: {
          name: editName.trim(),
          description: editDescription.trim() || undefined,
          ratingScaleId: Number(editRatingScaleId),
          goalsWeight: Number(editGoalsWeight),
          competenciesWeight: Number(editCompetenciesWeight),
          applicabilityScope: editScope,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceReviewTemplatesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceReviewTemplateQueryKey(organizationId, manageId) });
          toast({ title: 'Template updated' });
        },
        onError: (err) => toast({ title: 'Could not update template', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleToggleStatus = () => {
    if (manageId == null || !detail) return;
    const nextStatus = isArchived ? 'active' : 'archived';
    updateMutation.mutate(
      { organizationId, id: manageId, data: { status: nextStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceReviewTemplatesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceReviewTemplateQueryKey(organizationId, manageId) });
          toast({ title: nextStatus === 'archived' ? 'Template archived' : 'Template reactivated' });
        },
        onError: (err) => toast({ title: 'Could not update status', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSaveCompetencies = (e: React.FormEvent) => {
    e.preventDefault();
    if (manageId == null) return;
    replaceCompetenciesMutation.mutate(
      {
        organizationId,
        id: manageId,
        data: {
          competencies: competencyDrafts.map((d) => ({
            label: d.label.trim(),
            description: d.description.trim() || undefined,
            weight: Number(d.weight),
            sortOrder: d.sortOrder,
          })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPerformanceReviewTemplateQueryKey(organizationId, manageId) });
          toast({ title: 'Competencies saved' });
        },
        onError: (err) => {
          toast({
            title: 'Could not save competencies',
            description: errorMessage(err) ?? 'Please check the weights and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-7 w-7 text-primary" aria-hidden="true" />
            Performance Review Templates
          </h1>
          <p className="text-muted-foreground">Reusable competency sets and scoring weights for Performance reviews.</p>
        </div>
        {isHrCapable && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-template" disabled={activeScales.length === 0}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Template
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add Review Template</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Name</Label>
                    <Input id="template-name" value={createName} onChange={(e) => setCreateName(e.target.value)} required data-testid="input-template-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-description">Description (optional)</Label>
                    <Textarea id="template-description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} data-testid="input-template-description" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-rating-scale">Rating Scale</Label>
                    <Select value={createRatingScaleId} onValueChange={setCreateRatingScaleId}>
                      <SelectTrigger id="template-rating-scale" data-testid="select-template-rating-scale">
                        <SelectValue placeholder="Choose a rating scale" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeScales.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="template-goals-weight">Goals Weight (%)</Label>
                      <Input id="template-goals-weight" type="number" min={0} max={100} value={createGoalsWeight} onChange={(e) => setCreateGoalsWeight(e.target.value)} required data-testid="input-template-goals-weight" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="template-competencies-weight">Competencies Weight (%)</Label>
                      <Input id="template-competencies-weight" type="number" min={0} max={100} value={createCompetenciesWeight} onChange={(e) => setCreateCompetenciesWeight(e.target.value)} required data-testid="input-template-competencies-weight" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-scope">Applicability</Label>
                    <Select value={createScope} onValueChange={(v) => setCreateScope(v as CreatePerformanceReviewTemplateInputApplicabilityScope)}>
                      <SelectTrigger id="template-scope" data-testid="select-template-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(APPLICABILITY_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending || !createRatingScaleId} data-testid="button-submit-template">
                    {createMutation.isPending ? 'Creating…' : 'Create Template'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {activeScales.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">Add an active rating scale before creating a review template.</p>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading templates">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load templates" message="Could not fetch review templates. Try again." onRetry={() => refetch()} />
      ) : !templates || templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No review templates yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add a template to define how Performance reviews are structured and scored.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Review templates">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Rating Scale</TableHead>
                <TableHead>Weights (Goals / Competencies)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell className="text-muted-foreground">{scaleNameById.get(template.ratingScaleId) ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{template.goalsWeight}% / {template.competenciesWeight}%</TableCell>
                  <TableCell>
                    <Badge variant={template.status === 'active' ? 'secondary' : template.status === 'archived' ? 'outline' : 'outline'} className="capitalize">
                      {template.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openManage(template.id)} data-testid={`button-manage-template-${template.id}`}>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Review Template</DialogTitle>
            <DialogDescription>Edit the template and its competency set.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : detailError ? (
            <QueryError title="Could not load this template" message={errorMessage(detailError) ?? 'Please try again.'} />
          ) : !detail ? null : (
            <div className="space-y-6 py-2">
              {isArchived && (
                <p className="text-sm text-muted-foreground" data-testid="text-template-archived">
                  This template is archived. Reactivate it to make changes.
                </p>
              )}
              <form onSubmit={handleSaveDetails} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-template-name">Name</Label>
                  <Input id="edit-template-name" value={editName} onChange={(e) => setEditName(e.target.value)} required disabled={isArchived} data-testid="input-edit-template-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-template-description">Description</Label>
                  <Textarea id="edit-template-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} disabled={isArchived} data-testid="input-edit-template-description" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-template-rating-scale">Rating Scale</Label>
                  <Select value={editRatingScaleId} onValueChange={setEditRatingScaleId} disabled={isArchived}>
                    <SelectTrigger id="edit-template-rating-scale" data-testid="select-edit-template-rating-scale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(ratingScales ?? []).map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-template-goals-weight">Goals Weight (%)</Label>
                    <Input id="edit-template-goals-weight" type="number" min={0} max={100} value={editGoalsWeight} onChange={(e) => setEditGoalsWeight(e.target.value)} required disabled={isArchived} data-testid="input-edit-template-goals-weight" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-template-competencies-weight">Competencies Weight (%)</Label>
                    <Input id="edit-template-competencies-weight" type="number" min={0} max={100} value={editCompetenciesWeight} onChange={(e) => setEditCompetenciesWeight(e.target.value)} required disabled={isArchived} data-testid="input-edit-template-competencies-weight" />
                  </div>
                </div>
                <div className="flex justify-between">
                  <Button type="button" variant={isArchived ? 'default' : 'destructive'} onClick={handleToggleStatus} disabled={updateMutation.isPending} data-testid="button-toggle-template-status">
                    {isArchived ? 'Reactivate' : 'Archive'}
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending || isArchived} data-testid="button-save-template-details">
                    {updateMutation.isPending ? 'Saving…' : 'Save Details'}
                  </Button>
                </div>
              </form>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label>Competencies</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isArchived}
                    onClick={() => setCompetencyDrafts((prev) => [...prev, newCompetencyDraft(prev.length)])}
                    data-testid="button-add-competency"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Competency
                  </Button>
                </div>

                <form onSubmit={handleSaveCompetencies} className="space-y-3">
                  {competencyDrafts.map((competency, i) => (
                    <div key={competency.key} className="grid grid-cols-[1fr_1fr_80px_32px] gap-2 items-start" data-testid={`row-competency-draft-${i}`}>
                      <Input
                        placeholder="Label"
                        value={competency.label}
                        disabled={isArchived}
                        onChange={(e) => setCompetencyDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, label: e.target.value } : d)))}
                        required
                        data-testid={`input-competency-label-${i}`}
                      />
                      <Input
                        placeholder="Description (optional)"
                        value={competency.description}
                        disabled={isArchived}
                        onChange={(e) => setCompetencyDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, description: e.target.value } : d)))}
                        data-testid={`input-competency-description-${i}`}
                      />
                      <Input
                        type="number"
                        placeholder="Weight"
                        value={competency.weight}
                        disabled={isArchived}
                        onChange={(e) => setCompetencyDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, weight: e.target.value } : d)))}
                        required
                        data-testid={`input-competency-weight-${i}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={isArchived}
                        onClick={() => setCompetencyDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                        aria-label={`Remove competency ${i + 1}`}
                        data-testid={`button-remove-competency-${i}`}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {competencyDrafts.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">No competencies configured — required when Competencies Weight is above 0%.</p>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={replaceCompetenciesMutation.isPending || isArchived} data-testid="button-save-competencies">
                      {replaceCompetenciesMutation.isPending ? 'Saving…' : 'Save Competencies'}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
