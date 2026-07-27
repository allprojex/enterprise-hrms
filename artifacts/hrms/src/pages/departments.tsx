import { useState } from 'react';
import { Network, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
  useListDepartments,
  getListDepartmentsQueryKey,
  useCreateDepartment,
  useRestructureDepartment,
  useListBranches,
  getListBranchesQueryKey,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

const NONE = '__none__';

export default function Departments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

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

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
