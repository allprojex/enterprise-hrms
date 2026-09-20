import { useState } from 'react';
import { Plus, Trash2, Car, Users, KeyRound, UserCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { ConfirmActionDialog } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMembers,
  getListMembersQueryKey,
  useListVehicleRequestApprovalStages,
  getListVehicleRequestApprovalStagesQueryKey,
  useCreateVehicleRequestApprovalStage,
  useDeleteVehicleRequestApprovalStage,
  type VehicleRequestApprovalStage,
} from '@workspace/api-client-react';

/**
 * VR-02A — who approves a vehicle request, and in what order.
 *
 * Configuration only: no vehicle request exists yet, and nothing on this page
 * decides one. Administration of the vehicle domain, so it is reached with the
 * same `asset_management.manage` the register itself uses — holding a
 * `vehicle_request.*` key never opens this page, and the API re-checks that
 * server-side regardless of what is rendered here.
 *
 * An organization with NO stages configured cannot have requests submitted at
 * all (VR-02B refuses), which is why the empty state says so plainly rather
 * than looking like a harmless blank list.
 */
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
    hint: "Resolves through the head of the department the request was raised from — the department stored on the request itself, not wherever the requester works today. A currently-valid delegate counts; a vacant department resolves to nobody.",
  },
  {
    value: 'permission_holder',
    label: 'Anyone holding a permission',
    icon: KeyRound,
    hint: 'Anyone in the organization who currently holds the named permission may decide this stage — for a transport officer or fleet desk that is a role rather than a person.',
  },
  {
    value: 'specific_membership',
    label: 'One named person',
    icon: UserCheck,
    hint: 'Exactly one named member decides this stage.',
  },
] as const;

type ResolverValue = (typeof RESOLVERS)[number]['value'];

const emptyForm = { name: '', resolverType: 'department_head' as ResolverValue, permissionKey: '', membershipId: '' };

