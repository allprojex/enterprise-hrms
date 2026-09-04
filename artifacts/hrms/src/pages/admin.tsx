import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, UserPlus, Trash2, Star, History, Settings2, Mail, Copy, FileBarChart, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMembers,
  getListMembersQueryKey,
  useAddMember,
  useCreateInvitation,
  useRevokeMember,
  useAssignMemberRole,
  useRevokeMemberRole,
  useGetPrimaryHr,
  getGetPrimaryHrQueryKey,
  useSetPrimaryHr,
  useGetOrganizationConfig,
  getGetOrganizationConfigQueryKey,
  useUpdateOrganizationConfig,
  useListAuditEvents,
  getListAuditEventsQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListOrganizationModules,
  getListOrganizationModulesQueryKey,
  useUpdateOrganizationModule,
  useListMasterDataDomains,
  getListMasterDataDomainsQueryKey,
  useListMasterDataItems,
  getListMasterDataItemsQueryKey,
  useCreateMasterDataItem,
  useListOrganizationRoles,
  getListOrganizationRolesQueryKey,
  useCopyRoleTemplate,
  useGrantRolePermission,
  useRevokeRolePermission,
  useListPermissions,
  getListPermissionsQueryKey,
  useListReports,
  getListReportsQueryKey,
  useRunReport,
  getRunReportQueryKey,
  getRunReportUrl,
} from '@workspace/api-client-react';
import type { AuditEvent, ListAuditEventsCategory } from '@workspace/api-client-react';
import { getStoredToken } from '@/lib/auth';
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);

  const { data: members, isLoading, error, refetch } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 },
  });
  // Server-authoritative role list: `delegable` is the backend's own verdict
  // on whether THIS caller may assign the role here (org_admin path vs the
  // Primary HR's HR-team path). Non-delegable roles are simply not offered.
  const { data: organizationRoles } = useListOrganizationRoles(organizationId, {
    query: { queryKey: getListOrganizationRolesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const roles = organizationRoles?.filter((r) => r.delegable !== false);

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(organizationId) });

  const addMutation = useAddMember();
  const inviteMutation = useCreateInvitation();
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

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    inviteMutation.mutate(
      {
        organizationId,
        data: { email: inviteEmail.trim(), roleId: inviteRoleId ? Number(inviteRoleId) : undefined },
      },
      {
        onSuccess: (result) => {
          invalidateMembers();
          setInviteEmail('');
          setInviteRoleId('');
          setInviteLink({ email: inviteEmail.trim(), url: `${window.location.origin}/invite/${result.inviteToken}` });
          toast({ title: 'Invitation created', description: 'Share the link below with the invitee -- no email is sent automatically.' });
        },
        onError: (err) => {
          toast({
            title: 'Could not create invitation',
            description: errorMessage(err) ?? 'Check the email and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleCopyInviteLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink.url);
    toast({ title: 'Link copied' });
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite New User</CardTitle>
          <CardDescription>
            Invite someone who doesn't have an account yet. No email is sent -- you'll get a link to share with them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleInvite} className="flex flex-wrap gap-2 max-w-lg">
            <Label htmlFor="invite-email" className="sr-only">
              Email
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="flex-1 min-w-48"
              data-testid="input-invite-email"
            />
            <Select value={inviteRoleId} onValueChange={setInviteRoleId}>
              <SelectTrigger className="w-40" data-testid="select-invite-role">
                <SelectValue placeholder="Role (optional)" />
              </SelectTrigger>
              <SelectContent>
                {(roles ?? []).map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={inviteMutation.isPending} data-testid="button-invite-member">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Invite
            </Button>
          </form>

          {inviteLink && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2" data-testid="card-invite-link">
              <p className="text-sm text-muted-foreground">
                Invitation link for <span className="font-medium text-foreground">{inviteLink.email}</span> -- share it
                with them directly:
              </p>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink.url} className="text-xs" data-testid="input-invite-link" />
                <Button type="button" variant="outline" size="sm" onClick={handleCopyInviteLink} data-testid="button-copy-invite-link">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
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

function NamespaceConfigCard({
  organizationId,
  namespace,
  title,
  description,
}: {
  organizationId: number;
  namespace: 'general' | 'terminology' | 'branding';
  title: string;
  description: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: config, isLoading } = useGetOrganizationConfig(organizationId, namespace, {
    query: { queryKey: getGetOrganizationConfigQueryKey(organizationId, namespace), enabled: organizationId > 0 },
  });
  const updateMutation = useUpdateOrganizationConfig();

  const [json, setJson] = useState('');
  const [touched, setTouched] = useState(false);

  if (config && !touched) {
    const formatted = JSON.stringify(config.data, null, 2);
    if (formatted !== json) setJson(formatted);
  }

  const handleSave = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json);
    } catch {
      toast({ title: 'Invalid JSON', description: `${title} must be valid JSON.`, variant: 'destructive' });
      return;
    }
    updateMutation.mutate(
      { organizationId, namespace, data: { data: parsed } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrganizationConfigQueryKey(organizationId, namespace), updated);
          setTouched(false);
          toast({ title: `${title} saved` });
        },
        onError: (err) =>
          toast({ title: `Could not save ${title.toLowerCase()}`, description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <Textarea
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                setTouched(true);
              }}
              rows={8}
              className="font-mono text-sm"
              data-testid={`textarea-config-${namespace}`}
              aria-label={`${title} JSON`}
            />
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid={`button-save-config-${namespace}`}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              Save {title}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
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

  const [newPrimaryHrId, setNewPrimaryHrId] = useState('');

  const setPrimaryHrMutation = useSetPrimaryHr();

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

      <NamespaceConfigCard
        organizationId={organizationId}
        namespace="general"
        title="General Settings"
        description="Organization-wide configuration, validated and stored as JSON"
      />
      <NamespaceConfigCard
        organizationId={organizationId}
        namespace="branding"
        title="Branding"
        description={
          'Product name and colour theme shown on the login page and app shell. Fields: systemDisplayName ' +
          '(string) and theme (optional HSL-triple overrides for sidebar/primary/accent/ring — e.g. "220 55% 16%"). ' +
          'Leave empty to use the shared platform defaults.'
        }
      />
      <NamespaceConfigCard
        organizationId={organizationId}
        namespace="terminology"
        title="Terminology"
        description="Override the labels used for employees, branches, departments and positions"
      />
    </div>
  );
}

function ModulesTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: modules, isLoading, error, refetch } = useListOrganizationModules(organizationId, {
    query: { queryKey: getListOrganizationModulesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const updateMutation = useUpdateOrganizationModule();

  const handleToggle = (moduleKey: string, enabled: boolean) => {
    updateMutation.mutate(
      { organizationId, moduleKey, data: { enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrganizationModulesQueryKey(organizationId) });
          toast({ title: enabled ? 'Module enabled' : 'Module disabled' });
        },
        onError: (err) =>
          toast({
            title: `Could not ${enabled ? 'enable' : 'disable'} module`,
            description: errorMessage(err),
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modules</CardTitle>
          <CardDescription>
            Enable only the HR-operations modules this organisation needs. Modules still marked "hidden" have no
            shipped functionality yet and cannot be enabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading modules">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <QueryError title="Failed to load modules" message="Could not fetch modules." onRetry={() => refetch()} />
          ) : (
            <Table aria-label="Modules">
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(modules ?? []).map((module) => {
                  const enableable = module.status === 'active' || module.status === 'beta';
                  return (
                    <TableRow key={module.key} data-testid={`row-module-${module.key}`}>
                      <TableCell>
                        <div className="font-medium text-foreground">{module.name}</div>
                        <div className="text-sm text-muted-foreground">{module.description}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {module.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={module.enabled}
                          disabled={!enableable || updateMutation.isPending}
                          onCheckedChange={(checked) => handleToggle(module.key, checked)}
                          aria-label={`Toggle ${module.name}`}
                          data-testid={`switch-module-${module.key}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MasterDataTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [domain, setDomain] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');

  const { data: domains } = useListMasterDataDomains({ query: { queryKey: getListMasterDataDomainsQueryKey() } });
  const selectedDomain = domains?.find((d) => d.key === domain);
  const writable = selectedDomain && selectedDomain.classification !== 'system-defined';

  const { data: items, isLoading, error, refetch } = useListMasterDataItems(organizationId, domain, {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, domain), enabled: organizationId > 0 && !!domain },
  });
  const createMutation = useCreateMasterDataItem();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain) return;
    createMutation.mutate(
      { organizationId, domain, data: { code: code.trim(), label: label.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMasterDataItemsQueryKey(organizationId, domain) });
          setCode('');
          setLabel('');
          toast({ title: 'Item added' });
        },
        onError: (err) => toast({ title: 'Could not add item', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Master Data</CardTitle>
          <CardDescription>Reference data used across the platform — pick a domain to view or extend it</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={domain} onValueChange={setDomain}>
            <SelectTrigger className="max-w-xs" data-testid="select-master-data-domain">
              <SelectValue placeholder="Choose a domain" />
            </SelectTrigger>
            <SelectContent>
              {(domains ?? []).map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {domain && writable && (
            <form onSubmit={handleCreate} className="flex gap-2 max-w-md">
              <Input
                placeholder="Code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                data-testid="input-master-data-code"
              />
              <Input
                placeholder="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                data-testid="input-master-data-label"
              />
              <Button type="submit" disabled={createMutation.isPending} data-testid="button-add-master-data-item">
                Add
              </Button>
            </form>
          )}

          {!domain ? null : isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading items">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <QueryError title="Failed to load items" message="Could not fetch master data items." onRetry={() => refetch()} />
          ) : (
            <Table aria-label="Master data items">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items ?? []).map((item) => (
                  <TableRow key={item.id} data-testid={`row-master-data-item-${item.id}`}>
                    <TableCell className="font-mono text-sm">{item.code}</TableCell>
                    <TableCell>{item.label}</TableCell>
                    <TableCell>
                      <Badge variant={item.organizationId === null ? 'secondary' : 'outline'}>
                        {item.organizationId === null ? 'System' : 'Custom'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RolesTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: roles, isLoading, error, refetch } = useListOrganizationRoles(organizationId, {
    query: { queryKey: getListOrganizationRolesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: permissions } = useListPermissions({ query: { queryKey: getListPermissionsQueryKey() } });

  const [copyingRoleId, setCopyingRoleId] = useState<number | null>(null);
  const [copyKey, setCopyKey] = useState('');
  const [copyLabel, setCopyLabel] = useState('');
  const [permissionToAdd, setPermissionToAdd] = useState<Record<number, string>>({});

  const copyMutation = useCopyRoleTemplate();
  const grantMutation = useGrantRolePermission();
  const revokeMutation = useRevokeRolePermission();

  const invalidateRoles = () => queryClient.invalidateQueries({ queryKey: getListOrganizationRolesQueryKey(organizationId) });

  const handleCopy = (templateRoleId: number) => {
    copyMutation.mutate(
      { organizationId, data: { templateRoleId, key: copyKey.trim(), label: copyLabel.trim() } },
      {
        onSuccess: () => {
          invalidateRoles();
          setCopyingRoleId(null);
          setCopyKey('');
          setCopyLabel('');
          toast({ title: 'Role copied — customize its permissions below' });
        },
        onError: (err) => toast({ title: 'Could not copy role', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleGrant = (roleId: number) => {
    const permissionId = permissionToAdd[roleId];
    if (!permissionId) return;
    grantMutation.mutate(
      { organizationId, roleId, data: { permissionId: Number(permissionId) } },
      {
        onSuccess: () => {
          invalidateRoles();
          setPermissionToAdd((prev) => ({ ...prev, [roleId]: '' }));
        },
        onError: (err) => toast({ title: 'Could not grant permission', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleRevoke = (roleId: number, permissionId: number) => {
    revokeMutation.mutate(
      { organizationId, roleId, permissionId },
      {
        onSuccess: () => invalidateRoles(),
        onError: (err) => toast({ title: 'Could not revoke permission', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
          <CardDescription>
            System role templates are protected — copy one to create your own customizable role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading roles">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <QueryError title="Failed to load roles" message="Could not fetch roles." onRetry={() => refetch()} />
          ) : (
            <Table aria-label="Roles">
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles ?? []).map((role) => (
                  <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                    <TableCell>
                      <div className="font-medium text-foreground">{role.label}</div>
                      <div className="text-sm text-muted-foreground font-mono">{role.key}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={role.isSystemRole ? 'secondary' : 'outline'}>
                        {role.isSystemRole ? 'System' : 'Custom'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {role.permissionKeys.length === 0 && <span className="text-sm text-muted-foreground">None</span>}
                        {role.permissionKeys.map((key) => {
                          const permission = (permissions ?? []).find((p) => p.key === key);
                          return (
                            <Badge key={key} variant="outline" className="gap-1">
                              {key}
                              {!role.isSystemRole && permission && (
                                <button
                                  type="button"
                                  onClick={() => handleRevoke(role.id, permission.id)}
                                  aria-label={`Remove ${key} permission`}
                                  data-testid={`button-revoke-permission-${role.id}-${key}`}
                                >
                                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                                </button>
                              )}
                            </Badge>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      {role.isSystemRole ? (
                        role.delegable === false ? (
                          <span className="text-xs text-muted-foreground" data-testid={`role-not-delegable-${role.id}`}>
                            Not delegable
                          </span>
                        ) : copyingRoleId === role.id ? (
                          <div className="flex gap-2">
                            <Input
                              placeholder="Key"
                              value={copyKey}
                              onChange={(e) => setCopyKey(e.target.value)}
                              className="w-32"
                              data-testid={`input-copy-key-${role.id}`}
                            />
                            <Input
                              placeholder="Label"
                              value={copyLabel}
                              onChange={(e) => setCopyLabel(e.target.value)}
                              className="w-40"
                              data-testid={`input-copy-label-${role.id}`}
                            />
                            <Button
                              size="sm"
                              onClick={() => handleCopy(role.id)}
                              disabled={copyMutation.isPending}
                              data-testid={`button-confirm-copy-${role.id}`}
                            >
                              Save
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCopyingRoleId(role.id)}
                            data-testid={`button-copy-role-${role.id}`}
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            Copy to customize
                          </Button>
                        )
                      ) : (
                        <div className="flex gap-2">
                          <Select
                            value={permissionToAdd[role.id] ?? ''}
                            onValueChange={(v) => setPermissionToAdd((prev) => ({ ...prev, [role.id]: v }))}
                          >
                            <SelectTrigger className="w-44" data-testid={`select-permission-${role.id}`}>
                              <SelectValue placeholder="Add permission" />
                            </SelectTrigger>
                            <SelectContent>
                              {(permissions ?? []).map((p) => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.key}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGrant(role.id)}
                            disabled={!permissionToAdd[role.id] || grantMutation.isPending}
                            data-testid={`button-grant-permission-${role.id}`}
                          >
                            Grant
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// WS-3 (Owner Decision #17) — display labels for the audit_category
// taxonomy (lib/auditCategories.ts on the backend). Purely cosmetic; the
// actual set a given caller may choose from always comes from the server's
// own allowedCategories, never a fixed client-side assumption.
const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  hr: 'HR',
  payroll: 'Payroll',
  security: 'Security & Access',
  documents: 'Documents & Records',
  assets_inventory: 'Assets & Inventory',
  platform_configuration: 'Platform Configuration',
};

function AuditLogTab({ organizationId }: { organizationId: number }) {
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [actorApplicationUserId, setActorApplicationUserId] = useState('');
  // WS-3 (Owner Decision #17): '' means "every category I'm allowed to
  // see" (server-resolved — never assume "all" client-side). An explicit
  // value narrows to just that one category.
  const [category, setCategory] = useState('');
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null);

  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const filters = {
    page,
    pageSize: 20,
    eventType: eventType || undefined,
    targetType: targetType || undefined,
    targetId: targetId || undefined,
    actorApplicationUserId: actorApplicationUserId ? Number(actorApplicationUserId) : undefined,
    category: (category || undefined) as ListAuditEventsCategory | undefined,
  };

  const { data: result, isLoading, error, refetch } = useListAuditEvents(organizationId, filters, {
    query: { queryKey: getListAuditEventsQueryKey(organizationId, filters), enabled: organizationId > 0 },
  });

  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / 20));
  const hasFilters = !!(eventType || targetType || targetId || actorApplicationUserId || category);

  // The server tells us which categories this caller may even see
  // (allowedCategories) — the dropdown only ever offers a choice the
  // backend would actually honor, never a category picked from a fixed
  // client-side list that might 403.
  const selectableCategories =
    result?.allowedCategories === 'all'
      ? ['hr', 'payroll', 'security', 'documents', 'assets_inventory', 'platform_configuration']
      : (result?.allowedCategories ?? []);

  const resetFilters = () => {
    setEventType('');
    setTargetType('');
    setTargetId('');
    setActorApplicationUserId('');
    setCategory('');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="audit-filter-event-type">Event type</Label>
            <Input
              id="audit-filter-event-type"
              placeholder="e.g. employee.separated"
              value={eventType}
              onChange={(e) => { setEventType(e.target.value); setPage(1); }}
              className="w-56"
              data-testid="input-audit-filter-event-type"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-filter-target-type">Target type</Label>
            <Input
              id="audit-filter-target-type"
              placeholder="e.g. employee"
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
              className="w-40"
              data-testid="input-audit-filter-target-type"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-filter-target-id">Target ID</Label>
            <Input
              id="audit-filter-target-id"
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); setPage(1); }}
              className="w-28"
              data-testid="input-audit-filter-target-id"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-filter-actor">Actor</Label>
            <Select
              value={actorApplicationUserId}
              onValueChange={(v) => { setActorApplicationUserId(v); setPage(1); }}
            >
              <SelectTrigger id="audit-filter-actor" className="w-56" data-testid="select-audit-filter-actor">
                <SelectValue placeholder="Anyone" />
              </SelectTrigger>
              <SelectContent>
                {(members ?? []).map((m) => (
                  <SelectItem key={m.applicationUserId} value={String(m.applicationUserId)}>
                    {m.firstName} {m.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-filter-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => { setCategory(v === '__all__' ? '' : v); setPage(1); }}
            >
              <SelectTrigger id="audit-filter-category" className="w-56" data-testid="select-audit-filter-category">
                <SelectValue placeholder="Every category I can see" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Every category I can see</SelectItem>
                {selectableCategories.map((c) => (
                  <SelectItem key={c} value={c} data-testid={`option-audit-category-${c}`}>
                    {AUDIT_CATEGORY_LABELS[c] ?? c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="button-audit-filter-reset">
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

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
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {hasFilters ? 'No matching audit events' : 'No audit events yet'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {hasFilters
                ? 'Try adjusting or clearing the filters above.'
                : 'Sensitive actions in this organisation will appear here as they happen.'}
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
                  <TableHead />
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
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailEvent(event)}
                        data-testid={`button-audit-detail-${event.id}`}
                      >
                        Details
                      </Button>
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

      <Dialog open={!!detailEvent} onOpenChange={(open) => !open && setDetailEvent(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailEvent?.eventType}</DialogTitle>
          </DialogHeader>
          {detailEvent && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                <span>Target</span>
                <span className="text-foreground">
                  {detailEvent.targetType}
                  {detailEvent.targetId ? ` #${detailEvent.targetId}` : ''}
                </span>
                <span>When</span>
                <span className="text-foreground">{new Date(detailEvent.occurredAt).toLocaleString()}</span>
                {detailEvent.ipAddress && (
                  <>
                    <span>IP address</span>
                    <span className="text-foreground">{detailEvent.ipAddress}</span>
                  </>
                )}
              </div>
              {detailEvent.beforeState != null && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Before</p>
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-40">
                    {JSON.stringify(detailEvent.beforeState, null, 2)}
                  </pre>
                </div>
              )}
              {detailEvent.afterState != null && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">After</p>
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-40">
                    {JSON.stringify(detailEvent.afterState, null, 2)}
                  </pre>
                </div>
              )}
              {detailEvent.metadata != null && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Metadata</p>
                  <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-40">
                    {JSON.stringify(detailEvent.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportsTab({ organizationId }: { organizationId: number }) {
  const { toast } = useToast();
  const [reportKey, setReportKey] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  // WS-15 P3 (§31.30) — only the parameters the SELECTED report actually
  // supports are rendered. Attendance takes a date range; Payroll reports are
  // per locked run and genuinely require one. Every other report takes none,
  // and no generic JSON box is offered.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [runId, setRunId] = useState('');

  const { data: reports, isLoading: reportsLoading } = useListReports({
    query: { queryKey: getListReportsQueryKey() },
  });

  const [prevReports, setPrevReports] = useState(reports);
  if (reports && reports !== prevReports) {
    setPrevReports(reports);
    if (!reportKey && reports.length > 0) setReportKey(reports[0].key);
  }

  const selected = (reports ?? []).find((r) => r.key === reportKey);
  const category = selected?.category ?? '';
  const needsDateRange = category === 'attendance';
  const needsRunId = category === 'payroll';

  const reportParams = {
    ...(needsDateRange && from ? { from } : {}),
    ...(needsDateRange && to ? { to } : {}),
    ...(needsRunId && runId ? { runId: Number(runId) } : {}),
  };

  const { data: result, isLoading: resultLoading, error, refetch } = useRunReport(
    organizationId,
    reportKey,
    reportParams,
    {
      query: {
        queryKey: getRunReportQueryKey(organizationId, reportKey, reportParams),
        // A Payroll report cannot run without its run id, so it is not
        // requested until one is supplied — a 400 is correct from the API but
        // pointless to trigger on every keystroke.
        enabled: organizationId > 0 && !!reportKey && (!needsRunId || !!runId),
      },
    },
  );

  const handleDownloadCsv = async () => {
    setIsDownloading(true);
    try {
      const token = getStoredToken();
      // The export carries exactly the parameters the on-screen result used —
      // never a broader query (§31.30).
      const res = await fetch(getRunReportUrl(organizationId, reportKey, { ...reportParams, format: 'csv' }), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportKey}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Could not download report', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="report-select">Report</Label>
            <Select value={reportKey} onValueChange={setReportKey}>
              <SelectTrigger id="report-select" className="w-64" data-testid="select-report">
                <SelectValue placeholder="Choose a report" />
              </SelectTrigger>
              <SelectContent>
                {(reports ?? []).map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsDateRange && (
            <>
              <div className="space-y-1">
                <Label htmlFor="report-from">From</Label>
                <Input
                  id="report-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-40"
                  data-testid="input-report-from"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="report-to">To</Label>
                <Input
                  id="report-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-40"
                  data-testid="input-report-to"
                />
              </div>
            </>
          )}
          {needsRunId && (
            <div className="space-y-1">
              <Label htmlFor="report-run-id">Payroll run</Label>
              <Input
                id="report-run-id"
                type="number"
                min={1}
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                className="w-40"
                placeholder="Run ID"
                data-testid="input-report-run-id"
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadCsv}
            disabled={!reportKey || isDownloading}
            data-testid="button-download-report-csv"
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Download CSV
          </Button>
        </CardContent>
      </Card>

      {reportsLoading || resultLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading report">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to run report" message="Could not compute this report." onRetry={() => refetch()} />
      ) : !result || typeof result === 'string' ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileBarChart className="h-5 w-5 text-primary" aria-hidden="true" />
              {result.label}
            </CardTitle>
            <CardDescription>
              {result.description} · Generated {new Date(result.generatedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No data yet.</p>
            ) : (
              <Table aria-label={result.label}>
                <TableHeader>
                  <TableRow>
                    {result.columns.map((col) => (
                      <TableHead key={col.key}>{col.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i} data-testid={`row-report-${i}`}>
                      {result.columns.map((col) => (
                        <TableCell key={col.key}>{String(row[col.key] ?? '')}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
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
  // Primary HR Administrator delegation (server: requireDelegationAuthority):
  // the ACTIVE Primary HR holding hr_administrator may manage the HR team —
  // Members and Roles only, limited to delegable roles. Both signals come
  // from the same membership summary the org_admin gate reads.
  const canManageHrTeam =
    currentMembership?.isPrimaryHr === true && currentMembership.roles.includes('hr_administrator');
  const hrTeamMode = !isOrgAdmin && canManageHrTeam;
  const canOpen = isOrgAdmin || canManageHrTeam;
  const stillChecking = userLoading || membershipsLoading;

  // UX-level route guard only — every mutation/query this page makes is
  // independently permission-checked server-side (requireMembership +
  // requirePermission). This just avoids showing an admin console, with a
  // confusing wall of 403s, to a user whose roles wouldn't let them act on
  // any of it.
  useEffect(() => {
    if (!stillChecking && !canOpen) {
      setLocation('/unauthorized');
    }
  }, [stillChecking, canOpen, setLocation]);

  if (!stillChecking && !canOpen) {
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
          {hrTeamMode ? 'HR Team Management' : 'Admin Console'}
        </h1>
        <p className="text-muted-foreground">
          {hrTeamMode
            ? 'Invite HR team members and assign the HR roles you are entitled to delegate'
            : 'Manage members, roles, Primary HR, organisation settings, and the audit log'}
        </p>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members" data-testid="tab-members">Members</TabsTrigger>
          {!hrTeamMode && (
            <>
              <TabsTrigger value="hr-settings" data-testid="tab-hr-settings">Primary HR &amp; Settings</TabsTrigger>
              <TabsTrigger value="modules" data-testid="tab-modules">Modules</TabsTrigger>
            </>
          )}
          <TabsTrigger value="roles" data-testid="tab-roles">Roles</TabsTrigger>
          {!hrTeamMode && (
            <>
              <TabsTrigger value="master-data" data-testid="tab-master-data">Master Data</TabsTrigger>
              <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
              <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="members">
          <MembersTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab organizationId={organizationId} />
        </TabsContent>
        {!hrTeamMode && (
          <>
            <TabsContent value="hr-settings">
              <PrimaryHrAndSettingsTab organizationId={organizationId} />
            </TabsContent>
            <TabsContent value="modules">
              <ModulesTab organizationId={organizationId} />
            </TabsContent>
            <TabsContent value="master-data">
              <MasterDataTab organizationId={organizationId} />
            </TabsContent>
            <TabsContent value="audit">
              <AuditLogTab organizationId={organizationId} />
            </TabsContent>
            <TabsContent value="reports">
              <ReportsTab organizationId={organizationId} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
