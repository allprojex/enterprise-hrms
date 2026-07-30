import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, FileText, RotateCcw, XCircle, LogOut, AlertTriangle, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetApplication,
  getGetApplicationQueryKey,
  useGetVacancy,
  getGetVacancyQueryKey,
  useListRecruitmentStages,
  getListRecruitmentStagesQueryKey,
  useMoveApplicationStage,
  useRejectApplication,
  useWithdrawApplication,
  useReopenApplication,
  useSubmitApplicationScore,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const CATEGORY_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  applied: 'outline',
  screening: 'secondary',
  interview: 'secondary',
  assessment: 'secondary',
  offer: 'secondary',
  hired: 'secondary',
  rejected: 'destructive',
  withdrawn: 'destructive',
};

export default function ApplicationDetail() {
  const params = useParams<{ id: string }>();
  const applicationId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: application,
    isLoading,
    error,
    refetch,
  } = useGetApplication(organizationId, applicationId, {
    query: { queryKey: getGetApplicationQueryKey(organizationId, applicationId), enabled: organizationId > 0 && applicationId > 0 },
  });

  const { data: vacancy } = useGetVacancy(organizationId, application?.vacancyId ?? 0, {
    query: { queryKey: getGetVacancyQueryKey(organizationId, application?.vacancyId ?? 0), enabled: organizationId > 0 && !!application?.vacancyId },
  });

  const { data: stages } = useListRecruitmentStages(organizationId, vacancy?.workflowId ?? 0, {
    query: { queryKey: getListRecruitmentStagesQueryKey(organizationId, vacancy?.workflowId ?? 0), enabled: organizationId > 0 && !!vacancy?.workflowId },
  });

  const moveMutation = useMoveApplicationStage();
  const rejectMutation = useRejectApplication();
  const withdrawMutation = useWithdrawApplication();
  const reopenMutation = useReopenApplication();
  const scoreMutation = useSubmitApplicationScore();

  const [toStageId, setToStageId] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawComment, setWithdrawComment] = useState('');
  const [scoreType, setScoreType] = useState('screening');
  const [scoreValue, setScoreValue] = useState('');
  const [scoreNotes, setScoreNotes] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(organizationId, applicationId) });

  const isTerminal = application ? ['hired', 'rejected', 'withdrawn'].includes(application.currentStageCategory) : false;
  const movableStages = (stages ?? []).filter((s) => s.isActive && !s.isTerminal && s.id !== application?.currentStageId);

  const handleMove = () => {
    if (!toStageId) return;
    moveMutation.mutate(
      { organizationId, id: applicationId, data: { toStageId: Number(toStageId) } },
      {
        onSuccess: () => { invalidate(); setToStageId(''); toast({ title: 'Stage updated' }); },
        onError: (err) => toast({ title: 'Could not move application', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault();
    rejectMutation.mutate(
      { organizationId, id: applicationId, data: { reasonCode: rejectReason.trim() || undefined, comment: rejectComment.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setRejectOpen(false); setRejectReason(''); setRejectComment(''); toast({ title: 'Application rejected' }); },
        onError: (err) => toast({ title: 'Could not reject application', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    withdrawMutation.mutate(
      { organizationId, id: applicationId, data: { reasonCode: withdrawReason.trim() || undefined, comment: withdrawComment.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setWithdrawOpen(false); setWithdrawReason(''); setWithdrawComment(''); toast({ title: 'Application withdrawn' }); },
        onError: (err) => toast({ title: 'Could not withdraw application', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleReopen = () => {
    reopenMutation.mutate(
      { organizationId, id: applicationId, data: {} },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Application reopened' }); },
        onError: (err) => toast({ title: 'Could not reopen application', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSubmitScore = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedScore = Number(scoreValue);
    if (!scoreValue.trim() || !Number.isFinite(parsedScore)) return;
    scoreMutation.mutate(
      { organizationId, id: applicationId, data: { scoreType: scoreType as 'screening' | 'interview' | 'overall', score: parsedScore, notes: scoreNotes.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setScoreValue(''); setScoreNotes(''); toast({ title: 'Score submitted' }); },
        onError: (err) => toast({ title: 'Could not submit score', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this application" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !application) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/applications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-applications">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Applications
          </Link>
          <h1 className="text-3xl font-bold text-foreground">{application.candidateName}</h1>
          <p className="text-muted-foreground">{application.vacancyTitle}</p>
          <Badge variant={CATEGORY_VARIANT[application.currentStageCategory] ?? 'outline'} className="capitalize" data-testid="badge-application-stage">
            {application.currentStageName ?? application.currentStageCategory}
          </Badge>
        </div>
        <div className="flex gap-2">
          {!isTerminal && (
            <>
              <Button variant="outline" onClick={() => setWithdrawOpen(true)} data-testid="button-withdraw-application">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Withdraw
              </Button>
              <Button variant="destructive" onClick={() => setRejectOpen(true)} data-testid="button-reject-application">
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Reject
              </Button>
            </>
          )}
          {isTerminal && (
            <Button variant="outline" onClick={handleReopen} disabled={reopenMutation.isPending} data-testid="button-reopen-application">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {reopenMutation.isPending ? 'Reopening…' : 'Reopen'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-medium text-foreground">{application.candidateEmail}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="text-sm font-medium text-foreground">{application.candidatePhone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Submitted</p>
            <p className="text-sm font-medium text-foreground">{new Date(application.submittedAt).toLocaleDateString()}</p>
          </div>
          {application.rejectionReasonCode && (
            <div>
              <p className="text-xs text-muted-foreground">Rejection Reason</p>
              <p className="text-sm font-medium text-foreground">{application.rejectionReasonCode}</p>
            </div>
          )}
          {application.withdrawalReasonCode && (
            <div>
              <p className="text-xs text-muted-foreground">Withdrawal Reason</p>
              <p className="text-sm font-medium text-foreground">{application.withdrawalReasonCode}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {!isTerminal && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Move Stage</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 items-end">
            <div className="space-y-2 flex-1 max-w-xs">
              <Label htmlFor="move-to-stage">Target Stage</Label>
              <Select value={toStageId} onValueChange={setToStageId}>
                <SelectTrigger id="move-to-stage" data-testid="select-move-target-stage">
                  <SelectValue placeholder="Select a stage" />
                </SelectTrigger>
                <SelectContent>
                  {movableStages.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleMove} disabled={!toStageId || moveMutation.isPending} data-testid="button-move-stage">
              {moveMutation.isPending ? 'Moving…' : 'Move'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {application.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
          ) : (
            <ul className="space-y-2">
              {application.documents.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 text-sm text-foreground" data-testid={`row-document-${doc.id}`}>
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {doc.fileName}
                  <span className="text-xs text-muted-foreground capitalize">({doc.categoryCode})</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {application.answers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Screening Answers</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {application.answers.map((answer) => (
                <li key={answer.id} className="py-3 space-y-1" data-testid={`row-answer-${answer.id}`}>
                  <p className="text-sm font-medium text-foreground">{answer.questionText}</p>
                  <p className="text-sm text-muted-foreground">{answer.answerText}</p>
                  {answer.knockoutFailed && (
                    <p className="flex items-center gap-1 text-xs text-destructive" data-testid={`badge-knockout-failed-${answer.id}`}>
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      Knockout failed — review before proceeding
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Scoring
            {application.scoreRollup != null && (
              <Badge variant="secondary" className="flex items-center gap-1" data-testid="badge-score-rollup">
                <Star className="h-3 w-3" aria-hidden="true" />
                {application.scoreRollup.toFixed(1)}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Append-only — a new entry every time, never edited</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {application.scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scores submitted yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {application.scores.map((s) => (
                <li key={s.id} className="py-2 space-y-1" data-testid={`row-score-${s.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{s.scoreType}</Badge>
                    <span className="text-sm font-medium text-foreground">{s.score}</span>
                  </div>
                  {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                </li>
              ))}
            </ul>
          )}

          {!isTerminal && (
            <form onSubmit={handleSubmitScore} className="flex flex-wrap gap-2 items-end pt-2 border-t border-border">
              <div className="space-y-2">
                <Label htmlFor="score-type">Type</Label>
                <Select value={scoreType} onValueChange={setScoreType}>
                  <SelectTrigger id="score-type" className="w-36" data-testid="select-score-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="screening">Screening</SelectItem>
                    <SelectItem value="interview">Interview</SelectItem>
                    <SelectItem value="overall">Overall</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="score-value">Score</Label>
                <Input id="score-value" type="number" step="0.1" value={scoreValue} onChange={(e) => setScoreValue(e.target.value)} className="w-24" data-testid="input-score-value" />
              </div>
              <div className="space-y-2 flex-1 min-w-[150px]">
                <Label htmlFor="score-notes">Notes (optional)</Label>
                <Input id="score-notes" value={scoreNotes} onChange={(e) => setScoreNotes(e.target.value)} data-testid="input-score-notes" />
              </div>
              <Button type="submit" disabled={!scoreValue.trim() || scoreMutation.isPending} data-testid="button-submit-score">
                {scoreMutation.isPending ? 'Submitting…' : 'Submit Score'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>Immutable — every movement is recorded, never edited</CardDescription>
        </CardHeader>
        <CardContent>
          {application.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {application.history.map((entry) => (
                <li key={entry.id} className="py-3 space-y-1" data-testid={`row-history-${entry.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{new Date(entry.movedAt).toLocaleString()}</span>
                  </div>
                  {entry.reason && <p className="text-sm text-muted-foreground">{entry.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <form onSubmit={handleReject}>
            <DialogHeader>
              <DialogTitle>Reject Application</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reject-reason">Reason Code (optional)</Label>
                <Input id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} data-testid="input-reject-reason" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reject-comment">Comment (optional)</Label>
                <Input id="reject-comment" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} data-testid="input-reject-comment" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={rejectMutation.isPending} data-testid="button-confirm-reject">
                {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Rejection'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <form onSubmit={handleWithdraw}>
            <DialogHeader>
              <DialogTitle>Withdraw Application</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="withdraw-reason">Reason Code (optional)</Label>
                <Input id="withdraw-reason" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} data-testid="input-withdraw-reason" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="withdraw-comment">Comment (optional)</Label>
                <Input id="withdraw-comment" value={withdrawComment} onChange={(e) => setWithdrawComment(e.target.value)} data-testid="input-withdraw-comment" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" variant="outline" disabled={withdrawMutation.isPending} data-testid="button-confirm-withdraw">
                {withdrawMutation.isPending ? 'Withdrawing…' : 'Confirm Withdrawal'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
