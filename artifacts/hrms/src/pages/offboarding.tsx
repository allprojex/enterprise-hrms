import { DoorOpen, Package, Boxes, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetOffboardingReport,
  getGetOffboardingReportQueryKey,
  useGetClearanceQueue,
  getGetClearanceQueueQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const EXIT_STATUS: Record<string, { label: string; className: string }> = {
  legacy: { label: 'Legacy record', className: 'bg-muted text-muted-foreground' },
  initiated: { label: 'Initiated', className: 'bg-blue-100 text-blue-900' },
  clearance_in_progress: { label: 'Clearance in progress', className: 'bg-amber-100 text-amber-900' },
  ready_for_separation: { label: 'Cleared — ready', className: 'bg-green-100 text-green-900' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-900' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

const ITEM_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-900' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-900' },
  returned: { label: 'Returned', className: 'bg-red-100 text-red-900' },
  waived: { label: 'Waived', className: 'bg-blue-100 text-blue-900' },
};

/**
 * WS-12 — the Offboarding and clearance workspace (§28.6–28.10, §28.23).
 *
 * TWO THINGS THIS PAGE IS CAREFUL TO SAY PLAINLY.
 *
 * "Cleared — ready" means clearance is finished, NOT that anybody has left.
 * §28.7 freezes that completing offboarding never terminates employment, and a
 * UI that implied otherwise would undo the guarantee the service layer holds.
 *
 * Outstanding assets and inventory are shown as INFORMATION read from the
 * Assets and Office Inventory modules. Nothing on this page returns an asset or
 * moves stock — those actions happen in the modules that own them (§28.9,
 * §28.10), and only returnable inventory is ever counted.
 */
export default function Offboarding() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const report = useGetOffboardingReport(organizationId, {
    query: { queryKey: getGetOffboardingReportQueryKey(organizationId), enabled },
  });
  const queue = useGetClearanceQueue(organizationId, undefined, {
    query: { queryKey: getGetClearanceQueueQueryKey(organizationId), enabled },
  });

  if (isForbidden(report.error) && isForbidden(queue.error)) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          You do not have access to offboarding in this organization.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-offboarding">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <DoorOpen className="h-6 w-6" aria-hidden="true" />
          Offboarding &amp; Clearance
        </h1>
        <p className="text-muted-foreground mt-1">
          Clearance progress for departing employees. Completing clearance records that obligations are discharged; it
          does not end anyone's employment.
        </p>
      </div>

      {!isForbidden(report.error) && (
        <Card data-testid="card-offboarding-in-progress">
          <CardHeader>
            <CardTitle>Currently offboarding</CardTitle>
            <CardDescription>
              Outstanding assets are read from the Assets module. Return them there — ticking a clearance item does not
              return anything.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : report.error ? (
              <QueryError onRetry={() => void report.refetch()} />
            ) : (report.data?.inProgress ?? []).length === 0 ? (
              <p className="text-muted-foreground py-6 text-center">Nobody is currently offboarding.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expected separation</TableHead>
                    <TableHead>Actual separation</TableHead>
                    <TableHead>Required outstanding</TableHead>
                    <TableHead>Assets held</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report.data?.inProgress ?? []).map((row) => {
                    const style = EXIT_STATUS[row.status] ?? { label: row.status, className: 'bg-muted' };
                    return (
                      <TableRow key={row.exitProcessId} data-testid={`row-offboarding-${row.exitProcessId}`}>
                        <TableCell className="font-medium">#{row.employeeId}</TableCell>
                        <TableCell>
                          <Badge className={style.className}>{style.label}</Badge>
                        </TableCell>
                        <TableCell>
                          {row.expectedSeparationDate
                            ? new Date(row.expectedSeparationDate).toLocaleDateString()
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {row.separationDate ? (
                            new Date(row.separationDate).toLocaleDateString()
                          ) : (
                            <span className="text-muted-foreground">Still employed</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.requiredOutstanding > 0 ? (
                            <span className="flex items-center gap-1 text-amber-900">
                              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                              {row.requiredOutstanding}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-green-900">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />0
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.outstandingAssets > 0 ? (
                            <span className="flex items-center gap-1">
                              <Package className="h-3.5 w-3.5" aria-hidden="true" />
                              {row.outstandingAssets}
                            </span>
                          ) : (
                            '—'
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
      )}

      {!isForbidden(queue.error) && (
        <Card data-testid="card-clearance-queue">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5" aria-hidden="true" />
              Clearance queue
            </CardTitle>
            <CardDescription>
              Items awaiting action across every running offboarding. Only returnable inventory appears here;
              consumables are never clearance obligations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {queue.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : queue.error ? (
              <QueryError onRetry={() => void queue.refetch()} />
            ) : (queue.data?.outstanding ?? []).length === 0 ? (
              <p className="text-muted-foreground py-6 text-center">Nothing is awaiting clearance.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(queue.data?.outstanding ?? []).map((item) => {
                    const style = ITEM_STATUS[item.status] ?? { label: item.status, className: 'bg-muted' };
                    return (
                      <TableRow key={item.clearanceItemId} data-testid={`row-clearance-${item.clearanceItemId}`}>
                        <TableCell className="font-medium">{item.label}</TableCell>
                        <TableCell className="text-muted-foreground">{item.itemType.replace(/_/g, ' ')}</TableCell>
                        <TableCell>#{item.employeeId}</TableCell>
                        <TableCell>{item.required ? 'Required' : 'Optional'}</TableCell>
                        <TableCell>
                          <Badge className={style.className}>{style.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
