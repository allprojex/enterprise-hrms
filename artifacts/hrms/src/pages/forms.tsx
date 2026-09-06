import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { FilePlus2 } from 'lucide-react';
import {
  useGetMe,
  getGetMeQueryKey,
  useListFormTemplates,
  getListFormTemplatesQueryKey,
  useListFormSubmissions,
  getListFormSubmissionsQueryKey,
  useCreateFormSubmission,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { PageContainer, PageHeader, StatusBadge, EmptyState, ErrorState, TableSkeleton } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import { FORM_STATUS_LABEL } from '@/lib/form-definition';

/**
 * Forms (WS-26A): the forms the caller may see — their own, those they raised,
 * and those awaiting their action — plus "Start a form" over the templates
 * published for their organization. The server decides both lists.
 */
export default function FormsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.organizationId ?? 0;

  const templatesQuery = useListFormTemplates(organizationId, { query: { queryKey: getListFormTemplatesQueryKey(organizationId), enabled: organizationId > 0 } });
  const submissionsQuery = useListFormSubmissions(organizationId, undefined, {
    query: { queryKey: getListFormSubmissionsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const createMutation = useCreateFormSubmission();
  const [templateId, setTemplateId] = useState('');

  const startable = useMemo(() => (templatesQuery.data?.templates ?? []).filter((t) => t.status === 'active' && t.currentPublishedVersionId != null), [templatesQuery.data]);

  const handleStart = () => {
    if (!templateId) return;
    createMutation.mutate(
      { organizationId, data: { templateId: Number(templateId) } },
      {
        onSuccess: (detail) => {
          queryClient.invalidateQueries({ queryKey: getListFormSubmissionsQueryKey(organizationId) });
          toast({ title: 'Form started', description: detail.template.title, variant: 'success' });
          setLocation(`/forms/${detail.submission.id}`);
        },
        onError: (err) => {
          const message = err && typeof err === 'object' && 'data' in err && err.data && typeof err.data === 'object' && 'error' in err.data ? String((err.data as { error: unknown }).error) : 'Could not start the form.';
          toast({ title: 'Form not started', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const submissions = submissionsQuery.data?.submissions ?? [];

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Forms"
        description="Official organization forms: fill, submit, follow the approval, and download at any stage."
        actions={
          startable.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="start-form-template">Start a form</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger id="start-form-template" className="w-64" data-testid="select-form-template">
                    <SelectValue placeholder="Choose a form" />
                  </SelectTrigger>
                  <SelectContent>
                    {startable.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleStart} disabled={!templateId} loading={createMutation.isPending} data-testid="button-start-form">
                <FilePlus2 aria-hidden="true" />
                Start
              </Button>
            </div>
          ) : undefined
        }
      />

      {submissionsQuery.isLoading ? (
        <TableSkeleton rows={4} columns={5} />
      ) : submissionsQuery.error ? (
        <ErrorState title="Could not load forms" onRetry={() => submissionsQuery.refetch()} />
      ) : submissions.length === 0 ? (
        <EmptyState
          title="No forms yet"
          description={startable.length > 0 ? 'Start a form from the list above.' : 'No forms have been published for your organization yet.'}
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((s) => (
                    <TableRow key={s.id} data-testid={`row-form-${s.id}`}>
                      <TableCell>
                        <Link href={`/forms/${s.id}`} className="font-medium text-primary hover:underline" data-testid={`link-form-${s.id}`}>
                          {s.templateTitle}
                        </Link>
                        <p className="text-helper text-foreground-muted">#{s.id} · v{s.versionNumber}</p>
                      </TableCell>
                      <TableCell>{s.subjectName}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} label={FORM_STATUS_LABEL[s.status] ?? s.status} />
                      </TableCell>
                      <TableCell className="tabular-nums">{s.currentStageOrder != null && s.stageCountSnapshot ? `${s.currentStageOrder} of ${s.stageCountSnapshot}` : '—'}</TableCell>
                      <TableCell className="text-foreground-muted">{new Date(s.updatedAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
