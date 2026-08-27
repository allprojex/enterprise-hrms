import { useState } from 'react';
import { Plus, Trash2, ShieldCheck, Users, KeyRound, UserCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useListRecruitmentApprovalStages,
  getListRecruitmentApprovalStagesQueryKey,
  useCreateRecruitmentApprovalStage,
  useDeleteRecruitmentApprovalStage,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

const RESOLVERS = [
  {
    value: 'department_head',
    label: 'Department Head',
    icon: Users,
    hint: 'Resolves through the department head assigned to the role’s own department. Changing the head changes who approves next — it never rewrites past decisions.',
  },
  {
    value: 'permission_holder',
    label: 'Anyone holding a permission',
    icon: KeyRound,
    hint: 'Anyone in the organization who currently holds the named permission may decide this stage.',
  },
  {
    value: 'specific_membership',
    label: 'A named person',
    icon: UserCheck,
    hint: 'One specific member of this organization.',
  },
];

/**
 * WS-9 — Recruitment approval configuration.
 *
 * Two separate chains, because they answer different questions: a requisition
 * approval authorizes *recruiting for a role*, a hire authorization authorizes
 * *employing a specific candidate*. Neither has a hard-coded shape — an
 * organization configures as many or as few stages as it needs.
 */
export default function RecruitmentApprovalsConfig() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [purpose, setPurpose] = useState<'hire' | 'requisition'>('hire');
  const [name, setName] = useState('');
  const [resolverType, setResolverType] = useState('department_head');
  const [permissionKey, setPermissionKey] = useState('');
  const [membershipId, setMembershipId] = useState('');

  const query = useListRecruitmentApprovalStages(
    organizationId,
    { purpose },
    { query: { queryKey: getListRecruitmentApprovalStagesQueryKey(organizationId, { purpose }), enabled } },
  );
  const createMutation = useCreateRecruitmentApprovalStage();
  const deleteMutation = useDeleteRecruitmentApprovalStage();

  const stages = query.data?.stages ?? [];
  const nextOrder = stages.length > 0 ? Math.max(...stages.map((s) => s.stageOrder)) + 1 : 1;

  const handleAdd = () => {
    const resolverConfig =
      resolverType === 'permission_holder'
        ? { permissionKey: permissionKey.trim() }
        : resolverType === 'specific_membership'
          ? { membershipId: Number(membershipId) }
          : null;

    createMutation.mutate(
      {
        organizationId,
        data: {
          purpose,
          stageOrder: nextOrder,
          name: name.trim(),
          resolverType: resolverType as 'department_head' | 'permission_holder' | 'specific_membership',
          resolverConfig,
        },
      },
      {
        onSuccess: () => {
          void query.refetch();
          setName('');
          setPermissionKey('');
          setMembershipId('');
          toast({ title: 'Approval stage added' });
        },
        onError: (err) => toast({ title: 'Could not add stage', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );
  };

  if (isForbidden(query.error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to recruitment approval settings"
          message="Configuring who approves recruitment decisions requires the recruitment settings permissions."
        />
      </div>
    );
  }

  const selectedResolver = RESOLVERS.find((r) => r.value === resolverType);

  return (
    <div className="space-y-6 p-6" data-testid="page-recruitment-approvals-config">
      <div>
        <h1 className="text-2xl font-semibold">Recruitment Approvals</h1>
        <p className="text-muted-foreground">
          Decide who signs off on recruitment, in the order your organization actually works. Nothing here is mandatory — configure one stage,
          several, or none.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Which decision?</CardTitle>
          <CardDescription>
            These are deliberately separate. Approving a requisition authorizes recruiting for a role. Authorizing a hire approves employing one
            specific candidate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md">
            <Label htmlFor="purpose">Decision type</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as 'hire' | 'requisition')}>
              <SelectTrigger id="purpose">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hire">Authorization to hire a candidate</SelectItem>
                <SelectItem value="requisition">Requisition approval</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Approval stages
          </CardTitle>
          <CardDescription>Stages are decided in order. A rejection at any stage ends the decision.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stages.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Who decides</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages.map((s) => {
                  const resolver = RESOLVERS.find((r) => r.value === s.resolverType);
                  const config = s.resolverConfig as { permissionKey?: string; membershipId?: number } | null;
                  return (
                    <TableRow key={s.id} data-testid={`row-stage-${s.stageOrder}`}>
                      <TableCell>{s.stageOrder}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{resolver?.label ?? s.resolverType}</Badge>
                        {config?.permissionKey && <span className="ml-2 font-mono text-xs">{config.permissionKey}</span>}
                        {config?.membershipId && <span className="ml-2 text-xs text-muted-foreground">member #{config.membershipId}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={deleteMutation.isPending}
                          onClick={() =>
                            deleteMutation.mutate(
                              { organizationId, stageId: s.id },
                              {
                                onSuccess: () => {
                                  void query.refetch();
                                  toast({ title: 'Stage removed', description: 'Decisions already recorded are unaffected.' });
                                },
                                onError: (err) =>
                                  toast({ title: 'Could not remove', description: errorMessage(err, ''), variant: 'destructive' }),
                              },
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              No stages configured. {purpose === 'hire'
                ? 'Without any hire stages, conversion to employee does not require a separate hire authorization.'
                : 'Requisitions use the existing single-step approval.'}
            </p>
          )}

          <div className="space-y-3 rounded-md border p-4">
            <h3 className="font-medium">Add stage {nextOrder}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="stage-name">Stage name</Label>
                <Input id="stage-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Department Head" />
              </div>
              <div>
                <Label htmlFor="resolver">Who decides</Label>
                <Select value={resolverType} onValueChange={setResolverType}>
                  <SelectTrigger id="resolver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLVERS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedResolver && <p className="text-xs text-muted-foreground">{selectedResolver.hint}</p>}

            {resolverType === 'permission_holder' && (
              <div>
                <Label htmlFor="perm">Permission key</Label>
                <Input id="perm" value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)} placeholder="application.manage" />
              </div>
            )}
            {resolverType === 'specific_membership' && (
              <div>
                <Label htmlFor="member">Member ID</Label>
                <Input id="member" type="number" value={membershipId} onChange={(e) => setMembershipId(e.target.value)} />
              </div>
            )}

            <Button
              onClick={handleAdd}
              disabled={
                !name.trim() ||
                createMutation.isPending ||
                (resolverType === 'permission_holder' && !permissionKey.trim()) ||
                (resolverType === 'specific_membership' && !membershipId)
              }
            >
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Add stage
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Holding a role never makes someone an approver on its own. Authority is checked against this configuration each time a decision is
            made, and every decision records the basis on which it was allowed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
