import { useState } from 'react';
import { Network, Lock, Plus, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  useListSuccessionPlans,
  getListSuccessionPlansQueryKey,
  useGetSuccessionPlan,
  getGetSuccessionPlanQueryKey,
  useCreateSuccessionPlan,
  useUpdateSuccessionPlan,
  useListSuccessionCandidates,
  getListSuccessionCandidatesQueryKey,
  useNominateSuccessionCandidate,
  useSetSuccessionReadiness,
  useRemoveSuccessionCandidate,
  useListReadinessLevels,
  getListReadinessLevelsQueryKey,
  useCreateReadinessLevel,
  useGetSuccessionCoverage,
  getGetSuccessionCoverageQueryKey,
} from '@workspace/api-client-react';

function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

const PLAN_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100 text-green-900' },
  under_review: { label: 'Under review', className: 'bg-amber-100 text-amber-900' },
  closed: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/**
 * WS-14 — the succession workspace (§30.26 rows 11, 12, 13 and 15).
 *
 * THIS PAGE IS NEVER EMPLOYEE-FACING (§30.17). Succession is confidential HR
 * information: nobody sees that they are a candidate, who else is, or how ready
 * anybody was judged to be. The protection lives in the permissions on the
 * endpoints behind this page — `succession.read` for the fact that a position is
 * succession-managed, and the narrower `succession.confidential.read` for
 * candidates, rationales and criticality notes, whose reads are audited under
 * Owner Decision #18. Organization administrators do NOT receive those keys by
 * default: administrative rank is not the same as a need to see who is being
 * lined up for a role.
 *
 * THERE IS NO RANKING HERE, AND NONE MAY BE ADDED (§30.12). Candidates are
 * GROUPED by readiness band, which is a human judgement of how soon somebody
 * could step up. They are not ordered within a band, not scored, and there is no
 * "first successor". The API returns no rank field and the database has no
 * column to hold one.
 *
 * NOMINATING APPOINTS NOBODY (§30.16). Nothing on this page changes anybody's
 * position, status or reporting line. Succession records an intention; an
 * appointment is a separate, deliberate employment act elsewhere.
 *
 * NOTHING HERE IS COMPUTED. Readiness is supplied by a person every time — there
 * is no 9-box, no potential score and no automatic promotion (§30.13, §30.21).
 */
