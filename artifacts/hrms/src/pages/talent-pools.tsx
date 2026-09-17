import { useState } from 'react';
import { Users2, Plus, Archive, ArchiveRestore, X, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListTalentPools,
  getListTalentPoolsQueryKey,
  useCreateTalentPool,
  useArchiveTalentPool,
  useReactivateTalentPool,
  useListTalentPoolMembers,
  getListTalentPoolMembersQueryKey,
  useAddTalentPoolMember,
  useRemoveTalentPoolMember,
  useListCandidates,
  getListCandidatesQueryKey,
  useGetCandidate,
  getGetCandidateQueryKey,
  type TalentPool,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function MemberRow({ organizationId, candidateId, memberId, removePending, onRequestRemove }: { organizationId: number; candidateId: number; memberId: number; removePending: boolean; onRequestRemove: (candidateName: string) => void }) {
  const { data: candidate } = useGetCandidate(organizationId, candidateId, {
    query: { queryKey: getGetCandidateQueryKey(organizationId, candidateId), enabled: organizationId > 0 && candidateId > 0 },
  });
  const candidateName = candidate ? `${candidate.firstName} ${candidate.lastName}` : `Candidate #${candidateId}`;

  return (
    <TableRow data-testid={`row-pool-member-${memberId}`}>
      <TableCell className="font-medium">{candidateName}</TableCell>
      <TableCell className="text-muted-foreground">{candidate?.email ?? '—'}</TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant="ghost" onClick={() => onRequestRemove(candidateName)} disabled={removePending} data-testid={`button-remove-member-${memberId}`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ManageMembersDialog({ organizationId, pool, open, onOpenChange }: { organizationId: number; pool: TalentPool; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');

  const { data: members, isLoading: membersLoading } = useListTalentPoolMembers(organizationId, pool.id, {
    query: { queryKey: getListTalentPoolMembersQueryKey(organizationId, pool.id), enabled: open && organizationId > 0 },
  });

  const searchParams = { search: search || undefined, page: 1, pageSize: 10 };
  const { data: searchResults } = useListCandidates(organizationId, searchParams, {
    query: { queryKey: getListCandidatesQueryKey(organizationId, searchParams), enabled: open && organizationId > 0 && search.trim().length > 0 },
  });

  const addMutation = useAddTalentPoolMember();
  const removeMutation = useRemoveTalentPoolMember();
  const [removeTarget, setRemoveTarget] = useState<{ candidateId: number; name: string } | null>(null);

  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: getListTalentPoolMembersQueryKey(organizationId, pool.id) });

  const memberCandidateIds = new Set((members ?? []).map((m) => m.candidateId));

  const handleAdd = (candidateId: number) => {
    addMutation.mutate(
      { organizationId, poolId: pool.id, data: { candidateId } },
      {
        onSuccess: () => { invalidateMembers(); toast({ title: 'Candidate added to pool' }); },
        onError: (err) => toast({ title: 'Could not add candidate', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Members — {pool.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search candidates by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              data-testid="input-search-candidates-to-add"
            />
          </div>
          {search.trim().length > 0 && (
            <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
              {(searchResults?.items ?? []).length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No candidates found.</p>
              ) : (
                (searchResults?.items ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-2 px-3" data-testid={`row-candidate-search-${c.id}`}>
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.firstName} {c.lastName}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memberCandidateIds.has(c.id) || addMutation.isPending}
                      onClick={() => handleAdd(c.id)}
                      data-testid={`button-add-candidate-${c.id}`}
                    >
                      {memberCandidateIds.has(c.id) ? 'Added' : 'Add'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-foreground mb-2">Current Members</p>
            {membersLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !members || members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates in this pool yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <MemberRow
                      key={m.id}
                      organizationId={organizationId}
                      candidateId={m.candidateId}
                      memberId={m.id}
                      removePending={removeMutation.isPending}
                      onRequestRemove={(candidateName) => setRemoveTarget({ candidateId: m.candidateId, name: candidateName })}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>

      <ConfirmActionDialog
        open={removeTarget !== null}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove candidate from talent pool?"
        description={<p>“{removeTarget?.name}” will be removed from “{pool.name}”. The candidate's record and applications are not affected, and they can be added to the pool again later.</p>}
        confirmLabel="Remove Candidate"
        onConfirm={() =>
          removeTarget
            ? removeMutation.mutateAsync(
                { organizationId, poolId: pool.id, candidateId: removeTarget.candidateId },
                {
                  onSuccess: () => { invalidateMembers(); toast({ title: 'Candidate removed from pool' }); },
                  onError: (err) => toast({ title: 'Could not remove candidate', description: errorMessage(err), variant: 'destructive' }),
                },
              )
            : undefined
        }
        testId="dialog-remove-pool-member"
      />
    </Dialog>
  );
}

export default function TalentPools() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: pools,
    isLoading,
    error,
    refetch,
  } = useListTalentPools(organizationId, {
    query: { queryKey: getListTalentPoolsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const createMutation = useCreateTalentPool();
  const archiveMutation = useArchiveTalentPool();
  const reactivateMutation = useReactivateTalentPool();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [managingPool, setManagingPool] = useState<TalentPool | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TalentPool | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<TalentPool | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTalentPoolsQueryKey(organizationId) });

  const openCreate = () => {
    setName('');
    setDescription('');
    setOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(
      { organizationId, data: { name: name.trim(), description: description.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setOpen(false); toast({ title: 'Talent pool created' }); },
        onError: (err) => toast({ title: 'Could not create talent pool', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleArchive = (poolId: number) =>
    archiveMutation.mutateAsync(
      { organizationId, poolId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Talent pool archived' }); },
        onError: (err) => toast({ title: 'Could not archive talent pool', description: errorMessage(err), variant: 'destructive' }),
      },
    );

  const handleReactivate = (poolId: number) =>
    reactivateMutation.mutateAsync(
      { organizationId, poolId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Talent pool reactivated' }); },
        onError: (err) => toast({ title: 'Could not reactivate talent pool', description: errorMessage(err), variant: 'destructive' }),
      },
    );

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Users2 className="h-7 w-7 text-primary" aria-hidden="true" />
            Talent Pools
          </h1>
          <p className="text-muted-foreground">Reusable candidate groupings for future recruitment campaigns</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-new-talent-pool">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Talent Pool
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Talent Pool</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="pool-name">Name *</Label>
                  <Input id="pool-name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-pool-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pool-description">Description (optional)</Label>
                  <Input id="pool-description" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-pool-description" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || !name.trim()} data-testid="button-submit-talent-pool">
                  {createMutation.isPending ? 'Creating…' : 'Create Talent Pool'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error ? (
        <QueryError title="Could not load talent pools" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !pools || pools.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Users2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No talent pools yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Create a talent pool to start grouping candidates for future openings.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pools.map((pool) => (
                  <TableRow key={pool.id} data-testid={`row-talent-pool-${pool.id}`}>
                    <TableCell className="font-medium">
                      <button type="button" className="hover:underline text-left" onClick={() => setManagingPool(pool)} data-testid={`link-talent-pool-${pool.id}`}>
                        {pool.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{pool.description ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={pool.isActive ? 'secondary' : 'outline'}>{pool.isActive ? 'Active' : 'Archived'}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => setManagingPool(pool)} data-testid={`button-manage-members-${pool.id}`}>
                        Members
                      </Button>
                      {pool.isActive ? (
                        <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(pool)} disabled={archiveMutation.isPending} data-testid={`button-archive-pool-${pool.id}`}>
                          <Archive className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setReactivateTarget(pool)} disabled={reactivateMutation.isPending} data-testid={`button-reactivate-pool-${pool.id}`}>
                          <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {managingPool && (
        <ManageMembersDialog organizationId={organizationId} pool={managingPool} open={!!managingPool} onOpenChange={(open) => !open && setManagingPool(null)} />
      )}

      <ConfirmActionDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => { if (!o) setArchiveTarget(null); }}
        title="Archive talent pool?"
        description={<p>“{archiveTarget?.name}” will be marked archived. Its members are kept, and you can reactivate the pool later.</p>}
        confirmLabel="Archive Talent Pool"
        onConfirm={() => (archiveTarget ? handleArchive(archiveTarget.id) : undefined)}
        testId="dialog-archive-talent-pool"
      />

      <ConfirmActionDialog
        open={reactivateTarget !== null}
        onOpenChange={(o) => { if (!o) setReactivateTarget(null); }}
        title="Reactivate talent pool?"
        description={<p>“{reactivateTarget?.name}” will be marked active again, with its existing members.</p>}
        confirmLabel="Reactivate Talent Pool"
        tone="default"
        onConfirm={() => (reactivateTarget ? handleReactivate(reactivateTarget.id) : undefined)}
        testId="dialog-reactivate-talent-pool"
      />
    </div>
  );
}
