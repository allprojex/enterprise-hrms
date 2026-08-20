import { useState } from 'react';
import { Users, Plus, Check, X, CheckCircle2, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetMyEmployee,
  getGetMyEmployeeQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListLearningCourses,
  getListLearningCoursesQueryKey,
  useListTeamLearningEnrollments,
  getListTeamLearningEnrollmentsQueryKey,
  useGetLearningEnrollment,
  getGetLearningEnrollmentQueryKey,
  useGetLearningCourseSession,
  getGetLearningCourseSessionQueryKey,
  useApproveLearningEnrollment,
  useRejectLearningEnrollment,
  useAssignLearningEnrollments,
  useMarkLearningEnrollmentAttendance,
  useCompleteLearningEnrollment,
  type LearningEnrollment,
  type LearningCourse,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  assigned: 'outline',
  in_progress: 'secondary',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
};
const APPROVAL_LABEL: Record<string, string> = {
  auto_approved: 'Approved',
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};
const APPROVAL_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  auto_approved: 'secondary',
  pending: 'outline',
  approved: 'secondary',
  rejected: 'destructive',
};

/**
 * Instructor actions (attendance/complete) only ever render when a *live*
 * lookup of this specific enrollment's own session shows the caller as
 * that session's own instructorEmployeeId — manager-of-record authority
 * (already covered by the approve/reject actions above, in the same row)
 * never substitutes for it, mirroring the backend's own independent
 * dispatch (§13). This is convenience hiding only; the backend re-checks
 * the identical relationship on every call regardless of what this
 * component decides to render.
 */
