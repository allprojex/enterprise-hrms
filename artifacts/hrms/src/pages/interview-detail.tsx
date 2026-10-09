import { useState } from 'react';
import { useParams, Link, useLocation } from 'wouter';
import { ArrowLeft, CalendarClock, Users, X, Plus, XCircle, CheckCircle2, UserX, RefreshCw, ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetInterview,
  getGetInterviewQueryKey,
  useCancelInterview,
  useUpdateInterview,
  useListMembers,
  getListMembersQueryKey,
  type PanelMemberInput,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  scheduled: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
  no_show: 'destructive',
};

const TYPE_LABEL: Record<string, string> = {
  phone: 'Phone',
  virtual: 'Virtual',
  in_person: 'In Person',
};

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function InterviewDetail() {
  const params = useParams<{ id: string }>();
  const interviewId = Number(params.id);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: interview,
    isLoading,
    error,
    refetch,
  } = useGetInterview(organizationId, interviewId, {
    query: { queryKey: getGetInterviewQueryKey(organizationId, interviewId), enabled: organizationId > 0 && interviewId > 0 },
  });

  const { data: members } = useListMembers(organizationId, { query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 } });
  const memberById = new Map((members ?? []).map((m) => [m.membershipId, m]));

  const cancelMutation = useCancelInterview();
  const updateMutation = useUpdateInterview();

  const [outcomeOpen, setOutcomeOpen] = useState<'completed' | 'no_show' | null>(null);
  const [outcomeText, setOutcomeText] = useState('');
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newScheduledAt, setNewScheduledAt] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelDraft, setPanelDraft] = useState<PanelMemberInput[]>([]);
  const [newMemberId, setNewMemberId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetInterviewQueryKey(organizationId, interviewId) });

  const handleCancel = () =>
    cancelMutation.mutateAsync(
      { organizationId, id: interviewId },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Interview cancelled' }); },
        onError: (err) => toast({ title: 'Could not cancel interview', description: errorMessage(err), variant: 'destructive' }),
      },
    );

  const openOutcome = (status: 'completed' | 'no_show') => {
    setOutcomeText('');
    setOutcomeOpen(status);
  };

  const handleSubmitOutcome = (e: React.FormEvent) => {
    e.preventDefault();
    if (!interview || !outcomeOpen) return;
    updateMutation.mutate(
      { organizationId, applicationId: interview.applicationId, id: interviewId, data: { status: outcomeOpen, outcome: outcomeText.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setOutcomeOpen(null); toast({ title: outcomeOpen === 'completed' ? 'Interview marked completed' : 'Interview marked no-show' }); },
        onError: (err) => toast({ title: 'Could not update interview', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const openReschedule = () => {
    if (!interview) return;
    setNewScheduledAt(toDatetimeLocal(interview.scheduledAt));
    setNewDuration(String(interview.durationMinutes));
    setRescheduleOpen(true);
  };

  const handleReschedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!interview || !newScheduledAt) return;
    updateMutation.mutate(
      { organizationId, applicationId: interview.applicationId, id: interviewId, data: { scheduledAt: new Date(newScheduledAt).toISOString(), durationMinutes: Number(newDuration) } },
      {
        onSuccess: (rescheduled) => {
          setRescheduleOpen(false);
          toast({ title: 'Interview rescheduled' });
          navigate(`/interviews/${rescheduled.id}`);
        },
        onError: (err) => toast({ title: 'Could not reschedule interview', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const openPanel = () => {
    if (!interview) return;
    setPanelDraft(
      interview.panelMembers.map((p) => ({
        interviewerMembershipId: p.interviewerMembershipId,
        externalInterviewerName: p.externalInterviewerName,
        externalInterviewerEmail: p.externalInterviewerEmail,
        role: p.role,
        conflictDeclared: p.conflictDeclared,
      })),
    );
    setNewMemberId('');
    setExternalName('');
    setExternalEmail('');
    setPanelOpen(true);
  };

  const addInternalPanelMember = () => {
    if (!newMemberId) return;
    const id = Number(newMemberId);
    if (panelDraft.some((p) => p.interviewerMembershipId === id)) return;
    setPanelDraft((prev) => [...prev, { interviewerMembershipId: id, role: 'member' }]);
    setNewMemberId('');
  };

  const addExternalPanelMember = () => {
    if (!externalName.trim() || !externalEmail.trim()) return;
    setPanelDraft((prev) => [...prev, { externalInterviewerName: externalName.trim(), externalInterviewerEmail: externalEmail.trim(), role: 'member' }]);
    setExternalName('');
    setExternalEmail('');
  };

  const removePanelDraftMember = (index: number) => {
    setPanelDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSavePanel = () => {
    if (!interview) return;
    updateMutation.mutate(
      { organizationId, applicationId: interview.applicationId, id: interviewId, data: { panelMembers: panelDraft } },
      {
        onSuccess: () => { invalidate(); setPanelOpen(false); toast({ title: 'Panel updated' }); },
        onError: (err) => toast({ title: 'Could not update panel', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this interview" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !interview) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isScheduled = interview.status === 'scheduled';

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/interviews" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-interviews">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Interviews
          </Link>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="h-7 w-7 text-primary" aria-hidden="true" />
            <Link href={`/applications/${interview.applicationId}`} className="hover:underline" data-testid="link-interview-application">
              Application #{interview.applicationId}
            </Link>
          </h1>
          <Badge variant={STATUS_VARIANT[interview.status] ?? 'outline'} className="capitalize" data-testid="badge-interview-status">
            {interview.status.replace('_', ' ')}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/interviews/${interview.id}/scorecard`}>
            <Button variant="outline" data-testid="link-interview-scorecard">
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              Scorecard
            </Button>
          </Link>
          {isScheduled && (
            <>
            <Button variant="outline" onClick={openReschedule} data-testid="button-reschedule-interview">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reschedule
            </Button>
            <Button variant="outline" onClick={() => openOutcome('completed')} data-testid="button-mark-completed">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Mark Completed
            </Button>
            <Button variant="outline" onClick={() => openOutcome('no_show')} data-testid="button-mark-no-show">
              <UserX className="h-4 w-4" aria-hidden="true" />
              No-Show
            </Button>
            <Button variant="destructive" onClick={() => setCancelConfirmOpen(true)} disabled={cancelMutation.isPending} data-testid="button-cancel-interview">
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interview Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="text-sm font-medium text-foreground">{TYPE_LABEL[interview.interviewType] ?? interview.interviewType}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Scheduled</p>
            <p className="text-sm font-medium text-foreground">{new Date(interview.scheduledAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="text-sm font-medium text-foreground">{interview.durationMinutes} min</p>
          </div>
          {interview.location && (
            <div>
              <p className="text-xs text-muted-foreground">Location</p>
              <p className="text-sm font-medium text-foreground">{interview.location}</p>
            </div>
          )}
          {interview.meetingLink && (
            <div>
              <p className="text-xs text-muted-foreground">Meeting Link</p>
              <a href={interview.meetingLink} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">{interview.meetingLink}</a>
            </div>
          )}
          {interview.outcome && (
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">Outcome</p>
              <p className="text-sm font-medium text-foreground">{interview.outcome}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" aria-hidden="true" />
              Panel
            </CardTitle>
            <CardDescription>Panel composition — independent from interview results</CardDescription>
          </div>
          {isScheduled && (
            <Button size="sm" variant="outline" onClick={openPanel} data-testid="button-edit-panel">
              Edit Panel
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {interview.panelMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No panel members added yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {interview.panelMembers.map((p) => {
                const member = p.interviewerMembershipId != null ? memberById.get(p.interviewerMembershipId) : undefined;
                const name = member ? `${member.firstName} ${member.lastName}` : p.externalInterviewerName ?? 'Unknown';
                const email = member?.email ?? p.externalInterviewerEmail;
                return (
                  <li key={p.id} className="py-2 flex items-center justify-between" data-testid={`row-panel-member-${p.id}`}>
                    <div>
                      <p className="text-sm font-medium text-foreground">{name}{!member && <span className="text-xs text-muted-foreground ml-1">(external)</span>}</p>
                      {email && <p className="text-xs text-muted-foreground">{email}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{p.role}</Badge>
                      {p.conflictDeclared && <Badge variant="destructive">Conflict declared</Badge>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={outcomeOpen != null} onOpenChange={(open) => !open && setOutcomeOpen(null)}>
        <DialogContent>
          <form onSubmit={handleSubmitOutcome}>
            <DialogHeader>
              <DialogTitle>{outcomeOpen === 'completed' ? 'Mark Interview Completed' : 'Mark Interview No-Show'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="outcome-text">Outcome Summary (optional)</Label>
                <Textarea id="outcome-text" value={outcomeText} onChange={(e) => setOutcomeText(e.target.value)} rows={3} data-testid="input-outcome-text" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-confirm-outcome">
                {updateMutation.isPending ? 'Saving…' : 'Confirm'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent>
          <form onSubmit={handleReschedule}>
            <DialogHeader>
              <DialogTitle>Reschedule Interview</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="reschedule-at">New Date &amp; Time *</Label>
                <Input id="reschedule-at" type="datetime-local" value={newScheduledAt} onChange={(e) => setNewScheduledAt(e.target.value)} required data-testid="input-reschedule-at" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reschedule-duration">Duration (minutes) *</Label>
                <Input id="reschedule-duration" type="number" min={1} value={newDuration} onChange={(e) => setNewDuration(e.target.value)} required data-testid="input-reschedule-duration" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending || !newScheduledAt} data-testid="button-confirm-reschedule">
                {updateMutation.isPending ? 'Rescheduling…' : 'Confirm Reschedule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Panel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Current Panel</p>
              {panelDraft.length === 0 ? (
                <p className="text-sm text-muted-foreground">No panel members yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {panelDraft.map((p, i) => {
                    const member = p.interviewerMembershipId != null ? memberById.get(p.interviewerMembershipId) : undefined;
                    const label = member ? `${member.firstName} ${member.lastName}` : p.externalInterviewerName;
                    return (
                      <li key={i} className="py-2 flex items-center justify-between" data-testid={`row-panel-draft-${i}`}>
                        <span className="text-sm text-foreground">{label}</span>
                        <Button size="sm" variant="ghost" onClick={() => removePanelDraftMember(i)} data-testid={`button-remove-panel-draft-${i}`}>
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
              <div className="space-y-2">
                <Label>Add Internal Interviewer</Label>
                <div className="flex gap-2">
                  <Select value={newMemberId} onValueChange={setNewMemberId}>
                    <SelectTrigger data-testid="select-panel-member">
                      <SelectValue placeholder="Select a member" />
                    </SelectTrigger>
                    <SelectContent>
                      {(members ?? []).map((m) => (
                        <SelectItem key={m.membershipId} value={String(m.membershipId)}>{m.firstName} {m.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={addInternalPanelMember} disabled={!newMemberId} data-testid="button-add-internal-panelist">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Add External Interviewer</Label>
                <div className="flex gap-2">
                  <Input placeholder="Name" value={externalName} onChange={(e) => setExternalName(e.target.value)} data-testid="input-external-name" />
                  <Input placeholder="Email" value={externalEmail} onChange={(e) => setExternalEmail(e.target.value)} data-testid="input-external-email" />
                  <Button type="button" variant="outline" onClick={addExternalPanelMember} disabled={!externalName.trim() || !externalEmail.trim()} data-testid="button-add-external-panelist">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSavePanel} disabled={updateMutation.isPending} data-testid="button-save-panel">
              {updateMutation.isPending ? 'Saving…' : 'Save Panel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="Cancel interview?"
        description={
          <p>
            Are you sure you want to cancel the interview for Application #{interview.applicationId} scheduled for{' '}
            {new Date(interview.scheduledAt).toLocaleString()}? A cancelled interview cannot be rescheduled or reopened.
          </p>
        }
        confirmLabel="Cancel Interview"
        cancelLabel="Keep Interview"
        onConfirm={handleCancel}
        testId="dialog-cancel-interview"
      />
    </div>
  );
}
