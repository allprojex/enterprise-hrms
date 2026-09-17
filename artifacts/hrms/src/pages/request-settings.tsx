import { useState } from 'react';
import { SlidersHorizontal, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useListDataChangeFields,
  getListDataChangeFieldsQueryKey,
  useSetDataChangeFieldPolicy,
  useListServiceRequestTypes,
  getListServiceRequestTypesQueryKey,
  useCreateServiceRequestType,
  useUpdateServiceRequestType,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
    (err instanceof Error ? err.message : fallback)
  );
}

/**
 * WS-13 — request configuration (§29.17 action 9).
 *
 * WHAT THIS PAGE CANNOT DO, and why that matters more than what it can.
 *
 * The field list is served from the product's own eligible-field registry
 * (§29.3). There is no way to add a field here, no free-text column name, and
 * no path by which an organization could bring `employmentStatus`, a payroll
 * record or an access right under WS-13. Configuration chooses only whether an
 * already-eligible field needs approval — the server re-validates that against
 * the registry, so even a hand-crafted request cannot introduce a target.
 *
 * The request-type editor is a small fixed set of behaviours, not a process
 * designer (§29.12): no branching, no scripting, no state machine.
 */
export default function RequestSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [tab, setTab] = useState('fields');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newApproval, setNewApproval] = useState(false);
  const [newDocument, setNewDocument] = useState(false);
  const [activeTarget, setActiveTarget] = useState<{ id: number; name: string; activate: boolean } | null>(null);

  const fields = useListDataChangeFields(organizationId, {
    query: { queryKey: getListDataChangeFieldsQueryKey(organizationId), enabled },
  });
  const types = useListServiceRequestTypes(organizationId, {
    query: { queryKey: getListServiceRequestTypesQueryKey(organizationId), enabled },
  });

  const refreshFields = () =>
    void queryClient.invalidateQueries({ queryKey: getListDataChangeFieldsQueryKey(organizationId) });
  const refreshTypes = () =>
    void queryClient.invalidateQueries({ queryKey: getListServiceRequestTypesQueryKey(organizationId) });

  const onError = (title: string) => (err: unknown) =>
    toast({ title, description: errorMessage(err, 'Please try again.'), variant: 'destructive' });

  const setPolicy = useSetDataChangeFieldPolicy({
    mutation: { onSuccess: () => { toast({ title: 'Policy updated' }); refreshFields(); }, onError: onError('Could not update policy') },
  });
  const createType = useCreateServiceRequestType({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Request type created' });
        setNewCode('');
        setNewName('');
        setNewApproval(false);
        setNewDocument(false);
        refreshTypes();
      },
      onError: onError('Could not create the request type'),
    },
  });
  const updateType = useUpdateServiceRequestType({
    mutation: { onSuccess: () => { toast({ title: 'Request type updated' }); refreshTypes(); }, onError: onError('Could not update') },
  });

  if (isForbidden(fields.error) && isForbidden(types.error)) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          You do not have access to request configuration in this organization.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-request-settings">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <SlidersHorizontal className="h-6 w-6" aria-hidden="true" />
          Request Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Choose which personal details need approval before they change, and which HR requests employees may raise.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="fields">Data change policy</TabsTrigger>
          <TabsTrigger value="types">Request types</TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="mt-4">
          <Card data-testid="card-field-policy">
            <CardHeader>
              <CardTitle>Fields that require approval</CardTitle>
              <CardDescription>
                This list is fixed by the platform. Employment, pay, leave, assets and access details are owned by their
                own modules and cannot be added here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fields.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : fields.error ? (
                <QueryError onRetry={() => void fields.refetch()} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Self-service</TableHead>
                      <TableHead>Sensitive</TableHead>
                      <TableHead>Requires approval</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(fields.data ?? []).map((f) => (
                      <TableRow key={f.fieldKey} data-testid={`row-field-policy-${f.fieldKey}`}>
                        <TableCell className="font-medium">{f.label}</TableCell>
                        <TableCell>{f.essEligible ? 'Yes' : 'HR only'}</TableCell>
                        <TableCell>{f.sensitive ? <Badge className="bg-amber-100 text-amber-900">Masked</Badge> : '—'}</TableCell>
                        <TableCell>
                          <Switch
                            checked={f.approvalRequired}
                            data-testid={`switch-approval-${f.fieldKey}`}
                            onCheckedChange={(checked) =>
                              setPolicy.mutate({
                                organizationId,
                                fieldKey: f.fieldKey,
                                data: { approvalRequired: checked === true },
                              })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="types" className="mt-4 space-y-4">
          <Card data-testid="card-create-request-type">
            <CardHeader>
              <CardTitle>Add a request type</CardTitle>
              <CardDescription>
                A fixed set of behaviours, not a process designer. A type that produces a document is fulfilled by
                attaching one generated in Documents &amp; Records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                data-testid="form-create-request-type"
                onSubmit={(e) => {
                  e.preventDefault();
                  createType.mutate({
                    organizationId,
                    data: {
                      code: newCode.trim(),
                      name: newName.trim(),
                      approvalRequired: newApproval,
                      fulfilmentKind: newDocument ? 'document' : 'acknowledgement',
                    },
                  });
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="type-code">Code</Label>
                    <Input
                      id="type-code"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      placeholder="employment-letter"
                      data-testid="input-type-code"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="type-name">Name</Label>
                    <Input
                      id="type-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Employment letter"
                      data-testid="input-type-name"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={newApproval} onCheckedChange={(c) => setNewApproval(c === true)} data-testid="switch-type-approval" />
                    Requires approval
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={newDocument} onCheckedChange={(c) => setNewDocument(c === true)} data-testid="switch-type-document" />
                    Produces a document
                  </label>
                </div>
                <Button
                  type="submit"
                  disabled={!newCode.trim() || !newName.trim() || createType.isPending}
                  data-testid="button-create-request-type"
                >
                  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                  {createType.isPending ? 'Creating…' : 'Add type'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card data-testid="card-request-types">
            <CardHeader>
              <CardTitle>Request catalogue</CardTitle>
            </CardHeader>
            <CardContent>
              {types.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : types.error ? (
                <QueryError onRetry={() => void types.refetch()} />
              ) : (types.data ?? []).length === 0 ? (
                <p className="text-muted-foreground py-6 text-center">No request types configured.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Fulfilment</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead>Visible to employees</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(types.data ?? []).map((t) => (
                      <TableRow key={t.id} data-testid={`row-request-type-${t.id}`}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-muted-foreground">{t.code}</TableCell>
                        <TableCell>{t.fulfilmentKind === 'document' ? 'Document' : 'Acknowledgement'}</TableCell>
                        <TableCell>{t.approvalRequired ? 'Required' : '—'}</TableCell>
                        <TableCell>
                          <Switch
                            checked={t.employeeVisible}
                            data-testid={`switch-type-visible-${t.id}`}
                            onCheckedChange={(checked) =>
                              updateType.mutate({
                                organizationId,
                                typeId: t.id,
                                data: { employeeVisible: checked === true },
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={t.active}
                            data-testid={`switch-type-active-${t.id}`}
                            onCheckedChange={(checked) => setActiveTarget({ id: t.id, name: t.name, activate: checked === true })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Deactivating is a lifecycle change applied immediately: the server then
          refuses new requests of this type from ESS and HR alike
          (serviceRequests.submitRequest). Requests already raised are untouched. */}
      <ConfirmActionDialog
        open={activeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setActiveTarget(null);
        }}
        title={activeTarget?.activate ? 'Reactivate request type?' : 'Deactivate request type?'}
        description={
          activeTarget?.activate ? (
            <p>“{activeTarget?.name}” will be available for new requests again.</p>
          ) : (
            <p>
              “{activeTarget?.name}” will no longer be available for new requests. Requests already raised are not affected, and the type can
              be reactivated later.
            </p>
          )
        }
        confirmLabel={activeTarget?.activate ? 'Reactivate Request Type' : 'Deactivate Request Type'}
        tone={activeTarget?.activate ? 'default' : 'destructive'}
        onConfirm={() =>
          activeTarget && updateType.mutateAsync({ organizationId, typeId: activeTarget.id, data: { active: activeTarget.activate } })
        }
        testId="dialog-toggle-request-type"
      />
    </div>
  );
}
