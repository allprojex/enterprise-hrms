import { useState } from 'react';
import { Link } from 'wouter';
import { LayoutList, AlertTriangle, ExternalLink, Inbox, ShieldCheck, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListActionCentre,
  getListActionCentreQueryKey,
  useGetActionCentreCounts,
  getGetActionCentreCountsQueryKey,
  useExecuteActionCentreCommand,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const MODULE_LABEL: Record<string, string> = {
  leave: 'Leave',
  learning: 'Learning',
  onboarding: 'Onboarding',
  skills: 'Skills',
  performance: 'Performance',
  recruitment: 'Recruitment',
  employee_requests: 'Requests',
  employee_relations: 'Employee Relations',
  succession: 'Succession',
  employment_lifecycle: 'Employment Lifecycle',
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

type Scope = 'my_actions' | 'assigned' | 'oversight';

/**
 * WS-15 — the HR Action Centre (§31.34 rows 1–12 and 14).
 *
 * THIS PAGE SHOWS WHAT THE SERVER RETURNED AND NOTHING MORE. Every row was
 * already permission-filtered by its own source provider, so there is no
 * client-side visibility logic here and no role heuristic anywhere — a module
 * the caller cannot read simply never appears, indistinguishably from one that
 * is disabled (§31.19). `useIsHrCapable` is deliberately not used: it is a
 * role-name heuristic and can never be authority (§31.7).
 *
 * A ZERO AND AN ABSENCE ARE DIFFERENT THINGS, AND THE UI KEEPS THEM DIFFERENT.
 * A module with a count of 0 answered and had nothing to do. A module that is
 * simply missing from `byModule` was never shown to this caller at all. The
 * page renders the first and says nothing about the second, because a rendered
 * zero would assert that the module exists.
 *
 * AN INCOMPLETE QUEUE SAYS SO (§31.22). When a source the caller IS authorized
 * for could not be loaded, the banner names it and warns that the list may be
 * incomplete — never a silent under-report, and never a stack trace.
 *
 * THE FOUR INLINE ACTIONS CALL THE OWNING MODULE (§31.8). Everything else deep-
 * links, because the decision belongs where the context is.
 */
export default function ActionCentre() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [scope, setScope] = useState<Scope>('my_actions');
  const [sourceModule, setSourceModule] = useState('');
  const [dueState, setDueState] = useState('');
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const params = {
    scope,
    ...(sourceModule ? { sourceModule: sourceModule as 'leave' } : {}),
    ...(dueState ? { dueState: dueState as 'overdue' } : {}),
  };

  const queue = useListActionCentre(organizationId, params, {
    query: { queryKey: getListActionCentreQueryKey(organizationId, params), enabled },
  });
  const counts = useGetActionCentreCounts(organizationId, params, {
    query: { queryKey: getGetActionCentreCountsQueryKey(organizationId, params), enabled },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListActionCentreQueryKey(organizationId, params) });
    void queryClient.invalidateQueries({ queryKey: getGetActionCentreCountsQueryKey(organizationId, params) });
  };

  const execute = useExecuteActionCentreCommand({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Done', description: 'The owning module has been updated.' });
        setRejectFor(null);
        setReason('');
        refresh();
      },
      onError: (err: unknown) =>
        toast({
          title: 'Could not complete',
          // The source's own message, never an internal detail (§31.22).
          description: errorMessage(err, 'The owning module refused this action.'),
          variant: 'destructive',
        }),
    },
  });

  const run = (command: string, sourceId: number, extra: Record<string, unknown> = {}) =>
    execute.mutate({ organizationId, command: command as 'leave.approve', data: { sourceId, ...extra } });

  const items = queue.data?.items ?? [];
  const unavailable = queue.data?.unavailableSources ?? [];

  return (
    <div className="space-y-6" data-testid="page-action-centre">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <LayoutList className="h-6 w-6" aria-hidden="true" />
          Action Centre
        </h1>
        <p className="text-muted-foreground mt-1">
          Work waiting on you across every module. Each item stays owned by the module it came from.
        </p>
      </div>

      {unavailable.length > 0 && (
        <Card className="border-amber-300" data-testid="banner-unavailable-sources">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">This list may be incomplete</p>
              <p className="text-sm text-muted-foreground">
                Work could not be loaded from: {unavailable.map((m) => MODULE_LABEL[m] ?? m).join(', ')}. Everything
                else below is current.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={scope} onValueChange={(v) => setScope(v as Scope)}>
        <TabsList>
          <TabsTrigger value="my_actions" data-testid="tab-my-actions">
            My Actions
          </TabsTrigger>
          <TabsTrigger value="assigned" data-testid="tab-assigned">
            Assigned to me
          </TabsTrigger>
          <TabsTrigger value="oversight" data-testid="tab-oversight">
            HR Oversight
          </TabsTrigger>
        </TabsList>

        <TabsContent value={scope} className="mt-4 space-y-4">
          <Card data-testid="card-counts">
            <CardHeader>
              <CardTitle className="text-base">
                {counts.data?.total ?? 0} item{(counts.data?.total ?? 0) === 1 ? '' : 's'}
                {(counts.data?.overdue ?? 0) > 0 && (
                  <Badge className="ml-2 bg-red-100 text-red-900" data-testid="badge-overdue-count">
                    {counts.data?.overdue} overdue
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {scope === 'oversight'
                    ? 'Organization-wide visibility. This view grants no extra access — you see only what each module already permits you to read.'
                    : scope === 'assigned'
                      ? 'Items explicitly assigned to you. Approvals that come from a role or relationship appear under My Actions instead.'
                      : 'Items you can currently act on. Authority is re-checked from the owning module every time.'}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2" data-testid="list-module-counts">
              {(counts.data?.byModule ?? []).map((m) => (
                <Badge key={m.sourceModule} variant="secondary" data-testid={`count-${m.sourceModule}`}>
                  {MODULE_LABEL[m.sourceModule] ?? m.sourceModule}: {m.count}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ac-module">Module</Label>
                <select
                  id="ac-module"
                  className={SELECT_CLASS}
                  value={sourceModule}
                  onChange={(e) => setSourceModule(e.target.value)}
                  data-testid="select-module-filter"
                >
                  <option value="">All modules</option>
                  {/* Only modules the server actually returned — never a
                      hardcoded list, which would disclose what exists. */}
                  {(counts.data?.byModule ?? []).map((m) => (
                    <option key={m.sourceModule} value={m.sourceModule}>
                      {MODULE_LABEL[m.sourceModule] ?? m.sourceModule}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-due">Due</Label>
                <select
                  id="ac-due"
                  className={SELECT_CLASS}
                  value={dueState}
                  onChange={(e) => setDueState(e.target.value)}
                  data-testid="select-due-filter"
                >
                  <option value="">Any</option>
                  <option value="overdue">Overdue</option>
                  <option value="due_soon">Due soon</option>
                  <option value="undated">No due date</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {queue.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : queue.error ? (
            <QueryError onRetry={() => void queue.refetch()} />
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-no-actions">
                <Inbox className="h-8 w-8 mx-auto mb-3 opacity-50" aria-hidden="true" />
                Nothing is waiting on you here.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="list-actions">
              {items.map((item) => {
                const key = `${item.sourceType}-${item.sourceId}`;
                const canApproveLeave = item.inlineCommands.includes('leave.approve');
                const canApproveLearning = item.inlineCommands.includes('learning.approve');
                const canComplete = item.inlineCommands.includes('onboarding.complete');
                const canVerify = item.inlineCommands.includes('skill.verify');
                return (
                  <Card key={key} data-testid={`row-action-${key}`}>
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{item.title}</span>
                            <Badge variant="outline">{MODULE_LABEL[item.sourceModule] ?? item.sourceModule}</Badge>
                            <Badge variant="secondary">{item.status.replace(/_/g, ' ')}</Badge>
                            {item.overdue === true && (
                              <Badge className="bg-red-100 text-red-900" data-testid={`badge-overdue-${key}`}>
                                Overdue
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {item.employeeFirstName || item.employeeLastName
                              ? `${item.employeeFirstName ?? ''} ${item.employeeLastName ?? ''}`.trim()
                              : 'No named subject'}
                            {item.dueAt
                              ? ` · Due ${new Date(item.dueAt).toLocaleDateString()}`
                              : ' · No due date'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                          {canApproveLeave && (
                            <>
                              <Button
                                size="sm"
                                disabled={execute.isPending}
                                onClick={() => run('leave.approve', item.sourceId)}
                                data-testid={`button-approve-${key}`}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRejectFor(rejectFor === key ? null : key)}
                                data-testid={`button-reject-${key}`}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {canApproveLearning && (
                            <>
                              <Button
                                size="sm"
                                disabled={execute.isPending}
                                onClick={() => run('learning.approve', item.sourceId)}
                                data-testid={`button-approve-${key}`}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={execute.isPending}
                                onClick={() => run('learning.reject', item.sourceId)}
                                data-testid={`button-reject-${key}`}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {canComplete && (
                            <Button
                              size="sm"
                              disabled={execute.isPending}
                              onClick={() => run('onboarding.complete', item.sourceId)}
                              data-testid={`button-complete-${key}`}
                            >
                              Mark complete
                            </Button>
                          )}
                          {canVerify && (
                            <>
                              <Button
                                size="sm"
                                disabled={execute.isPending}
                                onClick={() => run('skill.verify', item.sourceId)}
                                data-testid={`button-verify-${key}`}
                              >
                                <ShieldCheck className="h-4 w-4 mr-1" aria-hidden="true" />
                                Verify
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRejectFor(rejectFor === key ? null : key)}
                                data-testid={`button-reject-${key}`}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          <Link href={item.deepLink}>
                            <Button size="sm" variant="ghost" data-testid={`link-open-${key}`}>
                              <ExternalLink className="h-4 w-4 mr-1" aria-hidden="true" />
                              Open
                            </Button>
                          </Link>
                        </div>
                      </div>

                      {rejectFor === key && (
                        <div className="flex gap-2 items-end border-t pt-3" data-testid={`panel-reject-${key}`}>
                          <div className="flex-1 space-y-2">
                            <Label htmlFor={`reason-${key}`}>Reason (required by the owning module)</Label>
                            <Input
                              id={`reason-${key}`}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              data-testid={`input-reason-${key}`}
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={reason.trim().length === 0 || execute.isPending}
                            onClick={() =>
                              run(canVerify ? 'skill.reject' : 'leave.reject', item.sourceId, {
                                reason: reason.trim(),
                              })
                            }
                            data-testid={`button-confirm-reject-${key}`}
                          >
                            Confirm
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
