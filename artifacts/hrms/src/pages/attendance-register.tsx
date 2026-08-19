import { useState } from 'react';
import { ClipboardList, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListAttendanceRegister,
  getListAttendanceRegisterQueryKey,
  useRecordAttendanceAdjustment,
  RecordAttendanceAdjustmentInputAdjustmentType,
  type DailyAttendanceSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';

const NONE = '__none__';
const PAGE_SIZE = 20;

const SUMMARY_STATUS_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  partial: 'Partial',
  absent: 'Absent',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  non_working_day: 'Non-Working Day',
};

const SUMMARY_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  present: 'secondary',
  late: 'outline',
  partial: 'outline',
  absent: 'destructive',
  on_leave: 'outline',
  holiday: 'outline',
  non_working_day: 'outline',
};

const ADJUSTMENT_TYPE_LABEL: Record<string, string> = {
  manual_clock_in: 'Manual clock-in',
  manual_clock_out: 'Manual clock-out',
  mark_present: 'Mark present',
  mark_absent: 'Mark absent',
  excuse_absence: 'Excuse absence',
};

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="outline">Not Applicable</Badge>;
  return (
    <Badge variant={SUMMARY_STATUS_VARIANT[status] ?? 'outline'} className="capitalize">
      {SUMMARY_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export default function AttendanceRegister() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  // HR-capable-role-gated manual-entry action (UX only — the backend
  // remains the real authority; see attendanceRegister.ts /
  // attendanceAdjustments.ts). Reuses app-shell.tsx's own isHrCapable
  // derivation exactly, so a manager without attendance.manage never sees
  // an action that would otherwise silently fall through to the
  // employee-initiated-request branch for the wrong employee.
  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'hr_manager' || r === 'super_admin') ?? false;

  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [employeeId, setEmployeeId] = useState(NONE);
  const [departmentId, setDepartmentId] = useState(NONE);
  const [branchId, setBranchId] = useState(NONE);
  const [status, setStatus] = useState(NONE);
  const [page, setPage] = useState(1);

  const { data: employeesPage } = useListEmployees(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 } },
  );
  const employeeById = new Map((employeesPage?.items ?? []).map((e) => [e.id, e]));

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const registerParams = {
    from,
    to,
    employeeId: employeeId === NONE ? undefined : Number(employeeId),
    departmentId: departmentId === NONE ? undefined : Number(departmentId),
    branchId: branchId === NONE ? undefined : Number(branchId),
    status: status === NONE ? undefined : status,
    page,
    pageSize: PAGE_SIZE,
  };
  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListAttendanceRegister(organizationId, registerParams, {
    query: { queryKey: getListAttendanceRegisterQueryKey(organizationId, registerParams), enabled: organizationId > 0 && from <= to },
  });

  const adjustmentMutation = useRecordAttendanceAdjustment();
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryEmployeeId, setEntryEmployeeId] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [entryType, setEntryType] = useState('');
  const [entryClockIn, setEntryClockIn] = useState('');
  const [entryClockOut, setEntryClockOut] = useState('');
  const [entryReason, setEntryReason] = useState('');

  const resetEntryForm = () => {
    setEntryEmployeeId('');
    setEntryDate('');
    setEntryType('');
    setEntryClockIn('');
    setEntryClockOut('');
    setEntryReason('');
  };

  const handleSubmitEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryEmployeeId || !entryDate || !entryType || !entryReason.trim()) return;
    adjustmentMutation.mutate(
      {
        organizationId,
        data: {
          employeeId: Number(entryEmployeeId),
          date: entryDate,
          adjustmentType: entryType as RecordAttendanceAdjustmentInputAdjustmentType,
          correctedClockIn: entryType === 'manual_clock_in' && entryClockIn ? entryClockIn : undefined,
          correctedClockOut: entryType === 'manual_clock_out' && entryClockOut ? entryClockOut : undefined,
          reason: entryReason.trim(),
        },
      },
      {
        onSuccess: () => {
          setEntryOpen(false);
          resetEntryForm();
          queryClient.invalidateQueries({ queryKey: getListAttendanceRegisterQueryKey(organizationId, registerParams) });
          toast({ title: 'Attendance entry recorded' });
        },
        onError: (err) => toast({ title: 'Could not record the entry', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const items = result?.items ?? [];
  const rows = items.flatMap((row) =>
    row.summaries.map((summary: DailyAttendanceSummary) => ({ employeeId: row.employeeId, summary })),
  );
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-primary" aria-hidden="true" />
            Attendance Register
          </h1>
          <p className="text-muted-foreground">
            {isHrCapable ? 'Organization-wide attendance' : "Your own and your direct reports' attendance"}
          </p>
        </div>

        {isHrCapable && (
          <Dialog open={entryOpen} onOpenChange={(open) => { setEntryOpen(open); if (!open) resetEntryForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-attendance-entry">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Entry
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleSubmitEntry}>
                <DialogHeader>
                  <DialogTitle>Manual Attendance Entry</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="entry-employee">Employee *</Label>
                    <Select value={entryEmployeeId} onValueChange={setEntryEmployeeId}>
                      <SelectTrigger id="entry-employee" data-testid="select-entry-employee">
                        <SelectValue placeholder="Choose an employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {(employeesPage?.items ?? []).map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="entry-type">Entry Type *</Label>
                    <Select value={entryType} onValueChange={setEntryType}>
                      <SelectTrigger id="entry-type" data-testid="select-entry-type">
                        <SelectValue placeholder="Choose an entry type" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ADJUSTMENT_TYPE_LABEL).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="entry-date">Date *</Label>
                    <Input id="entry-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} max={todayIso()} required data-testid="input-entry-date" />
                  </div>
                  {entryType === 'manual_clock_in' && (
                    <div className="space-y-2">
                      <Label htmlFor="entry-clock-in">Corrected Clock-In *</Label>
                      <Input id="entry-clock-in" type="datetime-local" value={entryClockIn} onChange={(e) => setEntryClockIn(e.target.value)} required data-testid="input-entry-clock-in" />
                    </div>
                  )}
                  {entryType === 'manual_clock_out' && (
                    <div className="space-y-2">
                      <Label htmlFor="entry-clock-out">Corrected Clock-Out *</Label>
                      <Input id="entry-clock-out" type="datetime-local" value={entryClockOut} onChange={(e) => setEntryClockOut(e.target.value)} required data-testid="input-entry-clock-out" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="entry-reason">Reason *</Label>
                    <Textarea id="entry-reason" value={entryReason} onChange={(e) => setEntryReason(e.target.value)} required data-testid="input-entry-reason" />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={
                      adjustmentMutation.isPending ||
                      !entryEmployeeId ||
                      !entryDate ||
                      !entryType ||
                      !entryReason.trim() ||
                      (entryType === 'manual_clock_in' && !entryClockIn) ||
                      (entryType === 'manual_clock_out' && !entryClockOut)
                    }
                    data-testid="button-submit-attendance-entry"
                  >
                    {adjustmentMutation.isPending ? 'Recording…' : 'Record Entry'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="space-y-2">
            <Label htmlFor="register-from">From</Label>
            <Input id="register-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} max={to} data-testid="input-register-from" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-to">To</Label>
            <Input id="register-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} min={from} data-testid="input-register-to" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-employee">Employee</Label>
            <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setPage(1); }}>
              <SelectTrigger id="register-employee" data-testid="select-register-employee">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All</SelectItem>
                {(employeesPage?.items ?? []).map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-department">Department</Label>
            <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); setPage(1); }}>
              <SelectTrigger id="register-department" data-testid="select-register-department">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All</SelectItem>
                {(departments ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-branch">Branch</Label>
            <Select value={branchId} onValueChange={(v) => { setBranchId(v); setPage(1); }}>
              <SelectTrigger id="register-branch" data-testid="select-register-branch">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All</SelectItem>
                {(branches ?? []).map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-status">Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger id="register-status" data-testid="select-register-status">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>All</SelectItem>
                {Object.entries(SUMMARY_STATUS_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading attendance register">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Could not load the attendance register" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <ClipboardList className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No attendance records for this selection</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Try a different date range or clear the filters.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <Table aria-label="Attendance register">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Worked (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ employeeId: rowEmployeeId, summary }) => {
                  const employee = employeeById.get(rowEmployeeId);
                  const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${rowEmployeeId}`;
                  return (
                    <TableRow key={`${rowEmployeeId}-${summary.date}`} data-testid={`row-attendance-register-${rowEmployeeId}-${summary.date}`}>
                      <TableCell>{new Date(`${summary.date}T00:00:00Z`).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium text-foreground">{employeeName}</TableCell>
                      <TableCell className="text-muted-foreground">{employee?.departmentName ?? '—'}</TableCell>
                      <TableCell><StatusBadge status={summary.status} /></TableCell>
                      <TableCell className="text-muted-foreground">{summary.firstClockIn ? new Date(summary.firstClockIn).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{summary.lastClockOut ? new Date(summary.lastClockOut).toLocaleTimeString() : '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{summary.workedMinutes ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({total} employees)
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-prev-page">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="button-next-page">
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
