import { Briefcase, CalendarClock, AlertTriangle, Plane, ShieldQuestion } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { QueryError } from '@/components/query-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetEmploymentLifecycle, getGetEmploymentLifecycleQueryKey } from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const EXPIRY_STYLES: Record<string, { label: string; className: string }> = {
  current: { label: 'Current', className: 'bg-green-100 text-green-900' },
  expiring_soon: { label: 'Ending soon', className: 'bg-amber-100 text-amber-900' },
  expired: { label: 'Past end date', className: 'bg-amber-100 text-amber-900' },
  not_applicable: { label: 'Permanent', className: 'bg-muted' },
};

/**
 * WS-11 — the employee's current lifecycle state.
 *
 * Substantive Position and Acting As are shown as SEPARATE facts, because they
 * are separate facts: an acting appointment never replaces the substantive one
 * (§27.12). Presenting only one of them would recreate in the UI exactly the
 * confusion the data model was designed to avoid.
 *
 * A contract past its end date is shown as information, never as a status
 * change — the employee remains employed until an authorized action says
 * otherwise (§27.6), and the wording here says so plainly.
 */
export function EmploymentLifecyclePanel({
  organizationId,
  employeeId,
}: {
  organizationId: number;
  employeeId: number;
}) {
  const enabled = organizationId > 0 && employeeId > 0;
  const query = useGetEmploymentLifecycle(organizationId, employeeId, {
    query: { queryKey: getGetEmploymentLifecycleQueryKey(organizationId, employeeId), enabled },
  });

  // Not an error state: an HR user without the lifecycle permission simply does
  // not see this panel.
  if (isForbidden(query.error)) return null;

  return (
    <Card className="lg:col-span-3" data-testid="card-employment-lifecycle">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5" aria-hidden="true" />
          Employment Lifecycle
        </CardTitle>
        <CardDescription>
          Current contract term, probation, acting appointment and secondment. Temporary assignments never change the substantive
          position.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-2" data-testid="loading-employment-lifecycle">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.error ? (
          <QueryError
            title="Failed to load employment lifecycle"
            message="Could not fetch this employee's lifecycle state."
            onRetry={() => query.refetch()}
          />
        ) : !query.data ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Substantive Position</p>
              <p className="mt-1 font-medium" data-testid="text-substantive-position">
                {query.data.substantivePositionTitle ?? '—'}
              </p>
            </div>

            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Acting As</p>
              {query.data.currentActingAssignment ? (
                <div className="mt-1" data-testid="text-acting-as">
                  <p className="font-medium">{query.data.currentActingAssignment.actingPositionTitle ?? 'Acting appointment'}</p>
                  <p className="text-xs text-muted-foreground">
                    From {new Date(query.data.currentActingAssignment.startDate).toLocaleDateString()}
                    {query.data.currentActingAssignment.expectedEndDate &&
                      ` · expected to ${new Date(query.data.currentActingAssignment.expectedEndDate).toLocaleDateString()}`}
                  </p>
                  {query.data.currentActingAssignment.overdue && (
                    <Badge variant="secondary" className="mt-1 gap-1 bg-amber-100 text-amber-900">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      Past expected end
                    </Badge>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Not currently acting</p>
              )}
            </div>

            <div className="rounded-md border p-3">
              <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="h-3 w-3" aria-hidden="true" />
                Contract Term
              </p>
              {query.data.currentTerm ? (
                <div className="mt-1" data-testid="text-current-term">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium capitalize">{query.data.currentTerm.termType.replace('_', ' ')}</span>
                    {query.data.currentTerm.expiryState && (
                      <Badge
                        variant="secondary"
                        className={EXPIRY_STYLES[query.data.currentTerm.expiryState]?.className ?? 'bg-muted'}
                      >
                        {EXPIRY_STYLES[query.data.currentTerm.expiryState]?.label ?? query.data.currentTerm.expiryState}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    From {new Date(query.data.currentTerm.startDate).toLocaleDateString()}
                    {query.data.currentTerm.endDate && ` to ${new Date(query.data.currentTerm.endDate).toLocaleDateString()}`}
                  </p>
                  {query.data.currentTerm.expiryState === 'expired' && (
                    <p className="mt-1 text-xs text-amber-900">
                      This contract has passed its end date. Employment is unchanged until an authorized action is recorded.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No contract term recorded</p>
              )}
            </div>

            <div className="rounded-md border p-3">
              <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
                <Plane className="h-3 w-3" aria-hidden="true" />
                Secondment
              </p>
              {query.data.currentSecondment ? (
                <div className="mt-1" data-testid="text-current-secondment">
                  <p className="font-medium">{query.data.currentSecondment.destinationDescription}</p>
                  <p className="text-xs text-muted-foreground">
                    From {new Date(query.data.currentSecondment.startDate).toLocaleDateString()}
                    {query.data.currentSecondment.destinationType && ` · ${query.data.currentSecondment.destinationType}`}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Not currently seconded</p>
              )}
            </div>

            {query.data.probation.onProbation && (
              <div className="rounded-md border p-3 sm:col-span-2" data-testid="text-probation-state">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Probation</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm">
                    {query.data.probation.probationEndDate
                      ? `Expected to end ${new Date(query.data.probation.probationEndDate).toLocaleDateString()}`
                      : 'No expected end recorded'}
                  </span>
                  {query.data.probation.extensionCount > 0 && (
                    <Badge variant="secondary">
                      Extended {query.data.probation.extensionCount}×
                    </Badge>
                  )}
                  {query.data.probation.unsuccessfulOutcomeRecorded && (
                    <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
                      <ShieldQuestion className="h-3 w-3" aria-hidden="true" />
                      Unsuccessful outcome recorded
                    </Badge>
                  )}
                </div>
                {query.data.probation.unsuccessfulOutcomeRecorded && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Recording the outcome does not end employment. Any employment decision is a separate authorized action.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
