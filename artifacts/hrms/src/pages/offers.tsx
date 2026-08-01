import { useState } from 'react';
import { Link } from 'wouter';
import { FileSignature } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { useGetMe, getGetMeQueryKey, useListOffers, getListOffersQueryKey } from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  pending_approval: 'secondary',
  approved: 'secondary',
  issued: 'secondary',
  accepted: 'secondary',
  declined: 'destructive',
  expired: 'destructive',
  withdrawn: 'destructive',
  superseded: 'outline',
};

export default function Offers() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params = { page, pageSize };

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListOffers(organizationId, params, {
    query: { queryKey: getListOffersQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <FileSignature className="h-7 w-7 text-primary" aria-hidden="true" />
          Offers
        </h1>
        <p className="text-muted-foreground">Offers visible to you — organization-wide staff and assigned recruiters/hiring managers</p>
      </div>

      {error ? (
        <QueryError title="Could not load offers" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <FileSignature className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No offers found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Create an offer from an application's detail page to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Vacancy</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((item) => (
                  <TableRow key={item.offer.id} data-testid={`row-offer-${item.offer.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/offers/${item.offer.id}`} className="hover:underline" data-testid={`link-offer-${item.offer.id}`}>
                        Application #{item.applicationId}
                      </Link>
                    </TableCell>
                    <TableCell>{item.vacancyTitle}</TableCell>
                    <TableCell>{item.currentVersion?.versionNumber ?? '—'}</TableCell>
                    <TableCell>
                      {item.currentVersion ? (
                        <Badge variant={STATUS_VARIANT[item.currentVersion.status] ?? 'outline'} className="capitalize">
                          {item.currentVersion.status.replace(/_/g, ' ')}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {result.total > pageSize && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">Page {page} of {Math.ceil(result.total / pageSize)}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-prev-page">Previous</Button>
                  <Button size="sm" variant="outline" disabled={page * pageSize >= result.total} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
