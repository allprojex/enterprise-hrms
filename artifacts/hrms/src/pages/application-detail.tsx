import { useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { ArrowLeft, FileText, RotateCcw, XCircle, LogOut, AlertTriangle, Star, CalendarClock, Plus, UserCheck, ShieldCheck, Download, Upload, FileSignature } from 'lucide-react';
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
  useListApplicationInterviews,
  getListApplicationInterviewsQueryKey,
  useScheduleInterview,
  useListReferenceChecks,
  getListReferenceChecksQueryKey,
  useCreateReferenceCheck,
  useUpdateReferenceCheckStatus,
  useListBackgroundChecks,
  getListBackgroundChecksQueryKey,
  useCreateBackgroundCheck,
  useUpdateBackgroundCheckStatus,
  useAttachBackgroundCheckEvidence,
  getGetBackgroundCheckEvidenceUrl,
  useGetOfferForApplication,
  getGetOfferForApplicationQueryKey,
  useCreateOffer,
  type InterviewInterviewType,
  type ReferenceBackgroundCheckStatus,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { getStoredToken } from '@/lib/auth';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const CHECK_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  requested: 'outline',
  in_progress: 'secondary',
  completed: 'secondary',
  flagged: 'destructive',
  unable_to_complete: 'destructive',
};

const TERMINAL_CHECK_STATUSES: ReferenceBackgroundCheckStatus[] = ['completed', 'flagged', 'unable_to_complete'];

