import { useState } from 'react';
import { Ruler, Plus, Settings, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListPerformanceRatingScales,
  getListPerformanceRatingScalesQueryKey,
  useGetPerformanceRatingScale,
  getGetPerformanceRatingScaleQueryKey,
  useCreatePerformanceRatingScale,
  useUpdatePerformanceRatingScale,
  useReplacePerformanceRatingScaleLevels,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { isHrCapableRole } from '@/hooks/use-hr-capable';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

interface LevelDraft {
  key: number;
  value: string;
  label: string;
  description: string;
  sortOrder: number;
}

let draftKeySeq = 0;
function newLevelDraft(sortOrder: number): LevelDraft {
  return { key: draftKeySeq++, value: '', label: '', description: '', sortOrder };
}

export default function PerformanceRatingScales() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = isHrCapableRole(currentOrg?.roles);

  const {
    data: scales,
    isLoading,
    error,
    refetch,
  } = useListPerformanceRatingScales(organizationId, {
    query: { queryKey: getListPerformanceRatingScalesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  // --- Create ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const createMutation = useCreatePerformanceRatingScale();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { organizationId, data: { name: createName.trim(), description: createDescription.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceRatingScalesQueryKey(organizationId) });
          setCreateOpen(false);
          setCreateName('');
          setCreateDescription('');
          toast({ title: 'Rating scale created' });
        },
        onError: (err) => toast({ title: 'Could not create rating scale', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Manage (detail dialog: base fields + levels) ---
  const [manageId, setManageId] = useState<number | null>(null);
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = useGetPerformanceRatingScale(organizationId, manageId ?? 0, {
    query: { queryKey: getGetPerformanceRatingScaleQueryKey(organizationId, manageId ?? 0), enabled: organizationId > 0 && manageId != null },
  });

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [levelDrafts, setLevelDrafts] = useState<LevelDraft[]>([]);
  const [levelsDirty, setLevelsDirty] = useState(false);

  const openManage = (id: number) => {
    setManageId(id);
    setLevelsDirty(false);
  };
  const closeManage = () => {
    setManageId(null);
    setLevelDrafts([]);
    setLevelsDirty(false);
  };

  // Sync local edit state whenever a fresh detail loads for the open scale.
  if (detail && manageId === detail.scale.id && !levelsDirty && editName === '' && editDescription === '' && levelDrafts.length === 0) {
    setEditName(detail.scale.name);
    setEditDescription(detail.scale.description ?? '');
    setLevelDrafts(
      detail.levels.length > 0
        ? detail.levels.map((l) => ({ key: draftKeySeq++, value: String(l.value), label: l.label, description: l.description ?? '', sortOrder: l.sortOrder }))
        : [newLevelDraft(0)],
    );
  }

  const updateMutation = useUpdatePerformanceRatingScale();
  const replaceLevelsMutation = useReplacePerformanceRatingScaleLevels();

  const handleSaveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    if (manageId == null) return;
    updateMutation.mutate(
      { organizationId, id: manageId, data: { name: editName.trim(), description: editDescription.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceRatingScalesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceRatingScaleQueryKey(organizationId, manageId) });
          toast({ title: 'Rating scale updated' });
        },
        onError: (err) => toast({ title: 'Could not update rating scale', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const [statusTarget, setStatusTarget] = useState<{ name: string; archived: boolean } | null>(null);

  const handleToggleStatus = () => {
    if (manageId == null || !detail) return;
    const nextStatus = detail.scale.status === 'archived' ? 'active' : 'archived';
    return updateMutation.mutateAsync(
      { organizationId, id: manageId, data: { status: nextStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPerformanceRatingScalesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceRatingScaleQueryKey(organizationId, manageId) });
          toast({ title: nextStatus === 'archived' ? 'Rating scale archived' : 'Rating scale reactivated' });
        },
        onError: (err) => toast({ title: 'Could not update status', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSaveLevels = (e: React.FormEvent) => {
    e.preventDefault();
    if (manageId == null) return;
    replaceLevelsMutation.mutate(
      {
        organizationId,
        id: manageId,
        data: {
          levels: levelDrafts.map((d) => ({
            value: Number(d.value),
            label: d.label.trim(),
            description: d.description.trim() || undefined,
            sortOrder: d.sortOrder,
          })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPerformanceRatingScaleQueryKey(organizationId, manageId) });
          setLevelsDirty(false);
          toast({ title: 'Levels saved' });
        },
        onError: (err) => {
          const message = errorMessage(err);
          toast({
            title: 'Could not save levels',
            description: message ?? 'Please check the levels and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const levelsLocked = detail?.levelsLocked ?? false;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Ruler className="h-7 w-7 text-primary" aria-hidden="true" />
            Performance Rating Scales
          </h1>
          <p className="text-muted-foreground">Organization-configurable scales used to score Performance reviews.</p>
        </div>
        {isHrCapable && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-rating-scale">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Rating Scale
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add Rating Scale</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="scale-name">Name</Label>
                    <Input id="scale-name" value={createName} onChange={(e) => setCreateName(e.target.value)} required data-testid="input-scale-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scale-description">Description (optional)</Label>
                    <Textarea id="scale-description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} data-testid="input-scale-description" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-rating-scale">
                    {createMutation.isPending ? 'Creating…' : 'Create Scale'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading rating scales">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load rating scales" message="Could not fetch rating scales. Try again." onRetry={() => refetch()} />
      ) : !scales || scales.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Ruler className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No rating scales yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add a rating scale before configuring review templates.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Rating scales">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scales.map((scale) => (
                <TableRow key={scale.id} data-testid={`row-rating-scale-${scale.id}`}>
                  <TableCell className="font-medium">{scale.name}</TableCell>
                  <TableCell className="text-muted-foreground">{scale.description ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={scale.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                      {scale.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openManage(scale.id)} data-testid={`button-manage-rating-scale-${scale.id}`}>
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
            <DialogTitle>Manage Rating Scale</DialogTitle>
            <DialogDescription>Edit the scale and its ordered levels.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : detailError ? (
            <QueryError title="Could not load this rating scale" message={errorMessage(detailError) ?? 'Please try again.'} />
          ) : !detail ? null : (
            <div className="space-y-6 py-2">
              <form onSubmit={handleSaveDetails} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-scale-name">Name</Label>
                  <Input id="edit-scale-name" value={editName} onChange={(e) => setEditName(e.target.value)} required data-testid="input-edit-scale-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-scale-description">Description</Label>
                  <Textarea id="edit-scale-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} data-testid="input-edit-scale-description" />
                </div>
                <div className="flex justify-between">
                  <Button type="button" variant={detail.scale.status === 'archived' ? 'default' : 'destructive'} onClick={() => setStatusTarget({ name: detail.scale.name, archived: detail.scale.status === 'archived' })} disabled={updateMutation.isPending} data-testid="button-toggle-scale-status">
                    {detail.scale.status === 'archived' ? 'Reactivate' : 'Archive'}
                  </Button>
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-scale-details">
                    {updateMutation.isPending ? 'Saving…' : 'Save Details'}
                  </Button>
                </div>
              </form>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label>Levels</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setLevelDrafts((prev) => [...prev, newLevelDraft(prev.length)]);
                      setLevelsDirty(true);
                    }}
                    data-testid="button-add-level"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Level
                  </Button>
                </div>

                {levelsLocked ? (
                  <p className="text-sm text-muted-foreground" data-testid="text-levels-locked">
                    This scale's levels are locked because it has already been used by a review. Archive it and create a new scale to make changes.
                  </p>
                ) : (
                  <form onSubmit={handleSaveLevels} className="space-y-3">
                    {levelDrafts.map((level, i) => (
                      <div key={level.key} className="grid grid-cols-[80px_1fr_1fr_32px] gap-2 items-start" data-testid={`row-level-draft-${i}`}>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Value"
                          value={level.value}
                          onChange={(e) => {
                            setLevelDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, value: e.target.value } : d)));
                            setLevelsDirty(true);
                          }}
                          required
                          data-testid={`input-level-value-${i}`}
                        />
                        <Input
                          placeholder="Label"
                          value={level.label}
                          onChange={(e) => {
                            setLevelDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, label: e.target.value } : d)));
                            setLevelsDirty(true);
                          }}
                          required
                          data-testid={`input-level-label-${i}`}
                        />
                        <Input
                          placeholder="Description (optional)"
                          value={level.description}
                          onChange={(e) => {
                            setLevelDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, description: e.target.value } : d)));
                            setLevelsDirty(true);
                          }}
                          data-testid={`input-level-description-${i}`}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setLevelDrafts((prev) => prev.filter((_, idx) => idx !== i));
                            setLevelsDirty(true);
                          }}
                          aria-label={`Remove level ${i + 1}`}
                          data-testid={`button-remove-level-${i}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex justify-end">
                      <Button type="submit" disabled={replaceLevelsMutation.isPending || levelDrafts.length === 0} data-testid="button-save-levels">
                        {replaceLevelsMutation.isPending ? 'Saving…' : 'Save Levels'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={statusTarget !== null}
        onOpenChange={(o) => {
          if (!o) setStatusTarget(null);
        }}
        title={statusTarget?.archived ? 'Reactivate rating scale?' : 'Archive rating scale?'}
        description={
          statusTarget?.archived ? (
            <p>“{statusTarget?.name}” will be set to active again and can be selected for new performance cycles.</p>
          ) : (
            <p>
              “{statusTarget?.name}” will be archived and can no longer be selected for new performance cycles. Existing
              templates, cycles and reviews that use it are not changed, and the scale can be reactivated later.
            </p>
          )
        }
        confirmLabel={statusTarget?.archived ? 'Reactivate Rating Scale' : 'Archive Rating Scale'}
        tone={statusTarget?.archived ? 'default' : 'destructive'}
        onConfirm={handleToggleStatus}
        testId="dialog-scale-status"
      />
    </div>
  );
}
