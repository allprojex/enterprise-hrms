import { useState } from 'react';
import { Scale, MessageSquareWarning, ShieldAlert, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useListDisciplinaryCases,
  getListDisciplinaryCasesQueryKey,
  useListGrievances,
  getListGrievancesQueryKey,
  useGetDisciplinaryReport,
  getGetDisciplinaryReportQueryKey,
  useGetGrievanceReport,
  getGetGrievanceReportQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const DISCIPLINARY_STATUS: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-amber-100 text-amber-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
};

const GRIEVANCE_STATUS: Record<string, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-900' },
  acknowledged: { label: 'Acknowledged', className: 'bg-blue-100 text-blue-900' },
  under_review: { label: 'Under review', className: 'bg-amber-100 text-amber-900' },
  resolved: { label: 'Resolved', className: 'bg-green-100 text-green-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

/**
 * WS-12 — the Employee Relations workspace (§28.3, §28.4, §28.23).
 *
 * THE TWO TABS ARE INDEPENDENTLY PERMISSIONED, and that is the whole design.
 * §28.17 keeps grievance visibility separate from disciplinary visibility —
 * a grievance may be about the very person holding disciplinary authority — so
 * each tab renders only if its own endpoint answers. A 403 hides the tab
 * rather than showing an error, because "you may not see this" is not a fault
 * the user needs to act on.
 *
 * Hiding a tab is NOT the authorization. Every endpoint behind these views
 * enforces its own permission server-side (routes/employeeRelations.ts); this
 * is presentation.
 */
export default function EmployeeRelations() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;
  const [tab, setTab] = useState('disciplinary');

  const disciplinaryQuery = useListDisciplinaryCases(organizationId, undefined, {
    query: { queryKey: getListDisciplinaryCasesQueryKey(organizationId), enabled },
  });
  const grievanceQuery = useListGrievances(organizationId, undefined, {
    query: { queryKey: getListGrievancesQueryKey(organizationId), enabled },
  });
  const disciplinaryReport = useGetDisciplinaryReport(organizationId, {
    query: { queryKey: getGetDisciplinaryReportQueryKey(organizationId), enabled },
  });
  const grievanceReport = useGetGrievanceReport(organizationId, {
    query: { queryKey: getGetGrievanceReportQueryKey(organizationId), enabled },
  });

  const canSeeDisciplinary = !isForbidden(disciplinaryQuery.error);
  const canSeeGrievances = !isForbidden(grievanceQuery.error);

  const ageOf = (id: number, rows?: Array<{ id: number; ageDays: number }>) =>
    rows?.find((r) => r.id === id)?.ageDays;

  return (
    <div className="space-y-6" data-testid="page-employee-relations">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Scale className="h-6 w-6" aria-hidden="true" />
          Employee Relations
        </h1>
        <p className="text-muted-foreground mt-1">
          Structured disciplinary cases and grievances. Recording an outcome here never changes anyone's employment
          status — separation remains a separate authorized act.
        </p>
      </div>

      {!canSeeDisciplinary && !canSeeGrievances ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You do not have access to employee relations records in this organization.
          </CardContent>
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {canSeeDisciplinary && <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>}
            {canSeeGrievances && <TabsTrigger value="grievances">Grievances</TabsTrigger>}
          </TabsList>

          {canSeeDisciplinary && (
            <TabsContent value="disciplinary" className="mt-4">
              <Card data-testid="card-disciplinary-cases">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                    Disciplinary cases
                  </CardTitle>
                  <CardDescription>
                    Structured cases. Historical disciplinary entries recorded before this module existed are preserved
                    unchanged and appear on the employee's own record.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {disciplinaryQuery.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : disciplinaryQuery.error ? (
                    <QueryError onRetry={() => void disciplinaryQuery.refetch()} />
                  ) : (disciplinaryQuery.data ?? []).length === 0 ? (
                    <p className="text-muted-foreground py-6 text-center">No disciplinary cases recorded.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Case</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Stage</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Opened</TableHead>
                          <TableHead>Age</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(disciplinaryQuery.data ?? []).map((c) => {
                          const style = DISCIPLINARY_STATUS[c.status] ?? {
                            label: c.status,
                            className: 'bg-muted',
                          };
                          const age = ageOf(c.id, disciplinaryReport.data?.openCases);
                          return (
                            <TableRow key={c.id} data-testid={`row-disciplinary-${c.id}`}>
                              <TableCell className="font-medium">{c.subject}</TableCell>
                              <TableCell>{c.categoryCode}</TableCell>
                              <TableCell>{c.stageCode ?? '—'}</TableCell>
                              <TableCell>
                                <Badge className={style.className}>{style.label}</Badge>
                              </TableCell>
                              <TableCell>{new Date(c.openedAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                {age === undefined ? (
                                  '—'
                                ) : (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                    {age}d
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {canSeeGrievances && (
            <TabsContent value="grievances" className="mt-4">
              <Card data-testid="card-grievances">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquareWarning className="h-5 w-5" aria-hidden="true" />
                    Grievances
                  </CardTitle>
                  <CardDescription>
                    Raised by employees. Access requires an explicit grievance permission — administrative rank alone
                    does not grant it.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {grievanceQuery.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : grievanceQuery.error ? (
                    <QueryError onRetry={() => void grievanceQuery.refetch()} />
                  ) : (grievanceQuery.data ?? []).length === 0 ? (
                    <p className="text-muted-foreground py-6 text-center">No grievances recorded.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead>Acknowledged</TableHead>
                          <TableHead>Age</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(grievanceQuery.data ?? []).map((g) => {
                          const style = GRIEVANCE_STATUS[g.status] ?? { label: g.status, className: 'bg-muted' };
                          const age = ageOf(g.id, grievanceReport.data?.openGrievances);
                          return (
                            <TableRow key={g.id} data-testid={`row-grievance-${g.id}`}>
                              <TableCell className="font-medium">{g.subject}</TableCell>
                              <TableCell>{g.categoryCode}</TableCell>
                              <TableCell>
                                <Badge className={style.className}>{style.label}</Badge>
                              </TableCell>
                              <TableCell>{new Date(g.submittedAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                {g.acknowledgedAt ? (
                                  new Date(g.acknowledgedAt).toLocaleDateString()
                                ) : (
                                  <Badge className="bg-amber-100 text-amber-900">Awaiting</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {age === undefined ? (
                                  '—'
                                ) : (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                    {age}d
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
