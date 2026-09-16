import { useState } from 'react';
import { Network, Plus, Pencil, UserCog, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListDepartments,
  getListDepartmentsQueryKey,
  useCreateDepartment,
  useUpdateDepartment,
  useArchiveDepartment,
  useReactivateDepartment,
  useRestructureDepartment,
  useListBranches,
  getListBranchesQueryKey,
  useListMembers,
  getListMembersQueryKey,
  useGetCurrentDepartmentHead,
  getGetCurrentDepartmentHeadQueryKey,
  useAssignDepartmentHead,
  useRevokeDepartmentHead,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useIsHrCapable, useHasAnyPermission } from '@/hooks/use-hr-capable';
import { QueryError } from '@/components/query-error';

const NONE = '__none__';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

// Office Inventory, Workstream 1 — Department Head is a general
// organizational-authority primitive (docs/OFFICE_INVENTORY_IMPLEMENTATION_
// PLAN.md §5), deliberately NOT namespaced under office_inventory and NOT
// gated by that module — it lives here on the existing Departments page,
// independent of Office Inventory's own enablement state.
//
// ROLE-02 (2026-09-15): reading and managing are separate capabilities, and
// both are resolved from the caller's EFFECTIVE permission keys, never from a
// role name. Previously this cell fetched unconditionally and rendered the
// assign/revoke controls for anyone who reached the page, so an org_admin — who
// may now read but still may not manage — produced one 403 per department and
// was offered controls the server refuses. We fetch only with read capability
// and render the controls only with manage capability. The server stays
// authoritative; this only decides which affordances to show.
function DepartmentHeadCell({ organizationId, departmentId }: { organizationId: number; departmentId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedMembershipId, setSelectedMembershipId] = useState('');

  // department.head.manage implies its own read, matching the route gate.
  const canRead = useHasAnyPermission(organizationId, ['department.head.read', 'department.head.manage']);
  const canManage = useHasAnyPermission(organizationId, ['department.head.manage']);

  const { data: currentHead, isLoading } = useGetCurrentDepartmentHead(organizationId, departmentId, {
    query: { queryKey: getGetCurrentDepartmentHeadQueryKey(organizationId, departmentId), enabled: organizationId > 0 && canRead },
  });
  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 && pickerOpen },
  });
  const assignMutation = useAssignDepartmentHead();
  const revokeMutation = useRevokeDepartmentHead();

  const memberById = new Map((members ?? []).map((m) => [m.membershipId, m]));
  const currentHeadMember = currentHead ? memberById.get(currentHead.headMembershipId) : undefined;

  const handleAssign = () => {
    if (!selectedMembershipId) return;
    assignMutation.mutate(
      { organizationId, departmentId, data: { headMembershipId: Number(selectedMembershipId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentDepartmentHeadQueryKey(organizationId, departmentId) });
          setPickerOpen(false);
          setSelectedMembershipId('');
          toast({ title: 'Department Head assigned' });
        },
        onError: (err) => toast({ title: 'Could not assign Department Head', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleRevoke = () => {
    revokeMutation.mutate(
      { organizationId, departmentId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentDepartmentHeadQueryKey(organizationId, departmentId) });
          toast({ title: 'Department Head revoked — department is now vacant' });
        },
        onError: (err) => toast({ title: 'Could not revoke Department Head', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // Without read capability the request is never issued, so there is nothing
  // to wait for and nothing to show.
  if (!canRead) {
    return (
      <span className="text-sm text-muted-foreground" data-testid={`text-department-head-hidden-${departmentId}`}>
        —
      </span>
    );
  }

  if (isLoading) return <Skeleton className="h-6 w-32" />;

  return (
    <div className="flex items-center gap-2">
      {currentHead ? (
        <>
          <span className="text-sm text-foreground" data-testid={`text-department-head-${departmentId}`}>
            {currentHeadMember ? `${currentHeadMember.firstName} ${currentHeadMember.lastName}` : `Membership #${currentHead.headMembershipId}`}
          </span>
          {canManage ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={handleRevoke}
              disabled={revokeMutation.isPending}
              aria-label="Revoke Department Head"
              data-testid={`button-revoke-head-${departmentId}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </>
      ) : (
        <span className="text-sm text-muted-foreground" data-testid={`text-department-head-vacant-${departmentId}`}>Vacant</span>
      )}

      {canManage ? (
      <Dialog open={pickerOpen} onOpenChange={(o) => { setPickerOpen(o); if (!o) setSelectedMembershipId(''); }}>
        <DialogTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={currentHead ? 'Replace Department Head' : 'Assign Department Head'} data-testid={`button-open-assign-head-${departmentId}`}>
            <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentHead ? 'Replace Department Head' : 'Assign Department Head'}</DialogTitle>
            <DialogDescription>The previous assignment, if any, is preserved as history — never overwritten.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor={`assign-head-select-${departmentId}`}>Member</Label>
            <Select value={selectedMembershipId} onValueChange={setSelectedMembershipId}>
              <SelectTrigger id={`assign-head-select-${departmentId}`} data-testid={`select-assign-head-${departmentId}`}>
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {(members ?? []).filter((m) => m.status === 'active').map((m) => (
                  <SelectItem key={m.membershipId} value={String(m.membershipId)}>{m.firstName} {m.lastName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={handleAssign} disabled={!selectedMembershipId || assignMutation.isPending} data-testid={`button-confirm-assign-head-${departmentId}`}>
              {assignMutation.isPending ? 'Saving…' : currentHead ? 'Replace' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}
    </div>
  );
}

export default function Departments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const isHrCapable = useIsHrCapable(organizationId);

  const {
    data: departments,
    isLoading,
    error,
    refetch,
  } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [branchId, setBranchId] = useState(NONE);

  const createMutation = useCreateDepartment();
  const restructureMutation = useRestructureDepartment();
  const updateMutation = useUpdateDepartment();
  const archiveMutation = useArchiveDepartment();
  const reactivateMutation = useReactivateDepartment();

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const openEdit = (department: { id: number; name: string; code: string }) => {
    setEditId(department.id);
    setEditName(department.name);
    setEditCode(department.code);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId == null) return;
    updateMutation.mutate(
      { organizationId, id: editId, data: { name: editName.trim(), code: editCode.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey(organizationId) });
          setEditId(null);
          toast({ title: 'Department updated' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update department', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleToggleStatus = (department: { id: number; status: string }) => {
    const mutation = department.status === 'inactive' ? reactivateMutation : archiveMutation;
    mutation.mutate(
      { organizationId, id: department.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey(organizationId) });
          toast({ title: department.status === 'inactive' ? 'Department reactivated' : 'Department archived' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update department status', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleMoveBranch = (departmentId: number, value: string) => {
    restructureMutation.mutate(
      { organizationId, id: departmentId, data: { branchId: value === NONE ? null : Number(value) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey(organizationId) });
          toast({ title: 'Department moved' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not move department', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organizationId,
        data: {
          name: name.trim(),
          code: code.trim(),
          branchId: branchId === NONE ? null : Number(branchId),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey(organizationId) });
          setOpen(false);
          setName('');
          setCode('');
          setBranchId(NONE);
          toast({ title: 'Department created' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not create department',
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
          <h1 className="text-3xl font-bold text-foreground">Departments</h1>
          <p className="text-muted-foreground">Organise employees into functional or organisational units</p>
        </div>
        {isHrCapable && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-department">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Department
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Department</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="department-name">Name</Label>
                  <Input
                    id="department-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    data-testid="input-department-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department-code">Code</Label>
                  <Input
                    id="department-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    data-testid="input-department-code"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department-branch">Branch (optional)</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger id="department-branch" data-testid="select-department-branch">
                      <SelectValue placeholder="No branch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No branch</SelectItem>
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-department">
                  {createMutation.isPending ? 'Creating…' : 'Create Department'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading departments">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError
          title="Failed to load departments"
          message="Could not fetch departments. Try again."
          onRetry={() => refetch()}
        />
      ) : !departments || departments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Network className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No departments yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add your first department to start structuring your organisation.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Departments">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Head</TableHead>
                <TableHead>Status</TableHead>
                {isHrCapable && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((department) => (
                <TableRow key={department.id} data-testid={`row-department-${department.id}`}>
                  <TableCell className="font-medium">{department.name}</TableCell>
                  <TableCell className="font-mono text-sm">{department.code}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <Select
                      value={department.branchId != null ? String(department.branchId) : NONE}
                      onValueChange={(v) => handleMoveBranch(department.id, v)}
                      disabled={!isHrCapable}
                    >
                      <SelectTrigger className="w-40" data-testid={`select-move-branch-${department.id}`}>
                        <SelectValue>{department.branchId ? (branchNameById.get(department.branchId) ?? '—') : 'No branch'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No branch</SelectItem>
                        {(branches ?? []).map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <DepartmentHeadCell organizationId={organizationId} departmentId={department.id} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={department.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                      {department.status}
                    </Badge>
                  </TableCell>
                  {isHrCapable && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(department)}
                        data-testid={`button-edit-department-${department.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant={department.status === 'inactive' ? 'default' : 'destructive'}
                        onClick={() => handleToggleStatus(department)}
                        disabled={archiveMutation.isPending || reactivateMutation.isPending}
                        data-testid={`button-toggle-department-status-${department.id}`}
                      >
                        {department.status === 'inactive' ? 'Reactivate' : 'Archive'}
                      </Button>
                    </div>
                  </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editId !== null} onOpenChange={(open) => !open && setEditId(null)}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Department</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-department-name">Name</Label>
                <Input
                  id="edit-department-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  data-testid="input-edit-department-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-department-code">Code</Label>
                <Input
                  id="edit-department-code"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  required
                  data-testid="input-edit-department-code"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-department">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
