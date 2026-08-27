import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, FileSignature, Send, CheckCircle2, Stamp, XCircle, History, Edit } from 'lucide-react';
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
  useGetOffer,
  getGetOfferQueryKey,
  useUpdateDraftOfferVersion,
  useCreateNewOfferVersion,
  useSubmitOfferVersionForApproval,
  useListOfferApprovals,
  getListOfferApprovalsQueryKey,
  useApproveOfferVersion,
  useIssueOfferVersion,
  useWithdrawOfferVersion,
  type UpdateOfferVersionInputEmploymentType,
  type UpdateOfferVersionInputWorkplaceType,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { OfferResponsePanel } from '@/components/recruitment/offer-response-panel';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
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

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: 'Full Time',
  part_time: 'Part Time',
  contract: 'Contract',
  intern: 'Intern',
  temporary: 'Temporary',
};

const NONE = '__none__';

export default function OfferDetail() {
  const params = useParams<{ id: string }>();
  const offerId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: offer,
    isLoading,
    error,
    refetch,
  } = useGetOffer(organizationId, offerId, {
    query: { queryKey: getGetOfferQueryKey(organizationId, offerId), enabled: organizationId > 0 && offerId > 0 },
  });

  const currentVersion = offer ? offer.versions[offer.versions.length - 1] : undefined;

  const { data: approvals } = useListOfferApprovals(organizationId, currentVersion?.id ?? 0, {
    query: { queryKey: getListOfferApprovalsQueryKey(organizationId, currentVersion?.id ?? 0), enabled: organizationId > 0 && (currentVersion?.id ?? 0) > 0 },
  });

  const updateMutation = useUpdateDraftOfferVersion();
  const newVersionMutation = useCreateNewOfferVersion();
  const submitMutation = useSubmitOfferVersionForApproval();
  const approveMutation = useApproveOfferVersion();
  const issueMutation = useIssueOfferVersion();
  const withdrawMutation = useWithdrawOfferVersion();

  const [editOpen, setEditOpen] = useState(false);
  const [proposedStartDate, setProposedStartDate] = useState('');
  const [employmentType, setEmploymentType] = useState<string>(NONE);
  const [workplaceType, setWorkplaceType] = useState<string>(NONE);
  const [location, setLocation] = useState('');
  const [conditions, setConditions] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetOfferQueryKey(organizationId, offerId) });

  const openEdit = () => {
    setProposedStartDate(currentVersion?.proposedStartDate ?? '');
    setEmploymentType(currentVersion?.employmentType ?? NONE);
    setWorkplaceType(currentVersion?.workplaceType ?? NONE);
    setLocation(currentVersion?.location ?? '');
    setConditions(currentVersion?.conditions ?? '');
    setExpiryDate(currentVersion?.expiryDate ?? '');
    setEditOpen(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVersion) return;
    const data = {
      proposedStartDate: proposedStartDate || null,
      employmentType: employmentType === NONE ? null : (employmentType as UpdateOfferVersionInputEmploymentType),
      workplaceType: workplaceType === NONE ? null : (workplaceType as UpdateOfferVersionInputWorkplaceType),
      location: location.trim() || null,
      conditions: conditions.trim() || null,
      expiryDate: expiryDate || null,
    };
    const isNewVersion = currentVersion.status === 'approved' || currentVersion.status === 'issued';
    const mutation = isNewVersion ? newVersionMutation : updateMutation;
    mutation.mutate(
      { organizationId, id: offerId, data },
      {
        onSuccess: () => { invalidate(); setEditOpen(false); toast({ title: isNewVersion ? 'New offer version created' : 'Offer updated' }); },
        onError: (err) => toast({ title: 'Could not save offer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSubmitForApproval = () => {
    if (!currentVersion) return;
    submitMutation.mutate(
      { organizationId, id: currentVersion.id },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Offer submitted for approval' }); },
        onError: (err) => toast({ title: 'Could not submit offer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVersion) return;
    approveMutation.mutate(
      { organizationId, id: currentVersion.id, data: { comment: approveComment.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setApproveOpen(false); toast({ title: 'Offer approved' }); },
        onError: (err) => toast({ title: 'Could not approve offer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleIssue = () => {
    if (!currentVersion) return;
    issueMutation.mutate(
      { organizationId, id: currentVersion.id },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Offer issued' }); },
        onError: (err) => toast({ title: 'Could not issue offer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentVersion) return;
    withdrawMutation.mutate(
      { organizationId, id: currentVersion.id, data: { reason: withdrawReason.trim() || undefined } },
      {
        onSuccess: () => { invalidate(); setWithdrawOpen(false); toast({ title: 'Offer withdrawn' }); },
        onError: (err) => toast({ title: 'Could not withdraw offer', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load this offer" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading || !offer || !currentVersion) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isDraft = currentVersion.status === 'draft';
  const isPendingApproval = currentVersion.status === 'pending_approval';
  const isApproved = currentVersion.status === 'approved';
  const isIssued = currentVersion.status === 'issued';
  const canWithdraw = isPendingApproval || isApproved || isIssued;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/offers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-to-offers">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Offers
          </Link>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <FileSignature className="h-7 w-7 text-primary" aria-hidden="true" />
            <Link href={`/applications/${offer.offer.applicationId}`} className="hover:underline" data-testid="link-offer-application">
              Application #{offer.offer.applicationId}
            </Link>
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[currentVersion.status] ?? 'outline'} className="capitalize" data-testid="badge-offer-status">
              {currentVersion.status.replace(/_/g, ' ')}
            </Badge>
            <span className="text-sm text-muted-foreground">Version {currentVersion.versionNumber}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(isDraft || isApproved || isIssued) && (
            <Button variant="outline" onClick={openEdit} data-testid="button-edit-offer">
              <Edit className="h-4 w-4" aria-hidden="true" />
              {isDraft ? 'Edit' : 'Create New Version'}
            </Button>
          )}
          {isDraft && (
            <Button variant="outline" onClick={handleSubmitForApproval} disabled={submitMutation.isPending} data-testid="button-submit-offer">
              <Send className="h-4 w-4" aria-hidden="true" />
              {submitMutation.isPending ? 'Submitting…' : 'Submit for Approval'}
            </Button>
          )}
          {isPendingApproval && (
            <Button variant="outline" onClick={() => { setApproveComment(''); setApproveOpen(true); }} data-testid="button-approve-offer">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Approve
            </Button>
          )}
          {isApproved && (
            <Button variant="outline" onClick={handleIssue} disabled={issueMutation.isPending} data-testid="button-issue-offer">
              <Stamp className="h-4 w-4" aria-hidden="true" />
              {issueMutation.isPending ? 'Issuing…' : 'Issue'}
            </Button>
          )}
          {canWithdraw && (
            <Button variant="destructive" onClick={() => { setWithdrawReason(''); setWithdrawOpen(true); }} data-testid="button-withdraw-offer">
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Withdraw
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offer Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Proposed Start Date</p>
            <p className="text-sm font-medium text-foreground">{currentVersion.proposedStartDate ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Employment Type</p>
            <p className="text-sm font-medium text-foreground">{currentVersion.employmentType ? (EMPLOYMENT_TYPE_LABEL[currentVersion.employmentType] ?? currentVersion.employmentType) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Workplace Type</p>
            <p className="text-sm font-medium text-foreground capitalize">{currentVersion.workplaceType ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Location</p>
            <p className="text-sm font-medium text-foreground">{currentVersion.location ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expiry Date</p>
            <p className="text-sm font-medium text-foreground">{currentVersion.expiryDate ?? '—'}</p>
          </div>
          {currentVersion.conditions && (
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">Conditions</p>
              <p className="text-sm font-medium text-foreground whitespace-pre-wrap">{currentVersion.conditions}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" aria-hidden="true" />
            Version History
          </CardTitle>
          <CardDescription>Every version of this offer, including superseded ones</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {offer.versions.map((v) => (
              <li key={v.id} className="py-2 flex items-center justify-between" data-testid={`row-offer-version-${v.id}`}>
                <span className="text-sm text-foreground">Version {v.versionNumber}</span>
                <Badge variant={STATUS_VARIANT[v.status] ?? 'outline'} className="capitalize">{v.status.replace(/_/g, ' ')}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* WS-9 — accept / decline / response-link, bound to this exact version. */}
      {currentVersion && (
        <OfferResponsePanel organizationId={organizationId} offerVersionId={currentVersion.id} />
      )}

      {approvals && approvals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval History</CardTitle>
            <CardDescription>Decision history for the current version</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {approvals.map((a) => (
                <li key={a.id} className="py-2" data-testid={`row-offer-approval-${a.id}`}>
                  <div className="flex items-center justify-between">
                    <Badge variant={a.decision === 'approved' ? 'secondary' : a.decision === 'rejected' ? 'destructive' : 'outline'} className="capitalize">
                      {a.decision}
                    </Badge>
                    {a.decidedAt && <span className="text-xs text-muted-foreground">{new Date(a.decidedAt).toLocaleString()}</span>}
                  </div>
                  {a.comment && <p className="text-sm text-muted-foreground mt-1">{a.comment}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={handleSaveEdit}>
            <DialogHeader>
              <DialogTitle>{isDraft ? 'Edit Offer' : 'Create New Offer Version'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="offer-start-date">Proposed Start Date</Label>
                <Input id="offer-start-date" type="date" value={proposedStartDate} onChange={(e) => setProposedStartDate(e.target.value)} data-testid="input-offer-start-date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-employment-type">Employment Type</Label>
                <Select value={employmentType} onValueChange={setEmploymentType}>
                  <SelectTrigger id="offer-employment-type" data-testid="select-offer-employment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not specified</SelectItem>
                    <SelectItem value="full_time">Full Time</SelectItem>
                    <SelectItem value="part_time">Part Time</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                    <SelectItem value="temporary">Temporary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-workplace-type">Workplace Type</Label>
                <Select value={workplaceType} onValueChange={setWorkplaceType}>
                  <SelectTrigger id="offer-workplace-type" data-testid="select-offer-workplace-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not specified</SelectItem>
                    <SelectItem value="onsite">Onsite</SelectItem>
                    <SelectItem value="remote">Remote</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-location">Location</Label>
                <Input id="offer-location" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="input-offer-location" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-expiry-date">Expiry Date</Label>
                <Input id="offer-expiry-date" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} data-testid="input-offer-expiry-date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-conditions">Conditions</Label>
                <Textarea id="offer-conditions" value={conditions} onChange={(e) => setConditions(e.target.value)} rows={3} data-testid="input-offer-conditions" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending || newVersionMutation.isPending} data-testid="button-confirm-save-offer">
                {updateMutation.isPending || newVersionMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <form onSubmit={handleApprove}>
            <DialogHeader>
              <DialogTitle>Approve Offer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="approve-comment">Comment (optional)</Label>
                <Textarea id="approve-comment" value={approveComment} onChange={(e) => setApproveComment(e.target.value)} rows={3} data-testid="input-approve-comment" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={approveMutation.isPending} data-testid="button-confirm-approve-offer">
                {approveMutation.isPending ? 'Approving…' : 'Approve'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <form onSubmit={handleWithdraw}>
            <DialogHeader>
              <DialogTitle>Withdraw Offer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="withdraw-reason">Reason (optional)</Label>
                <Textarea id="withdraw-reason" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={3} data-testid="input-withdraw-reason" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={withdrawMutation.isPending} data-testid="button-confirm-withdraw-offer">
                {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
