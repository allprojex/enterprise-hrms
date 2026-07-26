import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, UserPlus, Trash2, Star, History, Settings2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMembers,
  getListMembersQueryKey,
  useAddMember,
  useRevokeMember,
  useAssignMemberRole,
  useRevokeMemberRole,
  useListRoles,
  getListRolesQueryKey,
  useGetPrimaryHr,
  getGetPrimaryHrQueryKey,
  useSetPrimaryHr,
  useGetOrganizationSettings,
  getGetOrganizationSettingsQueryKey,
  useUpdateOrganizationSettings,
  useListAuditEvents,
  getListAuditEventsQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function MembersTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [roleToAssign, setRoleToAssign] = useState<Record<number, string>>({});

  const { data: members, isLoading, error, refetch } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: roles } = useListRoles({ query: { queryKey: getListRolesQueryKey() } });

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(organizationId) });

  const addMutation = useAddMember();
  const revokeMutation = useRevokeMember();
  const assignRoleMutation = useAssignMemberRole();
  const revokeRoleMutation = useRevokeMemberRole();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate(
      { organizationId, data: { email: email.trim() } },
      {
        onSuccess: () => {
          invalidateMembers();
          setEmail('');
          toast({ title: 'Member added' });
        },
        onError: (err) => {
          toast({
            title: 'Could not add member',
            description: errorMessage(err) ?? 'Check the email and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleAssignRole = (membershipId: number) => {
    const roleId = roleToAssign[membershipId];
    if (!roleId) return;
    assignRoleMutation.mutate(
      { organizationId, membershipId, data: { roleId: Number(roleId) } },
      {
        onSuccess: () => {
          invalidateMembers();
          toast({ title: 'Role assigned' });
        },
        onError: (err) => toast({ title: 'Could not assign role', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleRevokeRole = (membershipId: number, roleKey: string) => {
    const role = roles?.find((r) => r.key === roleKey);
    if (!role) return;
    revokeRoleMutation.mutate(
      { organizationId, membershipId, roleId: role.id },
      {
        onSuccess: () => invalidateMembers(),
        onError: (err) => toast({ title: 'Could not revoke role', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleRevokeMember = (membershipId: number) => {
    revokeMutation.mutate(
      { organizationId, membershipId },
      {
        onSuccess: () => {
          invalidateMembers();
          toast({ title: 'Membership revoked' });
        },
        onError: (err) => toast({ title: 'Could not revoke membership', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Member</CardTitle>
          <CardDescription>Add an existing user (by email) as a member of this organisation</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-2 max-w-md">
            <Label htmlFor="add-member-email" className="sr-only">
              Email
            </Label>
            <Input
              id="add-member-email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="input-add-member-email"
            />
            <Button type="submit" disabled={addMutation.isPending} data-testid="button-add-member">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading members">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load members" message="Could not fetch members." onRetry={() => refetch()} />
      ) : !members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <Card>
          <Table aria-label="Members">
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Assign role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.membershipId} data-testid={`row-member-${member.membershipId}`}>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {member.firstName} {member.lastName}
                      {member.isPrimaryHr && (
                        <Star className="inline h-3.5 w-3.5 ml-1.5 text-accent" aria-label="Primary HR" />
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{member.email}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {member.roles.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
                      {member.roles.map((roleKey) => (
                        <Badge key={roleKey} variant="outline" className="gap-1">
                          {roleKey.replace('_', ' ')}
                          <button
                            type="button"
                            onClick={() => handleRevokeRole(member.membershipId, roleKey)}
                            aria-label={`Remove ${roleKey} role`}
                            data-testid={`button-revoke-role-${member.membershipId}-${roleKey}`}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Select
                        value={roleToAssign[member.membershipId] ?? ''}
                        onValueChange={(v) => setRoleToAssign((prev) => ({ ...prev, [member.membershipId]: v }))}
                      >
                        <SelectTrigger className="w-40" data-testid={`select-role-${member.membershipId}`}>
                          <SelectValue placeholder="Choose role" />
                        </SelectTrigger>
                        <SelectContent>
                          {(roles ?? []).map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAssignRole(member.membershipId)}
                        disabled={!roleToAssign[member.membershipId] || assignRoleMutation.isPending}
                        data-testid={`button-assign-role-${member.membershipId}`}
                      >
                        Assign
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={member.status === 'revoked'}
                          data-testid={`button-revoke-member-${member.membershipId}`}
                        >
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke this membership?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {member.firstName} {member.lastName} will lose access to this organisation. This can be
                            reversed by adding them back later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRevokeMember(member.membershipId)}>
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function PrimaryHrAndSettingsTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: primaryHr, isLoading: hrLoading } = useGetPrimaryHr(organizationId, {
    query: { queryKey: getGetPrimaryHrQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: settings, isLoading: settingsLoading } = useGetOrganizationSettings(organizationId, {
    query: { queryKey: getGetOrganizationSettingsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const [newPrimaryHrId, setNewPrimaryHrId] = useState('');
  const [settingsJson, setSettingsJson] = useState('');
  const [settingsTouched, setSettingsTouched] = useState(false);

  if (settings && !settingsTouched) {
    const formatted = JSON.stringify(settings.settings, null, 2);
    if (formatted !== settingsJson) setSettingsJson(formatted);
  }

  const setPrimaryHrMutation = useSetPrimaryHr();
  const updateSettingsMutation = useUpdateOrganizationSettings();

  const currentPrimaryHrMember = members?.find((m) => primaryHr && m.membershipId === primaryHr.membershipId);

  const handleSetPrimaryHr = () => {
    if (!newPrimaryHrId) return;
    setPrimaryHrMutation.mutate(
      { organizationId, data: { membershipId: Number(newPrimaryHrId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPrimaryHrQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(organizationId) });
          setNewPrimaryHrId('');
          toast({ title: 'Primary HR updated' });
        },
        onError: (err) => toast({ title: 'Could not update Primary HR', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleSaveSettings = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(settingsJson);
    } catch {
      toast({ title: 'Invalid JSON', description: 'Settings must be valid JSON.', variant: 'destructive' });
      return;
    }
    updateSettingsMutation.mutate(
      { organizationId, data: { settings: parsed } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrganizationSettingsQueryKey(organizationId), updated);
          setSettingsTouched(false);
          toast({ title: 'Settings saved' });
        },
        onError: (err) => toast({ title: 'Could not save settings', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Primary HR</CardTitle>
          <CardDescription>The designated HR contact for this organisation — exactly one at a time</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hrLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : primaryHr ? (
            <p className="text-sm">
              Current: <span className="font-medium text-foreground">
                {currentPrimaryHrMember ? `${currentPrimaryHrMember.firstName} ${currentPrimaryHrMember.lastName}` : `Membership #${primaryHr.membershipId}`}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No Primary HR is currently assigned.</p>
          )}
          <div className="flex gap-2 max-w-md">
            <Select value={newPrimaryHrId} onValueChange={setNewPrimaryHrId}>
              <SelectTrigger data-testid="select-primary-hr">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {(members ?? [])
                  .filter((m) => m.status === 'active')
                  .map((m) => (
                    <SelectItem key={m.membershipId} value={String(m.membershipId)}>
                      {m.firstName} {m.lastName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleSetPrimaryHr}
              disabled={!newPrimaryHrId || setPrimaryHrMutation.isPending}
              data-testid="button-set-primary-hr"
            >
              {primaryHr ? 'Transfer' : 'Appoint'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organisation Settings</CardTitle>
          <CardDescription>Free-form settings, stored as JSON</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <>
              <Textarea
                value={settingsJson}
                onChange={(e) => {
                  setSettingsJson(e.target.value);
                  setSettingsTouched(true);
                }}
                rows={8}
                className="font-mono text-sm"
                data-testid="textarea-org-settings"
                aria-label="Organisation settings JSON"
              />
              <Button
                onClick={handleSaveSettings}
                disabled={updateSettingsMutation.isPending}
                data-testid="button-save-settings"
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                Save Settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditLogTab({ organizationId }: { organizationId: number }) {
  const [page, setPage] = useState(1);
  const { data: result, isLoading, error, refetch } = useListAuditEvents(
    organizationId,
    { page, pageSize: 20 },
    { query: { queryKey: getListAuditEventsQueryKey(organizationId, { page, pageSize: 20 }), enabled: organizationId > 0 } },
  );

  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / 20));

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading audit log">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load audit log" message="Could not fetch audit events." onRetry={() => refetch()} />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <History className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No audit events yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Sensitive actions in this organisation will appear here as they happen.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <Table aria-label="Audit log">
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((event) => (
                  <TableRow key={event.id} data-testid={`row-audit-${event.id}`}>
                    <TableCell className="font-mono text-sm">{event.eventType}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {event.targetType}
                      {event.targetId ? ` #${event.targetId}` : ''}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(event.occurredAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Admin() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations, isLoading: membershipsLoading } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: !!user },
  });

  const currentMembership = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isOrgAdmin = currentMembership?.roles.some((r) => r === 'org_admin' || r === 'super_admin') ?? false;
  const stillChecking = userLoading || membershipsLoading;

  // UX-level route guard only — every mutation/query this page makes is
  // independently permission-checked server-side (requireMembership +
  // requirePermission). This just avoids showing an admin console, with a
  // confusing wall of 403s, to a user whose roles wouldn't let them act on
  // any of it.
  useEffect(() => {
    if (!stillChecking && !isOrgAdmin) {
      setLocation('/unauthorized');
    }
  }, [stillChecking, isOrgAdmin, setLocation]);

  if (!stillChecking && !isOrgAdmin) {
    return null;
  }

  if (stillChecking) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
          Admin Console
        </h1>
        <p className="text-muted-foreground">
          Manage members, roles, Primary HR, organisation settings, and the audit log
        </p>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-members">Members</TabsTrigger>
          <TabsTrigger value="hr-settings" data-testid="tab-hr-settings">Primary HR &amp; Settings</TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="hr-settings">
          <PrimaryHrAndSettingsTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogTab organizationId={organizationId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
