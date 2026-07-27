import { useState } from 'react';
import { Building2, Plus, Pencil } from 'lucide-react';
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
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListBranches,
  getListBranchesQueryKey,
  useCreateBranch,
  useUpdateBranch,
  useArchiveBranch,
  useReactivateBranch,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

export default function Branches() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: branches,
    isLoading,
    error,
    refetch,
  } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const createMutation = useCreateBranch();
  const updateMutation = useUpdateBranch();
  const archiveMutation = useArchiveBranch();
  const reactivateMutation = useReactivateBranch();

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');

  const openEdit = (branch: { id: number; name: string; code: string }) => {
    setEditId(branch.id);
    setEditName(branch.name);
    setEditCode(branch.code);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editId == null) return;
    updateMutation.mutate(
      { organizationId, id: editId, data: { name: editName.trim(), code: editCode.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBranchesQueryKey(organizationId) });
          setEditId(null);
          toast({ title: 'Branch updated' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update branch', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleToggleStatus = (branch: { id: number; status: string }) => {
    const mutation = branch.status === 'inactive' ? reactivateMutation : archiveMutation;
    mutation.mutate(
      { organizationId, id: branch.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListBranchesQueryKey(organizationId) });
          toast({ title: branch.status === 'inactive' ? 'Branch reactivated' : 'Branch archived' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update branch status', description: message, variant: 'destructive' });
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
          queryClient.invalidateQueries({ queryKey: getListBranchesQueryKey(organizationId) });
          setOpen(false);
          setName('');
          setCode('');
          toast({ title: 'Branch created' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not create branch',
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
          <h1 className="text-3xl font-bold text-foreground">Branches</h1>
          <p className="text-muted-foreground">Manage your organisation's physical or regional locations</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-branch">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Branch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Branch</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="branch-name">Name</Label>
                  <Input
                    id="branch-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    data-testid="input-branch-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch-code">Code</Label>
                  <Input
                    id="branch-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    data-testid="input-branch-code"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-branch">
                  {createMutation.isPending ? 'Creating…' : 'Create Branch'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading branches">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load branches" message="Could not fetch branches. Try again." onRetry={() => refetch()} />
      ) : !branches || branches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Building2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No branches yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add your first branch to start organising employees by location.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Branches">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((branch) => (
                <TableRow key={branch.id} data-testid={`row-branch-${branch.id}`}>
                  <TableCell className="font-medium">{branch.name}</TableCell>
                  <TableCell className="font-mono text-sm">{branch.code}</TableCell>
                  <TableCell>
                    <Badge variant={branch.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                      {branch.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(branch)}
                        data-testid={`button-edit-branch-${branch.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant={branch.status === 'inactive' ? 'default' : 'destructive'}
                        onClick={() => handleToggleStatus(branch)}
                        disabled={archiveMutation.isPending || reactivateMutation.isPending}
                        data-testid={`button-toggle-branch-status-${branch.id}`}
                      >
                        {branch.status === 'inactive' ? 'Reactivate' : 'Archive'}
                      </Button>
                    </div>
                  </TableCell>
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
              <DialogTitle>Edit Branch</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-branch-name">Name</Label>
                <Input
                  id="edit-branch-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  data-testid="input-edit-branch-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-branch-code">Code</Label>
                <Input
                  id="edit-branch-code"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  required
                  data-testid="input-edit-branch-code"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-branch">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
