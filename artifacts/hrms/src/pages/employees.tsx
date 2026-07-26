import { useState } from 'react';
import { Link } from 'wouter';
import { Users, Plus, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  useListEmployees,
  getListEmployeesQueryKey,
  useCreateEmployee,
  useListDepartments,
  getListDepartmentsQueryKey,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

const NONE = '__none__';
const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-chart-3/10 text-chart-3',
  probation: 'bg-accent/10 text-accent',
  on_leave: 'bg-muted text-muted-foreground',
  suspended: 'bg-destructive/10 text-destructive',
  terminated: 'bg-destructive/10 text-destructive',
};

export default function Employees() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = { search: search || undefined, page, pageSize: PAGE_SIZE };
  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListEmployees(organizationId, params, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [departmentId, setDepartmentId] = useState(NONE);

  const createMutation = useCreateEmployee();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organizationId,
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          workEmail: workEmail.trim() || null,
          departmentId: departmentId === NONE ? null : Number(departmentId),
        },
      },
      {
        onSuccess: () => {
          // Invalidating by a params-less query key doesn't reliably match
          // the active list query (its key includes search/page/pageSize) —
          // refetch the query we actually have in hand instead.
          refetch();
          setOpen(false);
          setFirstName('');
          setLastName('');
          setWorkEmail('');
          setDepartmentId(NONE);
          toast({ title: 'Employee added' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not add employee',
            description: message ?? 'Please check the details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground">The employee directory for your organisation</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-employee">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Employee</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="employee-first-name">First name</Label>
                    <Input
                      id="employee-first-name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      data-testid="input-employee-first-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-last-name">Last name</Label>
                    <Input
                      id="employee-last-name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      data-testid="input-employee-last-name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employee-work-email">Work email</Label>
                  <Input
                    id="employee-work-email"
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value)}
                    data-testid="input-employee-work-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employee-department">Department (optional)</Label>
                  <Select value={departmentId} onValueChange={setDepartmentId}>
                    <SelectTrigger id="employee-department" data-testid="select-employee-department">
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
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-employee">
                  {createMutation.isPending ? 'Adding…' : 'Add Employee'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          placeholder="Search employees…"
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          data-testid="input-employee-search"
          aria-label="Search employees"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading employees">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load employees" message="Could not fetch employees. Try again." onRetry={() => refetch()} />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {search ? 'No employees match your search' : 'No employees yet'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {search ? 'Try a different search term.' : 'Add your first employee to start building the directory.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <Table aria-label="Employees">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Employee #</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((employee) => (
                  <TableRow key={employee.id} data-testid={`row-employee-${employee.id}`}>
                    <TableCell>
                      <Link
                        href={`/employees/${employee.id}`}
                        className="flex items-center gap-3 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        data-testid={`link-employee-${employee.id}`}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                            {employee.firstName[0]}
                            {employee.lastName[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">
                          {employee.firstName} {employee.lastName}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {employee.employeeNumber ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{employee.departmentName ?? '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`capitalize ${STATUS_COLOR[employee.employmentStatus] ?? ''}`}
                      >
                        {employee.employmentStatus.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({total} employees)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  data-testid="button-next-page"
                >
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
