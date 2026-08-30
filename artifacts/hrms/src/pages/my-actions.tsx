import { Link } from 'wouter';
import { CheckSquare, ExternalLink, Inbox } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyActionCentre,
  getListMyActionCentreQueryKey,
} from '@workspace/api-client-react';

const KIND_LABEL: Record<string, string> = {
  onboarding_task: 'Onboarding task',
  document_acknowledgement: 'To acknowledge',
  service_request: 'HR request',
};

/**
 * WS-15 — ESS My Actions (§31.34 row 13, §31.13).
 *
 * THREE SOURCES, AND THE NARROWNESS IS THE POINT. Only work the employee is
 * genuinely being asked to do appears: an onboarding task assigned to them, a
 * document awaiting their acknowledgement, and a request the organization has
 * put back to them. Leave history, learning progress, a skill claim waiting on
 * HR, Payroll, grievances and succession are deliberately absent — a to-do list
 * nobody can empty is not a to-do list.
 *
 * THE PAGE SENDS NO EMPLOYEE IDENTIFIER. The server resolves the subject from
 * the caller's own employee link on every request, so nothing here can be
 * pointed at somebody else's work.
 *
 * ACTIONS HAPPEN WHERE THEY BELONG. Each row deep-links to the surface that
 * already knows how to complete it — My Onboarding for a task or an
 * acknowledgement, My Requests for a request — rather than this page acquiring
 * its own copies of those flows.
 */
export default function MyActions() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const actions = useListMyActionCentre(organizationId, {
    query: { queryKey: getListMyActionCentreQueryKey(organizationId), enabled },
  });

  const items = actions.data?.items ?? [];

  return (
    <div className="space-y-6" data-testid="page-my-actions">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <CheckSquare className="h-6 w-6" aria-hidden="true" />
          My Actions
        </h1>
        <p className="text-muted-foreground mt-1">Things waiting on you. Everything else is being handled for you.</p>
      </div>

      {actions.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : actions.error ? (
        <QueryError onRetry={() => void actions.refetch()} />
      ) : !actions.data?.linked ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-not-linked">
            Your account is not linked to an employee record yet, so there is nothing to show.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-my-actions">
            <Inbox className="h-8 w-8 mx-auto mb-3 opacity-50" aria-hidden="true" />
            Nothing is waiting on you.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="list-my-actions">
          {items.map((item) => {
            const key = `${item.sourceType}-${item.sourceId}`;
            return (
              <Card key={key} data-testid={`row-my-action-${key}`}>
                <CardContent className="py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{item.title}</span>
                      <Badge variant="outline">{KIND_LABEL[item.sourceType] ?? item.sourceType}</Badge>
                      {item.overdue === true && (
                        <Badge className="bg-red-100 text-red-900" data-testid={`badge-overdue-${key}`}>
                          Overdue
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {item.dueAt ? `Due ${new Date(item.dueAt).toLocaleDateString()}` : 'No due date'}
                    </p>
                  </div>
                  <Link href={item.deepLink}>
                    <Button size="sm" data-testid={`link-open-${key}`}>
                      <ExternalLink className="h-4 w-4 mr-1" aria-hidden="true" />
                      Open
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
