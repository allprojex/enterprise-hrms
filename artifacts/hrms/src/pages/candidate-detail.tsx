import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, Tag, X, Plus, StickyNote } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetCandidate,
  getGetCandidateQueryKey,
  useListCandidateNotes,
  getListCandidateNotesQueryKey,
  useCreateCandidateNote,
  useListCandidateTags,
  getListCandidateTagsQueryKey,
  useAddCandidateTag,
  useRemoveCandidateTag,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

export default function CandidateDetail() {
  const params = useParams<{ id: string }>();
  const candidateId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: candidate,
    isLoading,
    error,
    refetch,
  } = useGetCandidate(organizationId, candidateId, {
    query: { queryKey: getGetCandidateQueryKey(organizationId, candidateId), enabled: organizationId > 0 && candidateId > 0 },
  });

  const { data: notes, isLoading: notesLoading } = useListCandidateNotes(organizationId, candidateId, {
    query: { queryKey: getListCandidateNotesQueryKey(organizationId, candidateId), enabled: organizationId > 0 && candidateId > 0 },
  });

  const { data: tags, isLoading: tagsLoading } = useListCandidateTags(organizationId, candidateId, {
    query: { queryKey: getListCandidateTagsQueryKey(organizationId, candidateId), enabled: organizationId > 0 && candidateId > 0 },
  });

  const createNoteMutation = useCreateCandidateNote();
  const addTagMutation = useAddCandidateTag();
  const removeTagMutation = useRemoveCandidateTag();

  const [noteText, setNoteText] = useState('');
  const [newTag, setNewTag] = useState('');

  const invalidateNotes = () => queryClient.invalidateQueries({ queryKey: getListCandidateNotesQueryKey(organizationId, candidateId) });
  const invalidateTags = () => queryClient.invalidateQueries({ queryKey: getListCandidateTagsQueryKey(organizationId, candidateId) });

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    createNoteMutation.mutate(
      { organizationId, id: candidateId, data: { note: noteText.trim() } },
      {
        onSuccess: () => { invalidateNotes(); setNoteText(''); toast({ title: 'Note added' }); },
        onError: (err) => toast({ title: 'Could not add note', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    addTagMutation.mutate(
      { organizationId, id: candidateId, data: { tag: newTag.trim() } },
      {
        onSuccess: () => { invalidateTags(); setNewTag(''); toast({ title: 'Tag added' }); },
        onError: (err) => toast({ title: 'Could not add tag', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleRemoveTag = (tagId: number) => {
    removeTagMutation.mutate(
      { organizationId, id: candidateId, tagId },
      {
        onSuccess: () => { invalidateTags(); toast({ title: 'Tag removed' }); },
        onError: (err) => toast({ title: 'Could not remove tag', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this candidate" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !candidate) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <Link href="/applications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-applications">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Applications
        </Link>
        <h1 className="text-3xl font-bold text-foreground">{candidate.firstName} {candidate.lastName}</h1>
        <p className="text-muted-foreground">{candidate.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium text-foreground">{candidate.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="text-sm font-medium text-foreground">{candidate.phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Source</p>
            <p className="text-sm font-medium text-foreground capitalize">{candidate.source.replace(/_/g, ' ')}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" aria-hidden="true" />
            Tags
          </CardTitle>
          <CardDescription>Configurable, free-text labels for searching and filtering</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tagsLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {(tags ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tags yet.</p>}
              {(tags ?? []).map((t) => (
                <Badge key={t.id} variant="secondary" className="flex items-center gap-1" data-testid={`badge-tag-${t.id}`}>
                  {t.tag}
                  <button type="button" onClick={() => handleRemoveTag(t.id)} aria-label={`Remove tag ${t.tag}`} data-testid={`button-remove-tag-${t.id}`}>
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <form onSubmit={handleAddTag} className="flex gap-2 items-end pt-2 border-t border-border">
            <div className="space-y-2 flex-1 max-w-xs">
              <Label htmlFor="new-tag">Add Tag</Label>
              <Input id="new-tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} data-testid="input-new-tag" />
            </div>
            <Button type="submit" disabled={!newTag.trim() || addTagMutation.isPending} data-testid="button-add-tag">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {addTagMutation.isPending ? 'Adding…' : 'Add'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <StickyNote className="h-4 w-4" aria-hidden="true" />
            Notes
          </CardTitle>
          <CardDescription>Create-only — a correction is a new note, never an edit of a past one</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notesLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (notes ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(notes ?? []).map((n) => (
                <li key={n.id} className="py-3 space-y-1" data-testid={`row-note-${n.id}`}>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{n.note}</p>
                  <p className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString()}{n.applicationId ? ` · Application #${n.applicationId}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAddNote} className="space-y-2 pt-2 border-t border-border">
            <Label htmlFor="new-note">Add Note</Label>
            <Textarea id="new-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} data-testid="input-new-note" />
            <Button type="submit" disabled={!noteText.trim() || createNoteMutation.isPending} data-testid="button-add-note">
              {createNoteMutation.isPending ? 'Saving…' : 'Add Note'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
