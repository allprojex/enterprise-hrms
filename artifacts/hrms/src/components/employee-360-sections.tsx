import { Link } from 'wouter';
import { AlertTriangle, ExternalLink, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import {
  useGetEmployee360Sections,
  getGetEmployee360SectionsQueryKey,
} from '@workspace/api-client-react';

/**
 * WS-15 P2/P3 — Employee 360 cross-module sections (§31.29).
 *
 * THIS COMPONENT INVENTS NO VISIBILITY. Every section it renders was already
 * permission-filtered by its own module's provider, so there is no client-side
 * gating here and no role heuristic anywhere. A module the caller cannot read
 * simply never arrives — indistinguishably from one that is disabled or one
 * that holds nothing about this employee, which is exactly what makes it safe
 * to render whatever the server sent.
 *
 * A ZERO IS NEVER SHOWN FOR AN ABSENT SECTION. There is no "Grievances: 0" and
 * no placeholder card, because a rendered zero asserts that the module exists
 * and this person has nothing in it — which for a grievance is itself the
 * disclosure §28 exists to prevent.
 *
 * LEGACY ROWS ARE LABELLED, NOT HIDDEN AND NOT PROMOTED (§31.29, §31.37). A
 * superseded record sits beside the current model with a `Legacy` badge and a
 * plain note, because deleting it would erase history somebody may need to
 * explain and silently mixing it in would make old data look authoritative.
 *
 * NOTHING HERE WRITES. Every section ends in a link into the module that owns
 * it, and that module re-gates at the destination.
 */

const PROVENANCE_NOTE = 'Retained history from a superseded model. Not part of the current record.';

export function Employee360Sections({
  organizationId,
  employeeId,
}: {
  organizationId: number;
  employeeId: number;
}) {
  const enabled = organizationId > 0 && employeeId > 0;
  const query = useGetEmployee360Sections(organizationId, employeeId, {
    query: { queryKey: getGetEmployee360SectionsQueryKey(organizationId, employeeId), enabled },
  });

  const sections = query.data?.sections ?? [];
  const unavailable = query.data?.unavailableSections ?? [];

  if (query.isLoading) return <Skeleton className="h-40 w-full" data-testid="skeleton-employee-360" />;
  if (query.error) return <QueryError onRetry={() => void query.refetch()} />;

  // Nothing arrived at all: either this caller may read no module, or none has
  // anything for this employee. The two are deliberately indistinguishable.
  if (sections.length === 0 && unavailable.length === 0) {
    return (
      <Card data-testid="card-employee-360-empty">
        <CardContent className="py-8 text-center text-muted-foreground">
          No additional module records are available for this employee.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="employee-360-sections">
      {unavailable.length > 0 && (
        <Card className="border-amber-300" data-testid="banner-employee-360-unavailable">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Some sections could not be loaded</p>
              <p className="text-sm text-muted-foreground">
                {unavailable.join(', ').replace(/_/g, ' ')} — this view may be incomplete.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.key} data-testid={`card-360-${section.key}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-4 w-4" aria-hidden="true" />
                    {section.title}
                  </CardTitle>
                  {section.note && (
                    <CardDescription data-testid={`note-360-${section.key}`}>{section.note}</CardDescription>
                  )}
                </div>
                <Link href={section.deepLink}>
                  <Button size="sm" variant="ghost" data-testid={`link-360-${section.key}`}>
                    <ExternalLink className="h-4 w-4 mr-1" aria-hidden="true" />
                    Open
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2" data-testid={`stats-360-${section.key}`}>
                {section.stats.map((stat) => (
                  <Badge key={stat.label} variant="secondary">
                    {stat.label}: {stat.value}
                  </Badge>
                ))}
              </div>

              {section.rows.length > 0 && (
                <ul className="space-y-1" data-testid={`rows-360-${section.key}`}>
                  {section.rows.map((row) => (
                    <li
                      key={`${row.provenance}-${row.id}`}
                      className="flex items-center justify-between gap-2 text-sm border-t pt-2 first:border-t-0 first:pt-0"
                      data-testid={`row-360-${section.key}-${row.provenance}-${row.id}`}
                    >
                      <span className="min-w-0 truncate">{row.label}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {row.status && <Badge variant="outline">{row.status.replace(/_/g, ' ')}</Badge>}
                        {row.provenance === 'legacy' && (
                          <Badge
                            className="bg-muted text-muted-foreground"
                            title={PROVENANCE_NOTE}
                            data-testid={`badge-legacy-${section.key}-${row.id}`}
                          >
                            Legacy
                          </Badge>
                        )}
                        {row.occurredAt && (
                          <span className="text-muted-foreground">
                            {new Date(row.occurredAt).toLocaleDateString()}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {section.truncated && (
                <p className="text-xs text-muted-foreground" data-testid={`truncated-360-${section.key}`}>
                  Showing the most recent only — open the module for the full record.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
