import { useState } from 'react';
import { Download, Plus, Rocket, Archive } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListFormTemplates,
  getListFormTemplatesQueryKey,
  useCreateFormTemplate,
  useCreateFormTemplateVersion,
  usePublishFormTemplateVersion,
  useArchiveFormTemplate,
  downloadFormTemplateBlank,
  type FormTemplateType,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageContainer, PageHeader, StatusBadge, EmptyState, ErrorState, ListSkeleton } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';

const TEMPLATE_TYPES: { value: FormTemplateType; label: string }[] = [
  { value: 'generic', label: 'Generic form' },
  { value: 'leave_application', label: 'Leave application' },
  { value: 'personal_information', label: 'Personal information' },
  { value: 'staff_evaluation', label: 'Staff evaluation' },
  { value: 'probationary_assessment', label: 'Probationary assessment' },
];

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) return String((data as { error: unknown }).error);
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') return (err as { message: string }).message;
  }
  return 'The request failed.';
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} must be valid JSON`);
  }
}

/**
 * Form templates (WS-26A) — organization configuration: create a template
 * from a definition, add draft versions, publish (supersedes the previous
 * published version), archive, and download the blank official form.
 * The definition is authored as JSON in this phase; a visual builder is not
 * part of the foundation.
 */
export default function FormTemplatesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.organizationId ?? 0;
  const listQuery = useListFormTemplates(organizationId, { query: { queryKey: getListFormTemplatesQueryKey(organizationId), enabled: organizationId > 0 } });
  const createMutation = useCreateFormTemplate();
  const versionMutation = useCreateFormTemplateVersion();
  const publishMutation = usePublishFormTemplateVersion();
  const archiveMutation = useArchiveFormTemplate();

  const [open, setOpen] = useState(false);
  const [newVersionFor, setNewVersionFor] = useState<number | null>(null);
  const [form, setForm] = useState({ templateKey: '', formType: 'generic' as FormTemplateType, title: '', moduleKey: '', definition: '', stages: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListFormTemplatesQueryKey(organizationId) });
  const fail = (title: string) => (err: unknown) => toast({ title, description: errorMessage(err), variant: 'destructive' });

  const submitDialog = () => {
    setFormError(null);
    let definition: unknown;
    let stages: unknown;
    try {
      definition = parseJson(form.definition, 'Definition');
      stages = form.stages.trim() ? parseJson(form.stages, 'Stages') : undefined;
    } catch (err) {
      setFormError((err as Error).message);
      return;
    }
    const onSuccess = () => {
      refresh();
      setOpen(false);
      setNewVersionFor(null);
      setForm({ templateKey: '', formType: 'generic', title: '', moduleKey: '', definition: '', stages: '' });
      toast({ title: newVersionFor ? 'Draft version created' : 'Template created', variant: 'success' });
    };
    const onError = (err: unknown) => setFormError(errorMessage(err));
    if (newVersionFor) {
      versionMutation.mutate({ organizationId, templateId: newVersionFor, data: { definition: definition as Record<string, unknown>, stages: stages as never } }, { onSuccess, onError });
    } else {
      createMutation.mutate(
        {
          organizationId,
          data: {
            templateKey: form.templateKey.trim(),
            formType: form.formType,
            title: form.title.trim(),
            moduleKey: form.moduleKey.trim() || null,
            definition: definition as Record<string, unknown>,
            stages: stages as never,
          },
        },
        { onSuccess, onError },
      );
    }
  };

  const handleBlank = async (versionId: number, title: string) => {
    try {
      const blob = await downloadFormTemplateBlank(organizationId, versionId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title} - blank.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      fail('Download failed')(err);
    }
  };

  const templates = listQuery.data?.templates ?? [];

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Form templates"
        description="Official organization forms as versioned templates. A published version is frozen; changes ship as a new version."
        actions={
          <Button onClick={() => { setNewVersionFor(null); setOpen(true); }} data-testid="button-new-template">
            <Plus aria-hidden="true" />
            New template
          </Button>
        }
      />

      {listQuery.isLoading ? (
        <ListSkeleton lines={3} />
      ) : listQuery.error ? (
        <ErrorState title="Could not load templates" onRetry={() => listQuery.refetch()} />
      ) : templates.length === 0 ? (
        <EmptyState title="No form templates" description="Create a template from a definition to make an official form available." />
      ) : (
        <div className="space-y-4">
          {templates.map((t) => (
            <Card key={t.id} data-testid={`card-template-${t.id}`}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {t.title}
                    <StatusBadge status={t.status} />
                  </CardTitle>
                  <CardDescription>
                    <span className="font-mono">{t.templateKey}</span> · {TEMPLATE_TYPES.find((x) => x.value === t.formType)?.label ?? t.formType}
                    {t.moduleKey ? ` · module ${t.moduleKey}` : ''}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={t.status !== 'active'} onClick={() => { setNewVersionFor(t.id); setOpen(true); }} data-testid={`button-new-version-${t.id}`}>
                    <Plus aria-hidden="true" />
                    New version
                  </Button>
                  <Button variant="ghost" size="sm" disabled={t.status !== 'active'} onClick={() => archiveMutation.mutate({ organizationId, templateId: t.id }, { onSuccess: () => { refresh(); toast({ title: 'Template archived' }); }, onError: fail('Not archived') })} data-testid={`button-archive-template-${t.id}`}>
                    <Archive aria-hidden="true" />
                    Archive
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Published</TableHead>
                        <TableHead>First used</TableHead>
                        <TableHead>Definition hash</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.versions.map((v) => (
                        <TableRow key={v.id} data-testid={`row-version-${v.id}`}>
                          <TableCell className="tabular-nums">v{v.versionNumber}{v.changeNote ? <span className="block text-helper text-foreground-muted">{v.changeNote}</span> : null}</TableCell>
                          <TableCell><StatusBadge status={v.status} /></TableCell>
                          <TableCell className="text-foreground-muted">{v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}</TableCell>
                          <TableCell className="text-foreground-muted">{v.firstUsedAt ? new Date(v.firstUsedAt).toLocaleDateString() : '—'}</TableCell>
                          <TableCell className="font-mono text-helper">{v.definitionSha256.slice(0, 12)}…</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleBlank(v.id, t.title)} data-testid={`button-blank-${v.id}`}>
                                <Download aria-hidden="true" />
                                Blank PDF
                              </Button>
                              {v.status === 'draft' && (
                                <Button size="sm" onClick={() => publishMutation.mutate({ organizationId, versionId: v.id }, { onSuccess: () => { refresh(); toast({ title: `Version ${v.versionNumber} published`, variant: 'success' }); }, onError: fail('Not published') })} data-testid={`button-publish-${v.id}`}>
                                  <Rocket aria-hidden="true" />
                                  Publish
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormError(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{newVersionFor ? 'New draft version' : 'New form template'}</DialogTitle>
            <DialogDescription>
              {newVersionFor ? 'The new version starts as a draft; publish it to supersede the current version.' : 'Paste the definition JSON and, optionally, the workflow stages JSON. The server validates both.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {!newVersionFor && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="tpl-key" required>Template key</Label>
                  <Input id="tpl-key" value={form.templateKey} onChange={(e) => setForm({ ...form, templateKey: e.target.value })} placeholder="e.g. leave_application" data-testid="input-template-key" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tpl-type" required>Type</Label>
                  <Select value={form.formType} onValueChange={(v) => setForm({ ...form, formType: v as FormTemplateType })}>
                    <SelectTrigger id="tpl-type" data-testid="select-template-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tpl-title" required>Title</Label>
                  <Input id="tpl-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-template-title" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tpl-module">Module key (optional)</Label>
                  <Input id="tpl-module" value={form.moduleKey} onChange={(e) => setForm({ ...form, moduleKey: e.target.value })} placeholder="leave, performance…" data-testid="input-template-module" />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="tpl-definition" required>Definition (JSON)</Label>
              <Textarea id="tpl-definition" rows={10} className="font-mono text-helper" value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} data-testid="input-template-definition" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-stages">Workflow stages (JSON, optional)</Label>
              <Textarea id="tpl-stages" rows={5} className="font-mono text-helper" value={form.stages} onChange={(e) => setForm({ ...form, stages: e.target.value })} data-testid="input-template-stages" />
            </div>
            {formError && (
              <p role="alert" className="text-body-sm text-danger-soft-foreground" data-testid="template-form-error">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submitDialog} loading={createMutation.isPending || versionMutation.isPending} data-testid="button-save-template">
              {newVersionFor ? 'Create draft version' : 'Create template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
