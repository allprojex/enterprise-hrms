import { useState } from 'react';
import { useRoute } from 'wouter';
import { CheckCircle2, AlertTriangle, Ban, FileText, GraduationCap, Link2, ShieldQuestion } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetOnboarding,
  getGetOnboardingQueryKey,
  useCompleteOnboardingTask,
  useWaiveOnboardingTask,
  useCancelOnboarding,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

const KIND_LABELS: Record<string, string> = {
  general: 'Task',
  document: 'Document',
  acknowledgement: 'Acknowledgement',
  induction: 'Induction',
  asset_reference: 'Asset',
  inventory_reference: 'Inventory',
  access_reference: 'System access',
  payroll_reference: 'Payroll setup',
  personnel_file_reference: 'Personnel file',
};

/**
 * WS-10 — one employee's onboarding.
 *
 * Reference tasks show the live state of the module that actually owns them,
 * and completing one is refused by the server when that state is missing. The
 * waiver control beside it is the deliberate, audited escape hatch — not a way
 * to tick something into being true.
 */
export default function OnboardingDetail() {
  const { toast } = useToast();
  const [, params] = useRoute('/onboarding/:instanceId');
  const instanceId = Number(params?.instanceId ?? 0);

  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0 && instanceId > 0;

  const [waiverReason, setWaiverReason] = useState<Record<number, string>>({});
  const [cancelReason, setCancelReason] = useState('');

  const query = useGetOnboarding(organizationId, instanceId, {
    query: { queryKey: getGetOnboardingQueryKey(organizationId, instanceId), enabled },
  });
  const completeMutation = useCompleteOnboardingTask();
  const waiveMutation = useWaiveOnboardingTask();
  const cancelMutation = useCancelOnboarding();

  if (isForbidden(query.error)) {
    return (
      <div className="p-6">
        <QueryError title="You do not have access to this onboarding" message="Viewing onboarding requires the onboarding read permission." />
      </div>
    );
  }
  if (!enabled || query.isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!query.data) {
    return (
      <div className="p-6">
        <QueryError title="Onboarding not found" message="It may have been removed, or belong to another organization." />
      </div>
    );
  }

  const detail = query.data;
  const isOpen = detail.instance.status === 'not_started' || detail.instance.status === 'in_progress';

  return (
    <div className="space-y-6 p-6" data-testid="page-onboarding-detail">
      <div>
        <h1 className="text-2xl font-semibold">{detail.employeeName ?? `Employee #${detail.instance.employeeId}`}</h1>
        <p className="text-muted-foreground">
          {detail.templateName ?? 'Onboarding'}
          {detail.templateVersionNumber != null && ` · version ${detail.templateVersionNumber}`}
          {detail.employeeNumber && ` · ${detail.employeeNumber}`}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>
            Onboarding completes when every required task is completed or waived. The percentage below is informational only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Progress value={detail.progress.completionPercentage} className="h-2" />
            <span className="text-sm text-muted-foreground">{detail.progress.completionPercentage}%</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{detail.progress.required} required</Badge>
            <Badge variant="secondary">{detail.progress.completed} completed</Badge>
            {detail.progress.waived > 0 && <Badge variant="secondary">{detail.progress.waived} waived</Badge>}
            {detail.progress.pending > 0 && <Badge variant="secondary">{detail.progress.pending} pending</Badge>}
            {detail.progress.overdue > 0 && (
              <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {detail.progress.overdue} overdue
              </Badge>
            )}
          </div>
          {detail.instance.status === 'cancelled' && detail.instance.cancellationReason && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <span className="font-medium">Cancelled.</span> {detail.instance.cancellationReason} — completed tasks and evidence are
              preserved, and employment is unaffected.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.tasks.map((task) => (
            <div key={task.id} className="rounded-md border p-4" data-testid={`task-${task.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <Badge variant="secondary">{KIND_LABELS[task.taskKind] ?? task.taskKind}</Badge>
                    {task.required ? <Badge variant="secondary">Required</Badge> : <Badge variant="outline">Optional</Badge>}
                    {task.status === 'completed' && (
                      <Badge variant="secondary" className="gap-1 bg-green-100 text-green-900">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Completed
                      </Badge>
                    )}
                    {task.status === 'waived' && <Badge variant="secondary">Waived</Badge>}
                    {task.status === 'cancelled' && (
                      <Badge variant="secondary" className="gap-1">
                        <Ban className="h-3 w-3" aria-hidden="true" />
                        Cancelled
                      </Badge>
                    )}
                    {task.overdue && (
                      <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Overdue
                      </Badge>
                    )}
                  </div>
                  {task.description && <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {task.responsibleBasis}
                    {task.dueAt && ` · due ${new Date(task.dueAt).toLocaleDateString()}`}
                  </p>

                  {task.referenceDetail && (
                    <p
                      className={`mt-2 flex items-center gap-1 text-xs ${task.referenceSatisfied ? 'text-green-800' : 'text-amber-900'}`}
                    >
                      <Link2 className="h-3 w-3" aria-hidden="true" />
                      {task.referenceDetail}
                    </p>
                  )}

                  {task.induction && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <GraduationCap className="h-3 w-3" aria-hidden="true" />
                      {task.induction.scheduledAt
                        ? `Scheduled ${new Date(task.induction.scheduledAt).toLocaleString()}`
                        : 'Not yet scheduled'}
                      {task.induction.rescheduleCount > 0 && ` · rescheduled ${task.induction.rescheduleCount}×`}
                      {task.induction.attendedAt && ` · attended ${new Date(task.induction.attendedAt).toLocaleDateString()}`}
                    </p>
                  )}

                  {task.status === 'completed' && task.completedByName && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Completed by {task.completedByName}
                      {task.completedAt && ` on ${new Date(task.completedAt).toLocaleDateString()}`}
                    </p>
                  )}
                  {task.status === 'waived' && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Waived by {task.waivedByName ?? 'an authorized user'} — {task.waiverReason}
                    </p>
                  )}
                </div>

                {isOpen && task.status === 'pending' && (
                  <div className="flex flex-col items-end gap-2">
                    <Button
                      size="sm"
                      disabled={completeMutation.isPending}
                      onClick={() =>
                        completeMutation.mutate(
                          { organizationId, taskId: task.id, data: {} },
                          {
                            onSuccess: () => {
                              void query.refetch();
                              toast({ title: 'Task completed' });
                            },
                            onError: (err) =>
                              toast({
                                title: 'Could not complete',
                                description: errorMessage(err, ''),
                                variant: 'destructive',
                              }),
                          },
                        )
                      }
                    >
                      Complete
                    </Button>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Waiver reason"
                        value={waiverReason[task.id] ?? ''}
                        onChange={(e) => setWaiverReason((prev) => ({ ...prev, [task.id]: e.target.value }))}
                        className="h-8 w-44 text-xs"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!waiverReason[task.id]?.trim() || waiveMutation.isPending}
                        onClick={() =>
                          waiveMutation.mutate(
                            { organizationId, taskId: task.id, data: { reason: waiverReason[task.id]! } },
                            {
                              onSuccess: () => {
                                setWaiverReason((prev) => ({ ...prev, [task.id]: '' }));
                                void query.refetch();
                                toast({ title: 'Task waived', description: 'Recorded in the audit trail.' });
                              },
                              onError: (err) =>
                                toast({ title: 'Could not waive', description: errorMessage(err, ''), variant: 'destructive' }),
                            },
                          )
                        }
                      >
                        <ShieldQuestion className="mr-1 h-3 w-3" aria-hidden="true" />
                        Waive
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {detail.acknowledgements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden="true" />
              Handbook and policies
            </CardTitle>
            <CardDescription>
              Each obligation is against one exact document version. This records confirmation of receipt, not a signature.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.acknowledgements.map((ack) => (
              <div key={ack.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <span>
                  {ack.documentTitle ?? `Document #${ack.documentId}`}
                  {ack.versionNumber != null && <span className="ml-2 text-xs text-muted-foreground">v{ack.versionNumber}</span>}
                </span>
                {ack.status === 'acknowledged' ? (
                  <Badge variant="secondary" className="bg-green-100 text-green-900">
                    Acknowledged {ack.acknowledgedAt && new Date(ack.acknowledgedAt).toLocaleDateString()}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Awaiting acknowledgement</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Cancel onboarding</CardTitle>
            <CardDescription>
              Preserves completed tasks, evidence and acknowledgements, and stops future reminders. This does not end anyone's
              employment — separation is handled separately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="cancel-reason">Reason</Label>
                <Input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </div>
              <Button
                variant="outline"
                disabled={!cancelReason.trim() || cancelMutation.isPending}
                onClick={() =>
                  cancelMutation.mutate(
                    { organizationId, instanceId, data: { reason: cancelReason } },
                    {
                      onSuccess: () => {
                        setCancelReason('');
                        void query.refetch();
                        toast({ title: 'Onboarding cancelled' });
                      },
                      onError: (err) =>
                        toast({ title: 'Could not cancel', description: errorMessage(err, ''), variant: 'destructive' }),
                    },
                  )
                }
              >
                Cancel onboarding
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
