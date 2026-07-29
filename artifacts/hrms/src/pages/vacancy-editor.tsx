import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetVacancy,
  getGetVacancyQueryKey,
  useUpdateVacancy,
  usePublishVacancy,
  usePauseVacancy,
  useCloseVacancy,
  useArchiveVacancy,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function isConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 409;
}

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value ?? '—'}</p>
    </div>
  );
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  scheduled: 'secondary',
  published: 'secondary',
  paused: 'destructive',
  closed: 'outline',
  archived: 'outline',
};

interface EditableLocation { branchId: number | null; label: string }
interface EditableQuestion { questionText: string; questionType: 'text' | 'yes_no' | 'multiple_choice' | 'numeric'; isKnockout: boolean }

export default function VacancyEditor() {
  const params = useParams<{ id: string }>();
  const vacancyId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: vacancy,
    isLoading,
    error,
    refetch,
  } = useGetVacancy(organizationId, vacancyId, {
    query: { queryKey: getGetVacancyQueryKey(organizationId, vacancyId), enabled: organizationId > 0 && vacancyId > 0 },
  });

  const updateMutation = useUpdateVacancy();
  const publishMutation = usePublishVacancy();
  const pauseMutation = usePauseVacancy();
  const closeMutation = useCloseVacancy();
  const archiveMutation = useArchiveVacancy();

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editOpenings, setEditOpenings] = useState('1');
  const [editDescription, setEditDescription] = useState('');
  const [editFeatured, setEditFeatured] = useState(false);
  const [editLocations, setEditLocations] = useState<EditableLocation[]>([]);
  const [editQuestions, setEditQuestions] = useState<EditableQuestion[]>([]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetVacancyQueryKey(organizationId, vacancyId) });

  const openEdit = () => {
    if (!vacancy) return;
    setEditTitle(vacancy.title);
    setEditOpenings(String(vacancy.openingsCount));
    setEditDescription(vacancy.jobDescription ?? '');
    setEditFeatured(vacancy.featured);
    setEditLocations(vacancy.locations.map((l) => ({ branchId: l.branchId, label: l.label ?? '' })));
    setEditQuestions(vacancy.questions.map((q) => ({ questionText: q.questionText, questionType: q.questionType, isKnockout: q.isKnockout })));
    setEditOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      {
        organizationId,
        id: vacancyId,
        data: {
          title: editTitle.trim(),
          openingsCount: Number(editOpenings),
          jobDescription: editDescription.trim() || null,
          featured: editFeatured,
          locations: editLocations.filter((l) => l.label.trim()).map((l) => ({ label: l.label.trim() })),
          questions: editQuestions.filter((q) => q.questionText.trim()).map((q, i) => ({ ...q, displayOrder: i })),
        },
      },
      {
        onSuccess: () => { invalidate(); setEditOpen(false); toast({ title: 'Vacancy updated' }); },
        onError: (err) => toast({ title: 'Could not update vacancy', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handlePublish = () => {
    publishMutation.mutate(
      { organizationId, id: vacancyId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Vacancy published' }); },
        onError: (err) => {
          invalidate();
          toast({ title: isConflict(err) ? 'No longer eligible' : 'Could not publish vacancy', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handlePause = () => {
    pauseMutation.mutate(
      { organizationId, id: vacancyId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Vacancy paused' }); },
        onError: (err) => {
          invalidate();
          toast({ title: isConflict(err) ? 'No longer eligible' : 'Could not pause vacancy', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handleClose = () => {
    closeMutation.mutate(
      { organizationId, id: vacancyId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Vacancy closed' }); },
        onError: (err) => {
          invalidate();
          toast({ title: isConflict(err) ? 'No longer eligible' : 'Could not close vacancy', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handleArchive = () => {
    archiveMutation.mutate(
      { organizationId, id: vacancyId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Vacancy archived' }); },
        onError: (err) => {
          invalidate();
          toast({ title: isConflict(err) ? 'No longer eligible' : 'Could not archive vacancy', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this vacancy" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !vacancy) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isDraft = vacancy.status === 'draft';
  const canPublish = vacancy.status === 'draft' || vacancy.status === 'scheduled' || vacancy.status === 'paused';
  const canPause = vacancy.status === 'published';
  const canClose = vacancy.status === 'draft' || vacancy.status === 'scheduled' || vacancy.status === 'published' || vacancy.status === 'paused';
  const canArchive = vacancy.status === 'closed';

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/vacancies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-vacancies">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Vacancies
          </Link>
          <h1 className="text-3xl font-bold text-foreground">{vacancy.title}</h1>
          <Badge variant={STATUS_VARIANT[vacancy.status] ?? 'outline'} className="capitalize" data-testid="badge-vacancy-status">{vacancy.status}</Badge>
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <Button variant="outline" onClick={openEdit} data-testid="button-edit-vacancy">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </Button>
          )}
          {canPublish && (
            <Button onClick={handlePublish} disabled={publishMutation.isPending} data-testid="button-publish-vacancy">
              {publishMutation.isPending ? 'Publishing…' : vacancy.status === 'paused' ? 'Resume' : 'Publish'}
            </Button>
          )}
          {canPause && (
            <Button variant="outline" onClick={handlePause} disabled={pauseMutation.isPending} data-testid="button-pause-vacancy">
              {pauseMutation.isPending ? 'Pausing…' : 'Pause'}
            </Button>
          )}
          {canClose && (
            <Button variant="destructive" onClick={handleClose} disabled={closeMutation.isPending} data-testid="button-close-vacancy">
              {closeMutation.isPending ? 'Closing…' : 'Close'}
            </Button>
          )}
          {canArchive && (
            <Button variant="outline" onClick={handleArchive} disabled={archiveMutation.isPending} data-testid="button-archive-vacancy">
              {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Requisition" value={vacancy.requisitionId} />
          <Field label="Visibility" value={vacancy.visibility} />
          <Field label="Openings" value={`${vacancy.filledCount} / ${vacancy.openingsCount}`} />
          <Field label="Open Date" value={vacancy.openDate ? new Date(vacancy.openDate).toLocaleDateString() : null} />
          <Field label="Close Date" value={vacancy.closeDate ? new Date(vacancy.closeDate).toLocaleDateString() : null} />
          <Field label="Featured" value={vacancy.featured ? 'Yes' : 'No'} />
          {vacancy.jobDescription && <Field label="Description" value={vacancy.jobDescription} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Locations</CardTitle>
          <CardDescription>Where this opening is posted</CardDescription>
        </CardHeader>
        <CardContent>
          {vacancy.locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations added yet.</p>
          ) : (
            <ul className="space-y-1">
              {vacancy.locations.map((loc) => (
                <li key={loc.id} className="text-sm text-foreground" data-testid={`row-vacancy-location-${loc.id}`}>{loc.label ?? `Branch #${loc.branchId}`}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Screening Questions</CardTitle>
        </CardHeader>
        <CardContent>
          {vacancy.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No screening questions added yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {vacancy.questions.map((q) => (
                <li key={q.id} className="py-2" data-testid={`row-vacancy-question-${q.id}`}>
                  <p className="text-sm text-foreground">{q.questionText}</p>
                  <p className="text-xs text-muted-foreground capitalize">{q.questionType.replace('_', ' ')}{q.isKnockout ? ' · knockout' : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Vacancy</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-vac-title">Title *</Label>
                <Input id="edit-vac-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required data-testid="input-edit-vacancy-title" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vac-openings">Openings *</Label>
                <Input id="edit-vac-openings" type="number" min={1} value={editOpenings} onChange={(e) => setEditOpenings(e.target.value)} required data-testid="input-edit-vacancy-openings" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vac-description">Job Description</Label>
                <Textarea id="edit-vac-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} data-testid="textarea-edit-vacancy-description" />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-vac-featured" checked={editFeatured} onCheckedChange={(v) => setEditFeatured(!!v)} data-testid="checkbox-edit-vacancy-featured" />
                <Label htmlFor="edit-vac-featured">Featured</Label>
              </div>

              <div className="space-y-2">
                <Label>Locations</Label>
                {editLocations.map((loc, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={loc.label}
                      placeholder="e.g. Remote"
                      onChange={(e) => setEditLocations((prev) => prev.map((l, idx) => (idx === i ? { ...l, label: e.target.value } : l)))}
                      data-testid={`input-edit-location-${i}`}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setEditLocations((prev) => prev.filter((_, idx) => idx !== i))} data-testid={`button-remove-location-${i}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setEditLocations((prev) => [...prev, { branchId: null, label: '' }])} data-testid="button-add-location">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Location
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Screening Questions</Label>
                {editQuestions.map((q, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Input
                      value={q.questionText}
                      placeholder="Question text"
                      onChange={(e) => setEditQuestions((prev) => prev.map((item, idx) => (idx === i ? { ...item, questionText: e.target.value } : item)))}
                      data-testid={`input-edit-question-${i}`}
                    />
                    <Select
                      value={q.questionType}
                      onValueChange={(v) => setEditQuestions((prev) => prev.map((item, idx) => (idx === i ? { ...item, questionType: v as EditableQuestion['questionType'] } : item)))}
                    >
                      <SelectTrigger className="w-40" data-testid={`select-edit-question-type-${i}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="yes_no">Yes/No</SelectItem>
                        <SelectItem value="multiple_choice">Multiple Choice</SelectItem>
                        <SelectItem value="numeric">Numeric</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setEditQuestions((prev) => prev.filter((_, idx) => idx !== i))} data-testid={`button-remove-question-${i}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setEditQuestions((prev) => [...prev, { questionText: '', questionType: 'text', isKnockout: false }])} data-testid="button-add-question">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Question
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending || !editTitle.trim()} data-testid="button-save-vacancy">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
