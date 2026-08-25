import { useState } from 'react';
import { Briefcase, Plus, Pencil } from 'lucide-react';
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
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListPositions,
  getListPositionsQueryKey,
  useCreatePosition,
  useUpdatePosition,
  useArchivePosition,
  useReactivatePosition,
  useRestructurePosition,
  useListDepartments,
  getListDepartmentsQueryKey,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useIsHrCapable } from '@/hooks/use-hr-capable';
import { QueryError } from '@/components/query-error';

const NONE = '__none__';

export default function Positions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const isHrCapable = useIsHrCapable(organizationId);

  const {
    data: positions,
    isLoading,
    error,
    refetch,
  } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [departmentId, setDepartmentId] = useState(NONE);

  const createMutation = useCreatePosition();
  const restructureMutation = useRestructurePosition();
  const updateMutation = useUpdatePosition();
  const archiveMutation = useArchivePosition();
  const reactivateMutation = useReactivatePosition();

  const [editId, setEditId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const departmentNameById = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const openEdit = (position: { id: number; title: string }) => {
    setEditId(position.id);
    setEditTitle(position.title);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId == null) return;
    updateMutation.mutate(
      { organizationId, id: editId, data: { title: editTitle.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey(organizationId) });
          setEditId(null);
          toast({ title: 'Position updated' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update position', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleToggleStatus = (position: { id: number; status: string }) => {
    const mutation = position.status === 'inactive' ? reactivateMutation : archiveMutation;
    mutation.mutate(
      { organizationId, id: position.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey(organizationId) });
          toast({ title: position.status === 'inactive' ? 'Position reactivated' : 'Position archived' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update position status', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleMoveDepartment = (positionId: number, value: string) => {
    restructureMutation.mutate(
      { organizationId, id: positionId, data: { departmentId: value === NONE ? null : Number(value) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey(organizationId) });
          toast({ title: 'Position moved' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not move position', description: message, variant: 'destructive' });
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
          title: title.trim(),
          departmentId: departmentId === NONE ? null : Number(departmentId),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey(organizationId) });
          setOpen(false);
          setTitle('');
          setDepartmentId(NONE);
          toast({ title: 'Position created' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not create position',
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
          <h1 className="text-3xl font-bold text-foreground">Positions</h1>
          <p className="text-muted-foreground">Define job titles employees can be assigned to</p>
        </div>
        {isHrCapable && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-position">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Position
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Position</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="position-title">Title</Label>
                  <Input
                    id="position-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    data-testid="input-position-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="position-department">Department (optional)</Label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger id="position-department" data-testid="select-position-department">
                      <SelectValue placeholder="No department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No department</SelectItem>
                      {(departments ?? []).map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-position">
                  {createMutation.isPending ? 'Creating…' : 'Create Position'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading positions">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load positions" message="Could not fetch positions. Try again." onRetry={() => refetch()} />
      ) : !positions || positions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Briefcase className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No positions yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add your first position to start assigning job titles to employees.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Positions">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                {isHrCapable && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={position.id} data-testid={`row-position-${position.id}`}>
                  <TableCell className="font-medium">{position.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <Select
                      value={position.departmentId != null ? String(position.departmentId) : NONE}
                      onValueChange={(v) => handleMoveDepartment(position.id, v)}
                      disabled={!isHrCapable}
                    >
                      <SelectTrigger className="w-40" data-testid={`select-move-department-${position.id}`}>
                        <SelectValue>{position.departmentId ? (departmentNameById.get(position.departmentId) ?? '—') : 'No department'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No department</SelectItem>
                        {(departments ?? []).map((d) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={position.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                      {position.status}
                    </Badge>
                  </TableCell>
                  {isHrCapable && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(position)}
                        data-testid={`button-edit-position-${position.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant={position.status === 'inactive' ? 'default' : 'destructive'}
                        onClick={() => handleToggleStatus(position)}
                        disabled={archiveMutation.isPending || reactivateMutation.isPending}
                        data-testid={`button-toggle-position-status-${position.id}`}
                      >
                        {position.status === 'inactive' ? 'Reactivate' : 'Archive'}
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
              <DialogTitle>Edit Position</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-position-title">Title</Label>
                <Input
                  id="edit-position-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  data-testid="input-edit-position-title"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-position">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
