import { useState } from 'react';
import { CalendarHeart, Plus, Pencil, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListPublicHolidays,
  getListPublicHolidaysQueryKey,
  useCreatePublicHoliday,
  useUpdatePublicHoliday,
  useDeactivatePublicHoliday,
  useReactivatePublicHoliday,
  useDeletePublicHoliday,
  type PublicHoliday,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { isHrCapableRole } from '@/hooks/use-hr-capable';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

interface FormState {
  name: string;
  date: string;
  recurring: boolean;
  effectiveYear: string;
  observedDate: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', date: '', recurring: false, effectiveYear: '', observedDate: '', description: '' };

export default function PublicHolidays() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  // UX-convenience gate only — public_holiday.manage is the real,
  // server-enforced authorization (same precedent as app-shell.tsx's
  // isOrgAdmin: this just avoids showing management controls to a role
  // whose actions would all 403).
  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey() },
  });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const canManage = isHrCapableRole(currentOrg?.roles);

  const {
    data: holidays,
    isLoading,
    error,
    refetch,
  } = useListPublicHolidays(organizationId, undefined, {
    query: { queryKey: getListPublicHolidaysQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const createMutation = useCreatePublicHoliday();
  const updateMutation = useUpdatePublicHoliday();
  const deactivateMutation = useDeactivatePublicHoliday();
  const reactivateMutation = useReactivatePublicHoliday();
  const deleteMutation = useDeletePublicHoliday();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PublicHoliday | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [statusTarget, setStatusTarget] = useState<PublicHoliday | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicHoliday | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPublicHolidaysQueryKey(organizationId) });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (holiday: PublicHoliday) => {
    setEditing(holiday);
    setForm({
      name: holiday.name,
      date: holiday.date.slice(0, 10),
      recurring: holiday.recurring,
      effectiveYear: holiday.effectiveYear != null ? String(holiday.effectiveYear) : '',
      observedDate: holiday.observedDate ? holiday.observedDate.slice(0, 10) : '',
      description: holiday.description ?? '',
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.date) return;

    const payload = {
      name: form.name,
      date: form.date,
      recurring: form.recurring,
      effectiveYear: form.recurring ? undefined : (form.effectiveYear ? Number(form.effectiveYear) : undefined),
      observedDate: form.recurring ? undefined : (form.observedDate || undefined),
      description: form.description || undefined,
    };

    const onSettled = {
      onSuccess: () => {
        invalidate();
        setOpen(false);
        toast({ title: editing ? 'Holiday updated' : 'Holiday created' });
      },
      onError: (err: unknown) => {
        toast({ title: 'Could not save holiday', description: errorMessage(err) ?? 'Please check the details and try again.', variant: 'destructive' });
      },
    };

    if (editing) {
      updateMutation.mutate({ organizationId, id: editing.id, data: payload }, onSettled);
    } else {
      createMutation.mutate({ organizationId, data: payload }, onSettled);
    }
  };

  const handleDeactivate = (id: number) => {
    return deactivateMutation.mutateAsync({ organizationId, id }, {
      onSuccess: () => { invalidate(); toast({ title: 'Holiday deactivated' }); },
      onError: (err) => toast({ title: 'Could not deactivate holiday', description: errorMessage(err), variant: 'destructive' }),
    });
  };
  const handleReactivate = (id: number) => {
    return reactivateMutation.mutateAsync({ organizationId, id }, {
      onSuccess: () => { invalidate(); toast({ title: 'Holiday reactivated' }); },
      onError: (err) => toast({ title: 'Could not reactivate holiday', description: errorMessage(err), variant: 'destructive' }),
    });
  };
  const handleDelete = (id: number) => {
    return deleteMutation.mutateAsync(
      { organizationId, id },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Holiday deleted' }); },
        onError: (err) => toast({ title: 'Could not delete holiday', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Public Holidays</h1>
          <p className="text-muted-foreground">Excluded from leave day-counting per policy, and overlaid on the Leave Calendar</p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-holiday" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Holiday
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>{editing ? 'Edit Holiday' : 'New Holiday'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="holiday-name">Name *</Label>
                    <Input id="holiday-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required data-testid="input-holiday-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="holiday-date">Date *</Label>
                    <Input
                      id="holiday-date"
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, effectiveYear: f.effectiveYear || e.target.value.slice(0, 4) }))}
                      required
                      data-testid="input-holiday-date"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="holiday-recurring"
                      checked={form.recurring}
                      onCheckedChange={(checked) => setForm((f) => ({ ...f, recurring: checked === true }))}
                      data-testid="checkbox-holiday-recurring"
                    />
                    <Label htmlFor="holiday-recurring" className="font-normal">Recurs every year (same month/day)</Label>
                  </div>
                  {!form.recurring && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="holiday-effective-year">Effective Year *</Label>
                        <Input
                          id="holiday-effective-year"
                          type="number"
                          value={form.effectiveYear}
                          onChange={(e) => setForm((f) => ({ ...f, effectiveYear: e.target.value }))}
                          required
                          data-testid="input-holiday-effective-year"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="holiday-observed-date">Observed Date (if shifted to a weekday)</Label>
                        <Input
                          id="holiday-observed-date"
                          type="date"
                          value={form.observedDate}
                          onChange={(e) => setForm((f) => ({ ...f, observedDate: e.target.value }))}
                          data-testid="input-holiday-observed-date"
                        />
                      </div>
                    </>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="holiday-description">Description</Label>
                    <Input id="holiday-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} data-testid="input-holiday-description" />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending || !form.name || !form.date}
                    data-testid="button-submit-holiday"
                  >
                    {createMutation.isPending || updateMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Holiday'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {error ? (
        <QueryError title="Could not load public holidays" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !holidays || holidays.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <CalendarHeart className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No public holidays defined</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Holidays defined here are excluded from leave day-counting where the policy requires it.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Recurring</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((holiday) => (
                  <TableRow key={holiday.id} data-testid={`row-holiday-${holiday.id}`}>
                    <TableCell className="font-medium">{holiday.name}</TableCell>
                    <TableCell>{new Date(holiday.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{holiday.recurring ? '' : ` ${holiday.effectiveYear}`}</TableCell>
                    <TableCell>{holiday.recurring ? 'Every year' : 'One-off'}</TableCell>
                    <TableCell>
                      <Badge variant={holiday.status === 'active' ? 'secondary' : 'outline'} className="capitalize">{holiday.status}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" aria-label={`Edit ${holiday.name}`} onClick={() => openEdit(holiday)} data-testid={`button-edit-holiday-${holiday.id}`}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {holiday.status === 'active' ? (
                          <Button size="icon" variant="ghost" aria-label={`Deactivate ${holiday.name}`} onClick={() => setStatusTarget(holiday)} data-testid={`button-deactivate-holiday-${holiday.id}`}>
                            <Archive className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : (
                          <Button size="icon" variant="ghost" aria-label={`Reactivate ${holiday.name}`} onClick={() => setStatusTarget(holiday)} data-testid={`button-reactivate-holiday-${holiday.id}`}>
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" aria-label={`Delete ${holiday.name}`} onClick={() => setDeleteTarget(holiday)} data-testid={`button-delete-holiday-${holiday.id}`}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ConfirmActionDialog
        open={statusTarget !== null}
        onOpenChange={(o) => {
          if (!o) setStatusTarget(null);
        }}
        title={statusTarget?.status === 'active' ? 'Deactivate public holiday?' : 'Reactivate public holiday?'}
        description={
          statusTarget?.status === 'active' ? (
            <p>
              “{statusTarget?.name}” will be marked inactive. It will no longer be treated as a holiday when counting days for new leave requests or
              shown on the leave calendar. Leave already requested keeps its recorded day count, and the holiday can be reactivated later.
            </p>
          ) : (
            <p>“{statusTarget?.name}” will be marked active again and excluded from leave day-counting where the leave policy requires it.</p>
          )
        }
        confirmLabel={statusTarget?.status === 'active' ? 'Deactivate Holiday' : 'Reactivate Holiday'}
        tone={statusTarget?.status === 'active' ? 'destructive' : 'default'}
        onConfirm={() => {
          if (!statusTarget) return undefined;
          return statusTarget.status === 'active' ? handleDeactivate(statusTarget.id) : handleReactivate(statusTarget.id);
        }}
        testId="dialog-holiday-status"
      />

      <ConfirmActionDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Delete public holiday?"
        description={
          <p>
            “{deleteTarget?.name}” will be permanently deleted. This cannot be undone. Leave already requested keeps its recorded day count. To
            stop using the holiday but keep it on record, deactivate it instead.
          </p>
        }
        confirmLabel="Delete Holiday"
        onConfirm={() => (deleteTarget ? handleDelete(deleteTarget.id) : undefined)}
        testId="dialog-delete-holiday"
      />
    </div>
  );
}
