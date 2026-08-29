import { useState } from 'react';
import { MessageSquareWarning, CheckCircle2, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { QueryError } from '@/components/query-error';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyGrievances,
  getListMyGrievancesQueryKey,
  useSubmitMyGrievance,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-900' },
  acknowledged: { label: 'Acknowledged', className: 'bg-blue-100 text-blue-900' },
  under_review: { label: 'Under review', className: 'bg-amber-100 text-amber-900' },
  resolved: { label: 'Resolved', className: 'bg-green-100 text-green-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

const UPDATE_LABELS: Record<string, string> = {
  submitted: 'Grievance submitted',
  acknowledged: 'Receipt acknowledged',
  meeting_held: 'Meeting held',
  information_requested: 'Information requested from you',
  information_provided: 'Information provided',
  resolution_recorded: 'Resolution',
  escalated: 'Escalated',
  appeal_lodged: 'Appeal lodged',
  appeal_decided: 'Appeal decided',
  withdrawn: 'Withdrawn',
  closed: 'Closed',
  reopened: 'Reopened',
};

/**
 * WS-12 — the employee's own grievances (§28.5).
 *
 * THIS PAGE CAN ONLY RENDER WHAT THE SERVER CHOSE TO SEND. The endpoint behind
 * it returns the explicit §28.5 allow-list view — built field by field on the
 * server, never a spread of the grievance record — so confidential HR notes,
 * investigator working notes, internal deliberations, draft findings, the
 * assigned investigator and the stored respondent never reach this component at
 * all. That ordering matters: the protection is in the response, not in what
 * this file happens to render, so it survives anyone editing this page.
 *
 * Only updates HR deliberately marked as communicated appear in the timeline.
 */
export default function MyGrievances() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const query = useListMyGrievances(organizationId, {
    query: { queryKey: getListMyGrievancesQueryKey(organizationId), enabled },
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [categoryCode, setCategoryCode] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const submit = useSubmitMyGrievance({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Grievance submitted', description: 'HR has been notified and will acknowledge it.' });
        setOpen(false);
        setCategoryCode('');
        setSubject('');
        setDescription('');
        void queryClient.invalidateQueries({ queryKey: getListMyGrievancesQueryKey(organizationId) });
      },
      onError: (err: unknown) => {
        toast({
          title: 'Could not submit',
          description: errorMessage(err, 'Please try again.'),
          variant: 'destructive',
        });
      },
    },
  });

  const canSubmit =
    categoryCode.trim().length > 0 && subject.trim().length > 0 && description.trim().length > 0 && !submit.isPending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    // The complainant is NEVER sent from here — the server resolves it from the
    // caller's own employee link (§28.5), so an employee cannot file in a
    // colleague's name even by tampering with this request.
    submit.mutate({
      organizationId,
      data: {
        categoryCode: categoryCode.trim(),
        subject: subject.trim(),
        description: description.trim(),
        submittedAt: new Date().toISOString(),
      },
    });
  }

  return (
    <div className="space-y-6" data-testid="page-my-grievances">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MessageSquareWarning className="h-6 w-6" aria-hidden="true" />
          My Grievances
        </h1>
        <p className="text-muted-foreground mt-1">
          Grievances you have raised, and the updates HR has shared with you.
        </p>
      </div>

      {/*
        §28.5 freezes this as a user action: "Employees may submit their own
        grievances through ESS". It is deliberately reachable without any
        permission key — an employee's right to raise a grievance comes from
        their employee link, not from a grant somebody could withhold.
      */}
      <Card data-testid="card-raise-grievance">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Raise a grievance</CardTitle>
              <CardDescription>
                Your submission goes to HR. You will see its acknowledgement and any updates HR shares with you.
              </CardDescription>
            </div>
            {!open && (
              <Button onClick={() => setOpen(true)} data-testid="button-open-grievance-form">
                <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                Raise a grievance
              </Button>
            )}
          </div>
        </CardHeader>
        {open && (
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit} data-testid="form-raise-grievance">
              <div className="space-y-2">
                <Label htmlFor="grievance-category">Category</Label>
                <Input
                  id="grievance-category"
                  value={categoryCode}
                  onChange={(e) => setCategoryCode(e.target.value)}
                  placeholder="e.g. working conditions"
                  data-testid="input-grievance-category"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grievance-subject">Subject</Label>
                <Input
                  id="grievance-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="A short summary"
                  data-testid="input-grievance-subject"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grievance-description">What happened</Label>
                <Textarea
                  id="grievance-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder="Describe the matter in your own words."
                  data-testid="input-grievance-description"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={!canSubmit} data-testid="button-submit-grievance">
                  {submit.isPending ? 'Submitting…' : 'Submit'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-grievance">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        )}
      </Card>

      {query.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : query.error ? (
        <QueryError onRetry={() => void query.refetch()} />
      ) : (query.data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You have not raised any grievances.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {(query.data ?? []).map((g) => {
            const style = STATUS[g.status] ?? { label: g.status, className: 'bg-muted' };
            return (
              <Card key={g.id} data-testid={`card-my-grievance-${g.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{g.subject}</CardTitle>
                      <CardDescription>
                        {g.categoryCode} · raised {new Date(g.submittedAt).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <Badge className={style.className}>{style.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm whitespace-pre-wrap">{g.description}</p>

                  {g.resolutionSummary && (
                    <div className="rounded-md border bg-green-50 p-3">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Resolution
                      </p>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{g.resolutionSummary}</p>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-medium mb-2">Updates</p>
                    {g.updates.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No updates have been shared with you yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {g.updates.map((u) => (
                          <li key={u.id} className="text-sm border-l-2 pl-3">
                            <span className="font-medium">{UPDATE_LABELS[u.eventType] ?? u.eventType}</span>
                            <span className="text-muted-foreground">
                              {' '}
                              · {new Date(u.occurredAt).toLocaleDateString()}
                            </span>
                            {u.notes && <p className="mt-1 whitespace-pre-wrap">{u.notes}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
