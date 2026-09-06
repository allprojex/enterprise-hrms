import { useMemo, useState } from 'react';
import { Link, useRoute } from 'wouter';
import { ArrowLeft, Download, Save, Send, CheckCircle2, Undo2, XCircle, Archive, Lock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetFormSubmission,
  getGetFormSubmissionQueryKey,
  getListFormSubmissionsQueryKey,
  useSaveFormSubmissionDraft,
  useSubmitFormSubmission,
  useActOnFormSubmissionStage,
  useFinalizeFormSubmission,
  useArchiveFormSubmission,
  downloadFormSubmissionDocument,
  downloadFormTemplateBlank,
  type FormSubmissionDetail,
  type FormStageAction,
  type FormDocumentKind,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PageContainer, PageHeader, StatusBadge, ErrorState, LoadingState } from '@/components/foundation';
import { FormRenderer } from '@/components/forms/form-renderer';
import { useListFormSubmissionSignatures, getListFormSubmissionSignaturesQueryKey } from '@workspace/api-client-react';
import { SignatureSlotProvider } from '@/components/signature/signature-slot-context';
import type { SignatureMethod } from '@/components/signature/signature-providers';
import { useToast } from '@/hooks/use-toast';
import { FORM_EVENT_LABEL, FORM_STATUS_LABEL, isFormDefinition, type Answers } from '@/lib/form-definition';

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const issues = (data as { issues?: { key: string; message: string }[] }).issues;
      if (Array.isArray(issues) && issues.length > 0) return issues.map((i) => i.message).join('; ');
      if ('error' in data) return String((data as { error: unknown }).error);
    }
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') return (err as { message: string }).message;
  }
  return 'The request failed. Please try again.';
}

async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * One form submission (WS-26A): the official form rendered for the caller's
 * role, save/submit for the employee, stage actions for the resolved actor,
 * finalize/archive for HR, downloads at every state, and the chronology.
 */
