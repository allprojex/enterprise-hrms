import { useState } from 'react';
import { Link } from 'wouter';
import { Users, LayoutGrid } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListApplications,
  getListApplicationsQueryKey,
  type ListApplicationsParams,
} from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

const STAGE_CATEGORIES = ['applied', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
const NONE = '__all__';

const CATEGORY_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  applied: 'outline',
  screening: 'secondary',
  interview: 'secondary',
  assessment: 'secondary',
  offer: 'secondary',
  hired: 'secondary',
  rejected: 'destructive',
  withdrawn: 'destructive',
};

export default function Applications() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [search, setSearch] = useState('');
  const [stageCategory, setStageCategory] = useState(NONE);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params: ListApplicationsParams = {
    search: search || undefined,
    stageCategory: stageCategory === NONE ? undefined : (stageCategory as ListApplicationsParams['stageCategory']),
    page,
    pageSize,
  };

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListApplications(organizationId, params, {
    query: { queryKey: getListApplicationsQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" aria-hidden="true" />
            Applications
          </h1>
          <p className="text-muted-foreground">Review applications submitted through the careers portal</p>
        </div>
        <Link href="/pipeline">
          <Button variant="outline" data-testid="button-pipeline-board">
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            Pipeline Board
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-4">
        <Input placeholder="Search by candidate name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" data-testid="input-search-applications" />
        <Select value={stageCategory} onValueChange={(v) => { setStageCategory(v); setPage(1); }}>
          <SelectTrigger className="w-56" data-testid="select-filter-stage-category">
            <SelectValue placeholder="All stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All stages</SelectItem>
            {STAGE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <QueryError title="Could not load applications" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No applications found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Applications submitted through the careers portal will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Vacancy</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((application) => (
                  <TableRow key={application.id} data-testid={`row-application-${application.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/applications/${application.id}`} className="hover:underline" data-testid={`link-application-${application.id}`}>
                        {application.candidateName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{application.candidateEmail}</p>
                    </TableCell>
                    <TableCell>{application.vacancyTitle}</TableCell>
                    <TableCell>
                      <Badge variant={CATEGORY_VARIANT[application.currentStageCategory] ?? 'outline'} className="capitalize">
                        {application.currentStageName ?? application.currentStageCategory}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(application.submittedAt).toLocaleDateString()}</TableCell>
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
