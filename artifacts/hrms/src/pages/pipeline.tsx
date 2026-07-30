import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { LayoutGrid } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  useGetMe,
  getGetMeQueryKey,
  useListVacancies,
  getListVacanciesQueryKey,
  useGetVacancy,
  getGetVacancyQueryKey,
  useListRecruitmentStages,
  getListRecruitmentStagesQueryKey,
  useListApplications,
  getListApplicationsQueryKey,
  useMoveApplicationStage,
  type ApplicationSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

// Pipeline board (Phase 3A, W51) — per the frozen plan's own frontend
// scope ("/pipeline board ... drag-or-click stage movement, calling the
// same move-stage endpoint either way"). Click-based, not drag-and-drop —
// the frozen text explicitly allows either, and click avoids adding a new
// drag-and-drop dependency for one page.
export default function Pipeline() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: vacancyList } = useListVacancies(
    organizationId,
    { page: 1, pageSize: 100 },
    { query: { queryKey: getListVacanciesQueryKey(organizationId, { page: 1, pageSize: 100 }), enabled: organizationId > 0 } },
  );

  const [vacancyId, setVacancyId] = useState<string>('');
  const selectedVacancyId = vacancyId ? Number(vacancyId) : undefined;

  const { data: vacancy } = useGetVacancy(organizationId, selectedVacancyId ?? 0, {
    query: { queryKey: getGetVacancyQueryKey(organizationId, selectedVacancyId ?? 0), enabled: organizationId > 0 && !!selectedVacancyId },
  });

  const { data: stages, isLoading: stagesLoading } = useListRecruitmentStages(organizationId, vacancy?.workflowId ?? 0, {
    query: { queryKey: getListRecruitmentStagesQueryKey(organizationId, vacancy?.workflowId ?? 0), enabled: organizationId > 0 && !!vacancy?.workflowId },
  });

  const applicationsParams = { vacancyId: selectedVacancyId, page: 1, pageSize: 100 };
  const {
    data: applicationsResult,
    isLoading: applicationsLoading,
    error: applicationsError,
    refetch,
  } = useListApplications(organizationId, applicationsParams, {
    query: { queryKey: getListApplicationsQueryKey(organizationId, applicationsParams), enabled: organizationId > 0 && !!selectedVacancyId },
  });

  const moveMutation = useMoveApplicationStage();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey(organizationId) });

  const handleMove = (applicationId: number, toStageId: number) => {
    moveMutation.mutate(
      { organizationId, id: applicationId, data: { toStageId } },
      {
        onSuccess: () => { invalidate(); toast({ title: 'Stage updated' }); },
        onError: (err) => toast({ title: 'Could not move application', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const activeStages = useMemo(() => (stages ?? []).filter((s) => s.isActive).sort((a, b) => a.displayOrder - b.displayOrder), [stages]);

  const applicationsByStage = useMemo(() => {
    const map = new Map<number | null, ApplicationSummary[]>();
    for (const app of applicationsResult?.items ?? []) {
      const key = app.currentStageId;
      const list = map.get(key) ?? [];
      list.push(app);
      map.set(key, list);
    }
    return map;
  }, [applicationsResult]);

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <LayoutGrid className="h-7 w-7 text-primary" aria-hidden="true" />
          Pipeline Board
        </h1>
        <p className="text-muted-foreground">Applications grouped by stage for a selected vacancy</p>
      </div>

      <div className="max-w-xs">
        <Select value={vacancyId} onValueChange={setVacancyId}>
          <SelectTrigger data-testid="select-pipeline-vacancy">
            <SelectValue placeholder="Select a vacancy" />
          </SelectTrigger>
          <SelectContent>
            {(vacancyList?.items ?? []).map((v) => (
              <SelectItem key={v.id} value={String(v.id)}>{v.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedVacancyId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">Select a vacancy to view its pipeline.</p>
          </CardContent>
        </Card>
      ) : applicationsError ? (
        <QueryError title="Could not load the pipeline" onRetry={() => refetch()} />
      ) : applicationsLoading || stagesLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !vacancy?.workflowId ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">This vacancy has no configured recruitment workflow.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="pipeline-board">
          {activeStages.map((stage) => {
            const cards = applicationsByStage.get(stage.id) ?? [];
            return (
              <div key={stage.id} className="w-72 flex-shrink-0" data-testid={`pipeline-column-${stage.id}`}>
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>{stage.name}</span>
                      <Badge variant="outline">{cards.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {cards.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No applications</p>
                    ) : (
                      cards.map((app) => (
                        <div key={app.id} className="rounded-md border border-border p-2 space-y-2" data-testid={`pipeline-card-${app.id}`}>
                          <Link href={`/applications/${app.id}`} className="text-sm font-medium hover:underline block">
                            {app.candidateName}
                          </Link>
                          <p className="text-xs text-muted-foreground">{app.candidateEmail}</p>
                          {!stage.isTerminal && (
                            <Select onValueChange={(v) => handleMove(app.id, Number(v))}>
                              <SelectTrigger className="h-7 text-xs" data-testid={`select-pipeline-move-${app.id}`}>
                                <SelectValue placeholder="Move to…" />
                              </SelectTrigger>
                              <SelectContent>
                                {activeStages.filter((s) => !s.isTerminal && s.id !== stage.id).map((s) => (
                                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