export default function FormSubmissionPage() {
  const [, params] = useRoute('/forms/:submissionId');
  const submissionId = Number(params?.submissionId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.organizationId ?? 0;
  const enabled = organizationId > 0 && Number.isInteger(submissionId) && submissionId > 0;

  const detailQuery = useGetFormSubmission(organizationId, submissionId, {
    query: { queryKey: getGetFormSubmissionQueryKey(organizationId, submissionId), enabled },
  });
  const detail = detailQuery.data;

  // WS-26B — applied signatures for this submission (for the live signature slots).
  const signaturesQuery = useListFormSubmissionSignatures(organizationId, submissionId, {
    query: { queryKey: getListFormSubmissionSignaturesQueryKey(organizationId, submissionId), enabled },
  });

  const [answers, setAnswers] = useState<Answers>({});
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  // Seed local answers from the current revision when a NEW revision arrives
  // and nothing is being edited (adjusting state from props during render,
  // never in an effect).
  const [seededRevisionId, setSeededRevisionId] = useState<number | null>(null);
  if (detail?.currentRevision && detail.currentRevision.id !== seededRevisionId && !dirty) {
    setSeededRevisionId(detail.currentRevision.id);
    setAnswers((detail.currentRevision.answers as Answers) ?? {});
  }

  const applyDetail = (next: FormSubmissionDetail) => {
    queryClient.setQueryData(getGetFormSubmissionQueryKey(organizationId, submissionId), next);
    queryClient.invalidateQueries({ queryKey: getListFormSubmissionsQueryKey(organizationId) });
    setAnswers((next.currentRevision?.answers as Answers) ?? {});
    setDirty(false);
  };
  const fail = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), variant: 'destructive' });

  const saveMutation = useSaveFormSubmissionDraft();
  const submitMutation = useSubmitFormSubmission();
  const stageMutation = useActOnFormSubmissionStage();
  const finalizeMutation = useFinalizeFormSubmission();
  const archiveMutation = useArchiveFormSubmission();
  const busy = saveMutation.isPending || submitMutation.isPending || stageMutation.isPending || finalizeMutation.isPending || archiveMutation.isPending;

  const editableAnswers = useMemo(() => {
    if (!detail) return {};
    const keys = new Set<string>();
    const editable = new Set(detail.viewer.editableSectionKeys);
    for (const section of (detail.version.definition as { sections: { key: string; items: { key?: string; otherField?: { key: string } }[] }[] }).sections) {
      if (!editable.has(section.key)) continue;
      for (const item of section.items) {
        if (item.key) keys.add(item.key);
        if (item.otherField?.key) keys.add(item.otherField.key);
      }
    }
    return Object.fromEntries(Object.entries(answers).filter(([k]) => keys.has(k)));
  }, [answers, detail]);

  const handleChange = (key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () =>
    saveMutation.mutate({ organizationId, submissionId, data: { answers: editableAnswers } }, { onSuccess: (d) => { applyDetail(d); toast({ title: 'Draft saved', variant: 'success' }); }, onError: fail('Draft not saved') });
  const handleSubmit = () =>
    submitMutation.mutate({ organizationId, submissionId, data: { answers: editableAnswers } }, { onSuccess: (d) => { applyDetail(d); toast({ title: 'Form submitted', variant: 'success' }); }, onError: fail('Form not submitted') });
  const handleStage = (action: FormStageAction) =>
    stageMutation.mutate(
      { organizationId, submissionId, data: { action, answers: editableAnswers, notes: notes.trim() || null } },
      { onSuccess: (d) => { applyDetail(d); setNotes(''); toast({ title: `Form ${action === 'complete' ? 'stage completed' : action === 'approve' ? 'approved' : action === 'return' ? 'returned' : 'rejected'}`, variant: action === 'reject' ? 'warning' : 'success' }); }, onError: fail('Action not applied') },
    );
  const handleFinalize = () =>
    finalizeMutation.mutate({ organizationId, submissionId }, { onSuccess: (d) => { applyDetail(d); toast({ title: 'Form finalized', description: 'The final document is stored and hashed.', variant: 'success' }); }, onError: fail('Not finalized') });
  const handleArchive = () =>
    archiveMutation.mutate({ organizationId, submissionId }, { onSuccess: (d) => { applyDetail(d); toast({ title: 'Form archived', variant: 'success' }); }, onError: fail('Not archived') });

  const handleDownload = async (kind: FormDocumentKind | 'blank-template') => {
    if (!detail) return;
    setDownloading(kind);
    try {
      const blob =
        kind === 'blank-template'
          ? await downloadFormTemplateBlank(organizationId, detail.version.id)
          : await downloadFormSubmissionDocument(organizationId, submissionId, { kind });
      await saveBlob(blob, `${detail.template.title} - ${kind === 'blank-template' ? 'blank' : kind}.pdf`);
    } catch (err) {
      fail('Download failed')(err);
    } finally {
      setDownloading(null);
    }
  };

  if (!enabled || detailQuery.isLoading) {
    return (
      <PageContainer>
        <LoadingState label="Loading form" />
      </PageContainer>
    );
  }
  if (detailQuery.error || !detail || !isFormDefinition(detail.version.definition)) {
    return (
      <PageContainer>
        <ErrorState title="Form not found" message="This form does not exist or you do not have access to it." action={<Button asChild variant="outline"><Link href="/forms">Back to forms</Link></Button>} />
      </PageContainer>
    );
  }

  const { submission, viewer } = detail;
  const status = submission.status;
  const currentStage = detail.stages.find((s) => s.stageOrder === submission.currentStageOrder);

  // WS-26B — per-slot signing context for the live signature fields.
  const signaturePolicy = (detail.version as { signaturePolicy?: { slots?: { key: string; methods?: string[] }[] } }).signaturePolicy;
  const appliedSignatures = signaturesQuery.data?.items ?? [];
  const minStageOrder = detail.stages.length > 0 ? Math.min(...detail.stages.map((s) => s.stageOrder)) : null;
  const signatureContext = {
    organizationId,
    submissionId,
    allowedMethods: (slotKey: string): SignatureMethod[] => {
      const slot = signaturePolicy?.slots?.find((s) => s.key === slotKey);
      const methods = (slot?.methods ?? ['drawn', 'uploaded']).filter((m): m is SignatureMethod => m === 'drawn' || m === 'uploaded' || m === 'device');
      return methods.length > 0 ? methods : ['drawn', 'uploaded'];
    },
    applied: (slotKey: string) => appliedSignatures.find((s) => s.slotKey === slotKey && !s.revokedAt) ?? null,
    canSign: (slotKey: string): boolean => {
      const stage = detail.stages.find((s) => s.signatureSlotKey === slotKey);
      if (!stage) return false;
      const already = appliedSignatures.some((s) => s.slotKey === slotKey && !s.revokedAt);
      if (already) return false;
      const isCurrent = stage.stageOrder === submission.currentStageOrder || (status === 'draft' && stage.stageOrder === minStageOrder);
      const isStageActor = viewer.availableActions.length > 0;
      const isSubjectSlot = stage.participant === 'employee' || stage.resolver === 'subject_employee';
      return isCurrent && (isStageActor || (viewer.isSubject && isSubjectSlot));
    },
    onChanged: () => {
      queryClient.invalidateQueries({ queryKey: getListFormSubmissionSignaturesQueryKey(organizationId, submissionId) });
      queryClient.invalidateQueries({ queryKey: getGetFormSubmissionQueryKey(organizationId, submissionId) });
    },
  };
  const currentKind: FormDocumentKind =
    status === 'draft' ? 'draft' : status === 'returned' ? 'returned' : status === 'rejected' ? 'rejected' : status === 'approved' ? 'approved' : status === 'finalized' || status === 'archived' ? 'final' : 'submitted';

  return (
    <PageContainer className="space-y-6" width="form">
      <PageHeader
        eyebrow={
          <Link href="/forms" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Forms
          </Link>
        }
        title={detail.template.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} label={FORM_STATUS_LABEL[status] ?? status} />
            <span>
              {submission.subjectName} · form #{submission.id} · version {submission.versionNumber}
              {currentStage ? ` · awaiting ${currentStage.name}` : ''}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" loading={downloading === currentKind} onClick={() => handleDownload(currentKind)} data-testid="button-download-current">
              <Download aria-hidden="true" />
              Download ({FORM_STATUS_LABEL[status] ?? status})
            </Button>
            <Button variant="ghost" size="sm" loading={downloading === 'blank-template'} onClick={() => handleDownload('blank-template')} data-testid="button-download-blank">
              <Download aria-hidden="true" />
              Blank form
            </Button>
          </div>
        }
      />

      <div role="status" aria-live="polite" className="sr-only">
        {FORM_STATUS_LABEL[status] ?? status}
        {currentStage ? `, awaiting ${currentStage.name}` : ''}
      </div>

      <SignatureSlotProvider value={signatureContext}>
        <FormRenderer
          definition={detail.version.definition}
          answers={answers}
          autofill={detail.currentRevision?.autofillSnapshot ?? {}}
          computed={(detail.currentRevision?.computed as Record<string, number | null>) ?? {}}
          editableSectionKeys={viewer.editableSectionKeys}
          disabled={busy}
          onChange={handleChange}
        />
      </SignatureSlotProvider>

      {(viewer.canSubmit || viewer.availableActions.length > 0 || viewer.canFinalize || viewer.canArchive) && (
        <Card variant="summary" data-testid="form-actions">
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>
              {viewer.canSubmit && 'Save your progress, or submit when the form is complete.'}
              {viewer.availableActions.length > 0 && currentStage && `You are the ${currentStage.name} stage for this form.`}
              {viewer.canFinalize && 'Approved. Finalizing generates the immutable signed document.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {viewer.availableActions.some((a) => a !== 'complete') && (
              <div className="space-y-1 max-w-xl">
                <Label htmlFor="stage-notes">Notes for the record (required when returning or rejecting)</Label>
                <Textarea id="stage-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-stage-notes" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {viewer.canSubmit && (
                <>
                  <Button variant="outline" onClick={handleSave} loading={saveMutation.isPending} disabled={busy} data-testid="button-save-draft">
                    <Save aria-hidden="true" />
                    Save draft
                  </Button>
                  <Button onClick={handleSubmit} loading={submitMutation.isPending} disabled={busy} data-testid="button-submit-form">
                    <Send aria-hidden="true" />
                    {status === 'returned' ? 'Resubmit' : 'Submit'}
                  </Button>
                </>
              )}
              {viewer.availableActions.includes('complete') && (
                <Button onClick={() => handleStage('complete')} loading={stageMutation.isPending} disabled={busy} data-testid="button-stage-complete">
                  <CheckCircle2 aria-hidden="true" />
                  Complete my part
                </Button>
              )}
              {viewer.availableActions.includes('approve') && (
                <Button onClick={() => handleStage('approve')} loading={stageMutation.isPending} disabled={busy} data-testid="button-stage-approve">
                  <CheckCircle2 aria-hidden="true" />
                  Approve
                </Button>
              )}
              {viewer.availableActions.includes('return') && (
                <Button variant="outline" onClick={() => handleStage('return')} disabled={busy || !notes.trim()} data-testid="button-stage-return">
                  <Undo2 aria-hidden="true" />
                  Return for correction
                </Button>
              )}
              {viewer.availableActions.includes('reject') && (
                <Button variant="destructive" onClick={() => handleStage('reject')} disabled={busy || !notes.trim()} data-testid="button-stage-reject">
                  <XCircle aria-hidden="true" />
                  Reject
                </Button>
              )}
              {viewer.canFinalize && (
                <Button onClick={handleFinalize} loading={finalizeMutation.isPending} disabled={busy} data-testid="button-finalize">
                  <Lock aria-hidden="true" />
                  Finalize
                </Button>
              )}
              {viewer.canArchive && (
                <Button variant="outline" onClick={handleArchive} loading={archiveMutation.isPending} disabled={busy} data-testid="button-archive">
                  <Archive aria-hidden="true" />
                  Archive
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Every step recorded for this form. Nothing here can be edited.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2" data-testid="form-history">
            {detail.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-meta tabular-nums text-foreground-muted">{new Date(e.occurredAt).toLocaleString()}</span>
                <span className="text-body">
                  <span className="font-medium">{FORM_EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                  {e.stageName ? ` · ${e.stageName}` : ''}
                  {e.actorName ? ` · ${e.actorName}` : ''}
                  {e.notes ? ` — ${e.notes}` : ''}
                </span>
              </li>
            ))}
          </ol>
          {submission.finalSha256 && (
            <p className="mt-4 text-helper text-foreground-muted" data-testid="form-final-hash">
              Final document SHA-256: <span className="font-mono">{submission.finalSha256}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
