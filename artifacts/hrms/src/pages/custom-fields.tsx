import { useMemo, useState } from 'react';
import { Plus, Archive, ArchiveRestore, History, Lock, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetCustomFieldMeta,
  getGetCustomFieldMetaQueryKey,
  useListCustomFields,
  getListCustomFieldsQueryKey,
  useCreateCustomField,
  useCreateCustomFieldVersion,
  useArchiveCustomField,
  useGetCustomField,
  getGetCustomFieldQueryKey,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

interface ChoiceDraft {
  value: string;
  label: string;
}

/**
 * WS-8 — Custom Fields configuration.
 *
 * Deliberately a plain ordered editor, not a visual designer: the frozen scope
 * asks for organization configuration, and every safeguard that matters
 * (breaking-change refusal, scope binding, visibility validation) lives on the
 * server. This page's job is to make those rules legible — which is why it
 * shows version history and warns before an edit that the server will reject.
 */
export default function CustomFields() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [scope, setScope] = useState('employee');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const metaQuery = useGetCustomFieldMeta(organizationId, {
    query: { queryKey: getGetCustomFieldMetaQueryKey(organizationId), enabled },
  });
  const listQuery = useListCustomFields(
    organizationId,
    { scope, includeArchived: showArchived ? 'true' : undefined },
    { query: { queryKey: getListCustomFieldsQueryKey(organizationId, { scope, includeArchived: showArchived ? 'true' : undefined }), enabled } },
  );
  const detailQuery = useGetCustomField(organizationId, editing ?? 0, {
    query: { queryKey: getGetCustomFieldQueryKey(organizationId, editing ?? 0), enabled: enabled && editing != null },
  });

  const createMutation = useCreateCustomField();
  const versionMutation = useCreateCustomFieldVersion();
  const archiveMutation = useArchiveCustomField();

  const fieldTypes = metaQuery.data?.fieldTypes ?? [];
  const scopes = metaQuery.data?.scopes ?? [];
  const fields = listQuery.data?.fields ?? [];

  // --- draft state -----------------------------------------------------------
  const [fieldKey, setFieldKey] = useState('');
  const [label, setLabel] = useState('');
  const [helpText, setHelpText] = useState('');
  const [fieldType, setFieldType] = useState('short_text');
  const [required, setRequired] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [displayOrder, setDisplayOrder] = useState('0');
  const [choices, setChoices] = useState<ChoiceDraft[]>([]);
  const [masterDataDomain, setMasterDataDomain] = useState('');
  const [conditionFieldKey, setConditionFieldKey] = useState('');
  const [conditionOperator, setConditionOperator] = useState('equals');
  const [conditionValue, setConditionValue] = useState('');

  const selectedType = useMemo(() => fieldTypes.find((t) => t.type === fieldType), [fieldTypes, fieldType]);
  const needsChoices = fieldType === 'single_select' || fieldType === 'multi_select';
  const needsDomain = fieldType === 'master_data_reference';

  const resetDraft = () => {
    setFieldKey('');
    setLabel('');
    setHelpText('');
    setFieldType('short_text');
    setRequired(false);
    setSensitive(false);
    setDisplayOrder('0');
    setChoices([]);
    setMasterDataDomain('');
    setConditionFieldKey('');
    setConditionOperator('equals');
    setConditionValue('');
  };

  const buildPayload = () => ({
    label: label.trim(),
    helpText: helpText.trim() || null,
    fieldType,
    required,
    sensitivity: sensitive ? ('sensitive' as const) : ('normal' as const),
    displayOrder: Number(displayOrder) || 0,
    options: needsChoices
      ? { choices: choices.filter((c) => c.value.trim()).map((c) => ({ value: c.value.trim(), label: c.label.trim() || c.value.trim() })) }
      : needsDomain
        ? { masterDataDomain: masterDataDomain.trim() }
        : null,
    visibility: conditionFieldKey
      ? {
          match: 'all',
          conditions: [
            {
              fieldKey: conditionFieldKey,
              operator: conditionOperator,
              ...(conditionOperator === 'is_empty' || conditionOperator === 'is_not_empty' ? {} : { value: conditionValue }),
            },
          ],
        }
      : null,
  });

  const handleCreate = () => {
    createMutation.mutate(
      { organizationId, data: { scope, fieldKey: fieldKey.trim().toLowerCase(), ...buildPayload() } },
      {
        onSuccess: () => {
          void listQuery.refetch();
          setCreating(false);
          resetDraft();
          toast({ title: 'Custom field created' });
        },
        onError: (err) => toast({ title: 'Could not create field', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );
  };

  const handleNewVersion = () => {
    if (editing == null) return;
    versionMutation.mutate(
      { organizationId, definitionId: editing, data: buildPayload() },
      {
        onSuccess: () => {
          void listQuery.refetch();
          void detailQuery.refetch();
          setEditing(null);
          resetDraft();
          toast({ title: 'New version created' });
        },
        onError: (err) =>
          toast({
            title: 'Could not update field',
            // The server refuses breaking changes with a precise reason; showing
            // it verbatim is more useful than a generic message.
            description: errorMessage(err, 'This change may be breaking.'),
            variant: 'destructive',
          }),
      },
    );
  };

  const openEdit = (definitionId: number) => {
    const f = fields.find((x) => x.definition.id === definitionId);
    if (!f) return;
    setFieldKey(f.definition.fieldKey);
    setLabel(f.version.label);
    setHelpText(f.version.helpText ?? '');
    setFieldType(f.version.fieldType);
    setRequired(f.version.required);
    setSensitive(f.version.sensitivity === 'sensitive');
    setDisplayOrder(String(f.version.displayOrder));
    const opts = f.version.options as { choices?: ChoiceDraft[]; masterDataDomain?: string } | null;
    setChoices(opts?.choices ?? []);
    setMasterDataDomain(opts?.masterDataDomain ?? '');
    const vis = f.version.visibility as { conditions?: { fieldKey: string; operator: string; value?: unknown }[] } | null;
    const first = vis?.conditions?.[0];
    setConditionFieldKey(first?.fieldKey ?? '');
    setConditionOperator(first?.operator ?? 'equals');
    setConditionValue(first?.value != null ? String(first.value) : '');
    setEditing(definitionId);
  };

  if (isForbidden(listQuery.error) || isForbidden(metaQuery.error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to custom fields"
          message="Configuring custom fields requires the custom fields permissions. Ask an organization administrator if you need access."
        />
      </div>
    );
  }

  const editorBody = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cf-key">Field key</Label>
          <Input
            id="cf-key"
            value={fieldKey}
            disabled={editing != null}
            onChange={(e) => setFieldKey(e.target.value)}
            placeholder="church_membership_status"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {editing != null ? 'The key never changes — it is what keeps historical values attached.' : 'Lowercase letters, numbers and underscores.'}
          </p>
        </div>
        <div>
          <Label htmlFor="cf-label">Label</Label>
          <Input id="cf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Church Membership Status" />
        </div>
      </div>

      <div>
        <Label htmlFor="cf-help">Help text</Label>
        <Textarea id="cf-help" value={helpText} onChange={(e) => setHelpText(e.target.value)} rows={2} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="cf-type">Type</Label>
          <Select value={fieldType} onValueChange={setFieldType}>
            <SelectTrigger id="cf-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fieldTypes.map((t) => (
                <SelectItem key={t.type} value={t.type}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editing != null && (
            <p className="mt-1 text-xs text-muted-foreground">Changing the type is refused once values exist.</p>
          )}
        </div>
        <div>
          <Label htmlFor="cf-order">Display order</Label>
          <Input id="cf-order" type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
        </div>
        <div className="space-y-3 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={required} onCheckedChange={setRequired} />
            Required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={sensitive} onCheckedChange={setSensitive} />
            Sensitive
          </label>
        </div>
      </div>

      {required && (
        <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          Required applies to new data only. Existing records without a value are shown as “missing required custom data” — no value is ever
          invented for them.
        </p>
      )}

      {needsChoices && (
        <div className="space-y-2">
          <Label>Choices</Label>
          {choices.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={c.value}
                placeholder="value"
                onChange={(e) => setChoices((prev) => prev.map((p, pi) => (pi === i ? { ...p, value: e.target.value } : p)))}
              />
              <Input
                value={c.label}
                placeholder="Label"
                onChange={(e) => setChoices((prev) => prev.map((p, pi) => (pi === i ? { ...p, label: e.target.value } : p)))}
              />
              <Button variant="outline" size="sm" onClick={() => setChoices((prev) => prev.filter((_, pi) => pi !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setChoices((prev) => [...prev, { value: '', label: '' }])}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add choice
          </Button>
          {editing != null && (detailQuery.data?.usedChoiceValues?.length ?? 0) > 0 && (
            <p className="text-xs text-amber-700">
              In use and cannot be removed: {detailQuery.data!.usedChoiceValues.join(', ')}
            </p>
          )}
        </div>
      )}

      {needsDomain && (
        <div>
          <Label htmlFor="cf-domain">Master data domain</Label>
          <Input id="cf-domain" value={masterDataDomain} onChange={(e) => setMasterDataDomain(e.target.value)} placeholder="document_category" />
        </div>
      )}

      <div className="space-y-2 rounded-md border p-3">
        <Label>Show this field only when…</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          <Select value={conditionFieldKey || '__none__'} onValueChange={(v) => setConditionFieldKey(v === '__none__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Always shown" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Always shown</SelectItem>
              {fields
                .filter((f) => f.definition.fieldKey !== fieldKey)
                .map((f) => (
                  <SelectItem key={f.definition.id} value={f.definition.fieldKey}>
                    {f.version.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={conditionOperator} onValueChange={setConditionOperator}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(metaQuery.data?.visibilityOperators ?? []).map((op) => (
                <SelectItem key={op} value={op}>
                  {op.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={conditionValue}
            onChange={(e) => setConditionValue(e.target.value)}
            placeholder="value"
            disabled={!conditionFieldKey || conditionOperator === 'is_empty' || conditionOperator === 'is_not_empty'}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Conditions are evaluated on the server, so a hidden field cannot be filled in by other means.
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-6" data-testid="page-custom-fields">
      <div>
        <h1 className="text-2xl font-semibold">Custom Fields</h1>
        <p className="text-muted-foreground">
          Add extra structured information to your records without custom software. Definitions are configuration; the values people enter are
          business data on each record.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
          <CardDescription>Choose which kind of record these fields belong to.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56">
              <Label htmlFor="cf-scope">Record type</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger id="cf-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopes.map((s) => (
                    <SelectItem key={s.scope} value={s.scope}>
                      {s.label}
                      {!s.bindable ? ' (definitions only)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <Button
              onClick={() => {
                resetDraft();
                setCreating(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New field
            </Button>
          </div>

          {!scopes.find((s) => s.scope === scope)?.bindable && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Fields can be defined for this record type now, but values cannot be attached until the corresponding module exists.
            </p>
          )}

          {fields.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.definition.id} data-testid={`row-field-${f.definition.fieldKey}`}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {f.version.label}
                        {f.version.required && <Badge variant="secondary">Required</Badge>}
                        {f.version.sensitivity === 'sensitive' && (
                          <Badge variant="secondary" className="gap-1">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Sensitive
                          </Badge>
                        )}
                        {f.version.visibility != null && (
                          <Badge variant="secondary" className="gap-1">
                            <Layers className="h-3 w-3" aria-hidden="true" />
                            Conditional
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{f.definition.fieldKey}</TableCell>
                    <TableCell>{fieldTypes.find((t) => t.type === f.version.fieldType)?.label ?? f.version.fieldType}</TableCell>
                    <TableCell>v{f.version.versionNumber}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{f.definition.status}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(f.definition.id)}>
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          archiveMutation.mutate(
                            { organizationId, definitionId: f.definition.id, data: { archived: f.definition.status === 'active' } },
                            {
                              onSuccess: () => {
                                void listQuery.refetch();
                                toast({ title: f.definition.status === 'active' ? 'Field archived' : 'Field restored' });
                              },
                              onError: (err) => toast({ title: 'Could not update', description: errorMessage(err, ''), variant: 'destructive' }),
                            },
                          )
                        }
                      >
                        {f.definition.status === 'active' ? (
                          <>
                            <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                            Archive
                          </>
                        ) : (
                          <>
                            <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden="true" />
                            Restore
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No custom fields for this record type yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New custom field</DialogTitle>
            <DialogDescription>This field will be added to every {scopes.find((s) => s.scope === scope)?.label ?? scope} record.</DialogDescription>
          </DialogHeader>
          {editorBody}
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={!fieldKey.trim() || !label.trim() || createMutation.isPending}>
              Create field
            </Button>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit custom field</DialogTitle>
            <DialogDescription>
              Saving creates a new version. Values already captured keep the version they were captured under, so their meaning does not change.
            </DialogDescription>
          </DialogHeader>
          {editorBody}

          {(detailQuery.data?.versions?.length ?? 0) > 1 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4" aria-hidden="true" />
                Version history
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailQuery.data!.versions.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>v{v.versionNumber}</TableCell>
                      <TableCell>{v.label}</TableCell>
                      <TableCell>{v.fieldType}</TableCell>
                      <TableCell>{new Date(v.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleNewVersion} disabled={!label.trim() || versionMutation.isPending}>
              Save new version
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
