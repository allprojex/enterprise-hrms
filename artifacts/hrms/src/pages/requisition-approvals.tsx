import { useState } from 'react';
import { Link } from 'wouter';
import { CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  useListPendingRequisitionApprovals,
  getListPendingRequisitionApprovalsQueryKey,
  useApproveJobRequisition,
  useRejectJobRequisition,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function isConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 409;
}

export default function RequisitionApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: pending,
    isLoading,
    error,
  } = useListPendingRequisitionApprovals(organizationId, {
    query: { queryKey: getListPendingRequisitionApprovalsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const approveMutation = useApproveJobRequisition();
  const rejectMutation = useRejectJobRequisition();

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPendingRequisitionApprovalsQueryKey(organizationId) });

  const handleApprove = (id: number) => {
    approveMutation.mutate(
      { organizationId, id, data: {} },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Requisition approved' });
        },
        onError: (err) => {
          toast({
            title: isConflict(err) ? 'Already decided' : 'Could not approve requisition',
            description: isConflict(err) ? 'This requisition was already decided or is no longer pending.' : (errorMessage(err) ?? 'Please try again.'),
            variant: 'destructive',
          });
          invalidate();
        },
      },
    );
  };

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (rejectTarget == null) return;
    rejectMutation.mutate(
      { organizationId, id: rejectTarget, data: { comment: rejectComment.trim() || undefined } },
      {
        onSuccess: () => {
          invalidate();
          setRejectTarget(null);
          setRejectComment('');
          toast({ title: 'Requisition rejected' });
        },
        onError: (err) => {
          toast({
            title: isConflict(err) ? 'Already decided' : 'Could not reject requisition',
            description: isConflict(err) ? 'This requisition was already decided or is no longer pending.' : (errorMessage(err) ?? 'Please try again.'),
            variant: 'destructive',
          });
          invalidate();
          setRejectTarget(null);
          setRejectComment('');
        },
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <h1 className="text-3xl font-bold text-foreground">Requisition Approvals</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Could not load pending approvals. Please try again.</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Requisition Approvals</h1>
        <p className="text-muted-foreground">Job requisitions awaiting an organization-wide approval decision</p>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading pending requisition approvals">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !pending || pending.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Nothing awaiting a decision</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Job requisitions submitted for approval will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Pending Requisitions</CardTitle>
            <CardDescription>Newest first</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {pending.map((requisition) => (
                <li key={requisition.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-pending-requisition-${requisition.id}`}>
                  <div>
                    <Link href={`/requisitions/${requisition.id}`} className="text-sm font-medium text-foreground hover:underline" data-testid={`link-requisition-${requisition.id}`}>
                      {requisition.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {requisition.requisitionType.replace('_', ' ')} · {requisition.requestedHeadcount} opening(s)
                    </p>
                    <Badge variant="secondary" className="mt-1">Pending Approval</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleApprove(requisition.id)}
                      disabled={approveMutation.isPending}
                      data-testid={`button-approve-${requisition.id}`}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRejectTarget(requisition.id)}
                      disabled={rejectMutation.isPending}
                      data-testid={`button-reject-${requisition.id}`}
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <form onSubmit={handleReject}>
            <DialogHeader>
              <DialogTitle>Reject Requisition</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="reject-comment">Comment (optional)</Label>
              <Input
                id="reject-comment"
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                placeholder="Why this requisition is being rejected"
                data-testid="input-reject-comment"
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={rejectMutation.isPending} data-testid="button-confirm-reject">
                {rejectMutation.isPending ? 'Rejecting…' : 'Reject Requisition'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
