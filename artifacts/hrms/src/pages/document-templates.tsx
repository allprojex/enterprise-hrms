import { useState } from 'react';
import { FileSignature, Plus, Eye, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useListDocumentTemplates,
  getListDocumentTemplatesQueryKey,
  useCreateDocumentTemplate,
  useUpdateDocumentTemplateStatus,
  useListDocumentTemplateVersions,
  getListDocumentTemplateVersionsQueryKey,
  useCreateDocumentTemplateVersion,
  useUpdateDocumentTemplateVersion,
  useActivateDocumentTemplateVersion,
  previewDocumentTemplateVersion,
  useListDocumentMergeFields,
  getListDocumentMergeFieldsQueryKey,
  useListDocumentCategories,
  getListDocumentCategoriesQueryKey,
  useGetMe,
  getGetMeQueryKey,
  type DocumentTemplate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useIsHrCapable } from '@/hooks/use-hr-capable';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

/**
 * Version management for one template. A draft is edited in place; an active
 * version never is — editing it creates a new draft, which mirrors the
 * server's own rule and is why the content editor is disabled for non-drafts
 * rather than silently failing on save.
 */
function TemplateVersionsDialog({
  organizationId,
  template,
  canManage,
  onClose,
}: {
  organizationId: number;
  template: DocumentTemplate;
  canManage: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: versions,
    isLoading,
    error,
    refetch,
  } = useListDocumentTemplateVersions(organizationId, template.id, {
    query: { queryKey: getListDocumentTemplateVersionsQueryKey(organizationId, template.id) },
  });

  const { data: mergeFields } = useListDocumentMergeFields(organizationId, {
    query: { queryKey: getListDocumentMergeFieldsQueryKey(organizationId) },
  });

  const createVersionMutation = useCreateDocumentTemplateVersion();
  const updateVersionMutation = useUpdateDocumentTemplateVersion();
  const activateMutation = useActivateDocumentTemplateVersion();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const selected = versions?.find((v) => v.id === selectedId) ?? versions?.[0] ?? null;
  const editing = selectedId !== null && selected?.id === selectedId;
  const editorValue = editing ? content : (selected?.content ?? '');
  const isDraft = selected?.status === 'draft';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListDocumentTemplateVersionsQueryKey(organizationId, template.id) });
    queryClient.invalidateQueries({ queryKey: [`/api/organizations/${organizationId}/document-templates`] });
  };

  const selectVersion = (id: number) => {
    setSelectedId(id);
    setContent(versions?.find((v) => v.id === id)?.content ?? '');
    setPreview(null);
  };

  const handleSaveDraft = () => {
    if (!selected) return;
    updateVersionMutation.mutate(
      { organizationId, templateId: template.id, versionId: selected.id, data: { content } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Draft saved' });
        },
        onError: (err) => {
          toast({ title: 'Could not save draft', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handleCreateVersion = () => {
    createVersionMutation.mutate(
      { organizationId, templateId: template.id, data: { content: editorValue } },
      {
        onSuccess: (created) => {
          invalidate();
          setSelectedId(created.id);
          setContent(created.content);
          toast({ title: `Draft version v${created.versionNumber} created` });
        },
        onError: (err) => {
          toast({ title: 'Could not create version', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handleActivate = (versionId: number) => {
    activateMutation.mutate(
      { organizationId, templateId: template.id, versionId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Version activated' });
        },
        onError: (err) => {
          toast({ title: 'Could not activate version', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );
  };

  const handlePreview = async () => {
    if (!selected) return;
    try {
      const result = await previewDocumentTemplateVersion(organizationId, template.id, selected.id);
      setPreview(result.text);
    } catch (err) {
      toast({ title: 'Could not render preview', description: errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>
            Template versions. Only a draft can be edited — editing an active version creates a new draft, so documents
            already generated from it stay unchanged.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4" aria-busy="true" aria-label="Loading template versions">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <QueryError title="Failed to load versions" message="Could not fetch template versions." onRetry={() => refetch()} />
        ) : (
          <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 text-sm font-semibold">Versions</h4>
                <Table aria-label="Template versions">
                  <TableBody>
                    {(versions ?? []).map((version) => (
                      <TableRow
                        key={version.id}
                        className="cursor-pointer"
                        onClick={() => selectVersion(version.id)}
                        data-testid={`row-template-version-${version.id}`}
                      >
                        <TableCell className="font-medium">v{version.versionNumber}</TableCell>
                        <TableCell>
                          <Badge
                            variant={version.status === 'active' ? 'secondary' : 'outline'}
                            className="capitalize"
                          >
                            {version.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && version.status !== 'active' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleActivate(version.id);
                              }}
                              disabled={activateMutation.isPending}
                              title="Activate this version"
                              data-testid={`button-activate-version-${version.id}`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold">Merge fields</h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  Only these resolve. Anything else is rejected when the version is saved.
                </p>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                  {(mergeFields ?? []).map((field) => (
                    <li key={field.key} className="flex flex-col">
                      <code className="font-mono text-foreground">{`{{${field.key}}}`}</code>
                      <span className="text-muted-foreground">{field.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="template-content">
                  Content {selected ? `(v${selected.versionNumber}, ${selected.status})` : ''}
                </Label>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handlePreview} disabled={!selected} data-testid="button-preview-version">
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    Preview
                  </Button>
                  {canManage && isDraft && (
                    <Button
                      size="sm"
                      onClick={handleSaveDraft}
                      disabled={updateVersionMutation.isPending}
                      data-testid="button-save-draft"
                    >
                      {updateVersionMutation.isPending ? 'Saving…' : 'Save Draft'}
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleCreateVersion}
                      disabled={createVersionMutation.isPending}
                      data-testid="button-create-version"
                    >
                      New Version
                    </Button>
                  )}
                </div>
              </div>
              <Textarea
                id="template-content"
                className="min-h-[18rem] font-mono text-sm"
                value={editorValue}
                onChange={(e) => {
                  if (selected) setSelectedId(selected.id);
                  setContent(e.target.value);
                }}
                readOnly={!canManage || !isDraft}
                data-testid="input-template-content"
              />
              {preview !== null && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Preview</h4>
                  <p className="text-xs text-muted-foreground">
                    Rendered with sample data — never a real employee record.
                  </p>
                  <pre
                    className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-xs"
                    data-testid="text-template-preview"
                  >
                    {preview}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentTemplates() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  // Role-shaped gate; the backend enforces document_template.read for the
  // list and document_template.manage for every mutation below.
  const isHrCapable = useIsHrCapable(organizationId);

  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useListDocumentTemplates(organizationId, undefined, {
    query: {
      queryKey: getListDocumentTemplatesQueryKey(organizationId),
      enabled: organizationId > 0,
    },
  });

  const { data: categories } = useListDocumentCategories(organizationId, {
    query: { queryKey: getListDocumentCategoriesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const createMutation = useCreateDocumentTemplate();
  const statusMutation = useUpdateDocumentTemplateStatus();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');

  const [versionsFor, setVersionsFor] = useState<DocumentTemplate | null>(null);
  const [statusTarget, setStatusTarget] = useState<DocumentTemplate | null>(null);
  const deactivating = statusTarget?.status === 'active';

  const invalidateTemplates = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/organizations/${organizationId}/document-templates`] });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      {
        organizationId,
        data: {
          name: name.trim(),
          categoryCode,
          content,
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          invalidateTemplates();
          setCreateOpen(false);
          setName('');
          setCategoryCode('');
          setDescription('');
          setContent('');
          toast({ title: 'Template created' });
        },
        onError: (err) => {
          toast({
            title: 'Could not create template',
            description: errorMessage(err) ?? 'Please check the details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  // Runs only from the confirmation dialog. The backend (setTemplateStatus)
  // flips the status and nothing more; generation does not yet check it, so the
  // dialog copy deliberately promises nothing beyond "marked inactive".
  const handleToggleStatus = (template: DocumentTemplate) =>
    statusMutation.mutateAsync(
      {
        organizationId,
        templateId: template.id,
        data: { status: template.status === 'active' ? 'inactive' : 'active' },
      },
      {
        onSuccess: () => {
          invalidateTemplates();
          toast({ title: template.status === 'active' ? 'Template deactivated' : 'Template activated' });
        },
        onError: (err) => {
          toast({ title: 'Could not update template', description: errorMessage(err), variant: 'destructive' });
        },
      },
    );

  const categoryLabel = (code: string) => categories?.find((c) => c.categoryCode === code)?.label ?? code;

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Document Templates</h1>
          <p className="text-muted-foreground">
            Reusable templates for official HR letters, with versioned content and merge fields
          </p>
        </div>
        {isHrCapable && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-template">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>New Template</DialogTitle>
                  <DialogDescription>
                    Content is plain text with <code className="font-mono">{'{{merge.field}}'}</code> tokens. Unknown
                    fields are rejected now rather than at generation time.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Name</Label>
                    <Input
                      id="template-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      data-testid="input-template-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-category">Category</Label>
                    <Select value={categoryCode} onValueChange={setCategoryCode}>
                      <SelectTrigger id="template-category" data-testid="select-template-category">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories ?? []).map((category) => (
                          <SelectItem key={category.categoryCode} value={category.categoryCode}>
                            {category.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-description">Description</Label>
                    <Input
                      id="template-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      data-testid="input-template-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-body">Content</Label>
                    <Textarea
                      id="template-body"
                      className="min-h-[12rem] font-mono text-sm"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      required
                      data-testid="input-template-body"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || !categoryCode}
                    data-testid="button-submit-template"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Create Template'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading templates">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError
          title="Failed to load templates"
          message="Could not fetch document templates. Try again."
          onRetry={() => refetch()}
        />
      ) : !templates || templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileSignature className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No templates yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Create a template to generate official HR letters from a single, versioned source.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Document templates">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id} data-testid={`row-template-${template.id}`}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{categoryLabel(template.categoryCode)}</TableCell>
                  <TableCell>
                    <Badge variant={template.status === 'active' ? 'secondary' : 'outline'} className="capitalize">
                      {template.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setVersionsFor(template)}
                        data-testid={`button-versions-template-${template.id}`}
                      >
                        Versions
                      </Button>
                      {isHrCapable && (
                        <Button
                          size="sm"
                          variant={template.status === 'active' ? 'destructive' : 'default'}
                          onClick={() => setStatusTarget(template)}
                          disabled={statusMutation.isPending}
                          data-testid={`button-toggle-template-${template.id}`}
                        >
                          {template.status === 'active' ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ConfirmActionDialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open) setStatusTarget(null);
        }}
        title={deactivating ? 'Deactivate document template?' : 'Activate document template?'}
        description={
          deactivating ? (
            <p>
              “{statusTarget?.name}” will be marked inactive. Its versions and any documents already generated from it are preserved, and it
              can be activated again later.
            </p>
          ) : (
            <p>“{statusTarget?.name}” will be marked active again.</p>
          )
        }
        confirmLabel={deactivating ? 'Deactivate Template' : 'Activate Template'}
        tone={deactivating ? 'destructive' : 'default'}
        onConfirm={() => statusTarget && handleToggleStatus(statusTarget)}
        testId="dialog-toggle-document-template"
      />

      {versionsFor && (
        <TemplateVersionsDialog
          organizationId={organizationId}
          template={versionsFor}
          canManage={isHrCapable}
          onClose={() => setVersionsFor(null)}
        />
      )}
    </div>
  );
}