export default function Succession() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('plans');
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [planPositionId, setPlanPositionId] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [planReviewDue, setPlanReviewDue] = useState('');

  const [nominateOpen, setNominateOpen] = useState(false);
  const [nomineeId, setNomineeId] = useState('');
  const [nomineeReadinessId, setNomineeReadinessId] = useState('');
  const [nomineeRationale, setNomineeRationale] = useState('');

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [removeReason, setRemoveReason] = useState('');

  const [closePlanOpen, setClosePlanOpen] = useState(false);

  const [bandOpen, setBandOpen] = useState(false);
  const [bandLabel, setBandLabel] = useState('');
  const [bandOrdinal, setBandOrdinal] = useState('1');

  const employees = useListEmployees(organizationId, undefined, {
    query: { queryKey: getListEmployeesQueryKey(organizationId), enabled },
  });
  const positions = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled },
  });
  const plans = useListSuccessionPlans(organizationId, {
    query: { queryKey: getListSuccessionPlansQueryKey(organizationId), enabled },
  });
  const readinessLevels = useListReadinessLevels(organizationId, {
    query: { queryKey: getListReadinessLevelsQueryKey(organizationId), enabled },
  });
  const coverage = useGetSuccessionCoverage(organizationId, {
    query: { queryKey: getGetSuccessionCoverageQueryKey(organizationId), enabled },
  });

  const planDetail = useGetSuccessionPlan(organizationId, selectedPlanId ?? 0, {
    query: {
      queryKey: getGetSuccessionPlanQueryKey(organizationId, selectedPlanId ?? 0),
      enabled: enabled && !!selectedPlanId,
    },
  });
  const candidates = useListSuccessionCandidates(organizationId, selectedPlanId ?? 0, undefined, {
    query: {
      queryKey: getListSuccessionCandidatesQueryKey(organizationId, selectedPlanId ?? 0),
      enabled: enabled && !!selectedPlanId,
    },
  });

  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: errorMessage(err, 'Please try again.'), variant: 'destructive' });

  const refreshPlans = () => {
    void queryClient.invalidateQueries({ queryKey: getListSuccessionPlansQueryKey(organizationId) });
    void queryClient.invalidateQueries({ queryKey: getGetSuccessionCoverageQueryKey(organizationId) });
  };
  const refreshCandidates = () => {
    void queryClient.invalidateQueries({
      queryKey: getListSuccessionCandidatesQueryKey(organizationId, selectedPlanId ?? 0),
    });
    void queryClient.invalidateQueries({ queryKey: getGetSuccessionCoverageQueryKey(organizationId) });
  };

  const createPlan = useCreateSuccessionPlan({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Plan opened', description: 'The position itself is unchanged.' });
        setPlanFormOpen(false);
        setPlanPositionId('');
        setPlanNotes('');
        setPlanReviewDue('');
        refreshPlans();
      },
      onError: onError('Could not open a plan'),
    },
  });

  const updatePlan = useUpdateSuccessionPlan({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Plan updated' });
        void queryClient.invalidateQueries({
          queryKey: getGetSuccessionPlanQueryKey(organizationId, selectedPlanId ?? 0),
        });
        refreshPlans();
      },
      onError: onError('Could not update'),
    },
  });

  const nominate = useNominateSuccessionCandidate({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Candidate nominated', description: 'This appoints nobody and promises nothing.' });
        setNominateOpen(false);
        setNomineeId('');
        setNomineeReadinessId('');
        setNomineeRationale('');
        refreshCandidates();
      },
      onError: onError('Could not nominate'),
    },
  });

  const setReadiness = useSetSuccessionReadiness({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Readiness updated' });
        refreshCandidates();
      },
      onError: onError('Could not update readiness'),
    },
  });

  const removeCandidate = useRemoveSuccessionCandidate({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Candidate removed', description: 'The record is retained with the reason.' });
        setRemovingId(null);
        setRemoveReason('');
        refreshCandidates();
      },
      onError: onError('Could not remove'),
    },
  });

  const createBand = useCreateReadinessLevel({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Readiness band added' });
        setBandOpen(false);
        setBandLabel('');
        void queryClient.invalidateQueries({ queryKey: getListReadinessLevelsQueryKey(organizationId) });
      },
      onError: onError('Could not add'),
    },
  });

  const positionsById = new Map((positions.data ?? []).map((p) => [p.id, p]));
  const employeeOptions = employees.data?.items ?? [];
  const employeesById = new Map(employeeOptions.map((e) => [e.id, e]));
  const employeeName = (id: number) => {
    const e = employeesById.get(id);
    return e ? [e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee #${id}` : `Employee #${id}`;
  };

  // Candidates are grouped by readiness band. They are NOT ordered within one:
  // a band is the whole judgement, and §30.12 forbids ranking inside it.
  const bands = new Map<string, typeof candidates.data>();
  for (const c of candidates.data ?? []) {
    const key = c.readinessLabel ?? 'Readiness not yet set';
    const list = bands.get(key) ?? [];
    list.push(c);
    bands.set(key, list);
  }

  return (
    <div className="space-y-6" data-testid="page-succession">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Network className="h-6 w-6" aria-hidden="true" />
          Succession
        </h1>
        <p className="text-muted-foreground mt-1 flex items-center gap-2">
          <Lock className="h-4 w-4" aria-hidden="true" />
          Confidential. Candidates, rationales and criticality notes are never shown to the employees they concern.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="plans">Positions &amp; candidates</TabsTrigger>
          <TabsTrigger value="bands">Readiness bands</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
        </TabsList>

        {/* --- Plans, confidential notes and candidates (rows 11, 12, 13) --- */}
        <TabsContent value="plans" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Succession-managed positions</CardTitle>
                  <CardDescription>
                    Opening a plan marks a position as one the organization is planning for. It changes nothing about
                    the position and appoints nobody.
                  </CardDescription>
                </div>
                {!planFormOpen && (
                  <Button onClick={() => setPlanFormOpen(true)} data-testid="button-open-plan-form">
                    <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                    Open a plan
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {planFormOpen && (
                <form
                  className="space-y-4 border rounded-md p-4"
                  data-testid="form-create-plan"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!planPositionId) return;
                    createPlan.mutate({
                      organizationId,
                      data: {
                        positionId: Number(planPositionId),
                        ...(planNotes.trim() ? { criticalityNotes: planNotes.trim() } : {}),
                        ...(planReviewDue ? { reviewDueAt: new Date(planReviewDue).toISOString() } : {}),
                      },
                    });
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plan-position">Position</Label>
                      <select
                        id="plan-position"
                        className={SELECT_CLASS}
                        value={planPositionId}
                        onChange={(e) => setPlanPositionId(e.target.value)}
                        data-testid="select-plan-position"
                      >
                        <option value="">Choose a position</option>
                        {(positions.data ?? []).map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-review">Review due (optional)</Label>
                      <Input
                        id="plan-review"
                        type="date"
                        value={planReviewDue}
                        onChange={(e) => setPlanReviewDue(e.target.value)}
                        data-testid="input-plan-review-due"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-notes">Why this position is critical (confidential)</Label>
                    <Textarea
                      id="plan-notes"
                      rows={3}
                      value={planNotes}
                      onChange={(e) => setPlanNotes(e.target.value)}
                      data-testid="input-plan-notes"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={!planPositionId || createPlan.isPending}
                      data-testid="button-submit-plan"
                    >
                      {createPlan.isPending ? 'Opening…' : 'Open plan'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setPlanFormOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {plans.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : plans.error ? (
                <QueryError onRetry={() => void plans.refetch()} />
              ) : (plans.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-plans">
                  No positions are succession-managed yet.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-plans">
                  {(plans.data ?? []).map((p) => {
                    const status = PLAN_STATUS[p.status] ?? { label: p.status, className: 'bg-muted' };
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                        data-testid={`row-plan-${p.id}`}
                      >
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {positionsById.get(p.positionId)?.title ?? `Position #${p.positionId}`}
                          </span>
                          <Badge className={status.className}>{status.label}</Badge>
                          {p.reviewDueAt && (
                            <span className="text-sm text-muted-foreground">
                              Review due {new Date(p.reviewDueAt).toLocaleDateString()}
                            </span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant={selectedPlanId === p.id ? 'default' : 'outline'}
                          onClick={() => setSelectedPlanId(selectedPlanId === p.id ? null : p.id)}
                          data-testid={`button-open-plan-${p.id}`}
                        >
                          {selectedPlanId === p.id ? 'Close' : 'Open'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedPlanId && (
            <Card data-testid="card-plan-detail">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Lock className="h-5 w-5" aria-hidden="true" />
                      {positionsById.get(planDetail.data?.positionId ?? 0)?.title ?? 'Plan'}
                    </CardTitle>
                    <CardDescription>
                      Opening this view is recorded. Candidates are grouped by readiness band — they are not ranked, and
                      there is no first successor.
                    </CardDescription>
                  </div>
                  {!nominateOpen && (
                    <Button onClick={() => setNominateOpen(true)} data-testid="button-open-nominate">
                      <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                      Nominate
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {planDetail.isLoading ? (
                  <Skeleton className="h-16 w-full" />
                ) : planDetail.error ? (
                  <QueryError onRetry={() => void planDetail.refetch()} />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="detail-notes">Why this position is critical (confidential)</Label>
                      <Textarea
                        id="detail-notes"
                        rows={3}
                        defaultValue={planDetail.data?.criticalityNotes ?? ''}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next === (planDetail.data?.criticalityNotes ?? '')) return;
                          updatePlan.mutate({
                            organizationId,
                            planId: selectedPlanId,
                            data: { criticalityNotes: next },
                          });
                        }}
                        data-testid="input-detail-notes"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['active', 'under_review', 'closed'] as const).map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={planDetail.data?.status === s ? 'default' : 'outline'}
                          disabled={updatePlan.isPending}
                          onClick={() => {
                            // Closing stops new nominations and drops the plan
                            // from coverage, so it is confirmed first.
                            if (s === 'closed' && planDetail.data?.status !== 'closed') {
                              setClosePlanOpen(true);
                              return;
                            }
                            updatePlan.mutate({ organizationId, planId: selectedPlanId, data: { status: s } });
                          }}
                          data-testid={`button-plan-status-${s}`}
                        >
                          {PLAN_STATUS[s].label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {nominateOpen && (
                  <form
                    className="space-y-4 border rounded-md p-4"
                    data-testid="form-nominate"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!nomineeId) return;
                      nominate.mutate({
                        organizationId,
                        planId: selectedPlanId,
                        data: {
                          employeeId: Number(nomineeId),
                          ...(nomineeReadinessId ? { readinessLevelId: Number(nomineeReadinessId) } : {}),
                          ...(nomineeRationale.trim() ? { rationale: nomineeRationale.trim() } : {}),
                        },
                      });
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="nominee">Employee</Label>
                        <select
                          id="nominee"
                          className={SELECT_CLASS}
                          value={nomineeId}
                          onChange={(e) => setNomineeId(e.target.value)}
                          data-testid="select-nominee"
                        >
                          <option value="">Choose an employee</option>
                          {employeeOptions.map((e) => (
                            <option key={e.id} value={String(e.id)}>
                              {[e.firstName, e.lastName].filter(Boolean).join(' ') || `Employee #${e.id}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="nominee-readiness">Readiness (a human judgement)</Label>
                        <select
                          id="nominee-readiness"
                          className={SELECT_CLASS}
                          value={nomineeReadinessId}
                          onChange={(e) => setNomineeReadinessId(e.target.value)}
                          data-testid="select-nominee-readiness"
                        >
                          <option value="">Not yet assessed</option>
                          {(readinessLevels.data ?? []).map((l) => (
                            <option key={l.id} value={String(l.id)}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nominee-rationale">Rationale (confidential)</Label>
                      <Textarea
                        id="nominee-rationale"
                        rows={2}
                        value={nomineeRationale}
                        onChange={(e) => setNomineeRationale(e.target.value)}
                        data-testid="input-nominee-rationale"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" disabled={!nomineeId || nominate.isPending} data-testid="button-submit-nominate">
                        {nominate.isPending ? 'Nominating…' : 'Nominate'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setNominateOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}

                {candidates.isLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : candidates.error ? (
                  <QueryError onRetry={() => void candidates.refetch()} />
                ) : (candidates.data ?? []).length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground" data-testid="text-no-candidates">
                    No candidates have been nominated for this position.
                  </p>
                ) : (
                  <div className="space-y-4" data-testid="list-candidates">
                    {[...bands.entries()].map(([band, list]) => (
                      <div key={band} className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">{band}</p>
                        {(list ?? []).map((c) => (
                          <div key={c.id} className="border rounded-md px-3 py-2 space-y-2" data-testid={`row-candidate-${c.id}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <span className="font-medium">{employeeName(c.employeeId)}</span>
                                {c.rationale && <p className="text-sm text-muted-foreground mt-1">{c.rationale}</p>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <select
                                  className={`${SELECT_CLASS} max-w-[12rem]`}
                                  value={String(c.readinessLevelId ?? '')}
                                  onChange={(e) => {
                                    if (!e.target.value) return;
                                    setReadiness.mutate({
                                      organizationId,
                                      candidateId: c.id,
                                      data: { readinessLevelId: Number(e.target.value) },
                                    });
                                  }}
                                  data-testid={`select-readiness-${c.id}`}
                                >
                                  <option value="">Not yet assessed</option>
                                  {(readinessLevels.data ?? []).map((l) => (
                                    <option key={l.id} value={String(l.id)}>
                                      {l.label}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setRemovingId(removingId === c.id ? null : c.id);
                                    setRemoveReason('');
                                  }}
                                  data-testid={`button-remove-candidate-${c.id}`}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                            {removingId === c.id && (
                              <div className="flex gap-2 items-end" data-testid={`panel-remove-${c.id}`}>
                                <div className="flex-1 space-y-2">
                                  <Label htmlFor={`remove-reason-${c.id}`}>Reason (required, and kept on the record)</Label>
                                  <Input
                                    id={`remove-reason-${c.id}`}
                                    value={removeReason}
                                    onChange={(e) => setRemoveReason(e.target.value)}
                                    data-testid={`input-remove-reason-${c.id}`}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  disabled={removeReason.trim().length === 0 || removeCandidate.isPending}
                                  onClick={() =>
                                    removeCandidate.mutate({
                                      organizationId,
                                      candidateId: c.id,
                                      data: { reason: removeReason.trim() },
                                    })
                                  }
                                  data-testid={`button-confirm-remove-${c.id}`}
                                >
                                  Confirm
                                </Button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
              {/* The hook's own onSuccess/onError toast and refresh. */}
              <ConfirmActionDialog
                open={closePlanOpen}
                onOpenChange={setClosePlanOpen}
                title="Close succession plan?"
                description={`The succession plan for “${
                  positionsById.get(planDetail.data?.positionId ?? 0)?.title ?? 'this position'
                }” will be closed. No new candidates can be nominated to it and it will no longer count toward succession coverage. Its candidates and history are kept.`}
                confirmLabel="Close Plan"
                onConfirm={() =>
                  updatePlan.mutateAsync({ organizationId, planId: selectedPlanId, data: { status: 'closed' } })
                }
                testId="dialog-close-plan"
              />
            </Card>
          )}
        </TabsContent>

        {/* --- Readiness bands --- */}
        <TabsContent value="bands" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Readiness bands</CardTitle>
                  <CardDescription>
                    How soon somebody could step up. A band is chosen by a person every time — nothing computes it, and
                    no scheduled process can change it.
                  </CardDescription>
                </div>
                {!bandOpen && (
                  <Button onClick={() => setBandOpen(true)} data-testid="button-open-band-form">
                    <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                    Add a band
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {bandOpen && (
                <form
                  className="space-y-4 border rounded-md p-4"
                  data-testid="form-create-band"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!bandLabel.trim()) return;
                    createBand.mutate({
                      organizationId,
                      data: { label: bandLabel.trim(), ordinal: Number(bandOrdinal) || 1 },
                    });
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="band-label">Label</Label>
                      <Input
                        id="band-label"
                        value={bandLabel}
                        onChange={(e) => setBandLabel(e.target.value)}
                        placeholder="Ready now"
                        data-testid="input-band-label"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="band-ordinal">Order (1 is the nearest term)</Label>
                      <Input
                        id="band-ordinal"
                        type="number"
                        min={1}
                        value={bandOrdinal}
                        onChange={(e) => setBandOrdinal(e.target.value)}
                        data-testid="input-band-ordinal"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!bandLabel.trim() || createBand.isPending} data-testid="button-submit-band">
                      {createBand.isPending ? 'Adding…' : 'Add band'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setBandOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {readinessLevels.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : readinessLevels.error ? (
                <QueryError onRetry={() => void readinessLevels.refetch()} />
              ) : (readinessLevels.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-bands">
                  No readiness bands are configured yet.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-bands">
                  {(readinessLevels.data ?? []).map((l) => (
                    <div
                      key={l.id}
                      className="flex items-center gap-2 border rounded-md px-3 py-2"
                      data-testid={`row-band-${l.id}`}
                    >
                      <Badge variant="outline">{l.ordinal}</Badge>
                      <span>{l.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Coverage reporting (row 15) --- */}
        <TabsContent value="coverage" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" aria-hidden="true" />
                Succession coverage
              </CardTitle>
              <CardDescription>
                Counts only. This report deliberately carries no candidate name, rationale or confidential note, so it
                can be read by someone who cannot open the plans themselves.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {coverage.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : coverage.error ? (
                <QueryError onRetry={() => void coverage.refetch()} />
              ) : (coverage.data?.coverage ?? []).length === 0 ? (
                <p className="py-6 text-center text-muted-foreground" data-testid="text-no-coverage">
                  No succession plans to report on.
                </p>
              ) : (
                <div className="space-y-2" data-testid="list-coverage">
                  {(coverage.data?.coverage ?? []).map((row) => (
                    <div
                      key={row.planId}
                      className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
                      data-testid={`row-coverage-${row.planId}`}
                    >
                      <span className="font-medium">{row.positionTitle}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {row.hasNoCandidates ? (
                          <Badge className="bg-amber-100 text-amber-900">No candidates</Badge>
                        ) : (
                          <>
                            <Badge variant="secondary">{row.candidateCount} candidate(s)</Badge>
                            <Badge variant="outline">{row.nearestTermReadyCount} in the nearest band</Badge>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
