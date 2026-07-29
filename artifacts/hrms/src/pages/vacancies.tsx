import { useState } from 'react';
import { Link } from 'wouter';
import { Briefcase, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
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
  useListVacancies,
  getListVacanciesQueryKey,
  useCreateVacancy,
  useListJobRequisitions,
  getListJobRequisitionsQueryKey,
  type ListVacanciesParams,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const STATUSES = ['draft', 'scheduled', 'published', 'paused', 'closed', 'archived'] as const;
const NONE = '__all__';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  scheduled: 'secondary',
  published: 'secondary',
  paused: 'destructive',
  closed: 'outline',
  archived: 'outline',
};

export default function Vacancies() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [status, setStatus] = useState(NONE);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params: ListVacanciesParams = {
    status: status === NONE ? undefined : (status as ListVacanciesParams['status']),
    search: search || undefined,
    page,
    pageSize,
  };

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListVacancies(organizationId, params, {
    query: { queryKey: getListVacanciesQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  // Only approved requisitions may back a new vacancy — the create dialog
  // offers a choice among the caller's visible approved requisitions rather
  // than a free-text ID, so an operator can't attempt (and be rejected for)
  // an invalid selection.
  const { data: approvedRequisitions } = useListJobRequisitions(
    organizationId,
    { status: 'approved', page: 1, pageSize: 100 },
    { query: { queryKey: getListJobRequisitionsQueryKey(organizationId, { status: 'approved', page: 1, pageSize: 100 }), enabled: organizationId > 0 } },
  );

  const createMutation = useCreateVacancy();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [requisitionId, setRequisitionId] = useState<string>('');
  const [openingsCount, setOpeningsCount] = useState('1');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListVacanciesQueryKey(organizationId) });

  const openCreate = () => {
    setTitle('');
    setRequisitionId('');
    setOpeningsCount('1');
    setOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !requisitionId) return;
    createMutation.mutate(
      { organizationId, data: { title: title.trim(), requisitionId: Number(requisitionId), openingsCount: Number(openingsCount) } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          toast({ title: 'Vacancy created' });
        },
        onError: (err) => toast({ title: 'Could not create vacancy', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Briefcase className="h-7 w-7 text-primary" aria-hidden="true" />
            Vacancies
          </h1>
          <p className="text-muted-foreground">Postable openings created from approved job requisitions</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-new-vacancy">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Vacancy
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Vacancy</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="vac-requisition">Approved Requisition *</Label>
                  <Select value={requisitionId} onValueChange={setRequisitionId}>
                    <SelectTrigger id="vac-requisition" data-testid="select-vacancy-requisition">
                      <SelectValue placeholder="Select an approved requisition" />
                    </SelectTrigger>
                    <SelectContent>
                      {(approvedRequisitions?.items ?? []).map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(approvedRequisitions?.items ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No approved requisitions are available yet.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vac-title">Title *</Label>
                  <Input id="vac-title" value={title} onChange={(e) => setTitle(e.target.value)} required data-testid="input-vacancy-title" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vac-openings">Openings *</Label>
                  <Input id="vac-openings" type="number" min={1} value={openingsCount} onChange={(e) => setOpeningsCount(e.target.value)} required data-testid="input-vacancy-openings" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || !title.trim() || !requisitionId} data-testid="button-submit-vacancy">
                  {createMutation.isPending ? 'Creating…' : 'Create Vacancy'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-4">
        <Input placeholder="Search by title…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" data-testid="input-search-vacancies" />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-filter-vacancy-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <QueryError title="Could not load vacancies" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Briefcase className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No vacancies found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Create a vacancy from an approved requisition to start posting an opening.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Openings</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((vacancy) => (
                  <TableRow key={vacancy.id} data-testid={`row-vacancy-${vacancy.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/vacancies/${vacancy.id}/edit`} className="hover:underline" data-testid={`link-vacancy-${vacancy.id}`}>
                        {vacancy.title}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{vacancy.visibility}</TableCell>
                    <TableCell>{vacancy.filledCount} / {vacancy.openingsCount}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[vacancy.status] ?? 'outline'} className="capitalize">{vacancy.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {result.total > pageSize && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">Page {page} of {Math.ceil(result.total / pageSize)}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-prev-page">Previous</Button>
                  <Button size="sm" variant="outline" disabled={page * pageSize >= result.total} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
