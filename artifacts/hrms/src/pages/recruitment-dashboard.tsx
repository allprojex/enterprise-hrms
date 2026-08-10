import { LayoutDashboard, ClipboardList, Megaphone, Users, UserCheck, Briefcase } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { QueryError } from '@/components/query-error';
import { useGetMe, getGetMeQueryKey, useGetRecruitmentDashboard, getGetRecruitmentDashboardQueryKey } from '@workspace/api-client-react';

function isForbidden(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 403;
}

const STAGE_CATEGORY_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  applied: 'outline',
  screening: 'secondary',
  interview: 'secondary',
  assessment: 'secondary',
  offer: 'secondary',
  hired: 'secondary',
  rejected: 'destructive',
  withdrawn: 'destructive',
};

export default function RecruitmentDashboard() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useGetRecruitmentDashboard(organizationId, {
    query: { queryKey: getGetRecruitmentDashboardQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const tiles = dashboard
    ? [
        { title: 'Open Requisitions', value: dashboard.openRequisitionsCount, icon: ClipboardList },
        { title: 'Open Vacancies', value: dashboard.openVacanciesCount, icon: Megaphone },
        { title: 'Total Applicants', value: dashboard.totalApplicantsCount, icon: UserCheck },
      ]
    : [];

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" aria-hidden="true" />
          Recruitment Dashboard
        </h1>
        <p className="text-muted-foreground">
          Real-time figures — organization-wide staff see every figure; an assigned recruiter or hiring manager sees only their own workload/pipeline scope.
        </p>
      </div>

      {isForbidden(error) ? (
        <QueryError title="Access denied" message="You don't have permission to view recruitment reporting." />
      ) : error ? (
        <QueryError title="Could not load the dashboard" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : !dashboard ? null : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="recruitment-dashboard-tiles">
            {tiles.map((tile) => (
              <Card key={tile.title} data-testid={`tile-${tile.title.toLowerCase().replace(/\s+/g, '-')}`}>
                <CardContent className="flex items-center gap-4 pt-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <tile.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{tile.value}</p>
                    <p className="text-sm text-muted-foreground">{tile.title}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card data-testid="card-candidates-by-stage">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" aria-hidden="true" />
                Candidates by Stage
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.candidatesByStage.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No applicants in scope yet.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {dashboard.candidatesByStage.map((item) => (
                    <Badge
                      key={item.stageId ?? 'unstaged'}
                      variant={STAGE_CATEGORY_VARIANT[item.category] ?? 'outline'}
                      className="text-sm px-3 py-1.5"
                      data-testid={`stage-badge-${item.stageId ?? 'unstaged'}`}
                    >
                      {item.stageName}: {item.count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <WorkloadCard title="Recruiter Workload" items={dashboard.recruiterWorkload} testId="recruiter-workload" />
            <WorkloadCard title="Hiring Manager Workload" items={dashboard.hiringManagerWorkload} testId="hiring-manager-workload" />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkloadCard({
  title,
  items,
  testId,
}: {
  title: string;
  items: { employeeId: number; employeeName: string; openRequisitionsCount: number }[];
  testId: string;
}) {
  return (
    <Card data-testid={`card-${testId}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No open requisitions in scope.</p>
        ) : (
          <Table aria-label={title}>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Open Requisitions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.employeeId} data-testid={`row-${testId}-${item.employeeId}`}>
                  <TableCell className="font-medium">{item.employeeName}</TableCell>
                  <TableCell>{item.openRequisitionsCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
