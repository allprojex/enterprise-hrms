import { ShieldAlert, DoorOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useListDisciplinaryCases,
  getListDisciplinaryCasesQueryKey,
  useListOffboarding,
  getListOffboardingQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const CASE_STATUS: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-amber-100 text-amber-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
};

const EXIT_STATUS: Record<string, { label: string; className: string }> = {
  legacy: { label: 'Legacy record', className: 'bg-muted text-muted-foreground' },
  initiated: { label: 'Initiated', className: 'bg-blue-100 text-blue-900' },
  clearance_in_progress: { label: 'Clearance in progress', className: 'bg-amber-100 text-amber-900' },
  ready_for_separation: { label: 'Cleared — ready', className: 'bg-green-100 text-green-900' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-900' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

/**
 * WS-12 — structured Employee Relations on the employee record (§28.2, §28.6).
 *
 * THIS PANEL SITS BESIDE THE LEGACY DISCIPLINARY PANEL, IT DOES NOT REPLACE IT.
 * §28.2 preserves `employee_disciplinary_records` as immutable history read
 * through its own older permission, so this page now shows both: the historical
 * log exactly as it was recorded, and the structured cases opened since. Merging
 * them into one list would imply the old entries have stages, findings and
 * outcomes they never had.
 *
 * The offboarding row deliberately says "Cleared — ready" rather than anything
 * resembling "separated": clearance finishing is not employment ending (§28.7).
 */
export function EmployeeRelationsPanel({
  organizationId,
  employeeId,
}: {
  organizationId: number;
  employeeId: number;
}) {
  const enabled = organizationId > 0 && employeeId > 0;

  const cases = useListDisciplinaryCases(
    organizationId,
    { employeeId },
    { query: { queryKey: getListDisciplinaryCasesQueryKey(organizationId, { employeeId }), enabled } },
  );
  const offboarding = useListOffboarding(
    organizationId,
    { employeeId },
    { query: { queryKey: getListOffboardingQueryKey(organizationId, { employeeId }), enabled } },
  );

  const canSeeCases = !isForbidden(cases.error);
  const canSeeOffboarding = !isForbidden(offboarding.error);

  // An HR user without either permission simply does not see this panel — not
  // an error state, and not a hint that anything exists.
  if (!canSeeCases && !canSeeOffboarding) return null;

  return (
    <Card className="lg:col-span-3" data-testid="card-employee-relations">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          Employee Relations
        </CardTitle>
        <CardDescription>
          Structured disciplinary cases and offboarding status. Historical disciplinary entries recorded before this
          module existed are shown separately and unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canSeeCases && (
          <div>
            <p className="text-sm font-medium mb-2">Disciplinary cases</p>
            {cases.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (cases.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No structured disciplinary cases.</p>
            ) : (
              <ul className="space-y-2">
                {(cases.data ?? []).map((c) => {
                  const style = CASE_STATUS[c.status] ?? { label: c.status, className: 'bg-muted' };
                  return (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-3 border-l-2 pl-3 text-sm"
                      data-testid={`row-employee-case-${c.id}`}
                    >
                      <div>
                        <span className="font-medium">{c.subject}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {c.categoryCode} · opened {new Date(c.openedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <Badge className={style.className}>{style.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {canSeeOffboarding && (
          <div>
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <DoorOpen className="h-4 w-4" aria-hidden="true" />
              Offboarding
            </p>
            {offboarding.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : (offboarding.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No offboarding recorded.</p>
            ) : (
              <ul className="space-y-2">
                {(offboarding.data ?? []).map((o) => {
                  const style = EXIT_STATUS[o.status] ?? { label: o.status, className: 'bg-muted' };
                  return (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-3 border-l-2 pl-3 text-sm"
                      data-testid={`row-employee-offboarding-${o.id}`}
                    >
                      <div>
                        <span className="font-medium">
                          {o.separationDate
                            ? `Separated ${new Date(o.separationDate).toLocaleDateString()}`
                            : o.expectedSeparationDate
                              ? `Expected ${new Date(o.expectedSeparationDate).toLocaleDateString()}`
                              : 'Offboarding'}
                        </span>
                        {!o.separationDate && (
                          <span className="text-muted-foreground"> · still employed</span>
                        )}
                      </div>
                      <Badge className={style.className}>{style.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
