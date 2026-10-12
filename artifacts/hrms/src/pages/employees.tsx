import { useState } from 'react';
import { Link } from 'wouter';
import { Users, Plus, Search, ChevronLeft, ChevronRight, IdCard } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListEmployees,
  getListEmployeesQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useSearchPersonnelRecords,
  getSearchPersonnelRecordsQueryKey,
} from '@workspace/api-client-react';
import { useEmployeePhoto } from '@/hooks/use-employee-photo';
import { useEmployeeAccess } from '@/hooks/use-employee-access';
import { QueryError } from '@/components/query-error';
import { StatusBadge } from '@/components/foundation';
import { STATUS_LABEL } from '@/components/employees/employee-form-schema';

function EmployeeRowAvatar({
  organizationId,
  employeeId,
  hasProfilePicture,
  firstName,
  lastName,
}: {
  organizationId: number;
  employeeId: number;
  hasProfilePicture: boolean;
  firstName: string;
  lastName: string;
}) {
  const photoSrc = useEmployeePhoto(organizationId, employeeId, hasProfilePicture);
  return (
    <Avatar className="h-8 w-8">
      {photoSrc && <AvatarImage src={photoSrc} alt="" />}
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
        {firstName[0]}
        {lastName[0]}
      </AvatarFallback>
    </Avatar>
  );
}

const MATCH_TYPE_LABEL: Record<string, string> = {
  name: 'Name',
  employee_number: 'Staff number',
  pif_number: 'PIF number',
};

const PAGE_SIZE = 20;

export default function Employees() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  // Permission keys, not role names: the Register control appears for anyone
  // whose effective permissions include employee.write — the exact key
  // POST /organizations/:id/employees checks — so a tenant's custom HR role
  // is honoured and a renamed template loses nothing (Phase 2).
  const access = useEmployeeAccess(organizationId);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Phase 3H, W118 — Personnel Records Search (frozen plan §10): name plus
  // current AND historical staff numbers plus PIF numbers, deliberately a
  // separate surface from the directory search above (never folded into
  // the broad employee.read-gated listEmployees query) since it's gated by
  // the narrower personnel_file.read. Only fires once HR types into its
  // own input; a 403 (no personnel_file.read) just means this panel never
  // renders for this user — the ordinary directory above is unaffected.
  const [personnelSearch, setPersonnelSearch] = useState('');
  const {
    data: personnelResults,
    error: personnelSearchError,
    isFetching: personnelSearchFetching,
  } = useSearchPersonnelRecords(organizationId, { search: personnelSearch }, {
    query: {
      queryKey: getSearchPersonnelRecordsQueryKey(organizationId, { search: personnelSearch }),
      enabled: organizationId > 0 && personnelSearch.trim().length > 0,
      retry: false,
    },
  });
  const personnelSearchForbidden =
    personnelSearchError && typeof personnelSearchError === 'object' && 'status' in personnelSearchError
      ? (personnelSearchError as { status: number }).status === 403
      : false;

  const params = { search: search || undefined, page, pageSize: PAGE_SIZE };
  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListEmployees(organizationId, params, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground">The employee directory for your organisation</p>
        </div>
        {access.canWrite && (
          // Registration is a full, sectioned page (Phase 2) rather than a
          // dialog: the record has some thirty fields, and the page explains
          // that no login account is created.
          <Button asChild>
            <Link href="/employees/new" data-testid="button-add-employee">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Register employee
            </Link>
          </Button>
        )}
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

      {!personnelSearchForbidden && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Personnel Records Search</p>
              <p className="text-xs text-muted-foreground">
                Search by name, PIF number, or a staff number — current or historical. A reused staff number shows every holder, clearly labeled.
              </p>
            </div>
            <div className="relative max-w-sm">
              <IdCard className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder="Search personnel records…"
                className="pl-9"
                value={personnelSearch}
                onChange={(e) => setPersonnelSearch(e.target.value)}
                data-testid="input-personnel-search"
                aria-label="Search personnel records"
              />
            </div>
            {personnelSearch.trim() && (
              personnelSearchFetching ? (
                <p className="text-sm text-muted-foreground">Searching…</p>
              ) : !personnelResults || personnelResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No personnel records match.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-personnel-search-results">
                  {personnelResults.map((r, i) => (
                    <li
                      key={`${r.employeeId}-${r.matchType}-${r.matchedValue}-${i}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      data-testid={`row-personnel-result-${r.employeeId}-${r.matchType}`}
                    >
                      <Link
                        href={`/employees/${r.employeeId}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {r.firstName} {r.lastName}
                      </Link>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{MATCH_TYPE_LABEL[r.matchType] ?? r.matchType}</Badge>
                        <span className="font-mono text-muted-foreground">{r.matchedValue}</span>
                        {r.matchType === 'employee_number' && (
                          <Badge variant={r.isCurrentHolder ? 'secondary' : 'outline'} className={r.isCurrentHolder ? 'bg-chart-3/10 text-chart-3' : ''}>
                            {r.isCurrentHolder ? 'Current holder' : 'Historical holder'}
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </CardContent>
        </Card>
      )}

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
              {search ? 'Try a different search term.' : 'Register your first employee to start building the directory.'}
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
                        <EmployeeRowAvatar
                          organizationId={organizationId}
                          employeeId={employee.id}
                          hasProfilePicture={employee.hasProfilePicture ?? false}
                          firstName={employee.firstName}
                          lastName={employee.lastName}
                        />
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
                      <StatusBadge
                        status={employee.employmentStatus}
                        label={STATUS_LABEL[employee.employmentStatus] ?? employee.employmentStatus}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
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
