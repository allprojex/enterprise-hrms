import { useState } from 'react';
import { Car, Plus, Pencil, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListVehicles,
  getListVehiclesQueryKey,
  useCreateVehicle,
  useUpdateVehicle,
  useListAssets,
  getListAssetsQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useGetMe,
  getGetMeQueryKey,
  type Vehicle,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useCapabilities } from '@/hooks/use-capabilities';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';

/**
 * VR-01 — the organizational vehicle register.
 *
 * The register is Assets administration: reading it and the add/edit/status
 * controls alike need the existing `asset_management.manage`, and VR-01 adds no
 * permission key of its own. Hiding a control is never the authorization —
 * every route behind this page re-checks the permission and the module
 * server-side.
 *
 * Status is the register's own administrative state — available, maintenance
 * or inactive. Whether a vehicle is physically out is a VR-02 question the
 * register deliberately cannot answer, so nothing here displays or implies it.
 */
const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100' },
  maintenance: { label: 'Maintenance', className: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100' },
  inactive: { label: 'Inactive', className: 'bg-muted text-muted-foreground' },
};

const emptyForm = {
  registrationNumber: '',
  make: '',
  model: '',
  description: '',
  notes: '',
  assetId: '',
  defaultDriverEmployeeId: '',
  branchId: '',
  status: 'available',
};

/**
 * The three administrative statuses the register defines. There is no "in use"
 * here and never will be: whether a vehicle is physically out is a movement
 * concern, not a register field.
 */
const REGISTER_STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'inactive', label: 'Inactive' },
] as const;

/**
 * Every optional reference is chosen from a list, never typed as an id: the
 * select needs a concrete value for "not set", and the API takes null.
 */
const NO_ASSET = 'none';
const NO_DRIVER = 'none';
const NO_BRANCH = 'none';

function errorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'error' in err) return String((err as { error: unknown }).error);
  if (err instanceof Error) return err.message;
  return undefined;
}

