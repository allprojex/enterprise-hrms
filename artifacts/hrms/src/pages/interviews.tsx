import { useState } from 'react';
import { Link } from 'wouter';
import { CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { useGetMe, getGetMeQueryKey, useListInterviews, getListInterviewsQueryKey, type InterviewStatus } from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

const STATUSES: InterviewStatus[] = ['scheduled', 'completed', 'cancelled', 'no_show'];
const NONE = '__all__';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  scheduled: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
  no_show: 'destructive',
};

const TYPE_LABEL: Record<string, string> = {
  phone: 'Phone',
  virtual: 'Virtual',
  in_person: 'In Person',
};

export default function Interviews() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [status, setStatus] = useState(NONE);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params = {
    status: status === NONE ? undefined : (status as InterviewStatus),
    page,
    pageSize,
  };

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useListInterviews(organizationId, params, {
    query: { queryKey: getListInterviewsQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <CalendarClock className="h-7 w-7 text-primary" aria-hidden="true" />
          Interviews
        </h1>
        <p className="text-muted-foreground">Scheduled interviews visible to you — assigned panel members and organization-wide staff</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-filter-interview-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <QueryError title="Could not load interviews" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !result || result.items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <CalendarClock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No interviews found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Schedule an interview from an application's detail page to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((interview) => (
                  <TableRow key={interview.id} data-testid={`row-interview-${interview.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/interviews/${interview.id}`} className="hover:underline" data-testid={`link-interview-${interview.id}`}>
                        Application #{interview.applicationId}
                      </Link>
                    </TableCell>
                    <TableCell>{TYPE_LABEL[interview.interviewType] ?? interview.interviewType}</TableCell>
                    <TableCell>{new Date(interview.scheduledAt).toLocaleString()}</TableCell>
                    <TableCell>{interview.durationMinutes} min</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[interview.status] ?? 'outline'} className="capitalize">{interview.status.replace('_', ' ')}</Badge>
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
