import { useState } from 'react';
import { Link } from 'wouter';
import { ClipboardCheck, ChevronLeft, ChevronRight, ArrowRight, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { PerformanceEvidenceSection } from '@/components/performance-evidence';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListPerformanceReviews,
  getListPerformanceReviewsQueryKey,
  useGetPerformanceReview,
  getGetPerformanceReviewQueryKey,
  useListPerformanceCycles,
  getListPerformanceCyclesQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  useFinalizePerformanceReview,
  useReopenPerformanceReview,
  getListTeamPerformanceReviewsQueryKey,
  ListPerformanceReviewsStatus,
  ReopenPerformanceReviewInputTargetStage,
  type PerformanceReview,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { isHrCapableRole } from '@/hooks/use-hr-capable';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const ALL = '__all__';
const PAGE_SIZE = 20;

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  self_assessment: 'Self-Assessment',
  manager_review: 'Manager Review',
  hr_review: 'HR Review',
  finalized: 'Finalized',
  acknowledged: 'Acknowledged',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  draft: 'outline',
  self_assessment: 'outline',
  manager_review: 'outline',
  hr_review: 'secondary',
  finalized: 'default',
  acknowledged: 'default',
};

// Score display (§frozen): the manager's computedOverallScore, the HR
// hrOverrideScore (when present), and the effective final score must
// always be shown distinctly — an override is never displayed as if it
// were the manager's own result. Matches the exact frozen patterns:
// "Manager score: 88.00 / HR override: 92.50 / Final score: 92.50" and,
// without an override, "Manager score: 88.00 / Final score: 88.00".
function formatScoreLine(review: PerformanceReview): string {
  if (review.computedOverallScore == null) return 'No score yet';
  const precision = review.scoringPrecisionSnapshot ?? 2;
  const managerScore = Number(review.computedOverallScore).toFixed(precision);
  if (review.hrOverrideScore != null) {
    const overrideScore = Number(review.hrOverrideScore).toFixed(precision);
    return `Manager score: ${managerScore} / HR override: ${overrideScore} / Final score: ${overrideScore}`;
  }
  return `Manager score: ${managerScore} / Final score: ${managerScore}`;
}

// A reopen targetStage must be strictly earlier than the review's current
// status (backend-enforced) — this only determines which options this UI
// offers so the confirmation dialog never lets HR pick an invalid target.
const REOPEN_STAGE_ORDER: ReopenPerformanceReviewInputTargetStage[] = [
  ReopenPerformanceReviewInputTargetStage.self_assessment,
  ReopenPerformanceReviewInputTargetStage.manager_review,
  ReopenPerformanceReviewInputTargetStage.hr_review,
];

function reopenTargetOptions(status: string): ReopenPerformanceReviewInputTargetStage[] {
  if (status === 'finalized') return REOPEN_STAGE_ORDER;
  const idx = REOPEN_STAGE_ORDER.indexOf(status as ReopenPerformanceReviewInputTargetStage);
  return idx > 0 ? REOPEN_STAGE_ORDER.slice(0, idx) : [];
}

