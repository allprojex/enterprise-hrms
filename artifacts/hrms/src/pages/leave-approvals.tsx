import { useState } from 'react';
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
  useListEmployees,
  getListEmployeesQueryKey,
  useListLeaveTypes,
  getListLeaveTypesQueryKey,
  useListPendingApprovals,
  getListPendingApprovalsQueryKey,
  useApproveLeaveRequest,
  useRejectLeaveRequest,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

const STAGE_LABEL: Record<string, string> = {
  awaiting_department_head: 'Awaiting Department Head',
  awaiting_hr: 'Department Head approved — Awaiting HR',
};

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function isConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'status' in err && (err as { status: unknown }).status === 409;
}

export default function LeaveApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: employeesPage } = useListEmployees(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 } },
  );
  const employeeById = new Map((employeesPage?.items ?? []).map((e) => [e.id, e]));

  const { data: leaveTypes } = useListLeaveTypes(organizationId, {
    query: { queryKey: getListLeaveTypesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const leaveTypeById = new Map((leaveTypes ?? []).map((t) => [t.id, t]));

  const {
    data: pending,
    isLoading: pendingLoading,
  } = useListPendingApprovals(organizationId, {
    query: { queryKey: getListPendingApprovalsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const approveMutation = useApproveLeaveRequest();
  const rejectMutation = useRejectLeaveRequest();

  const [rejectTarget, setRejectTarget] = useState<{ employeeId: number; id: number } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPendingApprovalsQueryKey(organizationId) });

  const handleApprove = (employeeId: number, id: number) => {
    approveMutation.mutate(
      { organizationId, employeeId, id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Leave request approved' });
        },
        onError: (err) => {
          toast({
            title: isConflict(err) ? 'Already processed' : 'Could not approve request',
            description: isConflict(err) ? 'This request was already decided or withdrawn.' : (errorMessage(err) ?? 'Please try again.'),
            variant: 'destructive',
          });
          invalidate();
        },
      },
    );
  };

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget || !rejectReason.trim()) return;
    rejectMutation.mutate(
      { organizationId, employeeId: rejectTarget.employeeId, id: rejectTarget.id, data: { reason: rejectReason.trim() } },
      {
        onSuccess: () => {
          invalidate();
          setRejectTarget(null);
          setRejectReason('');
          toast({ title: 'Leave request rejected' });
        },
        onError: (err) => {
          toast({
            title: isConflict(err) ? 'Already processed' : 'Could not reject request',
            description: isConflict(err) ? 'This request was already decided or withdrawn.' : (errorMessage(err) ?? 'Please try again.'),
            variant: 'destructive',
          });
          invalidate();
          setRejectTarget(null);
          setRejectReason('');
        },
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Leave Approvals</h1>
        <p className="text-muted-foreground">
          Requests you're authorized to act on as the employee's Department Head, or organization-wide if you hold HR authority.
          HR sees every request from submission, including while it still awaits the Department Head.
        </p>
      </div>

      {pendingLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading pending approvals">
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
            <h3 className="text-lg font-semibold text-foreground mb-2">Nothing awaiting your decision</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Pending leave requests you're authorized to approve or reject will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Pending Requests</CardTitle>
            <CardDescription>Oldest first</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {pending.map((request) => {
                const employee = employeeById.get(request.employeeId);
                const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${request.employeeId}`;
                const leaveTypeName = leaveTypeById.get(request.leaveTypeId)?.name ?? `Type #${request.leaveTypeId}`;
                return (
                  <li key={request.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-pending-approval-${request.id}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{employeeName} — {leaveTypeName}</p>
                        {request.workflowStage && STAGE_LABEL[request.workflowStage] && (
                          <Badge variant="outline" data-testid={`badge-stage-${request.id}`}>
                            {STAGE_LABEL[request.workflowStage]}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(request.startDate).toLocaleDateString()} – {new Date(request.endDate).toLocaleDateString()} · {request.daysRequested} day(s)
                      </p>
                      {request.reason && <p className="text-xs text-muted-foreground">{request.reason}</p>}
                      {request.departmentHeadApprovedAt && (
                        <p className="text-xs text-muted-foreground">
                          Department Head approved {new Date(request.departmentHeadApprovedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleApprove(request.employeeId, request.id)}
                        disabled={approveMutation.isPending}
                        data-testid={`button-approve-${request.id}`}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRejectTarget({ employeeId: request.employeeId, id: request.id })}
                        disabled={rejectMutation.isPending}
                        data-testid={`button-reject-${request.id}`}
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <form onSubmit={handleReject}>
            <DialogHeader>
              <DialogTitle>Reject Leave Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="reject-reason">Reason *</Label>
              <Input
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why this request is being rejected"
                required
                data-testid="input-reject-reason"
              />
              <p className="text-xs text-muted-foreground">A reason is required to reject a leave request.</p>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                disabled={rejectMutation.isPending || !rejectReason.trim()}
                data-testid="button-confirm-reject"
              >
                {rejectMutation.isPending ? 'Rejecting…' : 'Reject Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
