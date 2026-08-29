import { useState } from 'react';
import { ClipboardList, UserCog, ShieldCheck, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListDataChangeRequests,
  getListDataChangeRequestsQueryKey,
  useGetDataChangeRequest,
  getGetDataChangeRequestQueryKey,
  useListDataChangeFields,
  getListDataChangeFieldsQueryKey,
  useCreateDataChangeRequest,
  useDecideDataChangeRequest,
  useRejectDataChangeRequest,
  useReturnDataChangeRequest,
  useReconfirmDataChangeRequest,
  useApplyDataChangeRequest,
  useListServiceRequests,
  getListServiceRequestsQueryKey,
  useAcknowledgeServiceRequest,

  useApproveServiceRequest,
  useRejectServiceRequest,
  useFulfilServiceRequest,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const DC_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-blue-100 text-blue-900' },
  returned: { label: 'Returned', className: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Approved — not applied', className: 'bg-amber-100 text-amber-900' },
  applied: { label: 'Applied', className: 'bg-green-100 text-green-900' },
  rejected: { label: 'Rejected', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
  stale: { label: 'Stale — re-check', className: 'bg-red-100 text-red-900' },
  application_failed: { label: 'Application failed', className: 'bg-red-100 text-red-900' },
};

const SR_STATUS: Record<string, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-900' },
  acknowledged: { label: 'Acknowledged', className: 'bg-blue-100 text-blue-900' },
  in_progress: { label: 'In progress', className: 'bg-amber-100 text-amber-900' },
  awaiting_employee: { label: 'Awaiting employee', className: 'bg-amber-100 text-amber-900' },
  fulfilled: { label: 'Fulfilled', className: 'bg-green-100 text-green-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
  withdrawn: { label: 'Withdrawn', className: 'bg-muted text-muted-foreground' },
};

/**
 * WS-13 — the HR Requests and Approvals workspace (§29.17 actions 4 to 8).
 *
 * THIS IS NOT THE ORGANIZATION-WIDE HR ACTION CENTRE (§29.17). Leave approvals,
 * Recruitment approvals, Onboarding tasks, Employee Relations actions and
 * Payroll actions are deliberately absent — aggregating them here because WS-13
 * happens to have approvals is exactly what §29.17 forbids, and WS-15 owns that
 * surface.
 *
 * APPROVAL SHOWS THE FIELD, NOT THE EMPLOYEE (§29.7). The detail panel renders
 * the server's approval DTO, which carries the field, its previous and requested
 * values and the decision context — with sensitive values already masked. There
 * is no request anywhere on this page for the employee record itself, so being
 * an approver grants no extra visibility.
 *
 * Maker-checker is enforced on the server: an approve button is shown, and the
 * server refuses it with 403 if the viewer raised the request. The toast surfaces
 * that refusal rather than the UI pretending to prevent it.
 */
export default function Requests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('data');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);

  // Raise-for-employee form (action 4).
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [requestedValue, setRequestedValue] = useState('');

  // Fulfilment form (action 8).
  const [fulfilId, setFulfilId] = useState<number | null>(null);
  const [resolution, setResolution] = useState('');
  const [documentId, setDocumentId] = useState('');

  const dataRequests = useListDataChangeRequests(organizationId, undefined, {
    query: { queryKey: getListDataChangeRequestsQueryKey(organizationId), enabled },
  });
  const fields = useListDataChangeFields(organizationId, {
    query: { queryKey: getListDataChangeFieldsQueryKey(organizationId), enabled },
  });
  const detail = useGetDataChangeRequest(organizationId, selectedId ?? 0, {
    query: {
      queryKey: getGetDataChangeRequestQueryKey(organizationId, selectedId ?? 0),
      enabled: enabled && selectedId != null,
    },
  });
  const serviceRequests = useListServiceRequests(
    organizationId,
    assignedToMe ? { assignedToMe: 'true' as const } : undefined,
    {
      query: {
        queryKey: getListServiceRequestsQueryKey(organizationId, assignedToMe ? { assignedToMe: 'true' } : undefined),
        enabled,
      },
    },
  );

  const canSeeDataChange = !isForbidden(dataRequests.error);
  const canSeeService = !isForbidden(serviceRequests.error);

  const refreshData = () => {
    void queryClient.invalidateQueries({ queryKey: getListDataChangeRequestsQueryKey(organizationId) });
    if (selectedId != null) {
      void queryClient.invalidateQueries({ queryKey: getGetDataChangeRequestQueryKey(organizationId, selectedId) });
    }
  };
  const refreshService = () =>
    void queryClient.invalidateQueries({ queryKey: getListServiceRequestsQueryKey(organizationId) });

  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: errorMessage(err, 'Please try again.'), variant: 'destructive' });

  const createRequest = useCreateDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Request raised' });
        setRaiseOpen(false);
        setEmployeeId('');
        setFieldKey('');
        setRequestedValue('');
        refreshData();
      },
      onError: onError('Could not raise the request'),
    },
  });
  const approve = useDecideDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Approved' });
        setDecisionNote('');
        refreshData();
      },
      // A 403 here is maker-checker doing its job; the message says so.
      onError: onError('Could not approve'),
    },
  });
  const reject = useRejectDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Rejected' });
        setDecisionNote('');
        refreshData();
      },
      onError: onError('Could not reject'),
    },
  });
  const returnRequest = useReturnDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Returned for information' });
        setDecisionNote('');
        refreshData();
      },
      onError: onError('Could not return'),
    },
  });
  const reconfirm = useReconfirmDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Re-confirmed', description: 'The request now reflects the current values.' });
        refreshData();
      },
      onError: onError('Could not re-confirm'),
    },
  });
  const applyChange = useApplyDataChangeRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Applied', description: 'The employee record has been updated.' });
        refreshData();
      },
      onError: onError('Could not apply'),
    },
  });

  const acknowledge = useAcknowledgeServiceRequest({
    mutation: { onSuccess: () => { toast({ title: 'Acknowledged' }); refreshService(); }, onError: onError('Could not acknowledge') },
  });
  const approveService = useApproveServiceRequest({
    mutation: { onSuccess: () => { toast({ title: 'Approved' }); refreshService(); }, onError: onError('Could not approve') },
  });
  const rejectService = useRejectServiceRequest({
    mutation: { onSuccess: () => { toast({ title: 'Rejected' }); refreshService(); }, onError: onError('Could not reject') },
  });
  const fulfil = useFulfilServiceRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Fulfilled' });
        setFulfilId(null);
        setResolution('');
        setDocumentId('');
        refreshService();
      },
      onError: onError('Could not record fulfilment'),
    },
  });

  const selected = detail.data;

  if (!canSeeDataChange && !canSeeService) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          You do not have access to requests in this organization.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-requests">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ClipboardList className="h-6 w-6" aria-hidden="true" />
          Requests &amp; Approvals
        </h1>
        <p className="text-muted-foreground mt-1">
          Employee data changes and HR service requests. Approving a change records the decision; applying it writes the
          record.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {canSeeDataChange && <TabsTrigger value="data">Data changes</TabsTrigger>}
          {canSeeService && <TabsTrigger value="service">Service requests</TabsTrigger>}
        </TabsList>

        {canSeeDataChange && (
          <TabsContent value="data" className="mt-4 space-y-4">
            <Card data-testid="card-raise-for-employee">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Propose a change for an employee</CardTitle>
                    <CardDescription>
                      Only fields this platform allows can be proposed. Employment, pay, leave and access details are
                      owned by their own modules.
                    </CardDescription>
                  </div>
                  {!raiseOpen && (
                    <Button onClick={() => setRaiseOpen(true)} data-testid="button-open-hr-data-change-form">
                      <UserCog className="h-4 w-4 mr-2" aria-hidden="true" />
                      Propose a change
                    </Button>
                  )}
                </div>
              </CardHeader>
              {raiseOpen && (
                <CardContent>
                  <form
                    className="space-y-4"
                    data-testid="form-hr-data-change"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createRequest.mutate({
                        organizationId,
                        employeeId: Number(employeeId),
                        data: { fields: [{ fieldKey, requestedValue }] },
                      });
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="hr-emp">Employee ID</Label>
                      <Input
                        id="hr-emp"
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        data-testid="input-hr-employee-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hr-field">Field</Label>
                      <select
                        id="hr-field"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        value={fieldKey}
                        onChange={(e) => setFieldKey(e.target.value)}
                        data-testid="select-hr-field"
                      >
                        <option value="">Choose a field</option>
                        {(fields.data ?? [])
                          .filter((f) => f.hrEligible)
                          .map((f) => (
                            <option key={f.fieldKey} value={f.fieldKey}>
                              {f.label}
                              {f.approvalRequired ? ' (needs approval)' : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hr-value">New value</Label>
                      <Input
                        id="hr-value"
                        value={requestedValue}
                        onChange={(e) => setRequestedValue(e.target.value)}
                        data-testid="input-hr-value"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        disabled={!employeeId || !fieldKey || !requestedValue || createRequest.isPending}
                        data-testid="button-submit-hr-data-change"
                      >
                        {createRequest.isPending ? 'Raising…' : 'Raise request'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setRaiseOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              )}
            </Card>

            <Card data-testid="card-data-change-queue">
              <CardHeader>
                <CardTitle>Pending data changes</CardTitle>
                <CardDescription>Select a request to review its fields and decide.</CardDescription>
              </CardHeader>
              <CardContent>
                {dataRequests.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : dataRequests.error ? (
                  <QueryError onRetry={() => void dataRequests.refetch()} />
                ) : (dataRequests.data ?? []).length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center">No data change requests.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Requested</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(dataRequests.data ?? []).map((r) => {
                        const style = DC_STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
                        return (
                          <TableRow key={r.id} data-testid={`row-data-change-${r.id}`}>
                            <TableCell>#{r.employeeId}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.origin === 'employee_self_service' ? 'Employee' : 'HR'}
                            </TableCell>
                            <TableCell>
                              <Badge className={style.className}>{style.label}</Badge>
                            </TableCell>
                            <TableCell>{new Date(r.requestedAt).toLocaleDateString()}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid={`button-open-data-change-${r.id}`}
                                onClick={() => setSelectedId(r.id)}
                              >
                                Review
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {selected && (
              <Card data-testid="card-data-change-detail">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                    Request #{selected.id}
                  </CardTitle>
                  <CardDescription>
                    Only the fields being changed are shown. Sensitive values are masked.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Current</TableHead>
                        <TableHead>Requested</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selected.fields.map((f) => (
                        <TableRow key={f.fieldKey} data-testid={`row-detail-field-${f.fieldKey}`}>
                          <TableCell className="font-medium">
                            {f.label}
                            {f.sensitive && <Badge className="ml-2 bg-muted">masked</Badge>}
                          </TableCell>
                          <TableCell>{String(f.previousValue ?? '—')}</TableCell>
                          <TableCell>{String(f.requestedValue ?? '—')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {selected.status === 'stale' && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                      <p className="font-medium flex items-center gap-2">
                        <Clock className="h-4 w-4" aria-hidden="true" />
                        The record changed after this request was raised
                      </p>
                      <p className="mt-1">Re-confirm it against the current values before deciding.</p>
                      <Button
                        size="sm"
                        className="mt-2"
                        data-testid="button-reconfirm"
                        onClick={() => reconfirm.mutate({ organizationId, requestId: selected.id })}
                      >
                        Re-confirm
                      </Button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="decision-note">Note (a reason is required to reject or return)</Label>
                    <Textarea
                      id="decision-note"
                      rows={3}
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      data-testid="input-decision-note"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      data-testid="button-approve-data-change"
                      disabled={!['pending', 'returned'].includes(selected.status)}
                      onClick={() =>
                        approve.mutate({
                          organizationId,
                          requestId: selected.id,
                          data: decisionNote.trim() ? { notes: decisionNote.trim() } : {},
                        })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      data-testid="button-reject-data-change"
                      disabled={!decisionNote.trim()}
                      onClick={() =>
                        reject.mutate({ organizationId, requestId: selected.id, data: { reason: decisionNote.trim() } })
                      }
                    >
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      data-testid="button-return-data-change"
                      disabled={selected.status !== 'pending' || !decisionNote.trim()}
                      onClick={() =>
                        returnRequest.mutate({
                          organizationId,
                          requestId: selected.id,
                          data: { reason: decisionNote.trim() },
                        })
                      }
                    >
                      Return for information
                    </Button>
                    <Button
                      variant="secondary"
                      data-testid="button-apply-data-change"
                      disabled={!['approved', 'application_failed'].includes(selected.status)}
                      onClick={() => applyChange.mutate({ organizationId, requestId: selected.id })}
                    >
                      Apply to record
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {canSeeService && (
          <TabsContent value="service" className="mt-4 space-y-4">
            <Card data-testid="card-service-request-queue">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>HR service requests</CardTitle>
                    <CardDescription>Letters, documents and enquiries raised by employees.</CardDescription>
                  </div>
                  <Button
                    variant={assignedToMe ? 'default' : 'outline'}
                    data-testid="button-toggle-assigned-to-me"
                    onClick={() => setAssignedToMe((v) => !v)}
                  >
                    {assignedToMe ? 'Showing mine' : 'Assigned to me'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {serviceRequests.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : serviceRequests.error ? (
                  <QueryError onRetry={() => void serviceRequests.refetch()} />
                ) : (serviceRequests.data ?? []).length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center">No service requests.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Approval</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(serviceRequests.data ?? []).map((r) => {
                        const style = SR_STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
                        return (
                          <TableRow key={r.id} data-testid={`row-service-request-${r.id}`}>
                            <TableCell className="font-medium">{r.subject}</TableCell>
                            <TableCell>#{r.employeeId}</TableCell>
                            <TableCell>
                              <Badge className={style.className}>{style.label}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.approvalStatus.replace(/_/g, ' ')}
                            </TableCell>
                            <TableCell className="space-x-1">
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid={`button-acknowledge-${r.id}`}
                                onClick={() => acknowledge.mutate({ organizationId, requestId: r.id, data: {} })}
                              >
                                Acknowledge
                              </Button>
                              {r.approvalStatus === 'pending' && (
                                <>
                                  <Button
                                    size="sm"
                                    data-testid={`button-approve-service-${r.id}`}
                                    onClick={() => approveService.mutate({ organizationId, requestId: r.id, data: {} })}
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    data-testid={`button-reject-service-${r.id}`}
                                    onClick={() =>
                                      rejectService.mutate({
                                        organizationId,
                                        requestId: r.id,
                                        data: { reason: 'Not approved' },
                                      })
                                    }
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                data-testid={`button-open-fulfil-${r.id}`}
                                onClick={() => setFulfilId(r.id)}
                              >
                                Fulfil
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {fulfilId != null && (
              <Card data-testid="card-fulfil-form">
                <CardHeader>
                  <CardTitle>Record fulfilment</CardTitle>
                  <CardDescription>
                    Generate the document in Documents &amp; Records first, then attach its ID here. This module does not
                    generate documents.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-4"
                    data-testid="form-fulfil"
                    onSubmit={(e) => {
                      e.preventDefault();
                      fulfil.mutate({
                        organizationId,
                        requestId: fulfilId,
                        data: {
                          resolutionSummary: resolution.trim(),
                          ...(documentId ? { generatedDocumentId: Number(documentId) } : {}),
                        },
                      });
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="fulfil-summary">What was done</Label>
                      <Textarea
                        id="fulfil-summary"
                        rows={3}
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        data-testid="input-fulfil-summary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fulfil-doc">Generated document ID (if this request produces one)</Label>
                      <Input
                        id="fulfil-doc"
                        value={documentId}
                        onChange={(e) => setDocumentId(e.target.value)}
                        data-testid="input-fulfil-document-id"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={!resolution.trim() || fulfil.isPending} data-testid="button-submit-fulfil">
                        {fulfil.isPending ? 'Recording…' : 'Record fulfilment'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setFulfilId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