/** Reference checks reuse application.read/.manage — no dedicated permission, so this section is always attempted. */
function ReferenceChecksSection({ organizationId, applicationId }: { organizationId: number; applicationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: checks } = useListReferenceChecks(organizationId, applicationId, {
    query: { queryKey: getListReferenceChecksQueryKey(organizationId, applicationId), enabled: organizationId > 0 && applicationId > 0 },
  });
  const createMutation = useCreateReferenceCheck();
  const updateMutation = useUpdateReferenceCheckStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [refereeName, setRefereeName] = useState('');
  const [refereeContact, setRefereeContact] = useState('');
  const [refereeRelationship, setRefereeRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [outcomeCheckId, setOutcomeCheckId] = useState<number | null>(null);
  const [outcomeStatus, setOutcomeStatus] = useState<string>('in_progress');
  const [outcomeNotes, setOutcomeNotes] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListReferenceChecksQueryKey(organizationId, applicationId) });

  const openCreate = () => {
    setRefereeName('');
    setRefereeContact('');
    setRefereeRelationship('');
    setNotes('');
    setCreateOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { organizationId, applicationId, data: { refereeName, refereeContact, refereeRelationship: refereeRelationship.trim() || undefined, notes: notes.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setCreateOpen(false); toast({ title: 'Reference check requested' }); },
        onError: (err) => toast({ title: 'Could not request reference check', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const openOutcome = (checkId: number) => {
    setOutcomeCheckId(checkId);
    setOutcomeStatus('in_progress');
    setOutcomeNotes('');
  };

  const handleRecordOutcome = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outcomeCheckId) return;
    updateMutation.mutate(
      { organizationId, applicationId, id: outcomeCheckId, data: { status: outcomeStatus as 'in_progress' | 'completed' | 'flagged' | 'unable_to_complete', notes: outcomeNotes.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setOutcomeCheckId(null); toast({ title: 'Reference check updated' }); },
        onError: (err) => toast({ title: 'Could not update reference check', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            Reference Checks
          </CardTitle>
          <CardDescription>Status-tracked — informs the decision, never makes it</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={openCreate} data-testid="button-request-reference-check">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Request Reference Check
        </Button>
      </CardHeader>
      <CardContent>
        {!checks || checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reference checks requested yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {checks.map((c) => (
              <li key={c.id} className="py-3 space-y-1" data-testid={`row-reference-check-${c.id}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{c.refereeName} <span className="text-xs text-muted-foreground">({c.refereeContact})</span></p>
                  <Badge variant={CHECK_STATUS_VARIANT[c.status] ?? 'outline'} className="capitalize">{c.status.replace(/_/g, ' ')}</Badge>
                </div>
                {c.refereeRelationship && <p className="text-xs text-muted-foreground">{c.refereeRelationship}</p>}
                {c.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}
                {!TERMINAL_CHECK_STATUSES.includes(c.status) && (
                  <Button size="sm" variant="outline" onClick={() => openOutcome(c.id)} data-testid={`button-record-outcome-${c.id}`}>
                    Record Outcome
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Request Reference Check</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="referee-name">Referee Name *</Label>
                <Input id="referee-name" value={refereeName} onChange={(e) => setRefereeName(e.target.value)} required data-testid="input-referee-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="referee-contact">Referee Contact *</Label>
                <Input id="referee-contact" value={refereeContact} onChange={(e) => setRefereeContact(e.target.value)} required data-testid="input-referee-contact" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="referee-relationship">Relationship (optional)</Label>
                <Input id="referee-relationship" value={refereeRelationship} onChange={(e) => setRefereeRelationship(e.target.value)} data-testid="input-referee-relationship" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reference-notes">Notes (optional)</Label>
                <Input id="reference-notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-reference-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!refereeName.trim() || !refereeContact.trim() || createMutation.isPending} data-testid="button-confirm-request-reference-check">
                {createMutation.isPending ? 'Requesting…' : 'Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={outcomeCheckId != null} onOpenChange={(open) => !open && setOutcomeCheckId(null)}>
        <DialogContent>
          <form onSubmit={handleRecordOutcome}>
            <DialogHeader>
              <DialogTitle>Record Outcome</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="outcome-status">Status</Label>
                <Select value={outcomeStatus} onValueChange={setOutcomeStatus}>
                  <SelectTrigger id="outcome-status" data-testid="select-reference-outcome-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                    <SelectItem value="unable_to_complete">Unable to Complete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="outcome-notes">Notes (optional)</Label>
                <Input id="outcome-notes" value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} data-testid="input-reference-outcome-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-confirm-reference-outcome">
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** background_check.read/.manage are their own dedicated, organization-wide-only permission — a caller lacking it gets a 403, and this section quietly renders nothing rather than a scary error card. */
function BackgroundChecksSection({ organizationId, applicationId }: { organizationId: number; applicationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: checks, error } = useListBackgroundChecks(organizationId, applicationId, {
    query: { queryKey: getListBackgroundChecksQueryKey(organizationId, applicationId), enabled: organizationId > 0 && applicationId > 0, retry: false },
  });
  const createMutation = useCreateBackgroundCheck();
  const updateMutation = useUpdateBackgroundCheckStatus();
  const evidenceMutation = useAttachBackgroundCheckEvidence();

  const [createOpen, setCreateOpen] = useState(false);
  const [checkType, setCheckType] = useState('');
  const [vendorReference, setVendorReference] = useState('');
  const [resultCheckId, setResultCheckId] = useState<number | null>(null);
  const [resultStatus, setResultStatus] = useState<string>('in_progress');
  const [resultSummary, setResultSummary] = useState('');
  const [resultVendorReference, setResultVendorReference] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBackgroundChecksQueryKey(organizationId, applicationId) });

  if (error) return null;

  const openCreate = () => {
    setCheckType('');
    setVendorReference('');
    setCreateOpen(true);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { organizationId, applicationId, data: { checkType, vendorReference: vendorReference.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setCreateOpen(false); toast({ title: 'Background check requested' }); },
        onError: (err) => toast({ title: 'Could not request background check', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const openResult = (checkId: number) => {
    setResultCheckId(checkId);
    setResultStatus('in_progress');
    setResultSummary('');
    setResultVendorReference('');
  };

  const handleRecordResult = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resultCheckId) return;
    updateMutation.mutate(
      {
        organizationId,
        applicationId,
        id: resultCheckId,
        data: {
          status: resultStatus as 'in_progress' | 'completed' | 'flagged' | 'unable_to_complete',
          resultSummary: resultSummary.trim() || undefined,
          vendorReference: resultVendorReference.trim() || undefined,
        },
      },
      {
        onSuccess: () => { invalidate(); setResultCheckId(null); toast({ title: 'Background check updated' }); },
        onError: (err) => toast({ title: 'Could not update background check', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleUploadEvidence = (checkId: number, file: File) => {
    evidenceMutation.mutate(
      { organizationId, applicationId, id: checkId, data: { file } },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Evidence attached' }); },
        onError: (err) => toast({ title: 'Could not attach evidence', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleDownloadEvidence = async (checkId: number) => {
    const token = getStoredToken();
    const res = await fetch(getGetBackgroundCheckEvidenceUrl(organizationId, applicationId, checkId), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      toast({ title: 'Could not download evidence', variant: 'destructive' });
      return;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = 'evidence';
    a.click();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Background Checks
          </CardTitle>
          <CardDescription>Result content is highly sensitive — restricted to background_check.manage</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={openCreate} data-testid="button-request-background-check">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Request Background Check
        </Button>
      </CardHeader>
      <CardContent>
        {!checks || checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No background checks requested yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {checks.map((c) => (
              <li key={c.id} className="py-3 space-y-1" data-testid={`row-background-check-${c.id}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground capitalize">{c.checkType}</p>
                  <Badge variant={CHECK_STATUS_VARIANT[c.status] ?? 'outline'} className="capitalize">{c.status.replace(/_/g, ' ')}</Badge>
                </div>
                {c.vendorReference && <p className="text-xs text-muted-foreground">Ref: {c.vendorReference}</p>}
                {c.resultSummary && <p className="text-sm text-muted-foreground">{c.resultSummary}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  {!TERMINAL_CHECK_STATUSES.includes(c.status) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openResult(c.id)} data-testid={`button-record-result-${c.id}`}>
                        Record Result
                      </Button>
                      <label className="inline-flex">
                        <input
                          type="file"
                          className="hidden"
                          data-testid={`input-evidence-file-${c.id}`}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadEvidence(c.id, f); e.target.value = ''; }}
                        />
                        <Button size="sm" variant="outline" type="button" asChild>
                          <span>
                            <Upload className="h-4 w-4" aria-hidden="true" />
                            {c.hasEvidence ? 'Replace Evidence' : 'Attach Evidence'}
                          </span>
                        </Button>
                      </label>
                    </>
                  )}
                  {c.hasEvidence && (
                    <Button size="sm" variant="ghost" onClick={() => handleDownloadEvidence(c.id)} data-testid={`button-download-evidence-${c.id}`}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download Evidence
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Request Background Check</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="check-type">Check Type *</Label>
                <Input id="check-type" value={checkType} onChange={(e) => setCheckType(e.target.value)} placeholder="e.g. Identity, Right to Work" required data-testid="input-check-type" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-vendor-reference">Vendor Reference (optional)</Label>
                <Input id="create-vendor-reference" value={vendorReference} onChange={(e) => setVendorReference(e.target.value)} data-testid="input-create-vendor-reference" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!checkType.trim() || createMutation.isPending} data-testid="button-confirm-request-background-check">
                {createMutation.isPending ? 'Requesting…' : 'Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={resultCheckId != null} onOpenChange={(open) => !open && setResultCheckId(null)}>
        <DialogContent>
          <form onSubmit={handleRecordResult}>
            <DialogHeader>
              <DialogTitle>Record Result</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="result-status">Status</Label>
                <Select value={resultStatus} onValueChange={setResultStatus}>
                  <SelectTrigger id="result-status" data-testid="select-background-result-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                    <SelectItem value="unable_to_complete">Unable to Complete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="result-summary">Result Summary (optional)</Label>
                <Input id="result-summary" value={resultSummary} onChange={(e) => setResultSummary(e.target.value)} data-testid="input-result-summary" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="result-vendor-reference">Vendor Reference (optional)</Label>
                <Input id="result-vendor-reference" value={resultVendorReference} onChange={(e) => setResultVendorReference(e.target.value)} data-testid="input-result-vendor-reference" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-confirm-background-result">
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const OFFER_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  pending_approval: 'secondary',
  approved: 'secondary',
  issued: 'secondary',
  accepted: 'secondary',
  declined: 'destructive',
  expired: 'destructive',
  withdrawn: 'destructive',
  superseded: 'outline',
};

/** offer.manage is broadly seeded (including to "employee") — an assigned recruiter/hiring manager can create/manage their own application's offer here, not just org-wide staff. A 404 means no offer exists yet, not an error. */
function OfferSection({ organizationId, applicationId }: { organizationId: number; applicationId: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: offer, error } = useGetOfferForApplication(organizationId, applicationId, {
    query: { queryKey: getGetOfferForApplicationQueryKey(organizationId, applicationId), enabled: organizationId > 0 && applicationId > 0, retry: false },
  });
  const createMutation = useCreateOffer();

  const notFound = error != null && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404;

  const handleCreate = () => {
    createMutation.mutate(
      { organizationId, applicationId, data: {} },
      {
        onSuccess: (created) => navigate(`/offers/${created.offer.id}`),
        onError: (err) => toast({ title: 'Could not create offer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error && !notFound) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4" aria-hidden="true" />
            Offer
          </CardTitle>
          <CardDescription>A versioned offer envelope, taken through approval before being issued</CardDescription>
        </div>
        {notFound && (
          <Button size="sm" variant="outline" onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-offer">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {createMutation.isPending ? 'Creating…' : 'Create Offer'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {notFound || !offer ? (
          <p className="text-sm text-muted-foreground">No offer created yet.</p>
        ) : (
          <Link href={`/offers/${offer.offer.id}`} className="flex items-center justify-between hover:underline" data-testid="link-offer">
            <span className="text-sm font-medium text-foreground">Version {offer.versions[offer.versions.length - 1]?.versionNumber ?? 1}</span>
            <Badge variant={OFFER_STATUS_VARIANT[offer.versions[offer.versions.length - 1]?.status ?? 'draft'] ?? 'outline'} className="capitalize">
              {(offer.versions[offer.versions.length - 1]?.status ?? 'draft').replace(/_/g, ' ')}
            </Badge>
          </Link>
        )}
      </CardContent>
    </Card>
  );
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

const INTERVIEW_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  scheduled: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
  no_show: 'destructive',
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

  const { data: interviews, refetch: refetchInterviews } = useListApplicationInterviews(organizationId, applicationId, {
    query: { queryKey: getListApplicationInterviewsQueryKey(organizationId, applicationId), enabled: organizationId > 0 && applicationId > 0 },
  });

  const moveMutation = useMoveApplicationStage();
  const rejectMutation = useRejectApplication();
  const withdrawMutation = useWithdrawApplication();
  const reopenMutation = useReopenApplication();
  const scoreMutation = useSubmitApplicationScore();
  const scheduleInterviewMutation = useScheduleInterview();

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
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [interviewType, setInterviewType] = useState<InterviewInterviewType>('virtual');
  const [scheduledAt, setScheduledAt] = useState('');
  const [duration, setDuration] = useState('60');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');

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

  const openSchedule = () => {
    setInterviewType('virtual');
    setScheduledAt('');
    setDuration('60');
    setLocation('');
    setMeetingLink('');
    setScheduleOpen(true);
  };

  const handleScheduleInterview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledAt) return;
    scheduleInterviewMutation.mutate(
      {
        organizationId,
        applicationId,
        data: {
          interviewType,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(duration),
          location: location.trim() || undefined,
          meetingLink: meetingLink.trim() || undefined,
        },
      },
      {
        onSuccess: () => { refetchInterviews(); setScheduleOpen(false); toast({ title: 'Interview scheduled' }); },
        onError: (err) => toast({ title: 'Could not schedule interview', description: errorMessage(err), variant: 'destructive' }),
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
          <h1 className="text-3xl font-bold text-foreground">
            <Link href={`/candidates/${application.candidateId}`} className="hover:underline" data-testid="link-candidate-profile">
              {application.candidateName}
            </Link>
          </h1>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Interviews
            </CardTitle>
            <CardDescription>Scheduling only — evaluation is a separate workstream</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={openSchedule} data-testid="button-schedule-interview">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Schedule Interview
          </Button>
        </CardHeader>
        <CardContent>
          {!interviews || interviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interviews scheduled yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {interviews.map((interview) => (
                <li key={interview.id} className="py-3 flex items-center justify-between" data-testid={`row-interview-${interview.id}`}>
                  <div>
                    <Link href={`/interviews/${interview.id}`} className="text-sm font-medium text-foreground hover:underline" data-testid={`link-interview-${interview.id}`}>
                      {new Date(interview.scheduledAt).toLocaleString()}
                    </Link>
                    <p className="text-xs text-muted-foreground capitalize">{interview.interviewType.replace('_', ' ')} · {interview.durationMinutes} min</p>
                  </div>
                  <Badge variant={INTERVIEW_STATUS_VARIANT[interview.status] ?? 'outline'} className="capitalize">{interview.status.replace('_', ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <OfferSection organizationId={organizationId} applicationId={applicationId} />
      <ReferenceChecksSection organizationId={organizationId} applicationId={applicationId} />
      <BackgroundChecksSection organizationId={organizationId} applicationId={applicationId} />

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

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <form onSubmit={handleScheduleInterview}>
            <DialogHeader>
              <DialogTitle>Schedule Interview</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="interview-type">Type</Label>
                <Select value={interviewType} onValueChange={(v) => setInterviewType(v as InterviewInterviewType)}>
                  <SelectTrigger id="interview-type" data-testid="select-interview-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="virtual">Virtual</SelectItem>
                    <SelectItem value="in_person">In Person</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="interview-scheduled-at">Date &amp; Time *</Label>
                <Input id="interview-scheduled-at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required data-testid="input-interview-scheduled-at" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interview-duration">Duration (minutes) *</Label>
                <Input id="interview-duration" type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} required data-testid="input-interview-duration" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interview-location">Location (optional)</Label>
                <Input id="interview-location" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="input-interview-location" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="interview-meeting-link">Meeting Link (optional)</Label>
                <Input id="interview-meeting-link" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} data-testid="input-interview-meeting-link" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!scheduledAt || scheduleInterviewMutation.isPending} data-testid="button-confirm-schedule-interview">
                {scheduleInterviewMutation.isPending ? 'Scheduling…' : 'Schedule Interview'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
