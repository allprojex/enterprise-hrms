import { useState } from 'react';
import { Inbox, Send, UserCog, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmActionDialog } from '@/components/foundation';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyDataChangeFields,
  getListMyDataChangeFieldsQueryKey,
  useListMyDataChangeRequests,
  getListMyDataChangeRequestsQueryKey,
  useSubmitMyDataChangeRequest,
  useWithdrawMyDataChangeRequest,
  useListMyServiceRequestTypes,
  getListMyServiceRequestTypesQueryKey,
  useListMyServiceRequests,
  getListMyServiceRequestsQueryKey,
  useSubmitMyServiceRequest,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const DATA_CHANGE_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Awaiting decision', className: 'bg-blue-100 text-blue-900' },
  returned: { label: 'More information needed', className: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-900' },
  applied: { label: 'Applied', className: 'bg-green-100 text-green-900' },
  rejected: { label: 'Not approved', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
  stale: { label: 'Needs re-checking', className: 'bg-amber-100 text-amber-900' },
  application_failed: { label: 'Could not be applied', className: 'bg-red-100 text-red-900' },
};

const SERVICE_STATUS: Record<string, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-900' },
  acknowledged: { label: 'Acknowledged', className: 'bg-blue-100 text-blue-900' },
  in_progress: { label: 'In progress', className: 'bg-amber-100 text-amber-900' },
  awaiting_employee: { label: 'Awaiting your reply', className: 'bg-amber-100 text-amber-900' },
  fulfilled: { label: 'Fulfilled', className: 'bg-green-100 text-green-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

/**
 * WS-13 — Employee Self-Service requests (§29.17 actions 1, 2 and 3).
 *
 * THIS IS THE ONLY WAY AN EMPLOYEE CAN CHANGE THEIR OWN RECORD. §29.1(2) found
 * that no self-service edit path existed anywhere in this platform, so this
 * page is not a wrapper over an existing capability — it is the capability.
 *
 * NEITHER FORM SENDS AN EMPLOYEE IDENTIFIER. The server resolves the subject
 * from the caller's own employee link (§29.2), so tampering with the request
 * body cannot make it somebody else's record. That protection is in the API,
 * not in this component, which is what makes it survive a careless edit here.
 *
 * What the employee sees is the server's allow-list view: no approver identity,
 * no stage configuration and no internal notes ever reach this page.
 */
export default function MyRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('data');
  const [dataFormOpen, setDataFormOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState('');
  const [requestedValue, setRequestedValue] = useState('');
  const [dataReason, setDataReason] = useState('');
  const [dataChangeToWithdraw, setDataChangeToWithdraw] = useState<{ id: number; fieldLabels: string } | null>(null);

  const [serviceFormOpen, setServiceFormOpen] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');

  const fields = useListMyDataChangeFields(organizationId, {
    query: { queryKey: getListMyDataChangeFieldsQueryKey(organizationId), enabled },
  });
  const dataRequests = useListMyDataChangeRequests(organizationId, {
    query: { queryKey: getListMyDataChangeRequestsQueryKey(organizationId), enabled },
  });
  const types = useListMyServiceRequestTypes(organizationId, {
    query: { queryKey: getListMyServiceRequestTypesQueryKey(organizationId), enabled },
  });
  const serviceRequests = useListMyServiceRequests(organizationId, {
    query: { queryKey: getListMyServiceRequestsQueryKey(organizationId), enabled },
  });

  const invalidate = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key });

  const submitData = useSubmitMyDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Request submitted', description: 'HR will review it.' });
        setDataFormOpen(false);
        setFieldKey('');
        setRequestedValue('');
        setDataReason('');
        invalidate(getListMyDataChangeRequestsQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not submit', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const withdrawData = useWithdrawMyDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Request withdrawn' });
        invalidate(getListMyDataChangeRequestsQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not withdraw', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const submitService = useSubmitMyServiceRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Request submitted', description: 'HR will acknowledge it.' });
        setServiceFormOpen(false);
        setTypeId('');
        setSubject('');
        setDetails('');
        invalidate(getListMyServiceRequestsQueryKey(organizationId));
      },
      onError: (err: unknown) =>
        toast({ title: 'Could not submit', description: errorMessage(err, 'Please try again.'), variant: 'destructive' }),
    },
  });

  const canSubmitData = fieldKey.trim().length > 0 && requestedValue.trim().length > 0 && !submitData.isPending;
  const canSubmitService = typeId.length > 0 && subject.trim().length > 0 && !submitService.isPending;

  return (
    <div className="space-y-6" data-testid="page-my-requests">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Inbox className="h-6 w-6" aria-hidden="true" />
          My Requests
        </h1>
        <p className="text-muted-foreground mt-1">
          Ask HR to correct your personal details, or raise a service request. You will see the updates HR shares with
          you.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="data">My data changes</TabsTrigger>
          <TabsTrigger value="service">My HR requests</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="mt-4 space-y-4">
          <Card data-testid="card-raise-data-change">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Request a change to your details</CardTitle>
                  <CardDescription>
                    Only fields your organization allows appear here. Employment, pay and access details are managed by
                    HR through their own processes.
                  </CardDescription>
                </div>
                {!dataFormOpen && (
                  <Button onClick={() => setDataFormOpen(true)} data-testid="button-open-data-change-form">
                    <UserCog className="h-4 w-4 mr-2" aria-hidden="true" />
                    Request a change
                  </Button>
                )}
              </div>
            </CardHeader>
            {dataFormOpen && (
              <CardContent>
                <form
                  className="space-y-4"
                  data-testid="form-raise-data-change"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canSubmitData) return;
                    // No employee identifier is sent — the server resolves it
                    // from the caller's own link (§29.2).
                    submitData.mutate({
                      organizationId,
                      data: {
                        fields: [{ fieldKey, requestedValue }],
                        ...(dataReason.trim() ? { reason: dataReason.trim() } : {}),
                      },
                    });
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="dc-field">What would you like to change?</Label>
                    <select
                      id="dc-field"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      value={fieldKey}
                      onChange={(e) => setFieldKey(e.target.value)}
                      data-testid="select-data-change-field"
                    >
                      <option value="">Choose a detail</option>
                      {(fields.data ?? []).map((f) => (
                        <option key={f.fieldKey} value={f.fieldKey}>
                          {f.label}
                          {f.approvalRequired ? ' (needs approval)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dc-value">New value</Label>
                    <Input
                      id="dc-value"
                      value={requestedValue}
                      onChange={(e) => setRequestedValue(e.target.value)}
                      data-testid="input-data-change-value"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dc-reason">Reason (optional)</Label>
                    <Textarea
                      id="dc-reason"
                      rows={3}
                      value={dataReason}
                      onChange={(e) => setDataReason(e.target.value)}
                      data-testid="input-data-change-reason"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!canSubmitData} data-testid="button-submit-data-change">
                      {submitData.isPending ? 'Submitting…' : 'Submit'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setDataFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            )}
          </Card>

          {dataRequests.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : dataRequests.error ? (
            <QueryError onRetry={() => void dataRequests.refetch()} />
          ) : (dataRequests.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                You have not requested any changes.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(dataRequests.data ?? []).map((r) => {
                const style = DATA_CHANGE_STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
                const canWithdraw = ['pending', 'returned', 'stale', 'approved'].includes(r.status);
                return (
                  <Card key={r.id} data-testid={`card-my-data-change-${r.id}`}>
                    <CardContent className="pt-6 space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{r.fields.map((f) => f.label).join(', ')}</p>
                          <p className="text-sm text-muted-foreground">
                            Requested {new Date(r.requestedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge className={style.className}>{style.label}</Badge>
                      </div>
                      {r.reason && <p className="text-sm">{r.reason}</p>}
                      {canWithdraw && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`button-withdraw-data-change-${r.id}`}
                          onClick={() =>
                            setDataChangeToWithdraw({ id: r.id, fieldLabels: r.fields.map((f) => f.label).join(', ') })
                          }
                        >
                          Withdraw
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="service" className="mt-4 space-y-4">
          <Card data-testid="card-raise-service-request">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Raise an HR request</CardTitle>
                  <CardDescription>
                    Letters, documents and enquiries your organization has made available.
                  </CardDescription>
                </div>
                {!serviceFormOpen && (
                  <Button onClick={() => setServiceFormOpen(true)} data-testid="button-open-service-request-form">
                    <Send className="h-4 w-4 mr-2" aria-hidden="true" />
                    Raise a request
                  </Button>
                )}
              </div>
            </CardHeader>
            {serviceFormOpen && (
              <CardContent>
                <form
                  className="space-y-4"
                  data-testid="form-raise-service-request"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canSubmitService) return;
                    submitService.mutate({
                      organizationId,
                      data: {
                        typeId: Number(typeId),
                        subject: subject.trim(),
                        ...(details.trim() ? { details: details.trim() } : {}),
                      },
                    });
                  }}
                >
                  <div className="space-y-2">
                    <Label htmlFor="sr-type">Request type</Label>
                    <select
                      id="sr-type"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      value={typeId}
                      onChange={(e) => setTypeId(e.target.value)}
                      data-testid="select-service-request-type"
                    >
                      <option value="">Choose a request</option>
                      {(types.data ?? []).map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sr-subject">Subject</Label>
                    <Input
                      id="sr-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      data-testid="input-service-request-subject"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sr-details">Details (optional)</Label>
                    <Textarea
                      id="sr-details"
                      rows={4}
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      data-testid="input-service-request-details"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!canSubmitService} data-testid="button-submit-service-request">
                      {submitService.isPending ? 'Submitting…' : 'Submit'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setServiceFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            )}
          </Card>

          {serviceRequests.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : serviceRequests.error ? (
            <QueryError onRetry={() => void serviceRequests.refetch()} />
          ) : (serviceRequests.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                You have not raised any HR requests.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(serviceRequests.data ?? []).map((r) => {
                const style = SERVICE_STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
                return (
                  <Card key={r.id} data-testid={`card-my-service-request-${r.id}`}>
                    <CardContent className="pt-6 space-y-2">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{r.subject}</p>
                          <p className="text-sm text-muted-foreground">
                            Raised {new Date(r.submittedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge className={style.className}>{style.label}</Badge>
                      </div>
                      {r.resolutionSummary && (
                        <div className="rounded-md border bg-green-50 p-3 text-sm">
                          <p className="font-medium flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            Outcome
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">{r.resolutionSummary}</p>
                        </div>
                      )}
                      {r.updates.length > 0 && (
                        <ul className="space-y-1 text-sm">
                          {r.updates.map((u) => (
                            <li key={u.id} className="border-l-2 pl-3">
                              <span className="text-muted-foreground">
                                {new Date(u.occurredAt).toLocaleDateString()} ·{' '}
                              </span>
                              {u.notes ?? u.eventType.replace(/_/g, ' ')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmActionDialog
        open={dataChangeToWithdraw !== null}
        onOpenChange={(open) => {
          if (!open) setDataChangeToWithdraw(null);
        }}
        title="Withdraw change request?"
        description={
          <p>
            Are you sure you want to withdraw your request to change “{dataChangeToWithdraw?.fieldLabels}”? HR will no
            longer act on it, and the requested change will not be made. To make this change later, raise a new request.
          </p>
        }
        confirmLabel="Withdraw Request"
        tone="destructive"
        onConfirm={() =>
          dataChangeToWithdraw
            ? withdrawData.mutateAsync({ organizationId, requestId: dataChangeToWithdraw.id })
            : undefined
        }
        testId="dialog-withdraw-data-change"
      />
    </div>
  );
}