export default function Vehicles() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const capabilities = useCapabilities(organizationId);
  const canManage = capabilities.can('asset_management.manage');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const params = {
    ...(statusFilter !== 'all' ? { status: statusFilter as Vehicle['status'] } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  const {
    data: vehicles,
    isLoading,
    error,
    refetch,
  } = useListVehicles(organizationId, params, {
    query: { queryKey: getListVehiclesQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [statusTarget, setStatusTarget] = useState<Vehicle | null>(null);

  // The optional capital-asset link. Same permission and module as this page,
  // so no extra gate: a caller who may administer the register may already read
  // the asset register.
  const { data: assetsPage } = useListAssets(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListAssetsQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 } },
  );
  const assets = assetsPage?.items ?? [];
  const assetLabel = (assetId: number | null | undefined): string | null => {
    if (assetId == null) return null;
    const asset = assets.find((a) => a.id === assetId);
    return asset ? `${asset.assetTag} · ${asset.name}` : `Asset #${assetId}`;
  };

  // The default driver and the owning branch are the register's other two
  // optional references. Both are picked from the organization's own lists —
  // the page never asks anyone to type an id, and never shows one.
  const { data: employeesPage } = useListEmployees(
    organizationId,
    { pageSize: 200 },
    { query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 } },
  );
  const employees = employeesPage?.items ?? [];
  const employeeName = (employee: { firstName: string; lastName: string; employeeNumber?: string | null }): string =>
    employee.employeeNumber
      ? `${employee.firstName} ${employee.lastName} · ${employee.employeeNumber}`
      : `${employee.firstName} ${employee.lastName}`;
  const driverLabel = (employeeId: number | null | undefined): string | null => {
    if (employeeId == null) return null;
    const employee = employees.find((e) => e.id === employeeId);
    return employee ? employeeName(employee) : 'Unknown employee';
  };

  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const branchList = branches ?? [];
  const branchLabel = (branchId: number | null | undefined): string | null => {
    if (branchId == null) return null;
    const branch = branchList.find((b) => b.id === branchId);
    return branch ? branch.name : 'Unknown branch';
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey(organizationId) });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organizationId,
        data: {
          registrationNumber: form.registrationNumber.trim(),
          make: form.make.trim() || null,
          model: form.model.trim() || null,
          description: form.description.trim() || null,
          notes: form.notes.trim() || null,
          assetId: form.assetId ? Number(form.assetId) : null,
          defaultDriverEmployeeId: form.defaultDriverEmployeeId ? Number(form.defaultDriverEmployeeId) : null,
          branchId: form.branchId ? Number(form.branchId) : null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setAddOpen(false);
          setForm(emptyForm);
          toast({ title: 'Vehicle registered' });
        },
        onError: (err) =>
          toast({
            title: 'Could not register vehicle',
            description: errorMessage(err) ?? 'Check the registration number and try again.',
            variant: 'destructive',
          }),
      },
    );
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditId(vehicle.id);
    setEditForm({
      registrationNumber: vehicle.registrationNumber,
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      description: vehicle.description ?? '',
      notes: vehicle.notes ?? '',
      assetId: vehicle.assetId != null ? String(vehicle.assetId) : '',
      defaultDriverEmployeeId: vehicle.defaultDriverEmployeeId != null ? String(vehicle.defaultDriverEmployeeId) : '',
      branchId: vehicle.branchId != null ? String(vehicle.branchId) : '',
      status: vehicle.status,
    });
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId == null) return;
    updateMutation.mutate(
      {
        organizationId,
        vehicleId: editId,
        data: {
          registrationNumber: editForm.registrationNumber.trim(),
          make: editForm.make.trim() || null,
          model: editForm.model.trim() || null,
          description: editForm.description.trim() || null,
          notes: editForm.notes.trim() || null,
          assetId: editForm.assetId ? Number(editForm.assetId) : null,
          defaultDriverEmployeeId: editForm.defaultDriverEmployeeId ? Number(editForm.defaultDriverEmployeeId) : null,
          branchId: editForm.branchId ? Number(editForm.branchId) : null,
          status: editForm.status as Vehicle['status'],
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setEditId(null);
          toast({ title: 'Vehicle updated' });
        },
        onError: (err) =>
          toast({ title: 'Could not update vehicle', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // Returned so the confirmation stays open, with the error toast, when the
  // server refuses.
  const handleToggleStatus = (vehicle: Vehicle) => {
    const nextStatus = vehicle.status === 'inactive' ? 'available' : 'inactive';
    return updateMutation.mutateAsync(
      { organizationId, vehicleId: vehicle.id, data: { status: nextStatus } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: nextStatus === 'inactive' ? 'Vehicle taken out of service' : 'Vehicle returned to service' });
        },
        onError: (err) =>
          toast({ title: 'Could not change vehicle status', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Vehicles</h1>
          <p className="text-muted-foreground">The organisation's vehicle register</p>
        </div>
        {canManage && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-vehicle">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Vehicle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add Vehicle</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-registration">Registration / car number</Label>
                    <Input
                      id="vehicle-registration"
                      value={form.registrationNumber}
                      onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                      required
                      maxLength={32}
                      data-testid="input-vehicle-registration"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="vehicle-make">Make</Label>
                      <Input
                        id="vehicle-make"
                        value={form.make}
                        onChange={(e) => setForm({ ...form, make: e.target.value })}
                        data-testid="input-vehicle-make"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vehicle-model">Model</Label>
                      <Input
                        id="vehicle-model"
                        value={form.model}
                        onChange={(e) => setForm({ ...form, model: e.target.value })}
                        data-testid="input-vehicle-model"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="vehicle-driver">Default driver (optional)</Label>
                      <Select
                        value={form.defaultDriverEmployeeId || NO_DRIVER}
                        onValueChange={(value) =>
                          setForm({ ...form, defaultDriverEmployeeId: value === NO_DRIVER ? '' : value })
                        }
                      >
                        <SelectTrigger id="vehicle-driver" data-testid="select-vehicle-driver">
                          <SelectValue placeholder="No default driver" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DRIVER}>No default driver</SelectItem>
                          {employees.map((employee) => (
                            <SelectItem key={employee.id} value={String(employee.id)}>
                              {employeeName(employee)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vehicle-branch">Branch (optional)</Label>
                      <Select
                        value={form.branchId || NO_BRANCH}
                        onValueChange={(value) => setForm({ ...form, branchId: value === NO_BRANCH ? '' : value })}
                      >
                        <SelectTrigger id="vehicle-branch" data-testid="select-vehicle-branch">
                          <SelectValue placeholder="No branch" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_BRANCH}>No branch</SelectItem>
                          {branchList.map((branch) => (
                            <SelectItem key={branch.id} value={String(branch.id)}>
                              {branch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-asset">Linked asset (optional)</Label>
                    <Select
                      value={form.assetId || NO_ASSET}
                      onValueChange={(value) => setForm({ ...form, assetId: value === NO_ASSET ? '' : value })}
                    >
                      <SelectTrigger id="vehicle-asset" data-testid="select-vehicle-asset">
                        <SelectValue placeholder="Not linked" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ASSET}>Not linked</SelectItem>
                        {assets.map((asset) => (
                          <SelectItem key={asset.id} value={String(asset.id)}>
                            {asset.assetTag} · {asset.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-status">Status</Label>
                    {/* A newly registered vehicle always starts available — the
                        create endpoint takes no status — so this shows the
                        starting value rather than offering a choice the server
                        would discard. Maintenance and Inactive are set from
                        Edit, or through the out-of-service action. */}
                    <Select value={form.status} disabled>
                      <SelectTrigger id="vehicle-status" data-testid="select-vehicle-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REGISTER_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      A new vehicle starts available. Change it from Edit once it is registered.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-description">Description</Label>
                    <Textarea
                      id="vehicle-description"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={2}
                      data-testid="input-vehicle-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vehicle-notes">Notes</Label>
                    <Textarea
                      id="vehicle-notes"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      rows={2}
                      data-testid="input-vehicle-notes"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-vehicle">
                    {createMutation.isPending ? 'Saving…' : 'Add Vehicle'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="vehicle-status-filter">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="vehicle-status-filter" className="w-48" data-testid="select-vehicle-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vehicle-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="vehicle-search"
              className="pl-8 w-64"
              placeholder="Registration, make or model"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-vehicle-search"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading vehicles">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load vehicles" message="Could not fetch vehicles. Try again." onRetry={() => refetch()} />
      ) : !vehicles || vehicles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Car className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No vehicles yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add the organisation's vehicles so they can be requested and their movements recorded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Vehicles">
            <TableHeader>
              <TableRow>
                <TableHead>Car / registration number</TableHead>
                <TableHead>Make / model</TableHead>
                <TableHead>Default driver</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Linked asset</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((vehicle) => {
                const status = STATUS_LABELS[vehicle.status] ?? { label: vehicle.status, className: '' };
                return (
                  <TableRow key={vehicle.id} data-testid={`row-vehicle-${vehicle.id}`}>
                    <TableCell className="font-mono font-medium">{vehicle.registrationNumber}</TableCell>
                    <TableCell data-testid={`cell-vehicle-make-model-${vehicle.id}`}>
                      {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell data-testid={`cell-vehicle-driver-${vehicle.id}`}>
                      {driverLabel(vehicle.defaultDriverEmployeeId) ?? '—'}
                    </TableCell>
                    <TableCell data-testid={`cell-vehicle-branch-${vehicle.id}`}>
                      {branchLabel(vehicle.branchId) ?? '—'}
                    </TableCell>
                    <TableCell data-testid={`cell-vehicle-asset-${vehicle.id}`}>{assetLabel(vehicle.assetId) ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status.className} data-testid={`badge-vehicle-status-${vehicle.id}`}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(vehicle)}
                            aria-label={`Edit ${vehicle.registrationNumber}`}
                            data-testid={`button-edit-vehicle-${vehicle.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant={vehicle.status === 'inactive' ? 'default' : 'destructive'}
                            onClick={() => setStatusTarget(vehicle)}
                            disabled={updateMutation.isPending}
                            data-testid={`button-toggle-vehicle-status-${vehicle.id}`}
                          >
                            {vehicle.status === 'inactive' ? 'Return to service' : 'Take out of service'}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmActionDialog
        open={statusTarget !== null}
        onOpenChange={(o) => {
          if (!o) setStatusTarget(null);
        }}
        title={statusTarget?.status === 'inactive' ? 'Return vehicle to service?' : 'Take vehicle out of service?'}
        description={
          statusTarget?.status === 'inactive' ? (
            <p>“{statusTarget?.registrationNumber}” will be available again.</p>
          ) : (
            <>
              <p>
                “{statusTarget?.registrationNumber}” will be marked inactive. Its record and history are preserved, and it can be
                returned to service later.
              </p>
              <p>A vehicle that is currently out must have its return recorded first.</p>
            </>
          )
        }
        confirmLabel={statusTarget?.status === 'inactive' ? 'Return to Service' : 'Take Out of Service'}
        tone={statusTarget?.status === 'inactive' ? 'default' : 'destructive'}
        onConfirm={() => (statusTarget ? handleToggleStatus(statusTarget) : undefined)}
        testId="dialog-vehicle-status"
      />

      <Dialog open={editId !== null} onOpenChange={(open) => !open && setEditId(null)}>
        <DialogContent>
          <form onSubmit={handleEdit}>
            <DialogHeader>
              <DialogTitle>Edit Vehicle</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-vehicle-registration">Registration / car number</Label>
                <Input
                  id="edit-vehicle-registration"
                  value={editForm.registrationNumber}
                  onChange={(e) => setEditForm({ ...editForm, registrationNumber: e.target.value })}
                  required
                  maxLength={32}
                  data-testid="input-edit-vehicle-registration"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-vehicle-make">Make</Label>
                  <Input
                    id="edit-vehicle-make"
                    value={editForm.make}
                    onChange={(e) => setEditForm({ ...editForm, make: e.target.value })}
                    data-testid="input-edit-vehicle-make"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-vehicle-model">Model</Label>
                  <Input
                    id="edit-vehicle-model"
                    value={editForm.model}
                    onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                    data-testid="input-edit-vehicle-model"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-vehicle-driver">Default driver (optional)</Label>
                  <Select
                    value={editForm.defaultDriverEmployeeId || NO_DRIVER}
                    onValueChange={(value) =>
                      setEditForm({ ...editForm, defaultDriverEmployeeId: value === NO_DRIVER ? '' : value })
                    }
                  >
                    <SelectTrigger id="edit-vehicle-driver" data-testid="select-edit-vehicle-driver">
                      <SelectValue placeholder="No default driver" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_DRIVER}>No default driver</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={String(employee.id)}>
                          {employeeName(employee)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-vehicle-branch">Branch (optional)</Label>
                  <Select
                    value={editForm.branchId || NO_BRANCH}
                    onValueChange={(value) => setEditForm({ ...editForm, branchId: value === NO_BRANCH ? '' : value })}
                  >
                    <SelectTrigger id="edit-vehicle-branch" data-testid="select-edit-vehicle-branch">
                      <SelectValue placeholder="No branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BRANCH}>No branch</SelectItem>
                      {branchList.map((branch) => (
                        <SelectItem key={branch.id} value={String(branch.id)}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vehicle-asset">Linked asset (optional)</Label>
                <Select
                  value={editForm.assetId || NO_ASSET}
                  onValueChange={(value) => setEditForm({ ...editForm, assetId: value === NO_ASSET ? '' : value })}
                >
                  <SelectTrigger id="edit-vehicle-asset" data-testid="select-edit-vehicle-asset">
                    <SelectValue placeholder="Not linked" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ASSET}>Not linked</SelectItem>
                    {assets.map((asset) => (
                      <SelectItem key={asset.id} value={String(asset.id)}>
                        {asset.assetTag} · {asset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vehicle-status">Status</Label>
                <Select value={editForm.status} onValueChange={(value) => setEditForm({ ...editForm, status: value })}>
                  <SelectTrigger id="edit-vehicle-status" data-testid="select-edit-vehicle-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGISTER_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vehicle-description">Description</Label>
                <Textarea
                  id="edit-vehicle-description"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={2}
                  data-testid="input-edit-vehicle-description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-vehicle-notes">Notes</Label>
                <Textarea
                  id="edit-vehicle-notes"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={2}
                  data-testid="input-edit-vehicle-notes"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-vehicle">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
