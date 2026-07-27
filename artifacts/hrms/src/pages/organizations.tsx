import { useState } from 'react';
import { Building, Users, Calendar, CheckCircle, Clock, Ban, Plus } from 'lucide-react';
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
} from '@workspace/api-client-react';
import type { CreateOrganizationInputType } from '@workspace/api-client-react';
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
              <CardTitle>Organisation Details</CardTitle>
              <CardDescription>
                {selectedOrgId
                  ? 'Detailed information for the selected organisation'
                  : 'Select an organisation to view details'}
              </CardDescription>
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
                    <dt className="text-sm font-medium text-muted-foreground mb-1">Slug</dt>
                    <dd className="text-base text-foreground font-mono text-sm">{selectedOrg.slug}</dd>
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
                </dl>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
