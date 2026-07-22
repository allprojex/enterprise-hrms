import { useState } from 'react';
import { Building, Users, Calendar, CheckCircle, Clock, Ban } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useListOrganizations, getListOrganizationsQueryKey, useGetOrganization, getGetOrganizationQueryKey } from '@workspace/api-client-react';
import { motion } from 'framer-motion';
import type { Organization } from '@workspace/api-client-react';

export default function Organizations() {
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  
  const { data: organizations, isLoading } = useListOrganizations({
    query: { queryKey: getListOrganizationsQueryKey() }
  });

  const { data: selectedOrg, isLoading: orgLoading } = useGetOrganization(
    selectedOrgId!,
    { 
      query: { 
        enabled: selectedOrgId !== null,
        queryKey: selectedOrgId !== null ? getGetOrganizationQueryKey(selectedOrgId) : undefined
      } 
    }
  );

  const getStatusIcon = (status: Organization['status']) => {
    switch (status) {
      case 'active':
        return CheckCircle;
      case 'trial':
        return Clock;
      case 'suspended':
        return Ban;
      default:
        return Building;
    }
  };

  const getStatusColor = (status: Organization['status']) => {
    switch (status) {
      case 'active':
        return 'bg-chart-3/10 text-chart-3';
      case 'trial':
        return 'bg-accent/10 text-accent';
      case 'suspended':
        return 'bg-destructive/10 text-destructive';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Organizations</h1>
        <p className="text-muted-foreground">
          View and manage organizations you have access to
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Organizations List */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">All Organizations</h2>
          
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : !organizations || organizations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <Building className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No organizations found</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  You don't have access to any organizations yet.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {organizations.map((org, i) => {
                const StatusIcon = getStatusIcon(org.status);
                const statusColor = getStatusColor(org.status);
                const isSelected = selectedOrgId === org.id;
                
                return (
                  <motion.div
                    key={org.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Card 
                      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}
                      onClick={() => setSelectedOrgId(org.id)}
                      data-testid={`card-organization-${org.id}`}
                    >
                      <CardContent className="flex items-start gap-4 p-4">
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Building className="h-6 w-6 text-primary" />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 className="text-lg font-semibold text-foreground truncate">
                              {org.name}
                            </h3>
                            <Badge variant="secondary" className={`flex items-center gap-1 ${statusColor}`}>
                              <StatusIcon className="h-3 w-3" />
                              {org.status}
                            </Badge>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <span className="capitalize">{org.type.replace('_', ' ')}</span>
                            {org.employeeCount && (
                              <span className="flex items-center gap-1">
                                <Users className="h-3.5 w-3.5" />
                                {org.employeeCount} employees
                              </span>
                            )}
                            {org.industry && (
                              <span>{org.industry}</span>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Organization Details */}
        <div className="lg:col-span-1">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>
                {selectedOrgId ? 'View detailed information' : 'Select an organization to view details'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedOrgId ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                    <Building className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Click on an organization to see more details
                  </p>
                </div>
              ) : orgLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : selectedOrg ? (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Organization Name</h4>
                    <p className="text-base font-semibold text-foreground">{selectedOrg.name}</p>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Slug</h4>
                    <p className="text-base text-foreground font-mono text-sm">{selectedOrg.slug}</p>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Type</h4>
                    <p className="text-base text-foreground capitalize">{selectedOrg.type.replace('_', ' ')}</p>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Status</h4>
                    <Badge variant="secondary" className={`${getStatusColor(selectedOrg.status)} capitalize`}>
                      {selectedOrg.status}
                    </Badge>
                  </div>

                  {selectedOrg.industry && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Industry</h4>
                      <p className="text-base text-foreground">{selectedOrg.industry}</p>
                    </div>
                  )}

                  {selectedOrg.employeeCount && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Employee Count</h4>
                      <p className="text-base text-foreground flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {selectedOrg.employeeCount}
                      </p>
                    </div>
                  )}

                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Created</h4>
                    <p className="text-base text-foreground flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {formatDate(selectedOrg.createdAt)}
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
