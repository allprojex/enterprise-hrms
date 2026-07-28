import { useState } from 'react';
import { CalendarClock, Plus, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import {
  useGetMe,
  getGetMeQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListLeaveTypes,
  getListLeaveTypesQueryKey,
  useListLeaveRequests,
  getListLeaveRequestsQueryKey,
  useCreateLeaveRequest,
  useCancelLeaveRequest,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  pending: 'outline',
  approved: 'secondary',
  rejected: 'destructive',
  cancelled: 'outline',
};

export default function MyLeave() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  // No dedicated "resolve my employee" endpoint exists yet (that's W39's
  // job) — reuses the existing GET /employees roster (already readable by
  // the base "employee" role) and finds the row linked to this login, the
  // same linkage W14 already exposes.
  const { data: employeesPage, isLoading: employeesLoading } = useListEmployees(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 } },
  );
  const myEmployee = (employeesPage?.items ?? []).find((e) => e.linkedApplicationUserId === user?.id);
  const employeeId = myEmployee?.id ?? 0;

  const { data: leaveTypes } = useListLeaveTypes(organizationId, {
    query: { queryKey: getListLeaveTypesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const {
    data: requests,
    isLoading: requestsLoading,
  } = useListLeaveRequests(organizationId, employeeId, {
    query: { queryKey: getListLeaveRequestsQueryKey(organizationId, employeeId), enabled: organizationId > 0 && employeeId > 0 },
  });

  const createMutation = useCreateLeaveRequest();
  const cancelMutation = useCancelLeaveRequest();

  const [open, setOpen] = useState(false);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListLeaveRequestsQueryKey(organizationId, employeeId) });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveTypeId || !startDate || !endDate) return;
    createMutation.mutate(
      { organizationId, employeeId, data: { leaveTypeId: Number(leaveTypeId), startDate, endDate, reason: reason.trim() || undefined } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setLeaveTypeId('');
          setStartDate('');
          setEndDate('');
          setReason('');
          toast({ title: 'Leave request submitted' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not submit leave request', description: message ?? 'Please check the details and try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleCancel = (id: number) => {
    cancelMutation.mutate(
      { organizationId, employeeId, id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Leave request withdrawn' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not withdraw leave request', description: message, variant: 'destructive' });
        },
      },
    );
  };

  if (employeesLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!myEmployee) {
    return (
      <div className="p-6 lg:p-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="text-lg font-semibold text-foreground mb-2">No linked employee record</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Your login isn't linked to an employee record yet, so leave requests aren't available. Ask an administrator to link your account.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">My Leave</h1>
          <p className="text-muted-foreground">Submit and track your own leave requests</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-request-leave">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Request Leave
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Request Leave</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="my-leave-type">Leave Type *</Label>
                  <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                    <SelectTrigger id="my-leave-type" data-testid="select-my-leave-type">
                      <SelectValue placeholder="Choose a leave type" />
                    </SelectTrigger>
                    <SelectContent>
                      {(leaveTypes ?? [])
                        .filter((t) => t.status === 'active')
                        .map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="my-leave-start">Start Date *</Label>
                    <Input id="my-leave-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required data-testid="input-my-leave-start" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="my-leave-end">End Date *</Label>
                    <Input id="my-leave-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required data-testid="input-my-leave-end" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="my-leave-reason">Reason</Label>
                  <Input id="my-leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-my-leave-reason" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending || !leaveTypeId || !startDate || !endDate} data-testid="button-submit-leave-request">
                  {createMutation.isPending ? 'Submitting…' : 'Submit Request'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {requestsLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading leave requests">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !requests || requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <CalendarClock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No leave requests yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Submit your first leave request to see it here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Request History</CardTitle>
            <CardDescription>Most recent first</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {requests.map((request) => {
                const leaveTypeName = (leaveTypes ?? []).find((t) => t.id === request.leaveTypeId)?.name ?? `Type #${request.leaveTypeId}`;
                return (
                  <li key={request.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-leave-request-${request.id}`}>
                    <div>
                      <p className="text-sm font-medium text-foreground">{leaveTypeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(request.startDate).toLocaleDateString()} – {new Date(request.endDate).toLocaleDateString()} · {request.daysRequested} day(s)
                      </p>
                      {request.reason && <p className="text-xs text-muted-foreground">{request.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[request.status] ?? 'outline'} className="capitalize">
                        {request.status}
                      </Badge>
                      {request.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCancel(request.id)}
                          disabled={cancelMutation.isPending}
                          aria-label="Withdraw request"
                          data-testid={`button-cancel-leave-request-${request.id}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
