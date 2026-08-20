import { useState } from 'react';
import { Users, Send, Plus, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListTeamPerformanceReviews,
  getListTeamPerformanceReviewsQueryKey,
  useGetPerformanceReview,
  getGetPerformanceReviewQueryKey,
  useGetPerformanceRatingScale,
  getGetPerformanceRatingScaleQueryKey,
  useRateCompetency,
  useCreatePerformanceReviewGoal,
  useUpdatePerformanceReviewGoal,
  useAcceptPerformanceReviewGoal,
  useRejectPerformanceReviewGoal,
  useSubmitManagerReview,
  CreatePerformanceReviewGoalInputMeasurementType,
  type PerformanceReviewCompetency,
  type PerformanceGoal,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  self_assessment: 'Self-Assessment',
  manager_review: 'Manager Review',
  hr_review: 'HR Review',
  finalized: 'Finalized',
  acknowledged: 'Acknowledged',
};

const GOAL_APPROVAL_LABEL: Record<string, string> = {
  accepted: 'Official',
  proposed: 'Proposed — needs your decision',
  rejected: 'Not accepted',
};

const GOAL_APPROVAL_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  accepted: 'secondary',
  proposed: 'outline',
  rejected: 'destructive',
};

function CompetencyManagerRow({
  competency,
  levels,
  locked,
  onSave,
  isSaving,
}: {
  competency: PerformanceReviewCompetency;
  levels: { id: number; value: number; label: string }[];
  locked: boolean;
  onSave: (fields: { managerRatingValue?: number; managerComment?: string; notApplicable?: boolean; notApplicableReason?: string }) => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState(competency.managerRatingValue != null ? String(competency.managerRatingValue) : '');
  const [comment, setComment] = useState(competency.managerComment ?? '');
  const [notApplicable, setNotApplicable] = useState(competency.notApplicable);
  const [reason, setReason] = useState(competency.notApplicableReason ?? '');

  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`row-manager-competency-${competency.id}`}>
      <div>
        <p className="font-medium text-sm text-foreground">{competency.label}</p>
        {competency.description && <p className="text-xs text-muted-foreground">{competency.description}</p>}
        <p className="text-xs text-muted-foreground mt-1">
          Employee self-rating: {competency.employeeRatingValue ?? '—'}{competency.employeeComment ? ` — "${competency.employeeComment}"` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`competency-na-${competency.id}`}
          checked={notApplicable}
          onCheckedChange={(v) => setNotApplicable(v === true)}
          disabled={locked}
          data-testid={`checkbox-competency-na-${competency.id}`}
        />
        <Label htmlFor={`competency-na-${competency.id}`}>Not applicable</Label>
      </div>
      {notApplicable ? (
        <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={locked} data-testid={`input-competency-na-reason-${competency.id}`} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
          <div className="space-y-1">
            <Label htmlFor={`manager-rating-${competency.id}`}>Manager Rating</Label>
            <Select value={value} onValueChange={setValue} disabled={locked}>
              <SelectTrigger id={`manager-rating-${competency.id}`} data-testid={`select-manager-rating-${competency.id}`}>
                <SelectValue placeholder="Choose a rating" />
              </SelectTrigger>
              <SelectContent>
                {levels.map((l) => (
                  <SelectItem key={l.id} value={String(l.value)}>{l.label} ({l.value})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`manager-comment-${competency.id}`}>Comment</Label>
            <Textarea id={`manager-comment-${competency.id}`} value={comment} onChange={(e) => setComment(e.target.value)} disabled={locked} data-testid={`textarea-manager-comment-${competency.id}`} />
          </div>
        </div>
      )}
      {!locked && (
        <Button
          size="sm"
          disabled={isSaving || (notApplicable && !reason.trim())}
          onClick={() => onSave(notApplicable ? { notApplicable: true, notApplicableReason: reason } : { managerRatingValue: value ? Number(value) : undefined, managerComment: comment })}
          data-testid={`button-save-manager-competency-${competency.id}`}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      )}
    </div>
  );
}

function ManagerGoalCard({
  goal,
  locked,
  onAccept,
  onReject,
  onSaveResult,
  isSaving,
}: {
  goal: PerformanceGoal;
  locked: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
  onSaveResult: (fields: { actualResult?: number | null; managerComment?: string; notApplicable?: boolean; notApplicableReason?: string }) => void;
  isSaving: boolean;
}) {
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [actualResult, setActualResult] = useState(goal.actualResult ?? '');
  const [comment, setComment] = useState(goal.managerComment ?? '');
  const [notApplicable, setNotApplicable] = useState(goal.notApplicable);
  const [naReason, setNaReason] = useState(goal.notApplicableReason ?? '');

  const needsResult = goal.approvalStatus === 'accepted' && goal.measurementType !== 'qualitative';
  const showResultField = needsResult && goal.measurementType !== 'boolean' && goal.measurementType !== 'rating';

  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`row-manager-goal-${goal.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-foreground">{goal.title}</p>
          <p className="text-xs text-muted-foreground capitalize">{goal.measurementType} · weight {goal.weight}</p>
          {goal.employeeComment && <p className="text-xs text-muted-foreground mt-1">Employee comment: "{goal.employeeComment}"</p>}
        </div>
        <Badge variant={GOAL_APPROVAL_VARIANT[goal.approvalStatus]} data-testid={`badge-manager-goal-status-${goal.id}`}>
          {GOAL_APPROVAL_LABEL[goal.approvalStatus]}
        </Badge>
      </div>

      {goal.approvalStatus === 'proposed' && !locked && (
        <div className="flex flex-col sm:flex-row gap-2">
          <Button size="sm" onClick={onAccept} disabled={isSaving} data-testid={`button-accept-goal-${goal.id}`}>
            <Check className="h-4 w-4" aria-hidden="true" />
            Accept
          </Button>
          {showReject ? (
            <div className="flex flex-1 gap-2">
              <Input placeholder="Reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} data-testid={`input-reject-reason-${goal.id}`} />
              <Button size="sm" variant="destructive" disabled={!rejectReason.trim() || isSaving} onClick={() => onReject(rejectReason)} data-testid={`button-confirm-reject-goal-${goal.id}`}>
                Confirm
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowReject(true)} data-testid={`button-reject-goal-${goal.id}`}>
              <X className="h-4 w-4" aria-hidden="true" />
              Reject
            </Button>
          )}
        </div>
      )}

      {needsResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox id={`goal-na-${goal.id}`} checked={notApplicable} onCheckedChange={(v) => setNotApplicable(v === true)} disabled={locked} data-testid={`checkbox-goal-na-${goal.id}`} />
            <Label htmlFor={`goal-na-${goal.id}`}>Not applicable</Label>
          </div>
          {notApplicable ? (
            <Input placeholder="Reason (required)" value={naReason} onChange={(e) => setNaReason(e.target.value)} disabled={locked} data-testid={`input-goal-na-reason-${goal.id}`} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {showResultField && (
                <div className="space-y-1">
                  <Label htmlFor={`goal-actual-${goal.id}`}>Actual Result</Label>
                  <Input id={`goal-actual-${goal.id}`} type="number" value={actualResult ?? ''} onChange={(e) => setActualResult(e.target.value)} disabled={locked} data-testid={`input-goal-actual-${goal.id}`} />
                </div>
              )}
              {goal.measurementType === 'boolean' && (
                <div className="space-y-1">
                  <Label htmlFor={`goal-actual-${goal.id}`}>Completed?</Label>
                  <Select value={String(actualResult ?? '')} onValueChange={setActualResult} disabled={locked}>
                    <SelectTrigger id={`goal-actual-${goal.id}`} data-testid={`select-goal-actual-${goal.id}`}>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Yes</SelectItem>
                      <SelectItem value="0">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor={`goal-manager-comment-${goal.id}`}>Manager Comment</Label>
                <Textarea id={`goal-manager-comment-${goal.id}`} value={comment} onChange={(e) => setComment(e.target.value)} disabled={locked} data-testid={`textarea-goal-manager-comment-${goal.id}`} />
              </div>
            </div>
          )}
          {!locked && (
            <Button
              size="sm"
              disabled={isSaving || (notApplicable && !naReason.trim())}
              onClick={() =>
                onSaveResult(
                  notApplicable
                    ? { notApplicable: true, notApplicableReason: naReason }
                    : { actualResult: actualResult === '' ? undefined : Number(actualResult), managerComment: comment },
                )
              }
              data-testid={`button-save-goal-result-${goal.id}`}
            >
              {isSaving ? 'Saving…' : 'Save Result'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// My Team Reviews (W78): a dedicated manager-facing page, deliberately
// NOT inside employee ESS — §18's own frozen surface (/performance-team),
// ModuleGate-wrapped via SecureRoute, nav-gated isHrCapable (matching
// every other Performance HR/manager page's own convention). Backend
// authorization remains the source of truth (reviewer-of-record via
// reviewerEmployeeId) regardless of nav visibility.
export default function PerformanceTeam() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalMeasurementType, setGoalMeasurementType] = useState<CreatePerformanceReviewGoalInputMeasurementType | ''>('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalWeight, setGoalWeight] = useState('0');

  const reviewsQuery = useListTeamPerformanceReviews(organizationId, {
    query: { queryKey: getListTeamPerformanceReviewsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const reviews = reviewsQuery.data ?? [];

  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const employeeById = new Map((employeesPage?.items ?? []).map((e) => [e.id, e]));

  const detailQuery = useGetPerformanceReview(organizationId, selectedReviewId ?? 0, {
    query: { queryKey: getGetPerformanceReviewQueryKey(organizationId, selectedReviewId ?? 0), enabled: organizationId > 0 && !!selectedReviewId },
  });
  const detail = detailQuery.data;
  const review = detail?.review;
  const scaleId = review?.ratingScaleId;

  const scaleQuery = useGetPerformanceRatingScale(organizationId, scaleId ?? 0, {
    query: { queryKey: getGetPerformanceRatingScaleQueryKey(organizationId, scaleId ?? 0), enabled: organizationId > 0 && !!scaleId },
  });
  const levels = scaleQuery.data?.levels ?? [];

  const rateMutation = useRateCompetency();
  const createGoalMutation = useCreatePerformanceReviewGoal();
  const updateGoalMutation = useUpdatePerformanceReviewGoal();
  const acceptMutation = useAcceptPerformanceReviewGoal();
  const rejectMutation = useRejectPerformanceReviewGoal();
  const submitMutation = useSubmitManagerReview();

  const invalidateDetail = () => {
    if (selectedReviewId) queryClient.invalidateQueries({ queryKey: getGetPerformanceReviewQueryKey(organizationId, selectedReviewId) });
    queryClient.invalidateQueries({ queryKey: getListTeamPerformanceReviewsQueryKey(organizationId) });
  };

  const resetGoalForm = () => {
    setGoalTitle('');
    setGoalMeasurementType('');
    setGoalTarget('');
    setGoalWeight('0');
  };

  const handleCreateGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReviewId || !goalTitle.trim() || !goalMeasurementType) return;
    createGoalMutation.mutate(
      { organizationId, id: selectedReviewId, data: { title: goalTitle.trim(), measurementType: goalMeasurementType, target: goalTarget === '' ? undefined : Number(goalTarget), weight: Number(goalWeight) } },
      {
        onSuccess: () => { setCreateGoalOpen(false); resetGoalForm(); invalidateDetail(); toast({ title: 'Official goal created' }); },
        onError: (err) => toast({ title: 'Could not create goal', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const isLocked = review ? review.status !== 'manager_review' : true;

  if (reviewsQuery.isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (reviewsQuery.error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load your team's reviews" onRetry={() => reviewsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-7 w-7 text-primary" aria-hidden="true" />
          My Team Reviews
        </h1>
        <p className="text-muted-foreground">Reviews where you are the assigned reviewer</p>
      </div>

      {reviews.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No team reviews assigned</h3>
            <p className="text-sm text-muted-foreground max-w-sm">You aren't the assigned reviewer on any Performance review right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reviews.map((r) => {
            const employee = employeeById.get(r.employeeId);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedReviewId(r.id)}
                className="w-full text-left"
                data-testid={`row-team-review-${r.id}`}
              >
                <Card className={selectedReviewId === r.id ? 'border-primary' : undefined}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium text-sm text-foreground">
                        {employee ? `${employee.firstName} ${employee.lastName}` : `Employee #${r.employeeId}`}
                      </p>
                      <p className="text-xs text-muted-foreground">Review #{r.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.computedOverallScore != null && <Badge variant="secondary">Score: {r.computedOverallScore}</Badge>}
                      <Badge variant={r.status === 'manager_review' ? 'outline' : 'secondary'}>{REVIEW_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {selectedReviewId && (
        detailQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : detailQuery.error ? (
          <QueryError title="Could not load this review" onRetry={() => detailQuery.refetch()} />
        ) : detail && review ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Review #{review.id} — {REVIEW_STATUS_LABEL[review.status] ?? review.status}</CardTitle>
                <CardDescription>
                  {isLocked ? 'This review is no longer awaiting your action.' : 'Review the employee\'s self-assessment, resolve proposed goals, record results and ratings, then submit.'}
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Goals</CardTitle>
                  {!isLocked && (
                    <Dialog open={createGoalOpen} onOpenChange={(open) => { setCreateGoalOpen(open); if (!open) resetGoalForm(); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary" data-testid="button-create-official-goal">
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Add Official Goal
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <form onSubmit={handleCreateGoal}>
                          <DialogHeader>
                            <DialogTitle>Add an Official Goal</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label htmlFor="manager-goal-title">Title *</Label>
                              <Input id="manager-goal-title" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} required data-testid="input-manager-goal-title" />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="manager-goal-type">Measurement Type *</Label>
                              <Select value={goalMeasurementType} onValueChange={(v) => setGoalMeasurementType(v as CreatePerformanceReviewGoalInputMeasurementType)}>
                                <SelectTrigger id="manager-goal-type" data-testid="select-manager-goal-type">
                                  <SelectValue placeholder="Choose a type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="numeric">Numeric</SelectItem>
                                  <SelectItem value="percentage">Percentage</SelectItem>
                                  <SelectItem value="currency">Currency</SelectItem>
                                  <SelectItem value="boolean">Yes/No</SelectItem>
                                  <SelectItem value="rating">Rating</SelectItem>
                                  <SelectItem value="qualitative">Qualitative</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {(goalMeasurementType === 'numeric' || goalMeasurementType === 'percentage' || goalMeasurementType === 'currency') && (
                              <div className="space-y-2">
                                <Label htmlFor="manager-goal-target">Target *</Label>
                                <Input id="manager-goal-target" type="number" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} data-testid="input-manager-goal-target" />
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label htmlFor="manager-goal-weight">Weight</Label>
                              <Input id="manager-goal-weight" type="number" value={goalWeight} onChange={(e) => setGoalWeight(e.target.value)} disabled={goalMeasurementType === 'qualitative'} data-testid="input-manager-goal-weight" />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button type="submit" disabled={createGoalMutation.isPending} data-testid="button-submit-create-official-goal">
                              {createGoalMutation.isPending ? 'Adding…' : 'Add Goal'}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.goals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No goals yet.</p>
                ) : (
                  detail.goals.map((goal) => (
                    <ManagerGoalCard
                      key={goal.id}
                      goal={goal}
                      locked={isLocked}
                      isSaving={acceptMutation.isPending || rejectMutation.isPending || updateGoalMutation.isPending}
                      onAccept={() =>
                        acceptMutation.mutate(
                          { organizationId, id: review.id, goalId: goal.id },
                          { onSuccess: () => { invalidateDetail(); toast({ title: 'Goal accepted' }); }, onError: (err) => toast({ title: 'Could not accept goal', description: errorMessage(err), variant: 'destructive' }) },
                        )
                      }
                      onReject={(reason) =>
                        rejectMutation.mutate(
                          { organizationId, id: review.id, goalId: goal.id, data: { reason } },
                          { onSuccess: () => { invalidateDetail(); toast({ title: 'Goal rejected' }); }, onError: (err) => toast({ title: 'Could not reject goal', description: errorMessage(err), variant: 'destructive' }) },
                        )
                      }
                      onSaveResult={(fields) =>
                        updateGoalMutation.mutate(
                          { organizationId, id: review.id, goalId: goal.id, data: fields },
                          { onSuccess: () => { invalidateDetail(); toast({ title: 'Result saved' }); }, onError: (err) => toast({ title: 'Could not save result', description: errorMessage(err), variant: 'destructive' }) },
                        )
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Competencies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.competencies.map((competency) => (
                  <CompetencyManagerRow
                    key={competency.id}
                    competency={competency}
                    levels={levels}
                    locked={isLocked}
                    isSaving={rateMutation.isPending}
                    onSave={(fields) =>
                      rateMutation.mutate(
                        { organizationId, id: review.id, competencyId: competency.id, data: fields },
                        { onSuccess: () => { invalidateDetail(); toast({ title: 'Saved' }); }, onError: (err) => toast({ title: 'Could not save', description: errorMessage(err), variant: 'destructive' }) },
                      )
                    }
                  />
                ))}
              </CardContent>
            </Card>

            {!isLocked && (
              <Card>
                <CardContent className="py-6 space-y-3">
                  {submitMutation.isError && (
                    <div className="text-sm text-destructive space-y-1" data-testid="text-manager-submission-problems">
                      <p className="font-medium">This review isn't ready to submit:</p>
                      <ul className="list-disc list-inside">
                        {(((submitMutation.error as { problems?: string[] })?.problems) ?? [errorMessage(submitMutation.error) ?? 'Please review your entries.']).map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button
                    onClick={() =>
                      submitMutation.mutate(
                        { organizationId, id: review.id },
                        { onSuccess: () => { invalidateDetail(); toast({ title: 'Manager review submitted', description: 'This review now moves to HR review.' }); }, onError: () => {} },
                      )
                    }
                    disabled={submitMutation.isPending}
                    data-testid="button-submit-manager-review"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {submitMutation.isPending ? 'Submitting…' : 'Submit Manager Review'}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null
      )}
    </div>
  );
}