// Internal HR/Manager Review List (W80): an operational read/action
// surface over W75-W79 — org-wide list (performance.manage), reused
// detail route, and the reopen-with-reason dialog (§35's own literal row
// for this workstream). Deliberately NOT a new business-rules engine:
// finalize/reopen reuse W79's routes verbatim, and the manager's own
// scoped view remains W78's /performance-team (linked to, not duplicated).
export default function PerformanceReviews() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = isHrCapableRole(currentOrg?.roles);

  // --- Filters (only the frozen filters: cycleId/employeeId/status/
  // departmentId/positionId/reviewerId) — all narrow the already
  // org-scoped, performance.manage-gated result set; none can broaden it.
  const [cycleId, setCycleId] = useState(ALL);
  const [employeeId, setEmployeeId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [positionId, setPositionId] = useState(ALL);
  const [reviewerId, setReviewerId] = useState(ALL);
  const [page, setPage] = useState(1);

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(1);
    setter(v);
  };

  const params = {
    cycleId: cycleId === ALL ? undefined : Number(cycleId),
    employeeId: employeeId === ALL ? undefined : Number(employeeId),
    status: status === ALL ? undefined : (status as ListPerformanceReviewsStatus),
    departmentId: departmentId === ALL ? undefined : Number(departmentId),
    positionId: positionId === ALL ? undefined : Number(positionId),
    reviewerId: reviewerId === ALL ? undefined : Number(reviewerId),
    page,
    pageSize: PAGE_SIZE,
  };

  const listQuery = useListPerformanceReviews(organizationId, params, {
    query: { queryKey: getListPerformanceReviewsQueryKey(organizationId, params), enabled: organizationId > 0 },
  });
  const reviews = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: cycles } = useListPerformanceCycles(organizationId, {
    query: { queryKey: getListPerformanceCyclesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const cycleById = new Map((cycles ?? []).map((c) => [c.id, c]));

  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const employees = employeesPage?.items ?? [];
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const employeeLabel = (id: number | null | undefined) => {
    if (id == null) return '—';
    const e = employeeById.get(id);
    return e ? `${e.firstName} ${e.lastName}${e.employeeNumber ? ` (${e.employeeNumber})` : ''}` : `Employee #${id}`;
  };

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const departmentById = new Map((departments ?? []).map((d) => [d.id, d]));

  const { data: positions } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const positionById = new Map((positions ?? []).map((p) => [p.id, p]));

  // --- Detail ---
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const detailQuery = useGetPerformanceReview(organizationId, selectedReviewId ?? 0, {
    query: { queryKey: getGetPerformanceReviewQueryKey(organizationId, selectedReviewId ?? 0), enabled: organizationId > 0 && !!selectedReviewId },
  });
  const detail = detailQuery.data;
  const review = detail?.review;

  const refreshAfterMutation = () => {
    listQuery.refetch();
    if (selectedReviewId) detailQuery.refetch();
    // A finalize/reopen can move a review into or out of a manager's own
    // reviewer-of-record scope — refresh W78's team-reviews view too.
    queryClient.invalidateQueries({ queryKey: getListTeamPerformanceReviewsQueryKey(organizationId) });
  };

  // --- Finalize (reuses W79's finalize route verbatim) ---
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const finalizeMutation = useFinalizePerformanceReview();

  const handleFinalize = () => {
    if (!review) return;
    const hasOverride = overrideScore.trim() !== '';
    finalizeMutation.mutate(
      { organizationId, id: review.id, data: hasOverride ? { hrOverrideScore: Number(overrideScore), hrOverrideReason: overrideReason.trim() } : undefined },
      {
        onSuccess: () => {
          setOverrideScore('');
          setOverrideReason('');
          refreshAfterMutation();
          toast({ title: 'Review finalized' });
        },
        onError: (err) => toast({ title: 'Could not finalize review', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Reopen (reuses W79's reopen route verbatim; performance.manage,
  // not performance.finalize, per §10.1 row 6 / §16) ---
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<ReopenPerformanceReviewInputTargetStage | ''>('');
  const [reopenReason, setReopenReason] = useState('');
  const reopenMutation = useReopenPerformanceReview();

  const handleReopen = () => {
    if (!review || !reopenTarget || !reopenReason.trim()) return;
    reopenMutation.mutate(
      { organizationId, id: review.id, data: { targetStage: reopenTarget, reason: reopenReason.trim() } },
      {
        onSuccess: () => {
          setReopenOpen(false);
          setReopenTarget('');
          setReopenReason('');
          refreshAfterMutation();
          toast({ title: 'Review reopened' });
        },
        onError: (err) => toast({ title: 'Could not reopen review', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const canFinalize = review?.status === 'hr_review';
  const canReopen = review ? ['manager_review', 'hr_review', 'finalized'].includes(review.status) : false;
  const targetOptions = review ? reopenTargetOptions(review.status) : [];

  if (listQuery.isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (listQuery.error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load Performance reviews" onRetry={() => listQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <ClipboardCheck className="h-7 w-7 text-primary" aria-hidden="true" />
          Performance Reviews
        </h1>
        <p className="text-muted-foreground">Organization-wide Performance review list, finalization, and reopening.</p>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label htmlFor="filter-cycle">Cycle</Label>
              <Select value={cycleId} onValueChange={resetToFirstPage(setCycleId)}>
                <SelectTrigger id="filter-cycle" data-testid="select-filter-cycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All cycles</SelectItem>
                  {(cycles ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-status">Status</Label>
              <Select value={status} onValueChange={resetToFirstPage(setStatus)}>
                <SelectTrigger id="filter-status" data-testid="select-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {Object.entries(REVIEW_STATUS_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-employee">Employee</Label>
              <Select value={employeeId} onValueChange={resetToFirstPage(setEmployeeId)}>
                <SelectTrigger id="filter-employee" data-testid="select-filter-employee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All employees</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-reviewer">Reviewer</Label>
              <Select value={reviewerId} onValueChange={resetToFirstPage(setReviewerId)}>
                <SelectTrigger id="filter-reviewer" data-testid="select-filter-reviewer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All reviewers</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-department">Department</Label>
              <Select value={departmentId} onValueChange={resetToFirstPage(setDepartmentId)}>
                <SelectTrigger id="filter-department" data-testid="select-filter-department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {(departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-position">Position</Label>
              <Select value={positionId} onValueChange={resetToFirstPage(setPositionId)}>
                <SelectTrigger id="filter-position" data-testid="select-filter-position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All positions</SelectItem>
                  {(positions ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {reviews.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardCheck className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No reviews found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">No Performance reviews match the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Performance reviews">
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Scores</TableHead>
                <TableHead>Rev.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((r) => (
                <TableRow key={r.id} data-testid={`row-review-${r.id}`}>
                  <TableCell className="font-medium">{employeeLabel(r.employeeId)}</TableCell>
                  <TableCell className="text-muted-foreground">{cycleById.get(r.cycleId)?.name ?? `Cycle #${r.cycleId}`}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{REVIEW_STATUS_LABEL[r.status] ?? r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{employeeLabel(r.reviewerEmployeeId)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.departmentIdSnapshot != null ? (departmentById.get(r.departmentIdSnapshot)?.name ?? `#${r.departmentIdSnapshot}`) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.positionIdSnapshot != null ? (positionById.get(r.positionIdSnapshot)?.title ?? `#${r.positionIdSnapshot}`) : '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-xs" data-testid={`text-scores-review-${r.id}`}>{formatScoreLine(r)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.revisionNumber}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setSelectedReviewId(r.id)} data-testid={`button-view-review-${r.id}`}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} review{total === 1 ? '' : 's'})
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} data-testid="button-prev-page">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} data-testid="button-next-page">
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={selectedReviewId !== null} onOpenChange={(open) => !open && setSelectedReviewId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Detail</DialogTitle>
          </DialogHeader>

          {detailQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : detailQuery.error ? (
            <QueryError title="Could not load this review" message={errorMessage(detailQuery.error) ?? 'Please try again.'} onRetry={() => detailQuery.refetch()} />
          ) : detail && review ? (
            <div className="space-y-6 py-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium" data-testid="text-detail-employee">{employeeLabel(review.employeeId)}</p>
                  <Badge variant={STATUS_VARIANT[review.status]} data-testid="text-detail-status">{REVIEW_STATUS_LABEL[review.status] ?? review.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Cycle: {cycleById.get(review.cycleId)?.name ?? `Cycle #${review.cycleId}`} · Reviewer: {employeeLabel(review.reviewerEmployeeId)} · Revision {review.revisionNumber}
                </p>
                <p className="text-sm text-muted-foreground">
                  Department (at assignment): {review.departmentIdSnapshot != null ? (departmentById.get(review.departmentIdSnapshot)?.name ?? `#${review.departmentIdSnapshot}`) : '—'}
                  {' · '}
                  Position (at assignment): {review.positionIdSnapshot != null ? (positionById.get(review.positionIdSnapshot)?.title ?? `#${review.positionIdSnapshot}`) : '—'}
                </p>
                {/* status is the authoritative lifecycle signal (W83 DoD: never infer state from a nullable timestamp) — acknowledgedAt is read only for its own date value once status confirms the review really is acknowledged. */}
                <p className="text-sm text-muted-foreground">Acknowledgement: {review.status === 'acknowledged' && review.acknowledgedAt ? `Acknowledged on ${new Date(review.acknowledgedAt).toLocaleDateString()}` : 'Not yet acknowledged'}</p>
              </div>

              {review.status === 'manager_review' && (
                <Card>
                  <CardContent className="py-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">This review is with its reviewer. Manager scoring happens in the Team Reviews workspace.</p>
                    <Button asChild size="sm" variant="outline" data-testid="link-go-to-manager-review">
                      <Link href="/performance-team">
                        Go to Team Reviews
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scores</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm" data-testid="text-detail-scores">{formatScoreLine(review)}</p>
                  {review.hrOverrideReason && <p className="text-sm text-muted-foreground mt-1">Override reason: {review.hrOverrideReason}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Goals</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.goals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No goals.</p>
                  ) : (
                    detail.goals.map((g) => (
                      <div key={g.id} className="border rounded-md p-3 text-sm" data-testid={`row-detail-goal-${g.id}`}>
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{g.title}</p>
                          <Badge variant="outline">{g.approvalStatus}</Badge>
                        </div>
                        <p className="text-muted-foreground capitalize">{g.measurementType} · weight {g.weight} · {g.status}</p>
                        {g.actualResult != null && <p className="text-muted-foreground">Result: {g.actualResult}{g.computedScore != null ? ` (score ${g.computedScore})` : ''}</p>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Competencies</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.competencies.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No competencies.</p>
                  ) : (
                    detail.competencies.map((c) => (
                      <div key={c.id} className="border rounded-md p-3 text-sm" data-testid={`row-detail-competency-${c.id}`}>
                        <p className="font-medium">{c.label}</p>
                        <p className="text-muted-foreground">Employee: {c.employeeRatingValue ?? '—'}{c.employeeComment ? ` — "${c.employeeComment}"` : ''}</p>
                        <p className="text-muted-foreground">Manager: {c.managerRatingValue ?? '—'}{c.managerComment ? ` — "${c.managerComment}"` : ''}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <PerformanceEvidenceSection organizationId={organizationId} reviewId={review.id} canUpload={isHrCapable && review.status === 'hr_review'} />

              {(canFinalize || canReopen) && isHrCapable && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">HR Decision</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {canFinalize && (
                      <div className="space-y-3 border-b pb-4">
                        <p className="text-sm font-medium">Finalize this review</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label htmlFor="override-score">Override score (optional, 0-100)</Label>
                            <Input id="override-score" type="number" min={0} max={100} value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} data-testid="input-override-score" />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="override-reason">Override reason {overrideScore.trim() !== '' ? '(required)' : ''}</Label>
                            <Input id="override-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} data-testid="input-override-reason" />
                          </div>
                        </div>
                        <Button
                          onClick={handleFinalize}
                          disabled={finalizeMutation.isPending || (overrideScore.trim() !== '' && !overrideReason.trim())}
                          data-testid="button-finalize-review"
                        >
                          {finalizeMutation.isPending ? 'Finalizing…' : 'Finalize'}
                        </Button>
                      </div>
                    )}

                    {canReopen && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">Reopen this review</p>
                        <Dialog open={reopenOpen} onOpenChange={(open) => { setReopenOpen(open); if (!open) { setReopenTarget(''); setReopenReason(''); } }}>
                          <DialogTrigger asChild>
                            <Button type="button" variant="outline" data-testid="button-open-reopen-dialog">
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                              Reopen…
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Reopen Review</DialogTitle>
                              <DialogDescription>Send this review back to an earlier stage. This is not reversible and clears downstream decisions.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                              <div className="space-y-2">
                                <Label htmlFor="reopen-target">Target stage</Label>
                                <Select value={reopenTarget} onValueChange={(v) => setReopenTarget(v as ReopenPerformanceReviewInputTargetStage)}>
                                  <SelectTrigger id="reopen-target" data-testid="select-reopen-target">
                                    <SelectValue placeholder="Choose a stage" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {targetOptions.map((t) => (
                                      <SelectItem key={t} value={t}>{REVIEW_STATUS_LABEL[t]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="reopen-reason">Reason (required)</Label>
                                <Textarea id="reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} data-testid="textarea-reopen-reason" />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button
                                onClick={handleReopen}
                                disabled={reopenMutation.isPending || !reopenTarget || !reopenReason.trim()}
                                data-testid="button-confirm-reopen"
                              >
                                {reopenMutation.isPending ? 'Reopening…' : 'Confirm Reopen'}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