function InstructorActions({
  organizationId,
  enrollment,
  myEmployeeId,
  onChanged,
}: {
  organizationId: number;
  enrollment: LearningEnrollment;
  myEmployeeId: number | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [passed, setPassed] = useState<'true' | 'false' | ''>('');
  const sessionQuery = useGetLearningCourseSession(organizationId, enrollment.sessionId ?? 0, {
    query: { queryKey: getGetLearningCourseSessionQueryKey(organizationId, enrollment.sessionId ?? 0), enabled: organizationId > 0 && enrollment.sessionId != null },
  });
  const attendanceMutation = useMarkLearningEnrollmentAttendance();
  const completeMutation = useCompleteLearningEnrollment();

  if (enrollment.deliveryModeSnapshot !== 'instructor_led' || enrollment.sessionId == null) return null;
  if (sessionQuery.isLoading) return <Skeleton className="h-8 w-48" />;
  const isInstructor = myEmployeeId != null && sessionQuery.data?.instructorEmployeeId === myEmployeeId;
  if (!isInstructor) return null;
  if (enrollment.status !== 'assigned' && enrollment.status !== 'in_progress') return null;
  if (enrollment.approvalStatus !== 'auto_approved' && enrollment.approvalStatus !== 'approved') return null;

  const handleComplete = () => {
    const data = enrollment.hasAssessmentSnapshot ? { passed: passed === 'true' } : undefined;
    if (enrollment.hasAssessmentSnapshot && passed === '') return;
    completeMutation.mutate(
      { organizationId, id: enrollment.id, data },
      {
        onSuccess: () => { onChanged(); toast({ title: 'Training completed' }); },
        onError: (err) => toast({ title: 'Could not complete this enrollment', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`instructor-actions-${enrollment.id}`}>
      {enrollment.attended == null && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => attendanceMutation.mutate({ organizationId, id: enrollment.id, data: { attended: true } }, { onSuccess: () => { onChanged(); toast({ title: 'Attendance recorded' }); }, onError: (err) => toast({ title: 'Could not record attendance', description: errorMessage(err), variant: 'destructive' }) })}
            disabled={attendanceMutation.isPending}
            data-testid={`button-mark-attended-${enrollment.id}`}
          >
            Mark Attended
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => attendanceMutation.mutate({ organizationId, id: enrollment.id, data: { attended: false } }, { onSuccess: () => { onChanged(); toast({ title: 'Attendance recorded' }); }, onError: (err) => toast({ title: 'Could not record attendance', description: errorMessage(err), variant: 'destructive' }) })}
            disabled={attendanceMutation.isPending}
            data-testid={`button-mark-absent-${enrollment.id}`}
          >
            Mark Absent
          </Button>
        </>
      )}
      {enrollment.hasAssessmentSnapshot && (
        <Select value={passed} onValueChange={(v) => setPassed(v as 'true' | 'false')}>
          <SelectTrigger className="w-32" data-testid={`select-passed-${enrollment.id}`}>
            <SelectValue placeholder="Result" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Passed</SelectItem>
            <SelectItem value="false">Failed</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Button
        size="sm"
        onClick={handleComplete}
        disabled={completeMutation.isPending || (enrollment.hasAssessmentSnapshot && passed === '')}
        data-testid={`button-complete-${enrollment.id}`}
      >
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Complete Training
      </Button>
    </div>
  );
}

function TeamEnrollmentRow({
  organizationId,
  enrollment,
  employeeName,
  myEmployeeId,
  onChanged,
}: {
  organizationId: number;
  enrollment: LearningEnrollment;
  employeeName: string;
  myEmployeeId: number | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const approveMutation = useApproveLearningEnrollment();
  const rejectMutation = useRejectLearningEnrollment();

  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`row-team-enrollment-${enrollment.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-foreground">{employeeName}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {enrollment.courseTitleSnapshot} · {enrollment.categorySnapshot} · {enrollment.deliveryModeSnapshot.replace('_', ' ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {enrollment.mandatoryAtAssignment && <Badge variant="outline">Mandatory</Badge>}
          <Badge variant={STATUS_VARIANT[enrollment.status]}>{STATUS_LABEL[enrollment.status] ?? enrollment.status}</Badge>
          <Badge variant={APPROVAL_VARIANT[enrollment.approvalStatus]}>{APPROVAL_LABEL[enrollment.approvalStatus] ?? enrollment.approvalStatus}</Badge>
        </div>
      </div>

      {enrollment.approvalStatus === 'pending' && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => approveMutation.mutate({ organizationId, id: enrollment.id }, { onSuccess: () => { onChanged(); toast({ title: 'Request approved' }); }, onError: (err) => toast({ title: 'Could not approve', description: errorMessage(err), variant: 'destructive' }) })}
            disabled={approveMutation.isPending || rejectMutation.isPending}
            data-testid={`button-approve-${enrollment.id}`}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rejectMutation.mutate({ organizationId, id: enrollment.id }, { onSuccess: () => { onChanged(); toast({ title: 'Request rejected' }); }, onError: (err) => toast({ title: 'Could not reject', description: errorMessage(err), variant: 'destructive' }) })}
            disabled={approveMutation.isPending || rejectMutation.isPending}
            data-testid={`button-reject-${enrollment.id}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
        </div>
      )}

      <InstructorActions organizationId={organizationId} enrollment={enrollment} myEmployeeId={myEmployeeId} onChanged={onChanged} />
    </div>
  );
}

function AssignTrainingDialog({
  organizationId,
  activeCourses,
  directReports,
  onAssigned,
}: {
  organizationId: number;
  activeCourses: LearningCourse[];
  directReports: { id: number; firstName: string; lastName: string }[];
  onAssigned: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [mandatory, setMandatory] = useState(false);
  const assignMutation = useAssignLearningEnrollments();

  const reset = () => {
    setCourseId('');
    setSelectedEmployeeIds([]);
    setMandatory(false);
  };

  const handleAssign = () => {
    if (!courseId || selectedEmployeeIds.length === 0) return;
    assignMutation.mutate(
      { organizationId, id: Number(courseId), data: { scope: 'manual', employeeIds: selectedEmployeeIds, mandatory } },
      {
        onSuccess: (result) => {
          setOpen(false);
          reset();
          onAssigned();
          toast({ title: 'Training assigned', description: `${result.assignedCount} assigned${result.skippedCount ? `, ${result.skippedCount} already enrolled` : ''}.` });
        },
        onError: (err) => toast({ title: 'Could not assign training', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" data-testid="button-assign-training">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Assign Training
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Training to Direct Reports</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="assign-course">Course *</Label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger id="assign-course" data-testid="select-assign-course">
                <SelectValue placeholder="Choose a course" />
              </SelectTrigger>
              <SelectContent>
                {activeCourses.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Direct Reports *</Label>
            {directReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">You have no direct reports.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {directReports.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`assign-employee-${e.id}`}
                      checked={selectedEmployeeIds.includes(e.id)}
                      onCheckedChange={(v) => setSelectedEmployeeIds((prev) => (v === true ? [...prev, e.id] : prev.filter((id) => id !== e.id)))}
                      data-testid={`checkbox-assign-employee-${e.id}`}
                    />
                    <Label htmlFor={`assign-employee-${e.id}`}>{e.firstName} {e.lastName}</Label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="assign-mandatory" checked={mandatory} onCheckedChange={(v) => setMandatory(v === true)} data-testid="checkbox-assign-mandatory" />
            <Label htmlFor="assign-mandatory">Mandatory</Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleAssign}
            disabled={assignMutation.isPending || !courseId || selectedEmployeeIds.length === 0}
            data-testid="button-submit-assign-training"
          >
            {assignMutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Instructor lookup by enrollment ID — the frozen §21 route table has no
 * dedicated "sessions/enrollments I instruct" listing route, only the
 * already-existing GET .../enrollments/:id (own/manager-of-record/
 * instructor-of-record/org-wide dispatch, built in W87). This panel is
 * the disclosed, no-new-route way an instructor reaches an enrollment
 * outside their own direct-report list — e.g. a session with attendees
 * who report to a different manager — reusing that exact route rather
 * than inventing a new one.
 */
function InstructorLookupPanel({ organizationId, myEmployeeId }: { organizationId: number; myEmployeeId: number | null }) {
  const [lookupInput, setLookupInput] = useState('');
  const [lookupId, setLookupId] = useState<number | null>(null);
  const enrollmentQuery = useGetLearningEnrollment(organizationId, lookupId ?? 0, {
    query: { queryKey: getGetLearningEnrollmentQueryKey(organizationId, lookupId ?? 0), enabled: organizationId > 0 && lookupId != null },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Look Up an Enrollment</CardTitle>
        <CardDescription>For a session you instruct outside your own direct reports.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enrollment ID"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            data-testid="input-lookup-enrollment-id"
          />
          <Button
            variant="outline"
            onClick={() => setLookupId(lookupInput ? Number(lookupInput) : null)}
            disabled={!lookupInput}
            data-testid="button-lookup-enrollment"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Look Up
          </Button>
        </div>
        {lookupId != null && (
          enrollmentQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : enrollmentQuery.error ? (
            <QueryError title="Could not find this enrollment" onRetry={() => enrollmentQuery.refetch()} />
          ) : enrollmentQuery.data ? (
            <TeamEnrollmentRow
              organizationId={organizationId}
              enrollment={enrollmentQuery.data}
              employeeName={`Employee #${enrollmentQuery.data.employeeId}`}
              myEmployeeId={myEmployeeId}
              onChanged={() => enrollmentQuery.refetch()}
            />
          ) : null
        )}
      </CardContent>
    </Card>
  );
}

// My Team Training (W89): a dedicated manager/instructor-facing page,
// mirroring performance-team.tsx's own established shape (/performance-
// team) — nav-gated isHrCapable (same platform-wide convention), backend
// authorization (manager-of-record via managerEmployeeIdSnapshot,
// instructor-of-record via the session's own live instructorEmployeeId)
// remains the actual source of truth regardless of nav visibility. No
// certificate/evidence/HR-workspace/dashboard controls exist here — those
// are W90/W91/W92's own surfaces.
export default function LearningTeamTraining() {
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myEmployeeResponse } = useGetMyEmployee({ query: { queryKey: getGetMyEmployeeQueryKey(), enabled: !!user } });
  const myEmployeeId = myEmployeeResponse?.employee?.id ?? null;

  const teamQuery = useListTeamLearningEnrollments(organizationId, {
    query: { queryKey: getListTeamLearningEnrollmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const coursesQuery = useListLearningCourses(organizationId, {
    query: { queryKey: getListLearningCoursesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const employeeById = new Map((employeesPage?.items ?? []).map((e) => [e.id, e]));
  const directReports = (employeesPage?.items ?? []).filter((e) => e.reportingManagerId === myEmployeeId);
  const activeCourses = (coursesQuery.data ?? []).filter((c) => c.status === 'active');

  const enrollments = teamQuery.data ?? [];
  const pending = enrollments.filter((e) => e.approvalStatus === 'pending');
  // Excludes pending rows — they're already shown in the Pending Approvals
  // card above; showing the same enrollment id in both would duplicate it
  // in the DOM (and its data-testid) for no benefit, not just a display
  // choice.
  const nonPending = enrollments.filter((e) => e.approvalStatus !== 'pending');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTeamLearningEnrollmentsQueryKey(organizationId) });

  if (teamQuery.isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (teamQuery.error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load your team's training" onRetry={() => teamQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" aria-hidden="true" />
            My Team Training
          </h1>
          <p className="text-muted-foreground">Training for your direct reports, and sessions you instruct</p>
        </div>
        <AssignTrainingDialog organizationId={organizationId} activeCourses={activeCourses} directReports={directReports} onAssigned={invalidate} />
      </div>

      {pending.length > 0 && (
        <Card data-testid="card-pending-approvals">
          <CardHeader>
            <CardTitle className="text-base">Pending Approvals</CardTitle>
            <CardDescription>Requests from your direct reports awaiting your decision.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map((e) => (
              <TeamEnrollmentRow
                key={e.id}
                organizationId={organizationId}
                enrollment={e}
                employeeName={employeeById.get(e.employeeId) ? `${employeeById.get(e.employeeId)!.firstName} ${employeeById.get(e.employeeId)!.lastName}` : `Employee #${e.employeeId}`}
                myEmployeeId={myEmployeeId}
                onChanged={invalidate}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Team's Training</CardTitle>
          <CardDescription>Every enrollment where you are the manager of record.</CardDescription>
        </CardHeader>
        <CardContent>
          {enrollments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No team training yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">None of your direct reports have any Learning enrollments right now.</p>
            </div>
          ) : nonPending.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every enrollment is awaiting your decision above.</p>
          ) : (
            <div className="space-y-3">
              {nonPending.map((e) => (
                <TeamEnrollmentRow
                  key={e.id}
                  organizationId={organizationId}
                  enrollment={e}
                  employeeName={employeeById.get(e.employeeId) ? `${employeeById.get(e.employeeId)!.firstName} ${employeeById.get(e.employeeId)!.lastName}` : `Employee #${e.employeeId}`}
                  myEmployeeId={myEmployeeId}
                  onChanged={invalidate}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <InstructorLookupPanel organizationId={organizationId} myEmployeeId={myEmployeeId} />
    </div>
  );
}