export default function VehicleRequestApprovalsConfig() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<VehicleRequestApprovalStage | null>(null);

  const {
    data: stages,
    isLoading,
    error,
    refetch,
  } = useListVehicleRequestApprovalStages(organizationId, {
    query: { queryKey: getListVehicleRequestApprovalStagesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  // A membership id is not something an administrator can know — it is never
  // displayed anywhere in the product — so the picker and the list both resolve
  // it against the canonical member list. This is the rule VR-01's register was
  // corrected to follow: no raw id is ever typed or displayed.
  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');
  const memberById = new Map((members ?? []).map((m) => [m.membershipId, m]));

  const createMutation = useCreateVehicleRequestApprovalStage();
  const deleteMutation = useDeleteVehicleRequestApprovalStage();

  /** What a configured stage actually names, in words. Null when the resolver takes no input. */
  const resolverDetail = (stage: VehicleRequestApprovalStage): string | null => {
    const config = (stage.resolverConfig ?? {}) as { permissionKey?: unknown; membershipId?: unknown };
    if (stage.resolverType === 'permission_holder') {
      return typeof config.permissionKey === 'string' ? config.permissionKey : null;
    }
    if (stage.resolverType === 'specific_membership') {
      if (typeof config.membershipId !== 'number') return null;
      const member = memberById.get(config.membershipId);
      // An unresolvable reference reads as unknown rather than leaking its id.
      return member ? `${member.firstName} ${member.lastName}` : 'Unknown member';
    }
    return null;
  };

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVehicleRequestApprovalStagesQueryKey(organizationId) });

  const resolverConfigFor = (f: typeof emptyForm): Record<string, unknown> => {
    if (f.resolverType === 'permission_holder') return { permissionKey: f.permissionKey.trim() };
    if (f.resolverType === 'specific_membership') return { membershipId: Number(f.membershipId) };
    return {};
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const nextOrder = (stages?.length ?? 0) + 1;
    createMutation.mutate(
      {
        organizationId,
        data: {
          stageOrder: nextOrder,
          name: form.name.trim(),
          resolverType: form.resolverType,
          resolverConfig: resolverConfigFor(form),
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setForm(emptyForm);
          toast({ title: 'Approval stage added' });
        },
        onError: (err) =>
          toast({
            title: 'Could not add the stage',
            description: errorMessage(err, 'Check the stage details and try again.'),
            variant: 'destructive',
          }),
      },
    );
  };

  // Returned so the confirmation stays open, with the error toast, when the
  // server refuses.
  const handleDelete = (stage: VehicleRequestApprovalStage) =>
    deleteMutation.mutateAsync(
      { organizationId, stageId: stage.id },
      {
        onSuccess: () => {
          invalidate();
          setDeleteTarget(null);
          toast({ title: 'Approval stage removed' });
        },
        onError: (err) =>
          toast({ title: 'Could not remove the stage', description: errorMessage(err, ''), variant: 'destructive' }),
      },
    );

  if (error && isForbidden(error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to vehicle approval settings"
          message="Configuring who approves a vehicle request needs asset management administration."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const canSubmit =
    form.name.trim().length > 0 &&
    (form.resolverType === 'department_head' ||
      (form.resolverType === 'permission_holder' && form.permissionKey.trim().length > 0) ||
      (form.resolverType === 'specific_membership' && Number(form.membershipId) > 0));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Car className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicle Request Approvals</h1>
          <p className="text-sm text-muted-foreground">
            The order in which a vehicle request is decided. Changing this affects future requests only — a request
            already raised keeps the chain it was raised under.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval chain</CardTitle>
          <CardDescription>Stages are decided strictly in order, lowest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (stages?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-stages">
              No approval stages configured. Until at least one stage exists, employees cannot submit vehicle requests —
              a request with nobody to decide it would simply never be actionable.
            </p>
          ) : (
            <Table aria-label="Vehicle request approval stages">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Order</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Decided by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stages!.map((stage) => {
                  const resolver = RESOLVERS.find((r) => r.value === stage.resolverType);
                  const Icon = resolver?.icon ?? Users;
                  return (
                    <TableRow key={stage.id} data-testid={`row-stage-${stage.id}`}>
                      <TableCell>
                        <Badge variant="outline">{stage.stageOrder}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{stage.name}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2 text-sm">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          {resolver?.label ?? stage.resolverType}
                        </span>
                        {resolverDetail(stage) !== null && (
                          <span
                            className="mt-0.5 block text-xs text-muted-foreground"
                            data-testid={`text-stage-detail-${stage.id}`}
                          >
                            {resolverDetail(stage)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeleteTarget(stage)}
                          aria-label={`Remove ${stage.name}`}
                          data-testid={`button-delete-stage-${stage.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a stage</CardTitle>
          <CardDescription>New stages are appended to the end of the chain.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stage-name">Stage name</Label>
              <Input
                id="stage-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Transport Officer"
                maxLength={120}
                data-testid="input-stage-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stage-resolver">Decided by</Label>
              <Select
                value={form.resolverType}
                onValueChange={(value) => setForm({ ...form, resolverType: value as ResolverValue })}
              >
                <SelectTrigger id="stage-resolver" data-testid="select-stage-resolver">
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
              <p className="text-xs text-muted-foreground">{RESOLVERS.find((r) => r.value === form.resolverType)?.hint}</p>
            </div>

            {form.resolverType === 'permission_holder' && (
              <div className="space-y-2">
                <Label htmlFor="stage-permission-key">Permission key</Label>
                <Input
                  id="stage-permission-key"
                  value={form.permissionKey}
                  onChange={(e) => setForm({ ...form, permissionKey: e.target.value })}
                  placeholder="vehicle_request.approve"
                  data-testid="input-stage-permission-key"
                />
              </div>
            )}

            {form.resolverType === 'specific_membership' && (
              <div className="space-y-2">
                <Label htmlFor="stage-membership-id">Member</Label>
                <Select
                  value={form.membershipId}
                  onValueChange={(value) => setForm({ ...form, membershipId: value })}
                >
                  <SelectTrigger id="stage-membership-id" data-testid="select-stage-membership">
                    <SelectValue placeholder="Choose a member" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMembers.map((m) => (
                      <SelectItem key={m.membershipId} value={String(m.membershipId)}>
                        {m.firstName} {m.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button type="submit" disabled={!canSubmit || createMutation.isPending} data-testid="button-add-stage">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {createMutation.isPending ? 'Saving…' : 'Add stage'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this approval stage?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will no longer be part of the chain for new requests. Requests already raised keep the chain they were raised under.`
            : ''
        }
        confirmLabel="Remove stage"
        onConfirm={() => (deleteTarget ? handleDelete(deleteTarget) : Promise.resolve())}
      />
    </div>
  );
}
