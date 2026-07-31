import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, ClipboardList, Plus, X, Lock, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetInterview,
  getGetInterviewQueryKey,
  useListInterviewScorecards,
  getListInterviewScorecardsQueryKey,
  useSaveInterviewScorecard,
  useFinalizeInterviewScorecard,
  useListMembers,
  getListMembersQueryKey,
  type ResponseInput,
  type SaveInterviewScorecardInputRecommendation,
  type InterviewScorecard as InterviewScorecardType,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  strong_yes: 'Strong Yes',
  yes: 'Yes',
  no: 'No',
  strong_no: 'Strong No',
};

const RECOMMENDATION_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  strong_yes: 'secondary',
  yes: 'secondary',
  no: 'destructive',
  strong_no: 'destructive',
};

/**
 * Owns its own draft form state, lazily initialized once from `myScorecard`
 * at mount time — the parent only renders this after its own data has
 * already loaded, so a fresh mount always sees correct initial values
 * (existing draft/submitted content, or a blank new-draft form) without
 * needing an effect to re-derive state from later-arriving props.
 */
function MyEvaluationCard({
  organizationId,
  interviewId,
  myScorecard,
  onSaved,
}: {
  organizationId: number;
  interviewId: number;
  myScorecard: InterviewScorecardType | undefined;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const saveMutation = useSaveInterviewScorecard();
  const isMySubmitted = myScorecard?.submittedAt != null;

  const [recommendation, setRecommendation] = useState<string>(() => myScorecard?.recommendation ?? '');
  const [overallComment, setOverallComment] = useState(() => myScorecard?.overallComment ?? '');
  const [responses, setResponses] = useState<ResponseInput[]>(() =>
    myScorecard?.responses.length
      ? myScorecard.responses.map((r) => ({ criterion: r.criterion, rating: r.rating, comment: r.comment }))
      : [{ criterion: '', rating: null, comment: '' }],
  );
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);

  const addResponseRow = () => setResponses((prev) => [...prev, { criterion: '', rating: null, comment: '' }]);
  const removeResponseRow = (index: number) => setResponses((prev) => prev.filter((_, i) => i !== index));
  const updateResponseRow = (index: number, patch: Partial<ResponseInput>) => setResponses((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const buildPayload = () => ({
    recommendation: (recommendation || null) as SaveInterviewScorecardInputRecommendation,
    overallComment: overallComment.trim() || null,
    responses: responses.filter((r) => r.criterion.trim()).map((r) => ({ criterion: r.criterion.trim(), rating: r.rating ?? null, comment: r.comment?.trim() || null })),
  });

  const handleSaveDraft = () => {
    saveMutation.mutate(
      { organizationId, id: interviewId, data: { ...buildPayload(), submit: false } },
      {
        onSuccess: () => { onSaved(); toast({ title: 'Draft saved' }); },
        onError: (err) => toast({ title: 'Could not save draft', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSubmit = () => {
    saveMutation.mutate(
      { organizationId, id: interviewId, data: { ...buildPayload(), submit: true } },
      {
        onSuccess: () => { onSaved(); setSubmitConfirmOpen(false); toast({ title: 'Evaluation submitted' }); },
        onError: (err) => { setSubmitConfirmOpen(false); toast({ title: 'Could not submit evaluation', description: errorMessage(err), variant: 'destructive' }); },
      },
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Your Evaluation
            {isMySubmitted && (
              myScorecard?.finalizedAt ? (
                <Badge variant="outline" className="flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" />Finalized</Badge>
              ) : (
                <Badge variant="secondary" className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Submitted</Badge>
              )
            )}
          </CardTitle>
          <CardDescription>{isMySubmitted ? 'Submitted — read-only and immutable' : 'Draft — save as you go, submit when ready'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recommendation">Recommendation</Label>
            <Select value={recommendation} onValueChange={setRecommendation} disabled={isMySubmitted}>
              <SelectTrigger id="recommendation" data-testid="select-recommendation">
                <SelectValue placeholder="Select a recommendation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strong_yes">Strong Yes</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="strong_no">Strong No</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="overall-comment">Overall Comment</Label>
            <Textarea id="overall-comment" value={overallComment} onChange={(e) => setOverallComment(e.target.value)} rows={3} disabled={isMySubmitted} data-testid="input-overall-comment" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Criteria</Label>
              {!isMySubmitted && (
                <Button type="button" size="sm" variant="outline" onClick={addResponseRow} data-testid="button-add-criterion">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add Criterion
                </Button>
              )}
            </div>
            {responses.map((r, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-start" data-testid={`row-criterion-${i}`}>
                <Input placeholder="Criterion (e.g. Communication)" value={r.criterion} onChange={(e) => updateResponseRow(i, { criterion: e.target.value })} disabled={isMySubmitted} className="flex-1 min-w-[160px]" data-testid={`input-criterion-${i}`} />
                <Input type="number" placeholder="Rating" value={r.rating ?? ''} onChange={(e) => updateResponseRow(i, { rating: e.target.value === '' ? null : Number(e.target.value) })} disabled={isMySubmitted} className="w-24" data-testid={`input-rating-${i}`} />
                <Input placeholder="Comment (optional)" value={r.comment ?? ''} onChange={(e) => updateResponseRow(i, { comment: e.target.value })} disabled={isMySubmitted} className="flex-1 min-w-[160px]" data-testid={`input-criterion-comment-${i}`} />
                {!isMySubmitted && responses.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeResponseRow(i)} data-testid={`button-remove-criterion-${i}`}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {!isMySubmitted && (
            <div className="flex gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={handleSaveDraft} disabled={saveMutation.isPending} data-testid="button-save-draft">
                {saveMutation.isPending ? 'Saving…' : 'Save Draft'}
              </Button>
              <Button onClick={() => setSubmitConfirmOpen(true)} disabled={saveMutation.isPending} data-testid="button-open-submit-confirm">
                Submit Evaluation
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Evaluation</DialogTitle>
            <DialogDescription>
              Once submitted, your evaluation becomes immutable and cannot be changed. Are you sure you want to submit?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitConfirmOpen(false)} data-testid="button-cancel-submit">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending} data-testid="button-confirm-submit-scorecard">
              {saveMutation.isPending ? 'Submitting…' : 'Confirm Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function InterviewScorecard() {
  const params = useParams<{ id: string }>();
  const interviewId = Number(params.id);
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: interview, isLoading: interviewLoading, error: interviewError, refetch: refetchInterview } = useGetInterview(organizationId, interviewId, {
    query: { queryKey: getGetInterviewQueryKey(organizationId, interviewId), enabled: organizationId > 0 && interviewId > 0 },
  });

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListInterviewScorecards(organizationId, interviewId, {
    query: { queryKey: getListInterviewScorecardsQueryKey(organizationId, interviewId), enabled: organizationId > 0 && interviewId > 0 },
  });

  const { data: members } = useListMembers(organizationId, { query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 } });
  const memberById = new Map((members ?? []).map((m) => [m.membershipId, m]));
  const myMembershipId = (members ?? []).find((m) => m.applicationUserId === user?.id)?.membershipId;

  const finalizeMutation = useFinalizeInterviewScorecard();
  const { toast } = useToast();

  const isReadAll = result?.panelSummary != null;
  const myScorecard = (result?.scorecards ?? []).find((s) => s.interviewerMembershipId === myMembershipId);
  const isCancelled = interview?.status === 'cancelled';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListInterviewScorecardsQueryKey(organizationId, interviewId) });

  const handleFinalize = (scorecardId: number) => {
    finalizeMutation.mutate(
      { organizationId, id: scorecardId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Scorecard finalized' }); },
        onError: (err) => toast({ title: 'Could not finalize scorecard', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (interviewError || error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this scorecard" onRetry={() => { refetchInterview(); refetch(); }} />
      </div>
    );
  }

  if (interviewLoading || isLoading || !interview || !result) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <Link href={`/interviews/${interviewId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-interview">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Interview
        </Link>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <ClipboardList className="h-7 w-7 text-primary" aria-hidden="true" />
          Interview Scorecard
        </h1>
        <p className="text-muted-foreground">Independent, lockable evaluation — informs later decisions, does not make them</p>
      </div>

      {isCancelled && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground" data-testid="notice-interview-cancelled">
            This interview was cancelled — evaluation is disabled.
          </CardContent>
        </Card>
      )}

      {isReadAll && result.panelSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Panel Completion Summary</CardTitle>
            <CardDescription>Computed live — never stored</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Panel Size</p>
              <p className="text-sm font-medium text-foreground" data-testid="text-total-panel-members">{result.panelSummary.totalPanelMembers}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Submitted</p>
              <p className="text-sm font-medium text-foreground" data-testid="text-submitted-count">{result.panelSummary.submittedCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-sm font-medium text-foreground" data-testid="text-pending-count">{result.panelSummary.pendingCount}</p>
            </div>
            {(Object.keys(result.panelSummary.recommendationCounts) as Array<keyof typeof result.panelSummary.recommendationCounts>).map((key) => (
              <div key={key}>
                <p className="text-xs text-muted-foreground">{RECOMMENDATION_LABEL[key]}</p>
                <p className="text-sm font-medium text-foreground">{result.panelSummary!.recommendationCounts[key]}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isReadAll && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Panel Evaluations</CardTitle>
            <CardDescription>Each evaluator's scorecard, independently attributable</CardDescription>
          </CardHeader>
          <CardContent>
            {result.scorecards.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evaluations submitted yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {result.scorecards.map((s) => {
                  const member = s.interviewerMembershipId != null ? memberById.get(s.interviewerMembershipId) : undefined;
                  return (
                    <li key={s.id} className="py-3 space-y-2" data-testid={`row-evaluator-scorecard-${s.id}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">{member ? `${member.firstName} ${member.lastName}` : `Membership #${s.interviewerMembershipId}`}</p>
                        <div className="flex items-center gap-2">
                          {s.recommendation && <Badge variant={RECOMMENDATION_VARIANT[s.recommendation] ?? 'outline'}>{RECOMMENDATION_LABEL[s.recommendation]}</Badge>}
                          {s.finalizedAt ? (
                            <Badge variant="outline" className="flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" />Finalized</Badge>
                          ) : s.submittedAt ? (
                            <Badge variant="secondary" className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />Submitted</Badge>
                          ) : (
                            <Badge variant="outline">Draft</Badge>
                          )}
                        </div>
                      </div>
                      {s.overallComment && <p className="text-sm text-muted-foreground">{s.overallComment}</p>}
                      {s.responses.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-1 pl-4 list-disc">
                          {s.responses.map((r) => (
                            <li key={r.id}>{r.criterion}{r.rating != null ? ` — ${r.rating}` : ''}{r.comment ? `: ${r.comment}` : ''}</li>
                          ))}
                        </ul>
                      )}
                      {s.submittedAt && !s.finalizedAt && (
                        <Button size="sm" variant="outline" onClick={() => handleFinalize(s.id)} disabled={finalizeMutation.isPending} data-testid={`button-finalize-${s.id}`}>
                          Finalize
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!isCancelled && (myScorecard || !isReadAll) && (
        <MyEvaluationCard organizationId={organizationId} interviewId={interviewId} myScorecard={myScorecard} onSaved={invalidate} />
      )}
    </div>
  );
}
