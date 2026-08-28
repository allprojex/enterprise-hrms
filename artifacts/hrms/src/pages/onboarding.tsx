import { useState } from 'react';
import { Link } from 'wouter';
import { ClipboardCheck, AlertTriangle, CheckCircle2, Clock, Ban, UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { useToast } from '@/hooks/use-toast';
import {
  useGetMe,
  getGetMeQueryKey,
  useListOnboarding,
  getListOnboardingQueryKey,
  useStartOnboarding,
} from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}
function errorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? (err instanceof Error ? err.message : fallback);
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  not_started: { label: 'Not started', className: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In progress', className: 'bg-blue-100 text-blue-900' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-900' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

/**
 * WS-10 — the HR onboarding list.
 *
 * Progress is shown as a percentage because it is genuinely useful at a
 * glance, but the STATUS beside it is the authoritative answer: onboarding is
 * complete when every required task is completed or waived, which the server
 * decides. A bar at 90% and a bar at 100% can both be incomplete.
 */
export default function Onboarding() {
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;
  const enabled = organizationId > 0;

  const [status, setStatus] = useState<string>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [employeeId, setEmployeeId] = useState('');

  const params = {
    ...(status !== 'all' ? { status: status as 'not_started' | 'in_progress' | 'completed' | 'cancelled' } : {}),
    ...(overdueOnly ? { overdueOnly: true } : {}),
  };
  const query = useListOnboarding(organizationId, params, {
    query: { queryKey: getListOnboardingQueryKey(organizationId, params), enabled },
  });
  const startMutation = useStartOnboarding();

  const items = query.data?.items ?? [];

  if (isForbidden(query.error)) {
    return (
      <div className="p-6">
        <QueryError
          title="You do not have access to onboarding"
          message="Viewing onboarding across the organization requires the onboarding read permission. If you are looking for your own onboarding, use Employee Self-Service."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="page-onboarding">
      <div>
        <h1 className="text-2xl font-semibold">Onboarding</h1>
        <p className="text-muted-foreground">
          Track new starters through their checklist, documents, handbook acknowledgements and induction.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Start onboarding
          </CardTitle>
          <CardDescription>
            For an employee who already exists — a new hire converted from Recruitment, someone created manually, or staff brought in
            through an import. Onboarding never creates an employee record, and no candidate record is required.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="employee-id">Employee ID</Label>
              <Input
                id="employee-id"
                type="number"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              disabled={!employeeId || startMutation.isPending}
              onClick={() =>
                startMutation.mutate(
                  { organizationId, data: { employeeId: Number(employeeId) } },
                  {
                    onSuccess: () => {
                      setEmployeeId('');
                      void query.refetch();
                      toast({ title: 'Onboarding started' });
                    },
                    onError: (err) =>
                      toast({ title: 'Could not start onboarding', description: errorMessage(err, ''), variant: 'destructive' }),
                  },
                )
              }
            >
              Start
            </Button>
            <p className="text-xs text-muted-foreground">
              The most specific active template that applies to this employee is used.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            Active onboarding
          </CardTitle>
          <CardDescription>Percentage is informational — the status column is authoritative.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="status-filter">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="status-filter" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="not_started">Not started</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant={overdueOnly ? 'default' : 'outline'} onClick={() => setOverdueOnly((v) => !v)}>
              <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
              Overdue only
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No onboarding matches these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const style = STATUS_STYLES[item.progress.status] ?? STATUS_STYLES['not_started']!;
                  return (
                    <TableRow key={item.instance.id} data-testid={`row-onboarding-${item.instance.id}`}>
                      <TableCell className="font-medium">
                        {item.employeeName ?? `Employee #${item.instance.employeeId}`}
                        {item.employeeNumber && <span className="ml-2 text-xs text-muted-foreground">{item.employeeNumber}</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.templateName ?? '—'}</TableCell>
                      <TableCell className="w-48">
                        <div className="flex items-center gap-2">
                          <Progress value={item.progress.completionPercentage} className="h-2" />
                          <span className="text-xs text-muted-foreground">{item.progress.completionPercentage}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {item.progress.pending > 0 && (
                            <Badge variant="secondary" className="gap-1">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              {item.progress.pending} pending
                            </Badge>
                          )}
                          {item.progress.overdue > 0 && (
                            <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-900">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              {item.progress.overdue} overdue
                            </Badge>
                          )}
                          {item.progress.waived > 0 && <Badge variant="secondary">{item.progress.waived} waived</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={style.className}>
                          {item.progress.status === 'completed' && <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />}
                          {item.progress.status === 'cancelled' && <Ban className="mr-1 h-3 w-3" aria-hidden="true" />}
                          {style.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/onboarding/${item.instance.id}`}>
                          <Button variant="outline" size="sm">
                            Open
                          </Button>
                        </Link>
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
