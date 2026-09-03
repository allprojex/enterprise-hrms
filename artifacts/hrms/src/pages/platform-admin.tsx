/**
 * WS-4 (Installation Registry & Break-Glass Access Foundation) — minimal
 * platform-admin surface. Deliberately NOT the deferred fleet-management
 * Control Plane: no dashboards, no health/backup/update centres. Gated by
 * the platform bootstrap identity (me.role === 'super_admin' — see
 * lib/authorization.ts's isSuperAdmin on the backend, and organizations.tsx
 * for the same frontend gating precedent), never an organization role. A
 * standalone page/route rather than a tab inside admin.tsx, which is
 * entirely organization-scoped — this page is cross-organization and
 * platform-scoped, so it does not belong there.
 *
 * Elevated-state visibility here covers grant management itself (view
 * active grants, see remaining time, revoke) — an in-context "you are
 * viewing this organization's data under an active break-glass grant"
 * banner on the org data pages themselves is not built in this foundation
 * workstream (it would require plumbing elevation state into every
 * org-scoped page, which is out of WS-4's scope).
 */
import { useMemo, useState } from 'react';
import { ShieldAlert, Server, Plus, Link2, Unlink, Ban, Clock, RotateCcw, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FleetHealth } from '@/components/platform/fleet-health';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  useGetMe,
  useListInstallations,
  getListInstallationsQueryKey,
  useCreateInstallation,
  useListInstallationOrganizations,
  getListInstallationOrganizationsQueryKey,
  useLinkInstallationOrganization,
  useUnlinkInstallationOrganization,
  useListBreakGlassGrants,
  getListBreakGlassGrantsQueryKey,
  useCreateBreakGlassGrant,
  useRevokeBreakGlassGrant,
  useListOrganizations,
  useListScheduledJobs,
  getListScheduledJobsQueryKey,
  useCancelScheduledJob,
  useRetryScheduledJob,
} from '@workspace/api-client-react';
import type {
  CreateInstallationInputEnvironmentType,
  CreateInstallationInputHostingModel,
  Installation,
  BreakGlassGrant,
  ListScheduledJobsStatus,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

const ENVIRONMENT_TYPES: CreateInstallationInputEnvironmentType[] = ['development', 'staging', 'demo', 'production'];
const HOSTING_MODELS: CreateInstallationInputHostingModel[] = [
  'shared',
  'dedicated_owner_managed',
  'dedicated_customer_managed',
  'other',
];

function timeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
}

function grantIsLive(grant: BreakGlassGrant): boolean {
  return grant.status === 'active' && new Date(grant.expiresAt).getTime() > Date.now();
}

function InstallationsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: installations, isLoading, error } = useListInstallations();
  const { data: organizations } = useListOrganizations();
  const [createOpen, setCreateOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<Installation | null>(null);
  const [form, setForm] = useState({
    installationKey: '',
    name: '',
    environmentType: 'production' as CreateInstallationInputEnvironmentType,
    hostingModel: 'shared' as CreateInstallationInputHostingModel,
    hostingProvider: '',
    primaryDomain: '',
  });

  const createInstallation = useCreateInstallation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInstallationsQueryKey() });
        setCreateOpen(false);
        setForm({ installationKey: '', name: '', environmentType: 'production', hostingModel: 'shared', hostingProvider: '', primaryDomain: '' });
        toast({ title: 'Installation registered' });
      },
      onError: (err: unknown) => {
        toast({ title: 'Could not register installation', description: (err as { message?: string })?.message, variant: 'destructive' });
      },
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <QueryError />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" /> Installation Registry
          </CardTitle>
          <CardDescription>
            Durable identity for deployed HRMS installations. Not the fleet Control Plane — identity only.
          </CardDescription>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-installation">
              <Plus className="h-4 w-4 mr-1" /> New Installation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Register Installation</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-installation-name" />
              </div>
              <div>
                <Label>Installation Key (optional — generated if blank)</Label>
                <Input value={form.installationKey} onChange={(e) => setForm({ ...form, installationKey: e.target.value })} />
              </div>
              <div>
                <Label>Environment</Label>
                <Select value={form.environmentType} onValueChange={(v) => setForm({ ...form, environmentType: v as CreateInstallationInputEnvironmentType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hosting Model</Label>
                <Select value={form.hostingModel} onValueChange={(v) => setForm({ ...form, hostingModel: v as CreateInstallationInputHostingModel })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HOSTING_MODELS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hosting Provider (optional)</Label>
                <Input value={form.hostingProvider} onChange={(e) => setForm({ ...form, hostingProvider: e.target.value })} />
              </div>
              <div>
                <Label>Primary Domain (optional)</Label>
                <Input value={form.primaryDomain} onChange={(e) => setForm({ ...form, primaryDomain: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!form.name.trim() || createInstallation.isPending}
                onClick={() =>
                  createInstallation.mutate({
                    data: {
                      name: form.name.trim(),
                      installationKey: form.installationKey.trim() || undefined,
                      environmentType: form.environmentType,
                      hostingModel: form.hostingModel,
                      hostingProvider: form.hostingProvider.trim() || undefined,
                      primaryDomain: form.primaryDomain.trim() || undefined,
                    },
                  })
                }
                data-testid="button-submit-installation"
              >
                Register
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Hosting</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(installations ?? []).map((installation) => (
              <TableRow key={installation.id} data-testid={`row-installation-${installation.id}`}>
                <TableCell className="font-medium">{installation.name}</TableCell>
                <TableCell className="font-mono text-xs">{installation.installationKey}</TableCell>
                <TableCell>{installation.environmentType}</TableCell>
                <TableCell>{installation.hostingModel}</TableCell>
                <TableCell>
                  <Badge variant={installation.status === 'active' ? 'default' : 'secondary'}>{installation.status}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setLinkTarget(installation)} data-testid={`button-manage-links-${installation.id}`}>
                    <Link2 className="h-3.5 w-3.5 mr-1" /> Organizations
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(installations ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                  No installations registered yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {linkTarget && (
        <LinkOrganizationsDialog installation={linkTarget} organizations={organizations ?? []} onClose={() => setLinkTarget(null)} />
      )}
    </Card>
  );
}

function LinkOrganizationsDialog({
  installation,
  organizations,
  onClose,
}: {
  installation: Installation;
  organizations: { id: number; name: string; slug: string }[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const { data: links } = useListInstallationOrganizations(installation.id);

  const linkMutation = useLinkInstallationOrganization({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListInstallationOrganizationsQueryKey(installation.id) });
        setSelectedOrgId('');
      },
      onError: (err: unknown) => toast({ title: 'Could not link organization', description: (err as { message?: string })?.message, variant: 'destructive' }),
    },
  });
  const unlinkMutation = useUnlinkInstallationOrganization({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListInstallationOrganizationsQueryKey(installation.id) }),
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Organizations linked to {installation.name}</DialogTitle>
          <CardDescription>One installation may host one or many organizations.</CardDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={String(org.id)}>
                    {org.name} · {org.slug} · #{org.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!selectedOrgId || linkMutation.isPending}
              onClick={() => linkMutation.mutate({ id: installation.id, data: { organizationId: Number(selectedOrgId) } })}
              data-testid="button-link-organization"
            >
              Link
            </Button>
          </div>
          <div className="space-y-1">
            {(links ?? []).map((link) => {
              const org = organizations.find((o) => o.id === link.organizationId);
              return (
                <div key={link.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <span>
                    {org?.name ?? `Organization #${link.organizationId}`}
                    {org && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {org.slug} · #{org.id}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => unlinkMutation.mutate({ id: installation.id, organizationId: link.organizationId })}
                    data-testid={`button-unlink-${link.organizationId}`}
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {(links ?? []).length === 0 && <p className="text-sm text-muted-foreground">No organizations linked.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BreakGlassPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: grants, isLoading, error } = useListBreakGlassGrants();
  const { data: organizations } = useListOrganizations();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ targetOrganizationId: '', reason: '', scope: '', expiresInHours: '2' });

  const createGrant = useCreateBreakGlassGrant({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBreakGlassGrantsQueryKey() });
        setCreateOpen(false);
        setForm({ targetOrganizationId: '', reason: '', scope: '', expiresInHours: '2' });
        toast({ title: 'Break-glass grant activated' });
      },
      onError: (err: unknown) => toast({ title: 'Could not create grant', description: (err as { message?: string })?.message, variant: 'destructive' }),
    },
  });
  const revokeGrant = useRevokeBreakGlassGrant({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBreakGlassGrantsQueryKey() });
        toast({ title: 'Grant revoked' });
      },
    },
  });

  const scopeKeys = useMemo(() => form.scope.split(',').map((s) => s.trim()).filter(Boolean), [form.scope]);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <QueryError />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" /> Break-Glass Access
          </CardTitle>
          <CardDescription>
            Explicit, reason-bound, time-limited emergency access to one organization's data. Platform-owner status alone
            grants none of this — only an active grant, within its own scope and expiry, does.
          </CardDescription>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive" data-testid="button-new-grant">
              <Plus className="h-4 w-4 mr-1" /> New Grant
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Activate Break-Glass Grant</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Target Organization</Label>
                <Select value={form.targetOrganizationId} onValueChange={(v) => setForm({ ...form, targetOrganizationId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                  <SelectContent>
                    {/* Tenant identity hardening: never pick a tenant by display name alone — the
                        tenant code and internal id disambiguate similarly named organizations. */}
                    {(organizations ?? []).map((org) => (
                      <SelectItem key={org.id} value={String(org.id)}>
                        {org.name} · {org.slug} · #{org.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reason</Label>
                <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Support ticket reference / justification" data-testid="input-grant-reason" />
              </div>
              <div>
                <Label>Scope — comma-separated, read-only permission keys</Label>
                <Input value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="employee.read, payroll.banking.read" data-testid="input-grant-scope" />
              </div>
              <div>
                <Label>Expires in (hours)</Label>
                <Input type="number" min={1} value={form.expiresInHours} onChange={(e) => setForm({ ...form, expiresInHours: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={!form.targetOrganizationId || !form.reason.trim() || scopeKeys.length === 0 || createGrant.isPending}
                onClick={() =>
                  createGrant.mutate({
                    data: {
                      targetOrganizationId: Number(form.targetOrganizationId),
                      reason: form.reason.trim(),
                      scope: scopeKeys,
                      expiresAt: new Date(Date.now() + Number(form.expiresInHours) * 3_600_000).toISOString(),
                      confirm: true,
                    },
                  })
                }
                data-testid="button-submit-grant"
              >
                Activate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(grants ?? []).map((grant) => {
              const live = grantIsLive(grant);
              const org = (organizations ?? []).find((o) => o.id === grant.targetOrganizationId);
              return (
                <TableRow key={grant.id} data-testid={`row-grant-${grant.id}`}>
                  <TableCell className="font-medium">{org?.name ?? `Organization #${grant.targetOrganizationId}`}</TableCell>
                  <TableCell className="max-w-xs truncate" title={grant.reason}>{grant.reason}</TableCell>
                  <TableCell className="font-mono text-xs">{grant.scope.join(', ')}</TableCell>
                  <TableCell>
                    {live ? (
                      <Badge className="bg-destructive text-destructive-foreground" data-testid={`badge-active-${grant.id}`}>
                        ACTIVE — {timeRemaining(grant.expiresAt)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{grant.status === 'revoked' ? 'revoked' : 'expired'}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {live && (
                      <Button size="sm" variant="outline" onClick={() => revokeGrant.mutate({ id: grant.id })} data-testid={`button-revoke-${grant.id}`}>
                        <Ban className="h-3.5 w-3.5 mr-1" /> Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {(grants ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                  No break-glass grants have been created.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const JOB_STATUS_FILTERS: ('all' | ListScheduledJobsStatus)[] = ['all', 'scheduled', 'running', 'completed', 'failed', 'cancelled'];

function jobStatusBadgeVariant(status: ListScheduledJobsStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed') return 'destructive';
  if (status === 'running') return 'default';
  if (status === 'completed') return 'secondary';
  return 'outline';
}

/**
 * WS-6 (Scheduled Jobs / Notifications Foundation, §33-34) — the minimal
 * platform operational surface: list, filter by status, cancel a pending
 * job, retry a terminally failed one. Deliberately not a dashboard — no
 * charts, no health metrics, no auto-refresh. "Do not turn WS-6 into full
 * Control Plane."
 */
function ScheduledJobsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | ListScheduledJobsStatus>('all');

  const params = statusFilter === 'all' ? undefined : { status: statusFilter };
  const { data: jobs, isLoading, error } = useListScheduledJobs(params, {
    query: { queryKey: getListScheduledJobsQueryKey(params) },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListScheduledJobsQueryKey() });

  const cancelMutation = useCancelScheduledJob({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: 'Job cancelled' });
      },
      onError: (err: unknown) => toast({ title: 'Could not cancel job', description: (err as { message?: string })?.message, variant: 'destructive' }),
    },
  });
  const retryMutation = useRetryScheduledJob({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: 'Job re-queued for retry' });
      },
      onError: (err: unknown) => toast({ title: 'Could not retry job', description: (err as { message?: string })?.message, variant: 'destructive' }),
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <QueryError />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Scheduled Jobs
          </CardTitle>
          <CardDescription>
            The database-authoritative job scheduler (WS-6). Operational visibility only — no job type or payload can be
            created or executed from here; domain modules schedule their own work server-side.
          </CardDescription>
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | ListScheduledJobsStatus)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {JOB_STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All statuses' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Type</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Scheduled For</TableHead>
              <TableHead>Last Error</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(jobs ?? []).map((job) => (
              <TableRow key={job.id} data-testid={`row-job-${job.id}`}>
                <TableCell className="font-mono text-xs">{job.jobType}</TableCell>
                <TableCell>{job.organizationId ?? <span className="text-muted-foreground">platform</span>}</TableCell>
                <TableCell>
                  <Badge variant={jobStatusBadgeVariant(job.status)} data-testid={`badge-job-status-${job.id}`}>
                    {job.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {job.attemptCount}/{job.maxAttempts}
                </TableCell>
                <TableCell className="text-xs">{new Date(job.scheduledFor).toLocaleString()}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={job.lastErrorMessage ?? undefined}>
                  {job.lastErrorMessage ?? '—'}
                </TableCell>
                <TableCell>
                  {job.status === 'scheduled' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelMutation.mutate({ id: job.id })}
                      disabled={cancelMutation.isPending}
                      data-testid={`button-cancel-job-${job.id}`}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  )}
                  {job.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMutation.mutate({ id: job.id })}
                      disabled={retryMutation.isPending}
                      data-testid={`button-retry-job-${job.id}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(jobs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  No jobs match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function PlatformAdmin() {
  const { data: me, isLoading } = useGetMe();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (me?.role !== 'super_admin') {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Platform Administration is reserved to the platform super_admin identity.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Platform Administration</h1>
        <p className="text-muted-foreground">
          Installation registry and break-glass access foundation (WS-4). Not the fleet Control Plane.
        </p>
      </div>
      <FleetHealth />
      <InstallationsPanel />
      <BreakGlassPanel />
      <ScheduledJobsPanel />
    </div>
  );
}
