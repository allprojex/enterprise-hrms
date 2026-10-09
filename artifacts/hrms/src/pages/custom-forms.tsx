import { useMemo, useState } from 'react';
import { Plus, Send, Archive, CheckCircle2, FileText, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetCustomFieldMeta,
  getGetCustomFieldMetaQueryKey,
  useListCustomFields,
  getListCustomFieldsQueryKey,
  useListCustomForms,
  getListCustomFormsQueryKey,
  useCreateCustomForm,
  useGetCustomForm,
  getGetCustomFormQueryKey,
  useCreateCustomFormVersion,
  usePublishCustomFormVersion,
  useArchiveCustomForm,
  useListCustomFormSubmissions,
  getListCustomFormSubmissionsQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

interface SectionDraft {
  key: string;
  heading: string;
  helpText: string;
  fieldIds: number[];
}

const FORM_TYPES = [
  { value: 'internal_hr', label: 'Internal HR form' },
  { value: 'employee_ess', label: 'Employee self-service form' },
  { value: 'onboarding', label: 'Onboarding form' },
  { value: 'candidate_application', label: 'Candidate / application form' },
];

/**
 * WS-8 — Form Builder.
 *
 * An ordered section editor, not a page designer: the frozen scope explicitly
 * excludes drag-and-drop layout, arbitrary HTML/CSS and scripting. Publishing
 * freezes a version, and submissions captured against it keep rendering as
 * submitted even after later edits.
 */
export default function CustomForms() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingVersion, setEditingVersion] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: number; formKey: string; active: boolean } | null>(null);

  const [formKey, setFormKey] = useState('');
  const [formType, setFormType] = useState('internal_hr');
  const [scope, setScope] = useState('employee');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<SectionDraft[]>([{ key: 'section_1', heading: 'Details', helpText: '', fieldIds: [] }]);

  const metaQuery = useGetCustomFieldMeta(organizationId, {
    query: { queryKey: getGetCustomFieldMetaQueryKey(organizationId), enabled },
  });
  const formsQuery = useListCustomForms(organizationId, {
    query: { queryKey: getListCustomFormsQueryKey(organizationId), enabled },
  });
  const detailQuery = useGetCustomForm(organizationId, selectedFormId ?? 0, {
    query: { queryKey: getGetCustomFormQueryKey(organizationId, selectedFormId ?? 0), enabled: enabled && selectedFormId != null },
  });
  const fieldsQuery = useListCustomFields(
    organizationId,
    { scope },
    { query: { queryKey: getListCustomFieldsQueryKey(organizationId, { scope }), enabled } },
  );
  const submissionsQuery = useListCustomFormSubmissions(
    organizationId,
    { formId: selectedFormId ?? undefined },
    {
      query: {
        queryKey: getListCustomFormSubmissionsQueryKey(organizationId, { formId: selectedFormId ?? undefined }),
        enabled: enabled && selectedFormId != null,
      },
    },
  );

  const createMutation = useCreateCustomForm();
  const versionMutation = useCreateCustomFormVersion();
  const publishMutation = usePublishCustomFormVersion();
  const archiveMutation = useArchiveCustomForm();

  const scopes = metaQuery.data?.scopes ?? [];
  const availableFields = fieldsQuery.data?.fields ?? [];
  const forms = formsQuery.data?.forms ?? [];
  const detail = detailQuery.data;

  const layoutPayload = useMemo(
    () => ({
      sections: sections.map((s) => ({
        key: s.key,
        heading: s.heading.trim(),
        helpText: s.helpText.trim() || null,
        items: s.fieldIds.map((id) => ({ kind: 'field' as const, definitionId: id })),
      })),
    }),
    [sections],
  );

  const usedFieldIds = new Set(sections.flatMap((s) => s.fieldIds));

  const resetDraft = () => {
    setFormKey('');
    setTitle('');
    setDescription('');
    setSections([{ key: 'section_1', heading: 'Details', helpText: '', fieldIds: [] }]);
  };

  const handleCreate = () => {
    createMutation.mutate(
      { organizationId, data: { formKey: formKey.trim().toLowerCase(), formType: formType as "internal_hr" | "employee_ess" | "onboarding" | "candidate_application", scope, title: title.trim(), description: description.trim() || null, layout: layoutPayload } },
      {
        onSuccess: (created) => {
          void formsQuery.refetch();
          setSelectedFormId(created.form.id);
          setCreating(false);
          resetDraft();
          toast({ title: 'Form created', description: 'It starts as a draft — publish it when you are ready.' });
        },
        onError: (err) => toast({ title: 'Could not create form', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );
  };

  const handleNewVersion = () => {
    if (selectedFormId == null) return;
    versionMutation.mutate(
      { organizationId, formId: selectedFormId, data: { title: title.trim(), description: description.trim() || null, layout: layoutPayload } },
      {
        onSuccess: () => {
          void detailQuery.refetch();
          setEditingVersion(false);
          toast({ title: 'Draft version created' });
        },
        onError: (err) => toast({ title: 'Could not create version', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );
  };

  if (isForbidden(formsQuery.error) || isForbidden(metaQuery.error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to forms"
          message="Building forms requires the custom forms permissions. Ask an organization administrator if you need access."
        />
      </div>
    );
  }

  const builder = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="form-title">Title</Label>
          <Input id="form-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New Starter Details" />
        </div>
        {!editingVersion && (
          <div>
            <Label htmlFor="form-key">Form key</Label>
            <Input id="form-key" value={formKey} onChange={(e) => setFormKey(e.target.value)} placeholder="new_starter_details" />
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="form-desc">Description</Label>
        <Textarea id="form-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>

      {!editingVersion && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="form-type">Form type</Label>
            <Select value={formType} onValueChange={setFormType}>
              <SelectTrigger id="form-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORM_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="form-scope">Record type</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger id="form-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopes.map((s) => (
                  <SelectItem key={s.scope} value={s.scope}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <Label>Sections</Label>
        {sections.map((section, si) => (
          <div key={section.key} className="space-y-2 rounded-md border p-3">
            <div className="flex gap-2">
              <Input
                value={section.heading}
                placeholder="Section heading"
                onChange={(e) => setSections((prev) => prev.map((p, i) => (i === si ? { ...p, heading: e.target.value } : p)))}
              />
              <Button variant="outline" size="sm" onClick={() => setSections((prev) => prev.filter((_, i) => i !== si))} disabled={sections.length === 1}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <Input
              value={section.helpText}
              placeholder="Help text (optional)"
              onChange={(e) => setSections((prev) => prev.map((p, i) => (i === si ? { ...p, helpText: e.target.value } : p)))}
            />

            <div className="space-y-1">
              {section.fieldIds.map((fid, fi) => {
                const f = availableFields.find((a) => a.definition.id === fid);
                return (
                  <div key={fid} className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1 text-sm">
                    <span className="grow">{f?.version.label ?? `Field ${fid}`}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={fi === 0}
                      onClick={() =>
                        setSections((prev) =>
                          prev.map((p, i) => {
                            if (i !== si) return p;
                            const next = [...p.fieldIds];
                            [next[fi - 1], next[fi]] = [next[fi], next[fi - 1]];
                            return { ...p, fieldIds: next };
                          }),
                        )
                      }
                    >
                      <ArrowUp className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={fi === section.fieldIds.length - 1}
                      onClick={() =>
                        setSections((prev) =>
                          prev.map((p, i) => {
                            if (i !== si) return p;
                            const next = [...p.fieldIds];
                            [next[fi + 1], next[fi]] = [next[fi], next[fi + 1]];
                            return { ...p, fieldIds: next };
                          }),
                        )
                      }
                    >
                      <ArrowDown className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSections((prev) => prev.map((p, i) => (i === si ? { ...p, fieldIds: p.fieldIds.filter((x) => x !== fid) } : p)))}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                );
              })}

              <Select
                value="__add__"
                onValueChange={(v) => {
                  const id = Number(v);
                  if (!Number.isInteger(id)) return;
                  setSections((prev) => prev.map((p, i) => (i === si ? { ...p, fieldIds: [...p.fieldIds, id] } : p)));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Add a field…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__add__" disabled>
                    Add a field…
                  </SelectItem>
                  {availableFields
                    .filter((f) => !usedFieldIds.has(f.definition.id))
                    .map((f) => (
                      <SelectItem key={f.definition.id} value={String(f.definition.id)}>
                        {f.version.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSections((prev) => [...prev, { key: `section_${prev.length + 1}`, heading: '', helpText: '', fieldIds: [] }])}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add section
        </Button>
        <p className="text-xs text-muted-foreground">
          Only fields defined for this record type can be added. A field may appear once per form.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-6" data-testid="page-custom-forms">
      <div>
        <h1 className="text-2xl font-semibold">Form Builder</h1>
        <p className="text-muted-foreground">
          Compose your custom fields into data-entry forms. Publishing freezes a version, so past submissions keep their original wording.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Forms</CardTitle>
          <CardDescription>Draft, publish and archive forms for your organization.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => {
              resetDraft();
              setCreating(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New form
          </Button>

          {forms.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Record type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((f) => (
                  <TableRow key={f.id} data-testid={`row-form-${f.formKey}`}>
                    <TableCell className="font-medium">{f.formKey}</TableCell>
                    <TableCell>{FORM_TYPES.find((t) => t.value === f.formType)?.label ?? f.formType}</TableCell>
                    <TableCell>{scopes.find((s) => s.scope === f.scope)?.label ?? f.scope}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{f.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant={selectedFormId === f.id ? 'default' : 'outline'} size="sm" onClick={() => setSelectedFormId(f.id)}>
                        {selectedFormId === f.id ? 'Selected' : 'Open'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No forms yet.</p>
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" aria-hidden="true" />
              {detail.form.formKey}
              <Badge variant="secondary">{detail.form.status}</Badge>
            </CardTitle>
            <CardDescription>
              {detail.publishedVersion
                ? `Version ${detail.publishedVersion.versionNumber} is live. Editing creates a new draft — it does not change what is already published.`
                : 'This form has no published version yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const latest = detail.versions[0];
                  setTitle(latest?.title ?? '');
                  setDescription(latest?.description ?? '');
                  const layout = latest?.layout as { sections?: { key: string; heading: string; helpText?: string | null; items?: { kind: string; definitionId?: number }[] }[] } | undefined;
                  setSections(
                    (layout?.sections ?? []).map((s) => ({
                      key: s.key,
                      heading: s.heading,
                      helpText: s.helpText ?? '',
                      fieldIds: (s.items ?? []).filter((i) => i.kind === 'field' && i.definitionId != null).map((i) => i.definitionId!),
                    })),
                  );
                  setScope(detail.form.scope);
                  setEditingVersion(true);
                }}
              >
                Edit as new draft
              </Button>
              <Button
                variant="outline"
                disabled={archiveMutation.isPending}
                onClick={() => setArchiveTarget({ id: detail.form.id, formKey: detail.form.formKey, active: detail.form.status === 'active' })}
              >
                <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                {detail.form.status === 'active' ? 'Archive' : 'Restore'}
              </Button>
            </div>

            <div>
              <h3 className="mb-2 font-medium">Versions</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.versions.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>v{v.versionNumber}</TableCell>
                      <TableCell>{v.title}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={v.status === 'published' ? 'bg-green-100 text-green-800' : ''}>
                          {v.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {v.status === 'draft' && (
                          <Button
                            size="sm"
                            disabled={publishMutation.isPending}
                            onClick={() =>
                              publishMutation.mutate(
                                { organizationId, formId: detail.form.id, versionId: v.id },
                                {
                                  onSuccess: () => {
                                    void detailQuery.refetch();
                                    toast({ title: `Version ${v.versionNumber} published` });
                                  },
                                  onError: (err) => toast({ title: 'Could not publish', description: errorMessage(err, ''), variant: 'destructive' }),
                                },
                              )
                            }
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                            Publish
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {(submissionsQuery.data?.submissions?.length ?? 0) > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-2 font-medium">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Submissions
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Record</TableHead>
                      <TableHead>Captured version</TableHead>
                      <TableHead>Answers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissionsQuery.data!.submissions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{new Date(s.submittedAt).toLocaleString()}</TableCell>
                        <TableCell>{s.entityId ?? '—'}</TableCell>
                        <TableCell>
                          {detail.versions.find((v) => v.id === s.formVersionId)?.versionNumber
                            ? `v${detail.versions.find((v) => v.id === s.formVersionId)!.versionNumber}`
                            : s.formVersionId}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {/* Rendered from the labels captured at submission time. */}
                          {(s.answers as { label?: string }[]).map((a) => a.label).filter(Boolean).join(', ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Archiving refuses new submissions and new versions (lib/customFields/forms.ts);
          captured submissions are kept and Restore reverses it. */}
      <ConfirmActionDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => {
          if (!o) setArchiveTarget(null);
        }}
        title={archiveTarget?.active === false ? 'Restore form?' : 'Archive form?'}
        description={
          archiveTarget?.active === false ? (
            <p>“{archiveTarget?.formKey}” will accept new submissions and new versions again.</p>
          ) : (
            <p>
              “{archiveTarget?.formKey}” will no longer accept new submissions or new versions. Existing submissions are kept, and the form
              can be restored later.
            </p>
          )
        }
        confirmLabel={archiveTarget?.active === false ? 'Restore Form' : 'Archive Form'}
        tone={archiveTarget?.active === false ? 'default' : 'destructive'}
        onConfirm={() => {
          if (!archiveTarget) return;
          const archiving = archiveTarget.active;
          return archiveMutation.mutateAsync(
            { organizationId, formId: archiveTarget.id, data: { archived: archiving } },
            {
              onSuccess: () => {
                void formsQuery.refetch();
                void detailQuery.refetch();
                toast({ title: archiving ? 'Form archived' : 'Form restored' });
              },
              onError: (err) => toast({ title: 'Could not update', description: errorMessage(err, ''), variant: 'destructive' }),
            },
          );
        }}
        testId="dialog-archive-custom-form"
      />

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New form</DialogTitle>
            <DialogDescription>Compose custom fields into sections. The form starts as a draft.</DialogDescription>
          </DialogHeader>
          {builder}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={!formKey.trim() || !title.trim() || createMutation.isPending}>
              Create form
            </Button>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editingVersion} onOpenChange={(o) => !o && setEditingVersion(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New draft version</DialogTitle>
            <DialogDescription>Existing submissions keep the version they were captured under.</DialogDescription>
          </DialogHeader>
          {builder}
          <div className="flex gap-2">
            <Button onClick={handleNewVersion} disabled={!title.trim() || versionMutation.isPending}>
              Create draft
            </Button>
            <Button variant="outline" onClick={() => setEditingVersion(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
