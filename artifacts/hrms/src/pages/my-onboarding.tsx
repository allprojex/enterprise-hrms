import { CheckCircle2, AlertTriangle, FileText, GraduationCap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetMyOnboarding,
  getGetMyOnboardingQueryKey,
  useAcknowledgeDocument,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

/**
 * WS-10 — the employee's own onboarding (§26.26).
 *
 * Own scope only. The server resolves which employee this is from the
 * authenticated identity; this page never sends an employee id, and could not
 * see a colleague's onboarding by asking for one.
 *
 * Note the wording throughout: the employee ACKNOWLEDGES receipt. Nothing here
 * is a signature, and it must not be described as one.
 */
export default function MyOnboarding() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const query = useGetMyOnboarding(organizationId, {
    query: { queryKey: getGetMyOnboardingQueryKey(organizationId), enabled },
  });
  const acknowledgeMutation = useAcknowledgeDocument();

  if (!enabled || query.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const data = query.data;
  const onboarding = data?.onboarding ?? null;
  const acknowledgements = data?.acknowledgements ?? [];
  const outstanding = acknowledgements.filter((a) => a.status === 'pending');

  return (
    <div className="space-y-6 p-6" data-testid="page-my-onboarding">
      <div>
        <h1 className="text-2xl font-semibold">My Onboarding</h1>
        <p className="text-muted-foreground">Your tasks, documents, policies and induction.</p>
      </div>

      {!onboarding && outstanding.length === 0 && (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          You have no onboarding tasks or outstanding documents. Nothing here is blocking your access to the system.
        </p>
      )}

      {onboarding && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your progress</CardTitle>
              <CardDescription>
                Your access to Employee Self-Service does not depend on finishing this — you can work normally while onboarding is
                still in progress.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Progress value={onboarding.progress.completionPercentage} className="h-2" />
                <span className="text-sm text-muted-foreground">{onboarding.progress.completionPercentage}%</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{onboarding.progress.completed} completed</Badge>
                {onboarding.progress.pending > 0 && <Badge variant="secondary">{onboarding.progress.pending} to do</Badge>}
                {onboarding.progress.overdue > 0 && (
                  <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {onboarding.progress.overdue} overdue
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your tasks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {onboarding.tasks.map((task) => (
                <div key={task.id} className="rounded-md border p-3" data-testid={`my-task-${task.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    {task.status === 'completed' && (
                      <Badge variant="secondary" className="gap-1 bg-green-100 text-green-900">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Done
                      </Badge>
                    )}
                    {task.status === 'waived' && <Badge variant="secondary">Waived</Badge>}
                    {task.overdue && (
                      <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Overdue
                      </Badge>
                    )}
                  </div>
                  {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
                  {task.dueAt && (
                    <p className="mt-1 text-xs text-muted-foreground">Due {new Date(task.dueAt).toLocaleDateString()}</p>
                  )}
                  {task.induction?.scheduledAt && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <GraduationCap className="h-3 w-3" aria-hidden="true" />
                      {new Date(task.induction.scheduledAt).toLocaleString()}
                      {task.induction.location && ` · ${task.induction.location}`}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {acknowledgements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Handbook and policies
            </CardTitle>
            <CardDescription>
              Confirming here records that you have received and read the exact version shown. It is not an electronic signature.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {acknowledgements.map((ack) => (
              <div key={ack.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{ack.documentTitle ?? `Document #${ack.documentId}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {ack.versionNumber != null && `Version ${ack.versionNumber}`}
                    {ack.dueAt && ` · due ${new Date(ack.dueAt).toLocaleDateString()}`}
                  </p>
                </div>
                {ack.status === 'acknowledged' ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-900">
                    Acknowledged {ack.acknowledgedAt && new Date(ack.acknowledgedAt).toLocaleDateString()}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={acknowledgeMutation.isPending}
                    onClick={() =>
                      acknowledgeMutation.mutate(
                        { organizationId, acknowledgementId: ack.id },
                        {
                          onSuccess: () => {
                            void query.refetch();
                            toast({ title: 'Receipt confirmed' });
                          },
                          onError: (err) =>
                            toast({ title: 'Could not confirm', description: errorMessage(err, ''), variant: 'destructive' }),
                        },
                      )
                    }
                  >
                    Confirm receipt
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
