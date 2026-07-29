import { useState } from 'react';
import { Link } from 'wouter';
import { ClipboardList, Plus } from 'lucide-react';
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
  useListJobRequisitions,
  getListJobRequisitionsQueryKey,
  useCreateJobRequisition,
  type JobRequisition,
  type ListJobRequisitionsParams,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const REQUISITION_TYPES = ['new_role', 'replacement', 'temporary', 'internship', 'volunteer', 'contract', 'ministry'] as const;
const STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'partially_filled', 'filled', 'cancelled', 'closed'] as const;
const NONE = '__all__';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  pending_approval: 'secondary',
  approved: 'secondary',
  rejected: 'destructive',
  partially_filled: 'secondary',
  filled: 'secondary',
  cancelled: 'destructive',
  closed: 'outline',
};

export default function Requisitions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [status, setStatus] = useState(NONE);
  const [requisitionType, setRequisitionType] = useState(NONE);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params: ListJobRequisitionsParams = {
    status: status === NONE ? undefined : (status as ListJobRequisitionsParams['status']),
    requisitionType: requisitionType === NONE ? undefined : (requisitionType as ListJobRequisitionsParams['requisitionType']),
    search: search || undefined,
    page,
    pageSize,
  };

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListJobRequisitions(organizationId, params, {
    query: { queryKey: getListJobRequisitionsQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  const createMutation = useCreateJobRequisition();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [newType, setNewType] = useState<string>('new_role');
  const [requestedHeadcount, setRequestedHeadcount] = useState('1');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListJobRequisitionsQueryKey(organizationId) });

  const openCreate = () => {
    setTitle('');
    setNewType('new_role');
    setRequestedHeadcount('1');
    setOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createMutation.mutate(
      { organizationId, data: { title: title.trim(), requisitionType: newType as JobRequisition['requisitionType'], requestedHeadcount: Number(requestedHeadcount) } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          toast({ title: 'Job requisition created' });
        },
        onError: (err) => toast({ title: 'Could not create requisition', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-primary" aria-hidden="true" />
            Job Requisitions
          </h1>
          <p className="text-muted-foreground">Requests to recruit for one or more openings</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-new-requisition">
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Requisition
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Job Requisition</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="req-title">Title *</Label>
                  <Input id="req-title" value={title} onChange={(e) => setTitle(e.target.value)} required data-testid="input-requisition-title" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="req-type">Requisition Type *</Label>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger id="req-type" data-testid="select-requisition-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUISITION_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="req-headcount">Requested Openings *</Label>
                  <Input id="req-headcount" type="number" min={1} value={requestedHeadcount} onChange={(e) => setRequestedHeadcount(e.target.value)} required data-testid="input-requested-headcount" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || !title.trim()} data-testid="button-submit-requisition">
                  {createMutation.isPending ? 'Creating…' : 'Create Requisition'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-4">
        <Input placeholder="Search by title…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" data-testid="input-search-requisitions" />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-filter-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={requisitionType} onValueChange={(v) => { setRequisitionType(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-filter-type">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All types</SelectItem>
            {REQUISITION_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <QueryError title="Could not load job requisitions" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <ClipboardList className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No job requisitions found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Create a requisition to start the hiring process for a new opening.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Openings</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((req) => (
                  <TableRow key={req.id} data-testid={`row-requisition-${req.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/requisitions/${req.id}`} className="hover:underline" data-testid={`link-requisition-${req.id}`}>
                        {req.title}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{req.requisitionType.replace('_', ' ')}</TableCell>
                    <TableCell>{req.filledCount} / {req.requestedHeadcount}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[req.status] ?? 'outline'} className="capitalize">{req.status.replace('_', ' ')}</Badge>
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
