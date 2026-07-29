import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetJobRequisition,
  getGetJobRequisitionQueryKey,
  useUpdateJobRequisition,
  useSubmitJobRequisition,
  useCancelJobRequisition,
  useArchiveJobRequisition,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

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
  pending_approval: 'secondary',
  approved: 'secondary',
  rejected: 'destructive',
  partially_filled: 'secondary',
  filled: 'secondary',
  cancelled: 'destructive',
  closed: 'outline',
};

export default function RequisitionDetail() {
  const params = useParams<{ id: string }>();
  const requisitionId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: requisition,
    isLoading,
    error,
    refetch,
  } = useGetJobRequisition(organizationId, requisitionId, {
    query: { queryKey: getGetJobRequisitionQueryKey(organizationId, requisitionId), enabled: organizationId > 0 && requisitionId > 0 },
  });

  const updateMutation = useUpdateJobRequisition();
  const submitMutation = useSubmitJobRequisition();
  const cancelMutation = useCancelJobRequisition();
  const archiveMutation = useArchiveJobRequisition();

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editHeadcount, setEditHeadcount] = useState('1');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetJobRequisitionQueryKey(organizationId, requisitionId) });

  const openEdit = () => {
    if (!requisition) return;
    setEditTitle(requisition.title);
    setEditHeadcount(String(requisition.requestedHeadcount));
    setEditOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      { organizationId, id: requisitionId, data: { title: editTitle.trim(), requestedHeadcount: Number(editHeadcount) } },
      {
        onSuccess: () => { invalidate(); setEditOpen(false); toast({ title: 'Requisition updated' }); },
        onError: (err) => toast({ title: 'Could not update requisition', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSubmitRequisition = () => {
    submitMutation.mutate(
      { organizationId, id: requisitionId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Requisition submitted for approval' }); },
        onError: (err) => toast({ title: 'Could not submit requisition', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleCancel = () => {
    cancelMutation.mutate(
      { organizationId, id: requisitionId, data: { reason: cancelReason.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setCancelOpen(false); toast({ title: 'Requisition cancelled' }); },
        onError: (err) => toast({ title: 'Could not cancel requisition', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleArchive = () => {
    archiveMutation.mutate(
      { organizationId, id: requisitionId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Requisition archived' }); },
        onError: (err) => toast({ title: 'Could not archive requisition', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this requisition" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !requisition) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isDraft = requisition.status === 'draft';
  const canCancel = requisition.status === 'draft' || requisition.status === 'pending_approval';
  const canArchive = requisition.status === 'draft' || requisition.status === 'cancelled';

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/requisitions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-requisitions">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Requisitions
          </Link>
          <h1 className="text-3xl font-bold text-foreground">{requisition.title}</h1>
          <Badge variant={STATUS_VARIANT[requisition.status] ?? 'outline'} className="capitalize">{requisition.status.replace('_', ' ')}</Badge>
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <Button variant="outline" onClick={openEdit} data-testid="button-edit-requisition">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit
            </Button>
          )}
          {isDraft && (
            <Button onClick={handleSubmitRequisition} disabled={submitMutation.isPending} data-testid="button-submit-for-approval">
              {submitMutation.isPending ? 'Submitting…' : 'Submit for Approval'}
            </Button>
          )}
          {canCancel && (
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <Button variant="destructive" onClick={() => setCancelOpen(true)} data-testid="button-cancel-requisition">
                Cancel
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel Requisition</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 py-4">
                  <Label htmlFor="cancel-reason">Reason (optional)</Label>
                  <Input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} data-testid="input-cancel-reason" />
                </div>
                <DialogFooter>
                  <Button variant="destructive" onClick={handleCancel} disabled={cancelMutation.isPending} data-testid="button-confirm-cancel">
                    {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancellation'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canArchive && (
            <Button variant="outline" onClick={handleArchive} disabled={archiveMutation.isPending} data-testid="button-archive-requisition">
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
          <Field label="Requisition Type" value={requisition.requisitionType.replace('_', ' ')} />
          <Field label="Requested Openings" value={requisition.requestedHeadcount} />
          <Field label="Filled" value={requisition.filledCount} />
          <Field label="Employment Type" value={requisition.employmentType} />
          <Field label="Workplace Type" value={requisition.workplaceType} />
          <Field label="Expected Start Date" value={requisition.expectedStartDate ? new Date(requisition.expectedStartDate).toLocaleDateString() : null} />
          <Field label="Salary Range" value={requisition.salaryRangeMin && requisition.salaryRangeMax ? `${requisition.salaryRangeMin} – ${requisition.salaryRangeMax} ${requisition.salaryCurrency ?? ''}` : null} />
          {requisition.justification && <Field label="Justification" value={requisition.justification} />}
          {requisition.cancellationReason && <Field label="Cancellation Reason" value={requisition.cancellationReason} />}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Requisition</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-req-title">Title *</Label>
                <Input id="edit-req-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required data-testid="input-edit-requisition-title" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-req-headcount">Requested Openings *</Label>
                <Input id="edit-req-headcount" type="number" min={1} value={editHeadcount} onChange={(e) => setEditHeadcount(e.target.value)} required data-testid="input-edit-requested-headcount" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending || !editTitle.trim()} data-testid="button-save-requisition">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
