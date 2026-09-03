import { useState } from 'react';
import { Link } from 'wouter';
import { Building, Users, Calendar, CheckCircle, Clock, Ban, Plus, Pencil, Globe, Copy, Star, PowerOff, Power, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  useListOrganizations,
  getListOrganizationsQueryKey,
  useGetOrganization,
  getGetOrganizationQueryKey,
  useCreateOrganization,
  useUpdateOrganization,
  useSuspendOrganization,
  useReactivateOrganization,
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListOrganizationDomains,
  getListOrganizationDomainsQueryKey,
  useCreateOrganizationDomain,
  useActivateOrganizationDomain,
  useDisableOrganizationDomain,
  useSetPrimaryOrganizationDomain,
  useGetTenantIdentity,
  getGetTenantIdentityQueryKey,
} from '@workspace/api-client-react';
import { Textarea } from '@/components/ui/textarea';
import type {
  CreateOrganizationInputType,
  CreateOrganizationDomainInputDomainType,
  OrganizationDomain,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import type { Organization } from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

const ORG_TYPES: CreateOrganizationInputType[] = [
  'business',
  'church',
  'ngo',
  'school',
  'hospital',
  'hotel',
  'government',
  'other',
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Multi-Organization Tenant Infrastructure — platform-admin domain
// management. Reserved to super_admin server-side (requireSuperAdmin); the
// parent already gates rendering the same way (canManageSelectedOrg /
// me.role check), this component assumes it is only ever mounted for a
// caller who can actually call these routes.
function DomainsPanel({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [hostname, setHostname] = useState('');
  const [domainType, setDomainType] = useState<CreateOrganizationDomainInputDomainType>('platform_subdomain');

  const domainsQueryKey = getListOrganizationDomainsQueryKey(organizationId);
  const { data: domains, isLoading, error } = useListOrganizationDomains(organizationId, {
    query: { queryKey: domainsQueryKey },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: domainsQueryKey });

  const createMutation = useCreateOrganizationDomain();
  const activateMutation = useActivateOrganizationDomain();
  const disableMutation = useDisableOrganizationDomain();
  const setPrimaryMutation = useSetPrimaryOrganizationDomain();

  function errorMessage(err: unknown): string | undefined {
    return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostname.trim()) return;
    createMutation.mutate(
      { organizationId, data: { hostname: hostname.trim(), domainType } },
      {
        onSuccess: () => {
          setHostname('');
          invalidate();
          toast({ title: 'Domain added' });
        },
        onError: (err) =>
          toast({ title: 'Could not add domain', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copied to clipboard' });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4 mt-4">
      <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Globe className="h-4 w-4" aria-hidden="true" />
        Domains
      </h4>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive">Could not load domains.</p>
      ) : !domains || domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No testing hostname or custom domain assigned yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Organisation domains">
          {domains.map((domain: OrganizationDomain) => (
            <li
              key={domain.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
              data-testid={`row-domain-${domain.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono truncate">{domain.hostname}</span>
                  {domain.isPrimary && <Star className="h-3 w-3 text-accent flex-shrink-0" aria-label="Primary domain" />}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{domain.domainType.replace('_', ' ')}</span>
                  <span aria-hidden="true">·</span>
                  <span className="capitalize">{domain.status}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => handleCopy(domain.hostname)}
                  aria-label={`Copy ${domain.hostname}`}
                  data-testid={`button-copy-domain-${domain.id}`}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                {domain.status === 'active' ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={disableMutation.isPending}
                    onClick={() => disableMutation.mutate({ organizationId, id: domain.id }, { onSuccess: invalidate })}
                    aria-label={`Disable ${domain.hostname}`}
                    data-testid={`button-disable-domain-${domain.id}`}
                  >
                    <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={activateMutation.isPending}
                    onClick={() => activateMutation.mutate({ organizationId, id: domain.id }, { onSuccess: invalidate })}
                    aria-label={`Activate ${domain.hostname}`}
                    data-testid={`button-activate-domain-${domain.id}`}
                  >
                    <Power className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
                {domain.status === 'active' && !domain.isPrimary && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={setPrimaryMutation.isPending}
                    onClick={() => setPrimaryMutation.mutate({ organizationId, id: domain.id }, { onSuccess: invalidate })}
                    aria-label={`Mark ${domain.hostname} primary`}
                    data-testid={`button-set-primary-domain-${domain.id}`}
                  >
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="flex items-end gap-2" aria-label="Add domain">
        <div className="flex-1 space-y-1">
          <Label htmlFor="domain-hostname" className="text-xs">
            Hostname
          </Label>
          <Input
            id="domain-hostname"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="wwm.localhost"
            className="h-8 text-sm"
            data-testid="input-domain-hostname"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="domain-type" className="text-xs">
            Type
          </Label>
          <Select value={domainType} onValueChange={(v) => setDomainType(v as CreateOrganizationDomainInputDomainType)}>
            <SelectTrigger id="domain-type" className="h-8 w-40 text-sm" data-testid="select-domain-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="platform_subdomain">Testing hostname</SelectItem>
              <SelectItem value="custom_domain">Custom domain</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={createMutation.isPending || !hostname.trim()}
          data-testid="button-add-domain"
        >
          Add
        </Button>
      </form>
    </div>
  );
}

export default function Organizations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<CreateOrganizationInputType>('business');

  const createMutation = useCreateOrganization();
  const updateMutation = useUpdateOrganization();
  const suspendMutation = useSuspendOrganization();
  const reactivateMutation = useReactivateOrganization();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: myOrganizations } = useListMyOrganizations({
    query: { queryKey: getListMyOrganizationsQueryKey(), enabled: !!me },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIndustry, setEditIndustry] = useState('');

  // Tenant identity hardening (Phase 7): suspend/reactivate is a dangerous
  // tenant-specific action, so it goes through a confirmation that shows the
  // full tenant identity and requires the tenant code to be typed. The
  // backend independently requires the same confirmSlug.
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(
      { data: { name: name.trim(), slug: slug.trim(), type } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
          setOpen(false);
          setName('');
          setSlug('');
          setSlugTouched(false);
          setType('business');
          toast({ title: 'Organisation created' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not create organisation',
            description: message ?? 'Please check the details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const {
    data: organizations,
    isLoading,
    error: orgsError,
    refetch: refetchOrgs,
  } = useListOrganizations({
    query: { queryKey: getListOrganizationsQueryKey() },
  });

  const {
    data: selectedOrg,
    isLoading: orgLoading,
  } = useGetOrganization(
    // Always pass a number — `enabled` guards actual execution when null.
    selectedOrgId ?? 0,
    {
      query: {
        enabled: selectedOrgId !== null,
        queryKey: getGetOrganizationQueryKey(selectedOrgId ?? 0),
      },
    },
  );

  // me.role is the legacy platform-wide role column -- it never reflects an
  // org_admin granted through the membership_roles system (the mechanism
  // every organization's own admin, including WWM's, actually uses). The
  // real authority signal is the caller's own membership for the selected
  // organization, same source app-shell's isOrgAdmin already reads from.
  const selectedOrgMembership = myOrganizations?.find((m) => m.organizationId === selectedOrg?.id);
  const canManageSelectedOrg =
    !!me &&
    !!selectedOrg &&
    (me.role === 'super_admin' ||
      (selectedOrgMembership?.roles.some((r) => r === 'org_admin' || r === 'super_admin') ?? false));

  const openEditDialog = () => {
    if (!selectedOrg) return;
    setEditName(selectedOrg.name);
    setEditIndustry(selectedOrg.industry ?? '');
    setEditOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg) return;
    updateMutation.mutate(
      { id: selectedOrg.id, data: { name: editName.trim(), industry: editIndustry.trim() || null } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrganizationQueryKey(selectedOrg.id), updated);
          queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
          setEditOpen(false);
          toast({ title: 'Organisation updated' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update organisation', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const openStatusDialog = () => {
    if (!selectedOrg) return;
    setConfirmSlug('');
    setStatusReason('');
    setStatusDialogOpen(true);
  };

  const handleConfirmStatusChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg) return;
    const mutation = selectedOrg.status === 'suspended' ? reactivateMutation : suspendMutation;
    mutation.mutate(
      { id: selectedOrg.id, data: { confirmSlug: confirmSlug.trim(), reason: statusReason.trim() || undefined } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetOrganizationQueryKey(selectedOrg.id), updated);
          queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTenantIdentityQueryKey(selectedOrg.id) });
          setStatusDialogOpen(false);
          toast({ title: selectedOrg.status === 'suspended' ? 'Organisation reactivated' : 'Organisation suspended' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update organisation status', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const getStatusIcon = (status: Organization['status']) => {
    switch (status) {
      case 'active':    return CheckCircle;
      case 'trial':     return Clock;
      case 'suspended': return Ban;
      default:          return Building;
    }
  };

  const getStatusColor = (status: Organization['status']) => {
    switch (status) {
      case 'active':    return 'bg-chart-3/10 text-chart-3';
      case 'trial':     return 'bg-accent/10 text-accent';
      case 'suspended': return 'bg-destructive/10 text-destructive';
      default:          return 'bg-muted text-muted-foreground';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Organisations</h1>
          <p className="text-muted-foreground">
            View and manage organisations you have access to
          </p>
        </div>
        <div className="flex items-center gap-2">
          {me?.role === 'super_admin' && (
            // WS-4 (Installation Registry & Break-Glass Access Foundation):
            // platform-scoped, cross-organization surface — never an
            // organization role, same gate as DomainsPanel below.
            <Link href="/platform-admin">
              <Button variant="outline" data-testid="button-platform-admin">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Platform Administration
              </Button>
            </Link>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-organization">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New Organisation
              </Button>
            </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Create Organisation</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Name</Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!slugTouched) setSlug(slugify(e.target.value));
                    }}
                    required
                    data-testid="input-org-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-slug">Slug</Label>
                  <Input
                    id="org-slug"
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugTouched(true);
                    }}
                    required
                    data-testid="input-org-slug"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-type">Type</Label>
                  <Select value={type} onValueChange={(v) => setType(v as CreateOrganizationInputType)}>
                    <SelectTrigger id="org-type" data-testid="select-org-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="capitalize">
                          {t.replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-org">
                  {createMutation.isPending ? 'Creating…' : 'Create Organisation'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Organisations List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">All Organisations</h2>

          {isLoading ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading organisations">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : orgsError ? (
            <QueryError
              title="Failed to load organisations"
              message="Could not fetch organisation data. Check your connection and try again."
              onRetry={() => refetchOrgs()}
            />
          ) : !organizations || organizations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <Building className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No organisations found</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  You don't have access to any organisations yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3" aria-label="Organisation list">
              {organizations.map((org, i) => {
                const StatusIcon = getStatusIcon(org.status);
                const statusColor = getStatusColor(org.status);
                const isSelected = selectedOrgId === org.id;

                return (
                  <li key={org.id}>
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <Card
                        className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}
                        onClick={() => setSelectedOrgId(org.id)}
                        data-testid={`card-organization-${org.id}`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`Select ${org.name}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedOrgId(org.id);
                          }
                        }}
                      >
                        <CardContent className="flex items-start gap-4 p-4">
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Building className="h-6 w-6 text-primary" aria-hidden="true" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h3 className="text-lg font-semibold text-foreground truncate">
                                {org.name}
                              </h3>
                              <Badge variant="secondary" className={`flex items-center gap-1 ${statusColor}`}>
                                <StatusIcon className="h-3 w-3" aria-hidden="true" />
                                <span className="capitalize">{org.status}</span>
                              </Badge>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                              <span className="capitalize">{org.type.replace('_', ' ')}</span>
                              {org.employeeCount != null && (
                                <span className="flex items-center gap-1">
                                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                                  {org.employeeCount} employees
                                </span>
                              )}
                              {org.industry && <span>{org.industry}</span>}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Organisation Details */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>Organisation Details</CardTitle>
                  <CardDescription>
                    {selectedOrgId
                      ? 'Detailed information for the selected organisation'
                      : 'Select an organisation to view details'}
                  </CardDescription>
                </div>
                {canManageSelectedOrg && (
                  <Button size="sm" variant="outline" onClick={openEditDialog} data-testid="button-edit-organization">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedOrgId ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                    <Building className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Click on an organisation to see more details
                  </p>
                </div>
              ) : orgLoading ? (
                <div className="space-y-4" aria-busy="true" aria-label="Loading organisation details">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : selectedOrg ? (
                <dl className="space-y-4">
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Organisation Name</dt>
                    <dd className="text-base font-semibold text-foreground">{selectedOrg.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Tenant code (slug)</dt>
                    <dd className="text-base text-foreground font-mono text-sm" data-testid="text-org-slug">{selectedOrg.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Tenant ID (immutable)</dt>
                    <dd className="text-foreground font-mono text-xs break-all" data-testid="text-org-tenant-uuid">
                      {selectedOrg.tenantUuid}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Internal ID</dt>
                    <dd className="text-foreground font-mono text-sm" data-testid="text-org-internal-id">#{selectedOrg.id}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Type</dt>
                    <dd className="text-base text-foreground capitalize">{selectedOrg.type.replace('_', ' ')}</dd>
                  </div>
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Status</dt>
                    <dd>
                      <Badge
                        variant="secondary"
                        className={`${getStatusColor(selectedOrg.status)} capitalize`}
                      >
                        {selectedOrg.status}
                      </Badge>
                    </dd>
                  </div>
                  {selectedOrg.industry && (
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground mb-1">Industry</dt>
                      <dd className="text-base text-foreground">{selectedOrg.industry}</dd>
                    </div>
                  )}
                  {selectedOrg.employeeCount != null && (
                    <div>
                      <dt className="text-sm font-medium text-muted-foreground mb-1">Employee Count</dt>
                      <dd className="text-base text-foreground flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        {selectedOrg.employeeCount}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Created</dt>
                    <dd className="text-base text-foreground flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {formatDate(selectedOrg.createdAt)}
                    </dd>
                  </div>
                  {canManageSelectedOrg && (
                    <Button
                      variant={selectedOrg.status === 'suspended' ? 'default' : 'destructive'}
                      className="w-full"
                      disabled={suspendMutation.isPending || reactivateMutation.isPending}
                      onClick={openStatusDialog}
                      data-testid="button-toggle-organization-status"
                    >
                      {selectedOrg.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </Button>
                  )}
                </dl>
              ) : null}
              {selectedOrg && me?.role === 'super_admin' && <TenantIdentityPanel organizationId={selectedOrg.id} />}
              {selectedOrg && me?.role === 'super_admin' && <DomainsPanel organizationId={selectedOrg.id} />}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Organisation</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-org-name">Name</Label>
                <Input
                  id="edit-org-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  data-testid="input-edit-org-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-org-industry">Industry</Label>
                <Input
                  id="edit-org-industry"
                  value={editIndustry}
                  onChange={(e) => setEditIndustry(e.target.value)}
                  data-testid="input-edit-org-industry"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-org">
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <form onSubmit={handleConfirmStatusChange}>
            <DialogHeader>
              <DialogTitle>
                {selectedOrg?.status === 'suspended' ? 'Reactivate organisation' : 'Suspend organisation'}
              </DialogTitle>
              <DialogDescription>
                This action affects exactly one tenant. Confirm the target before continuing.
              </DialogDescription>
            </DialogHeader>
            {selectedOrg && (
              <div className="space-y-4 py-4">
                <dl className="rounded-md border p-3 text-sm space-y-1" data-testid="status-dialog-target">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Organisation</dt>
                    <dd className="font-semibold">{selectedOrg.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Tenant code</dt>
                    <dd className="font-mono">{selectedOrg.slug}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Tenant ID</dt>
                    <dd className="font-mono text-xs break-all">{selectedOrg.tenantUuid}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Current status</dt>
                    <dd className="capitalize">{selectedOrg.status}</dd>
                  </div>
                </dl>
                <div className="space-y-2">
                  <Label htmlFor="confirm-org-slug">
                    Type the tenant code <span className="font-mono">{selectedOrg.slug}</span> to confirm
                  </Label>
                  <Input
                    id="confirm-org-slug"
                    value={confirmSlug}
                    onChange={(e) => setConfirmSlug(e.target.value)}
                    autoComplete="off"
                    required
                    data-testid="input-confirm-org-slug"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status-change-reason">Reason (recorded in the audit trail)</Label>
                  <Textarea
                    id="status-change-reason"
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    placeholder="Support ticket reference / justification"
                    data-testid="input-status-change-reason"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                type="submit"
                variant={selectedOrg?.status === 'suspended' ? 'default' : 'destructive'}
                disabled={
                  !selectedOrg ||
                  confirmSlug.trim() !== selectedOrg.slug ||
                  suspendMutation.isPending ||
                  reactivateMutation.isPending
                }
                data-testid="button-confirm-organization-status"
              >
                {selectedOrg?.status === 'suspended' ? 'Reactivate' : 'Suspend'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Tenant identity hardening (Phase 7): the operational identity card a
 * platform super_admin sees before acting on a tenant — immutable tenant ID,
 * tenant code, hosting/deployment target with its environment and version,
 * the release identity of the API that served this page, module state and
 * feature flags. Read-only. Sourced from GET /platform/organizations/:id/identity,
 * which contains no HR data.
 */
function TenantIdentityPanel({ organizationId }: { organizationId: number }) {
  const { data, isLoading, error } = useGetTenantIdentity(organizationId, {
    query: { queryKey: getGetTenantIdentityQueryKey(organizationId) },
  });

  if (isLoading) {
    return <Skeleton className="mt-6 h-24 w-full" aria-label="Loading tenant identity" />;
  }
  if (error || !data) {
    return (
      <p className="mt-6 text-sm text-muted-foreground" data-testid="text-tenant-identity-unavailable">
        Tenant identity is unavailable.
      </p>
    );
  }

  const enabledModules = data.modules.filter((m) => m.enabled).map((m) => m.key);
  const enabledFlags = data.featureFlags.filter((f) => f.enabled).map((f) => f.key);

  return (
    <div className="mt-6 space-y-3" data-testid="panel-tenant-identity">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        Operational identity
      </h3>
      <dl className="text-sm space-y-2">
        <div>
          <dt className="text-muted-foreground">Hosting / deployment target</dt>
          <dd data-testid="text-tenant-installations">
            {data.installations.length === 0 ? (
              <span className="text-muted-foreground">Not linked to any installation</span>
            ) : (
              <ul className="space-y-1">
                {data.installations.map((installation) => (
                  <li key={installation.id} className="font-mono text-xs">
                    {installation.installationKey} · {installation.environmentType} · {installation.hostingModel} · v
                    {installation.applicationVersion ?? 'unknown'}
                    {installation.migrationVersion ? ` · migration ${installation.migrationVersion}` : ''} ·{' '}
                    {installation.status}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Serving API</dt>
          <dd className="font-mono text-xs" data-testid="text-tenant-runtime">
            {data.runtime.environment} · {data.runtime.appVersion}
            {data.runtime.installationKey ? ` · ${data.runtime.installationKey}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Enabled modules ({enabledModules.length})</dt>
          <dd className="font-mono text-xs break-words" data-testid="text-tenant-modules">
            {enabledModules.length ? enabledModules.join(', ') : 'none'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Feature flags / extensions ({data.featureFlags.length} registered)</dt>
          <dd className="font-mono text-xs break-words" data-testid="text-tenant-feature-flags">
            {enabledFlags.length ? `enabled: ${enabledFlags.join(', ')}` : 'none enabled'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
