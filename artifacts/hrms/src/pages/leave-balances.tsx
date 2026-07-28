import { useState } from 'react';
import { Wallet, Plus } from 'lucide-react';
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
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListLeaveTypes,
  getListLeaveTypesQueryKey,
  useListLeaveBalances,
  getListLeaveBalancesQueryKey,
  useListLeaveBalanceLedger,
  getListLeaveBalanceLedgerQueryKey,
  useAdjustLeaveBalance,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

const ALL_TYPES = '__all__';

const ENTRY_TYPE_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  opening_balance: 'secondary',
  accrual: 'secondary',
  carry_forward: 'secondary',
  usage: 'destructive',
  expiry: 'destructive',
  reversal: 'outline',
  manual_adjustment: 'outline',
};

export default function LeaveBalances() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: employeesPage, isLoading: employeesLoading } = useListEmployees(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 } },
  );
  const employees = employeesPage?.items ?? [];

  const [employeeId, setEmployeeId] = useState<number>(0);
  const [ledgerLeaveTypeId, setLedgerLeaveTypeId] = useState(ALL_TYPES);

  const { data: leaveTypes } = useListLeaveTypes(organizationId, {
    query: { queryKey: getListLeaveTypesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const {
    data: balances,
    isLoading: balancesLoading,
    error: balancesError,
    refetch: refetchBalances,
  } = useListLeaveBalances(organizationId, employeeId, {
    query: { queryKey: getListLeaveBalancesQueryKey(organizationId, employeeId), enabled: organizationId > 0 && employeeId > 0 },
  });

  const ledgerParams = ledgerLeaveTypeId === ALL_TYPES ? undefined : { leaveTypeId: Number(ledgerLeaveTypeId) };
  const {
    data: ledger,
    isLoading: ledgerLoading,
  } = useListLeaveBalanceLedger(organizationId, employeeId, ledgerParams, {
    query: {
      queryKey: getListLeaveBalanceLedgerQueryKey(organizationId, employeeId, ledgerParams),
      enabled: organizationId > 0 && employeeId > 0,
    },
  });

  const adjustMutation = useAdjustLeaveBalance();

  const [open, setOpen] = useState(false);
  const [adjustLeaveTypeId, setAdjustLeaveTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListLeaveBalancesQueryKey(organizationId, employeeId) });
    queryClient.invalidateQueries({ queryKey: getListLeaveBalanceLedgerQueryKey(organizationId, employeeId, ledgerParams) });
  };

  const handleSubmitAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustLeaveTypeId || !amount || !effectiveDate || !reason.trim()) return;
    adjustMutation.mutate(
      {
        organizationId,
        employeeId,
        data: { leaveTypeId: Number(adjustLeaveTypeId), amount: Number(amount), effectiveDate, reason: reason.trim() },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setAdjustLeaveTypeId('');
          setAmount('');
          setEffectiveDate('');
          setReason('');
          toast({ title: 'Manual adjustment posted' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not post adjustment', description: message ?? 'Please check the details and try again.', variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Leave Balances</h1>
        <p className="text-muted-foreground">Reconstructed live from the immutable balance ledger — post a manual adjustment when a correction is needed</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="balance-employee">Employee</Label>
            {employeesLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={employeeId > 0 ? String(employeeId) : ''} onValueChange={(v) => setEmployeeId(Number(v))}>
                <SelectTrigger id="balance-employee" data-testid="select-balance-employee">
                  <SelectValue placeholder="Choose an employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((employee) => (
                    <SelectItem key={employee.id} value={String(employee.id)}>
                      {employee.firstName} {employee.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardContent>
      </Card>

      {employeeId > 0 && (
        <>
          {balancesError ? (
            <QueryError title="Could not load balances" message="You may not be authorized to view this employee's leave balances." onRetry={() => refetchBalances()} />
          ) : balancesLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !balances || balances.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <Wallet className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No ledger history yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm">This employee has no leave balance entries. Post an opening balance or manual adjustment to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {balances.map((balance) => (
                <Card key={balance.leaveTypeId} data-testid={`card-leave-balance-${balance.leaveTypeId}`}>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">{balance.leaveTypeName}</p>
                    <p className="text-2xl font-bold text-foreground">{balance.available}</p>
                    <p className="text-xs text-muted-foreground">days available</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Ledger</CardTitle>
                <CardDescription>Every immutable balance movement — corrections appear as new reversal entries, never edits</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <Select value={ledgerLeaveTypeId} onValueChange={setLedgerLeaveTypeId}>
                  <SelectTrigger className="w-40" data-testid="select-ledger-leave-type">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_TYPES}>All types</SelectItem>
                    {(leaveTypes ?? []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-post-adjustment">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Adjust
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <form onSubmit={handleSubmitAdjustment}>
                      <DialogHeader>
                        <DialogTitle>Post Manual Adjustment</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="adjust-leave-type">Leave Type *</Label>
                          <Select value={adjustLeaveTypeId} onValueChange={setAdjustLeaveTypeId}>
                            <SelectTrigger id="adjust-leave-type" data-testid="select-adjust-leave-type">
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
                            <Label htmlFor="adjust-amount">Amount (days) *</Label>
                            <Input
                              id="adjust-amount"
                              type="number"
                              step="0.5"
                              value={amount}
                              onChange={(e) => setAmount(e.target.value)}
                              placeholder="e.g. 2 or -1.5"
                              required
                              data-testid="input-adjust-amount"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="adjust-effective-date">Effective Date *</Label>
                            <Input
                              id="adjust-effective-date"
                              type="date"
                              value={effectiveDate}
                              onChange={(e) => setEffectiveDate(e.target.value)}
                              required
                              data-testid="input-adjust-effective-date"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="adjust-reason">Reason *</Label>
                          <Input
                            id="adjust-reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why this adjustment is being made"
                            required
                            data-testid="input-adjust-reason"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          type="submit"
                          disabled={adjustMutation.isPending || !adjustLeaveTypeId || !amount || !effectiveDate || !reason.trim()}
                          data-testid="button-submit-adjustment"
                        >
                          {adjustMutation.isPending ? 'Posting…' : 'Post Adjustment'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {ledgerLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : !ledger || ledger.length === 0 ? (
                <p className="text-sm text-muted-foreground">No ledger entries.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Posted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.map((entry) => (
                      <TableRow key={entry.id} data-testid={`row-ledger-entry-${entry.id}`}>
                        <TableCell>{new Date(entry.effectiveDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Badge variant={ENTRY_TYPE_VARIANT[entry.entryType] ?? 'outline'} className="capitalize">
                            {entry.entryType.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className={Number(entry.amount) < 0 ? 'text-destructive' : 'text-foreground'}>
                          {Number(entry.amount) > 0 ? `+${entry.amount}` : entry.amount}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{entry.reason ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{new Date(entry.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
