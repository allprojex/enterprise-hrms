import { useState } from 'react';
import { CalendarDays, Plus, Pencil, ListPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
  useListLeaveTypes,
  getListLeaveTypesQueryKey,
  useCreateLeaveType,
  useUpdateLeaveType,
  useArchiveLeaveType,
  useReactivateLeaveType,
  useListLeavePolicies,
  getListLeavePoliciesQueryKey,
  useCreateLeavePolicy,
  useArchiveLeavePolicy,
  useReactivateLeavePolicy,
  useListBranches,
  getListBranchesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

const EMPTY = '__any__';

function PoliciesPanel({ organizationId, leaveTypeId }: { organizationId: number; leaveTypeId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: policies } = useListLeavePolicies(organizationId, leaveTypeId, {
    query: { queryKey: getListLeavePoliciesQueryKey(organizationId, leaveTypeId), enabled: organizationId > 0 },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: positions } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const createMutation = useCreateLeavePolicy();
  const archiveMutation = useArchiveLeavePolicy();
  const reactivateMutation = useReactivateLeavePolicy();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [employmentType, setEmploymentType] = useState(EMPTY);
  const [branchId, setBranchId] = useState(EMPTY);
  const [departmentId, setDepartmentId] = useState(EMPTY);
  const [positionId, setPositionId] = useState(EMPTY);
  const [gender, setGender] = useState(EMPTY);
  const [minimumServiceMonths, setMinimumServiceMonths] = useState('');
  const [probationRestricted, setProbationRestricted] = useState(false);
  const [annualEntitlementDays, setAnnualEntitlementDays] = useState('');
  const [isPaid, setIsPaid] = useState(true);
  const [accrualMethod, setAccrualMethod] = useState('annual');
  const [accrualRate, setAccrualRate] = useState('');
  const [entitlementPeriod, setEntitlementPeriod] = useState('calendar_year');
  const [carryForwardAllowed, setCarryForwardAllowed] = useState(false);
  const [maxCarryForwardDays, setMaxCarryForwardDays] = useState('');
  const [carryForwardExpiryMonths, setCarryForwardExpiryMonths] = useState('');
  const [minRequestDurationDays, setMinRequestDurationDays] = useState('');
  const [maxRequestDurationDays, setMaxRequestDurationDays] = useState('');
  const [noticePeriodDays, setNoticePeriodDays] = useState('');
  const [attachmentRequired, setAttachmentRequired] = useState(false);
  const [countWeekends, setCountWeekends] = useState(false);
  const [countPublicHolidays, setCountPublicHolidays] = useState(false);
  const [allowNegativeBalance, setAllowNegativeBalance] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListLeavePoliciesQueryKey(organizationId, leaveTypeId) });

  const handleToggleStatus = (policy: { id: number; status: string }) => {
    const mutation = policy.status === 'inactive' ? reactivateMutation : archiveMutation;
    mutation.mutate(
      { organizationId, leaveTypeId, policyId: policy.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: policy.status === 'inactive' ? 'Policy reactivated' : 'Policy archived' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update policy', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !annualEntitlementDays || !effectiveFrom) return;
    createMutation.mutate(
      {
        organizationId,
        leaveTypeId,
        data: {
          name: name.trim(),
          employmentType: employmentType === EMPTY ? undefined : (employmentType as never),
          branchId: branchId === EMPTY ? undefined : Number(branchId),
          departmentId: departmentId === EMPTY ? undefined : Number(departmentId),
          positionId: positionId === EMPTY ? undefined : Number(positionId),
          gender: gender === EMPTY ? undefined : (gender as never),
          minimumServiceMonths: minimumServiceMonths ? Number(minimumServiceMonths) : undefined,
          probationRestricted,
          annualEntitlementDays: Number(annualEntitlementDays),
          isPaid,
          accrualMethod: accrualMethod as never,
          accrualRate: accrualRate ? Number(accrualRate) : undefined,
          entitlementPeriod: entitlementPeriod as never,
          carryForwardAllowed,
          maxCarryForwardDays: maxCarryForwardDays ? Number(maxCarryForwardDays) : undefined,
          carryForwardExpiryMonths: carryForwardExpiryMonths ? Number(carryForwardExpiryMonths) : undefined,
          minRequestDurationDays: minRequestDurationDays ? Number(minRequestDurationDays) : undefined,
          maxRequestDurationDays: maxRequestDurationDays ? Number(maxRequestDurationDays) : undefined,
          noticePeriodDays: noticePeriodDays ? Number(noticePeriodDays) : undefined,
          attachmentRequired,
          countWeekends,
          countPublicHolidays,
          allowNegativeBalance,
          effectiveFrom,
          effectiveTo: effectiveTo || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setName('');
          setAnnualEntitlementDays('');
          setEffectiveFrom('');
          toast({ title: 'Policy added' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not add policy', description: message ?? 'Please check the details and try again.', variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Policies</h4>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" data-testid={`button-add-policy-${leaveTypeId}`}>
              <ListPlus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              Add Policy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Leave Policy</DialogTitle>
              </DialogHeader>
              <div className="space-y-6 py-4">
                <div className="space-y-2">
                  <Label htmlFor="policy-name">Policy Name *</Label>
                  <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Eligibility</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Employment Type</Label>
                      <Select value={employmentType} onValueChange={setEmploymentType}>
                        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY}>Any</SelectItem>
                          {['full_time', 'part_time', 'contract', 'intern', 'temporary'].map((t) => (
                            <SelectItem key={t} value={t} className="capitalize">{t.replace('_', ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Gender</Label>
                      <Select value={gender} onValueChange={setGender}>
                        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY}>Any</SelectItem>
                          {['male', 'female', 'other', 'prefer_not_to_say'].map((g) => (
                            <SelectItem key={g} value={g} className="capitalize">{g.replace(/_/g, ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Branch</Label>
                      <Select value={branchId} onValueChange={setBranchId}>
                        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY}>Any</SelectItem>
                          {(branches ?? []).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Department</Label>
                      <Select value={departmentId} onValueChange={setDepartmentId}>
                        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY}>Any</SelectItem>
                          {(departments ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Position</Label>
                      <Select value={positionId} onValueChange={setPositionId}>
                        <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY}>Any</SelectItem>
                          {(positions ?? []).map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Minimum Service (months)</Label>
                      <Input type="number" min="0" value={minimumServiceMonths} onChange={(e) => setMinimumServiceMonths(e.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={probationRestricted} onCheckedChange={(c) => setProbationRestricted(c === true)} />
                    Restrict during probation
                  </label>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Entitlement &amp; Accrual</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Annual Entitlement (days) *</Label>
                      <Input type="number" min="0" step="0.5" value={annualEntitlementDays} onChange={(e) => setAnnualEntitlementDays(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Accrual Method</Label>
                      <Select value={accrualMethod} onValueChange={setAccrualMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['annual', 'monthly', 'per_pay_period', 'none'].map((m) => (
                            <SelectItem key={m} value={m} className="capitalize">{m.replace(/_/g, ' ')}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Accrual Rate (days/period)</Label>
                      <Input type="number" min="0" step="0.5" value={accrualRate} onChange={(e) => setAccrualRate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Entitlement Period</Label>
                      <Select value={entitlementPeriod} onValueChange={setEntitlementPeriod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="calendar_year">Calendar year</SelectItem>
                          <SelectItem value="anniversary_year">Anniversary year</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={isPaid} onCheckedChange={(c) => setIsPaid(c === true)} />
                    Paid leave
                  </label>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Carry-Forward</p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={carryForwardAllowed} onCheckedChange={(c) => setCarryForwardAllowed(c === true)} />
                    Allow carry-forward
                  </label>
                  {carryForwardAllowed && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Max Carry-Forward (days) *</Label>
                        <Input type="number" min="0" step="0.5" value={maxCarryForwardDays} onChange={(e) => setMaxCarryForwardDays(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Carry-Forward Expiry (months)</Label>
                        <Input type="number" min="0" value={carryForwardExpiryMonths} onChange={(e) => setCarryForwardExpiryMonths(e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Request Constraints</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Min Duration (days)</Label>
                      <Input type="number" min="0" step="0.5" value={minRequestDurationDays} onChange={(e) => setMinRequestDurationDays(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Duration (days)</Label>
                      <Input type="number" min="0" step="0.5" value={maxRequestDurationDays} onChange={(e) => setMaxRequestDurationDays(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Notice Period (days)</Label>
                      <Input type="number" min="0" value={noticePeriodDays} onChange={(e) => setNoticePeriodDays(e.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={attachmentRequired} onCheckedChange={(c) => setAttachmentRequired(c === true)} />
                    Require supporting document
                  </label>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Day-Counting Rules</p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={countWeekends} onCheckedChange={(c) => setCountWeekends(c === true)} />
                    Count weekends
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={countPublicHolidays} onCheckedChange={(c) => setCountPublicHolidays(c === true)} />
                    Count public holidays
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={allowNegativeBalance} onCheckedChange={(c) => setAllowNegativeBalance(c === true)} />
                    Allow negative balance
                  </label>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Effective Dates</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Effective From *</Label>
                      <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Effective To</Label>
                      <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Adding…' : 'Add Policy'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {(policies ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No policies defined for this leave type yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {(policies ?? []).map((policy) => (
            <li key={policy.id} className="flex items-center justify-between gap-4 py-2" data-testid={`row-policy-${policy.id}`}>
              <div>
                <p className="text-sm font-medium text-foreground">{policy.name}</p>
                <p className="text-xs text-muted-foreground">
                  {policy.annualEntitlementDays} days/year · {policy.accrualMethod.replace(/_/g, ' ')} accrual
                  {policy.carryForwardAllowed ? ` · carries forward up to ${policy.maxCarryForwardDays}d` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={policy.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                  {policy.status}
                </Badge>
                <Button
                  size="sm"
                  variant={policy.status === 'inactive' ? 'default' : 'destructive'}
                  onClick={() => handleToggleStatus(policy)}
                  data-testid={`button-toggle-policy-status-${policy.id}`}
                >
                  {policy.status === 'inactive' ? 'Reactivate' : 'Archive'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LeaveTypes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: leaveTypes,
    isLoading,
    error,
    refetch,
  } = useListLeaveTypes(organizationId, {
    query: { queryKey: getListLeaveTypesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const createMutation = useCreateLeaveType();
  const updateMutation = useUpdateLeaveType();
  const archiveMutation = useArchiveLeaveType();
  const reactivateMutation = useReactivateLeaveType();

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListLeaveTypesQueryKey(organizationId) });

  const openEdit = (leaveType: { id: number; name: string; code: string }) => {
    setEditId(leaveType.id);
    setEditName(leaveType.name);
    setEditCode(leaveType.code);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId == null) return;
    updateMutation.mutate(
      { organizationId, id: editId, data: { name: editName.trim(), code: editCode.trim() } },
      {
        onSuccess: () => {
          invalidate();
          setEditId(null);
          toast({ title: 'Leave type updated' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update leave type', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleToggleStatus = (leaveType: { id: number; status: string }) => {
    const mutation = leaveType.status === 'inactive' ? reactivateMutation : archiveMutation;
    mutation.mutate(
      { organizationId, id: leaveType.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: leaveType.status === 'inactive' ? 'Leave type reactivated' : 'Leave type archived' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update leave type status', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { organizationId, data: { name: name.trim(), code: code.trim() } },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setName('');
          setCode('');
          toast({ title: 'Leave type created' });
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not create leave type',
            description: message ?? 'Please check the details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Leave Types</h1>
          <p className="text-muted-foreground">Define leave categories and the policies that govern them</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-leave-type">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Leave Type
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Leave Type</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="leave-type-name">Name</Label>
                  <Input id="leave-type-name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-leave-type-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="leave-type-code">Code</Label>
                  <Input id="leave-type-code" value={code} onChange={(e) => setCode(e.target.value)} required data-testid="input-leave-type-code" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-leave-type">
                  {createMutation.isPending ? 'Creating…' : 'Create Leave Type'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading leave types">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load leave types" message="Could not fetch leave types. Try again." onRetry={() => refetch()} />
      ) : !leaveTypes || leaveTypes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <CalendarDays className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No leave types yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add your first leave type (e.g. Annual, Sick) to start defining policies.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Leave types">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaveTypes.map((leaveType) => (
                <>
                  <TableRow key={leaveType.id} data-testid={`row-leave-type-${leaveType.id}`}>
                    <TableCell className="font-medium">{leaveType.name}</TableCell>
                    <TableCell className="font-mono text-sm">{leaveType.code}</TableCell>
                    <TableCell>
                      <Badge variant={leaveType.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                        {leaveType.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExpandedId(expandedId === leaveType.id ? null : leaveType.id)}
                          data-testid={`button-manage-policies-${leaveType.id}`}
                        >
                          {expandedId === leaveType.id ? 'Hide Policies' : 'Manage Policies'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(leaveType)} data-testid={`button-edit-leave-type-${leaveType.id}`}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant={leaveType.status === 'inactive' ? 'default' : 'destructive'}
                          onClick={() => handleToggleStatus(leaveType)}
                          data-testid={`button-toggle-leave-type-status-${leaveType.id}`}
                        >
                          {leaveType.status === 'inactive' ? 'Reactivate' : 'Archive'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === leaveType.id && (
                    <TableRow key={`${leaveType.id}-policies`}>
                      <TableCell colSpan={4} className="bg-muted/30">
                        <PoliciesPanel organizationId={organizationId} leaveTypeId={leaveType.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editId !== null} onOpenChange={(open) => !open && setEditId(null)}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Leave Type</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-leave-type-name">Name</Label>
                <Input id="edit-leave-type-name" value={editName} onChange={(e) => setEditName(e.target.value)} required data-testid="input-edit-leave-type-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-leave-type-code">Code</Label>
                <Input id="edit-leave-type-code" value={editCode} onChange={(e) => setEditCode(e.target.value)} required data-testid="input-edit-leave-type-code" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-leave-type">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
