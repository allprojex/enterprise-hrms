import { useState } from 'react';
import { ClipboardList, ChevronLeft, ChevronRight, Check, X, UserPlus, ShieldOff, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { LearningEvidenceSection } from '@/components/learning-evidence';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListLearningEnrollments,
  getListLearningEnrollmentsQueryKey,
  useApproveLearningEnrollment,
  useRejectLearningEnrollment,
  useCancelLearningEnrollment,
  useMarkLearningEnrollmentAttendance,
  useCompleteLearningEnrollment,
  useAssignLearningEnrollments,
  useListLearningCertificates,
  getListLearningCertificatesQueryKey,
  useRevokeLearningCertificate,
  useListLearningCourses,
  getListLearningCoursesQueryKey,
  useListLearningCourseSessions,
  getListLearningCourseSessionsQueryKey,
  useListEmployees,
  getListEmployeesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  ListLearningEnrollmentsStatus,
  ListLearningEnrollmentsApprovalStatus,
  ListLearningCertificatesStatus,
  AssignLearningEnrollmentsInputScope,
  type LearningEnrollment,
  type LearningCertificate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const ALL = '__all__';
const PAGE_SIZE = 20;

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
const ORIGIN_LABEL: Record<string, string> = {
  hr_assigned: 'HR Assigned',
  manager_assigned: 'Manager Assigned',
  employee_requested: 'Employee Requested',
};

// Terminal enrollment states (§ frozen enrollment model — no reopen
// workflow exists anywhere in Learning). Administrative correction actions
// (cancel/attendance/complete) never render once an enrollment has reached
// one of these; retraining means a brand-new enrollment row, not reviving
// this one.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function isCertificateExpired(cert: LearningCertificate): boolean {
  return cert.status === 'active' && cert.expiresAt != null && new Date(cert.expiresAt) < new Date();
}

/**
 * Administrative correction actions for a single enrollment row — cancel
 * (with a mandatory reason, since the caller is never the enrollment's own
 * employee here), attendance correction, and completion override. Every
 * one of these calls the exact same W87/W89 route an employee/manager/
 * instructor would call; isOrgWide is derived server-side from the
 * caller's own learning.manage permission, not from anything this
 * component sends. No second completion/approval engine is implemented
 * here.
 */
function EnrollmentActions({
  organizationId,
  enrollment,
  onChanged,
}: {
  organizationId: number;
  enrollment: LearningEnrollment;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const approveMutation = useApproveLearningEnrollment();
  const rejectMutation = useRejectLearningEnrollment();
  const attendanceMutation = useMarkLearningEnrollmentAttendance();
  const completeMutation = useCompleteLearningEnrollment();
  const cancelMutation = useCancelLearningEnrollment();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [passed, setPassed] = useState<'true' | 'false' | ''>('');

  const isTerminal = TERMINAL_STATUSES.has(enrollment.status);
  const canCorrectAttendance = !isTerminal && enrollment.deliveryModeSnapshot === 'instructor_led' && enrollment.sessionId != null;
  const canComplete = !isTerminal && (enrollment.approvalStatus === 'auto_approved' || enrollment.approvalStatus === 'approved');

  const handleCancel = () => {
    if (!cancelReason.trim()) return;
    cancelMutation.mutate(
      { organizationId, id: enrollment.id, data: { cancelReason: cancelReason.trim() } },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason('');
          onChanged();
          toast({ title: 'Enrollment cancelled' });
        },
        onError: (err) => toast({ title: 'Could not cancel this enrollment', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleComplete = () => {
    const data = enrollment.hasAssessmentSnapshot ? { passed: passed === 'true' } : undefined;
    if (enrollment.hasAssessmentSnapshot && passed === '') return;
    completeMutation.mutate(
      { organizationId, id: enrollment.id, data },
      {
        onSuccess: () => { setPassed(''); onChanged(); toast({ title: 'Enrollment completed' }); },
        onError: (err) => toast({ title: 'Could not complete this enrollment', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`enrollment-actions-${enrollment.id}`}>
      {enrollment.approvalStatus === 'pending' && (
        <>
          <Button
            size="sm"
            onClick={() => approveMutation.mutate({ organizationId, id: enrollment.id }, { onSuccess: () => { onChanged(); toast({ title: 'Approved' }); }, onError: (err) => toast({ title: 'Could not approve', description: errorMessage(err), variant: 'destructive' }) })}
            disabled={approveMutation.isPending || rejectMutation.isPending}
            data-testid={`button-approve-${enrollment.id}`}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rejectMutation.mutate({ organizationId, id: enrollment.id }, { onSuccess: () => { onChanged(); toast({ title: 'Rejected' }); }, onError: (err) => toast({ title: 'Could not reject', description: errorMessage(err), variant: 'destructive' }) })}
            disabled={approveMutation.isPending || rejectMutation.isPending}
            data-testid={`button-reject-${enrollment.id}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Reject
          </Button>
        </>
      )}

      {canCorrectAttendance && enrollment.attended == null && (
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

      {canComplete && (
        <>
          {enrollment.hasAssessmentSnapshot && (
            <Select value={passed} onValueChange={(v) => setPassed(v as 'true' | 'false')}>
              <SelectTrigger className="w-28 h-8" data-testid={`select-passed-${enrollment.id}`}>
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
            variant="outline"
            onClick={handleComplete}
            disabled={completeMutation.isPending || (enrollment.hasAssessmentSnapshot && passed === '')}
            data-testid={`button-complete-${enrollment.id}`}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Complete
          </Button>
        </>
      )}

      {!isTerminal && (
        <Dialog open={cancelOpen} onOpenChange={(o) => { setCancelOpen(o); if (!o) setCancelReason(''); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive" data-testid={`button-open-cancel-${enrollment.id}`}>
              Cancel…
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel Enrollment</DialogTitle>
              <DialogDescription>An administrative cancellation requires a reason and is recorded on the enrollment.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor={`cancel-reason-${enrollment.id}`}>Reason (required)</Label>
              <Textarea id={`cancel-reason-${enrollment.id}`} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} data-testid={`textarea-cancel-reason-${enrollment.id}`} />
            </div>
            <DialogFooter>
              <Button onClick={handleCancel} disabled={cancelMutation.isPending || !cancelReason.trim()} data-testid={`button-confirm-cancel-${enrollment.id}`}>
                {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancel'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Org-wide bulk-assign — the HR/L&D counterpart to My Team Training's own
 * manager-scoped "Assign Training" dialog (which is restricted server-side
 * to scope='manual' + direct reports only). This dialog exposes the full
 * audience-targeting scope set (all_active/department/position/manual)
 * that assignEnrollments already supports for an isOrgWide caller — no new
 * assignment logic, just the full scope surface a learning.manage caller
 * is already entitled to.
 */
function BulkAssignDialog({
  organizationId,
  onAssigned,
}: {
  organizationId: number;
  onAssigned: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [scope, setScope] = useState<AssignLearningEnrollmentsInputScope>(AssignLearningEnrollmentsInputScope.all_active);
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const [mandatory, setMandatory] = useState(false);
  const [dueDate, setDueDate] = useState('');

  const coursesQuery = useListLearningCourses(organizationId, {
    query: { queryKey: getListLearningCoursesQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const activeCourses = (coursesQuery.data ?? []).filter((c) => c.status === 'active');
  const selectedCourse = activeCourses.find((c) => String(c.id) === courseId);
  const requiresSession = selectedCourse?.deliveryMode === 'instructor_led';

  const sessionsQuery = useListLearningCourseSessions(organizationId, selectedCourse?.id ?? 0, {
    query: { queryKey: getListLearningCourseSessionsQueryKey(organizationId, selectedCourse?.id ?? 0), enabled: organizationId > 0 && open && requiresSession && selectedCourse != null },
  });
  const scheduledSessions = (sessionsQuery.data ?? []).filter((s) => s.status === 'scheduled');

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: positions } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 && open },
  });
  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 && open },
  });
  const employees = employeesPage?.items ?? [];

  const assignMutation = useAssignLearningEnrollments();

  const reset = () => {
    setCourseId('');
    setSessionId('');
    setScope(AssignLearningEnrollmentsInputScope.all_active);
    setDepartmentId('');
    setPositionId('');
    setEmployeeIds([]);
    setMandatory(false);
    setDueDate('');
  };

  const isValid =
    !!courseId &&
    (!requiresSession || !!sessionId) &&
    (scope !== 'department' || !!departmentId) &&
    (scope !== 'position' || !!positionId) &&
    (scope !== 'manual' || employeeIds.length > 0);

  const handleAssign = () => {
    if (!isValid) return;
    assignMutation.mutate(
      {
        organizationId,
        id: Number(courseId),
        data: {
          sessionId: requiresSession ? Number(sessionId) : undefined,
          scope,
          departmentId: scope === 'department' ? Number(departmentId) : undefined,
          positionId: scope === 'position' ? Number(positionId) : undefined,
          employeeIds: scope === 'manual' ? employeeIds : undefined,
          mandatory,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        },
      },
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
        <Button data-testid="button-bulk-assign">
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Bulk Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Assign Training</DialogTitle>
          <DialogDescription>Organization-wide audience targeting. Mirrors the same assignment engine used everywhere else in Learning.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="bulk-assign-course">Course *</Label>
            <Select value={courseId} onValueChange={(v) => { setCourseId(v); setSessionId(''); }}>
              <SelectTrigger id="bulk-assign-course" data-testid="select-bulk-assign-course">
                <SelectValue placeholder="Choose a course" />
              </SelectTrigger>
              <SelectContent>
                {activeCourses.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {requiresSession && (
            <div className="space-y-2">
              <Label htmlFor="bulk-assign-session">Session *</Label>
              <Select value={sessionId} onValueChange={setSessionId}>
                <SelectTrigger id="bulk-assign-session" data-testid="select-bulk-assign-session">
                  <SelectValue placeholder={scheduledSessions.length === 0 ? 'No scheduled sessions' : 'Choose a session'} />
                </SelectTrigger>
                <SelectContent>
                  {scheduledSessions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{new Date(s.scheduledAt).toLocaleString()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="bulk-assign-scope">Audience</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as AssignLearningEnrollmentsInputScope)}>
              <SelectTrigger id="bulk-assign-scope" data-testid="select-bulk-assign-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active">All active employees</SelectItem>
                <SelectItem value="department">A department</SelectItem>
                <SelectItem value="position">A position</SelectItem>
                <SelectItem value="manual">Specific employees</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === 'department' && (
            <div className="space-y-2">
              <Label htmlFor="bulk-assign-department">Department *</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="bulk-assign-department" data-testid="select-bulk-assign-department">
                  <SelectValue placeholder="Choose a department" />
                </SelectTrigger>
                <SelectContent>
                  {(departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {scope === 'position' && (
            <div className="space-y-2">
              <Label htmlFor="bulk-assign-position">Position *</Label>
              <Select value={positionId} onValueChange={setPositionId}>
                <SelectTrigger id="bulk-assign-position" data-testid="select-bulk-assign-position">
                  <SelectValue placeholder="Choose a position" />
                </SelectTrigger>
                <SelectContent>
                  {(positions ?? []).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {scope === 'manual' && (
            <div className="space-y-2">
              <Label>Employees *</Label>
              <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
                {employees.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`bulk-assign-employee-${e.id}`}
                      checked={employeeIds.includes(e.id)}
                      onCheckedChange={(v) => setEmployeeIds((prev) => (v === true ? [...prev, e.id] : prev.filter((id) => id !== e.id)))}
                      data-testid={`checkbox-bulk-assign-employee-${e.id}`}
                    />
                    <Label htmlFor={`bulk-assign-employee-${e.id}`} className="font-normal">{e.firstName} {e.lastName}</Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox id="bulk-assign-mandatory" checked={mandatory} onCheckedChange={(v) => setMandatory(v === true)} data-testid="checkbox-bulk-assign-mandatory" />
            <Label htmlFor="bulk-assign-mandatory" className="font-normal">Mandatory</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-assign-due-date">Due date (optional)</Label>
            <Input id="bulk-assign-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-bulk-assign-due-date" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleAssign} disabled={assignMutation.isPending || !isValid} data-testid="button-submit-bulk-assign">
            {assignMutation.isPending ? 'Assigning…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeCertificateDialog({
  organizationId,
  certificate,
  onRevoked,
}: {
  organizationId: number;
  certificate: LearningCertificate;
  onRevoked: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const revokeMutation = useRevokeLearningCertificate();

  const handleRevoke = () => {
    if (!reason.trim()) return;
    revokeMutation.mutate(
      { organizationId, id: certificate.id, data: { revokeReason: reason.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          onRevoked();
          toast({ title: 'Certificate revoked' });
        },
        onError: (err) => toast({ title: 'Could not revoke this certificate', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive" data-testid={`button-open-revoke-${certificate.id}`}>
          <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
          Revoke…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke Certificate</DialogTitle>
          <DialogDescription>This is permanent — there is no un-revoke action. Retraining requires a new enrollment.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor={`revoke-reason-${certificate.id}`}>Reason (required)</Label>
          <Textarea id={`revoke-reason-${certificate.id}`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`textarea-revoke-reason-${certificate.id}`} />
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handleRevoke} disabled={revokeMutation.isPending || !reason.trim()} data-testid={`button-confirm-revoke-${certificate.id}`}>
            {revokeMutation.isPending ? 'Revoking…' : 'Confirm Revoke'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Internal HR/L&D Workspace (W91): an operational read/action surface over
// the Learning capabilities already delivered in W85-W90 — org-wide
// enrollment list + approval queue + administrative corrections (W87/W89's
// own routes), bulk-assign (W87's own assignEnrollments, full audience
// scope), and certificate administration (W90's own routes). Deliberately
// not a second business-rules engine: every mutation here calls the exact
// same route an employee/manager/instructor would call, with isOrgWide
// server-derived from the caller's own learning.manage permission.
//
// Course/session administration (the other half of §15's frozen internal-
// workspace bullet) is not duplicated here — it already shipped as part of
// /learning-courses in W86 (including the SessionsPanel nested in that
// page's own course-detail dialog), which is exactly the "if not already
// built there" case §29's own W91 scope entry anticipates. A second
// /learning-sessions route would only duplicate that page.
export default function LearningEnrollments() {
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = currentOrg?.roles.some((r) => r === 'org_admin' || r === 'hr_manager' || r === 'super_admin') ?? false;

  const { data: employeesPage } = useListEmployees(organizationId, { pageSize: 200 }, {
    query: { queryKey: getListEmployeesQueryKey(organizationId, { pageSize: 200 }), enabled: organizationId > 0 },
  });
  const employeeById = new Map((employeesPage?.items ?? []).map((e) => [e.id, e]));
  const employeeLabel = (id: number | null | undefined) => {
    if (id == null) return '—';
    const e = employeeById.get(id);
    return e ? `${e.firstName} ${e.lastName}` : `Employee #${id}`;
  };

  const { data: courses } = useListLearningCourses(organizationId, {
    query: { queryKey: getListLearningCoursesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  // --- Enrollments tab ---
  const [courseFilter, setCourseFilter] = useState(ALL);
  const [employeeFilter, setEmployeeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [approvalFilter, setApprovalFilter] = useState(ALL);
  const [enrollmentsPage, setEnrollmentsPage] = useState(1);

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setEnrollmentsPage(1);
    setter(v);
  };

  const enrollmentsParams = {
    courseId: courseFilter === ALL ? undefined : Number(courseFilter),
    employeeId: employeeFilter === ALL ? undefined : Number(employeeFilter),
    status: statusFilter === ALL ? undefined : (statusFilter as ListLearningEnrollmentsStatus),
    approvalStatus: approvalFilter === ALL ? undefined : (approvalFilter as ListLearningEnrollmentsApprovalStatus),
    page: enrollmentsPage,
    pageSize: PAGE_SIZE,
  };

  const enrollmentsQuery = useListLearningEnrollments(organizationId, enrollmentsParams, {
    query: { queryKey: getListLearningEnrollmentsQueryKey(organizationId, enrollmentsParams), enabled: organizationId > 0 },
  });
  const enrollments = enrollmentsQuery.data?.items ?? [];
  const enrollmentsTotal = enrollmentsQuery.data?.total ?? 0;
  const enrollmentsTotalPages = Math.max(1, Math.ceil(enrollmentsTotal / PAGE_SIZE));

  const invalidateEnrollments = () => enrollmentsQuery.refetch();

  const [detailEnrollmentId, setDetailEnrollmentId] = useState<number | null>(null);
  const detailEnrollment = enrollments.find((e) => e.id === detailEnrollmentId) ?? null;

  // --- Certificates tab ---
  const [certEmployeeFilter, setCertEmployeeFilter] = useState(ALL);
  const [certStatusFilter, setCertStatusFilter] = useState(ALL);
  const [certPage, setCertPage] = useState(1);

  const certParams = {
    employeeId: certEmployeeFilter === ALL ? undefined : Number(certEmployeeFilter),
    status: certStatusFilter === ALL ? undefined : (certStatusFilter as ListLearningCertificatesStatus),
    page: certPage,
    pageSize: PAGE_SIZE,
  };

  const certificatesQuery = useListLearningCertificates(organizationId, certParams, {
    query: { queryKey: getListLearningCertificatesQueryKey(organizationId, certParams), enabled: organizationId > 0 },
  });
  const certificates = certificatesQuery.data?.items ?? [];
  const certTotal = certificatesQuery.data?.total ?? 0;
  const certTotalPages = Math.max(1, Math.ceil(certTotal / PAGE_SIZE));

  if (!isHrCapable) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Not authorized" message="This workspace is for HR/L&D administrators only." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-primary" aria-hidden="true" />
            Learning Enrollments
          </h1>
          <p className="text-muted-foreground">Organization-wide enrollment administration, approval queue, and certificate management.</p>
        </div>
        <BulkAssignDialog organizationId={organizationId} onAssigned={invalidateEnrollments} />
      </div>

      <Tabs defaultValue="enrollments">
        <TabsList>
          <TabsTrigger value="enrollments" data-testid="tab-enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="certificates" data-testid="tab-certificates">Certificates</TabsTrigger>
        </TabsList>

        <TabsContent value="enrollments" className="space-y-6 pt-4">
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="filter-course">Course</Label>
                  <Select value={courseFilter} onValueChange={resetToFirstPage(setCourseFilter)}>
                    <SelectTrigger id="filter-course" data-testid="select-filter-course">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All courses</SelectItem>
                      {(courses ?? []).map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="filter-employee">Employee</Label>
                  <Select value={employeeFilter} onValueChange={resetToFirstPage(setEmployeeFilter)}>
                    <SelectTrigger id="filter-employee" data-testid="select-filter-employee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All employees</SelectItem>
                      {(employeesPage?.items ?? []).map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="filter-status">Status</Label>
                  <Select value={statusFilter} onValueChange={resetToFirstPage(setStatusFilter)}>
                    <SelectTrigger id="filter-status" data-testid="select-filter-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {Object.entries(STATUS_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="filter-approval">Approval</Label>
                  <Select value={approvalFilter} onValueChange={resetToFirstPage(setApprovalFilter)}>
                    <SelectTrigger id="filter-approval" data-testid="select-filter-approval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All approval states</SelectItem>
                      <SelectItem value="pending">Pending Approval</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="auto_approved">Auto-Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {enrollmentsQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : enrollmentsQuery.error ? (
            <QueryError title="Could not load enrollments" onRetry={() => enrollmentsQuery.refetch()} />
          ) : enrollments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <ClipboardList className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No enrollments found</h3>
                <p className="text-sm text-muted-foreground max-w-sm">No enrollments match the current filters.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table aria-label="Learning enrollments">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Origin</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.map((e) => (
                    <TableRow key={e.id} data-testid={`row-enrollment-${e.id}`}>
                      <TableCell className="font-medium">{employeeLabel(e.employeeId)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.courseTitleSnapshot}
                        {e.mandatoryAtAssignment && <Badge variant="outline" className="ml-2">Mandatory</Badge>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ORIGIN_LABEL[e.originType] ?? e.originType}</TableCell>
                      <TableCell>
                        <Badge variant={APPROVAL_VARIANT[e.approvalStatus]}>{APPROVAL_LABEL[e.approvalStatus] ?? e.approvalStatus}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status] ?? e.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.dueDate ? new Date(e.dueDate).toLocaleDateString() : '—'}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setDetailEnrollmentId(e.id)} data-testid={`button-view-enrollment-${e.id}`}>
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {enrollmentsTotalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {enrollmentsPage} of {enrollmentsTotalPages} ({enrollmentsTotal} enrollment{enrollmentsTotal === 1 ? '' : 's'})
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={enrollmentsPage <= 1} onClick={() => setEnrollmentsPage((p) => Math.max(1, p - 1))} data-testid="button-enrollments-prev-page">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={enrollmentsPage >= enrollmentsTotalPages} onClick={() => setEnrollmentsPage((p) => Math.min(enrollmentsTotalPages, p + 1))} data-testid="button-enrollments-next-page">
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="certificates" className="space-y-6 pt-4">
          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="filter-cert-employee">Employee</Label>
                  <Select value={certEmployeeFilter} onValueChange={(v) => { setCertPage(1); setCertEmployeeFilter(v); }}>
                    <SelectTrigger id="filter-cert-employee" data-testid="select-filter-cert-employee">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All employees</SelectItem>
                      {(employeesPage?.items ?? []).map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="filter-cert-status">Status</Label>
                  <Select value={certStatusFilter} onValueChange={(v) => { setCertPage(1); setCertStatusFilter(v); }}>
                    <SelectTrigger id="filter-cert-status" data-testid="select-filter-cert-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="revoked">Revoked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {certificatesQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : certificatesQuery.error ? (
            <QueryError title="Could not load certificates" onRetry={() => certificatesQuery.refetch()} />
          ) : certificates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <ClipboardList className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No certificates found</h3>
                <p className="text-sm text-muted-foreground max-w-sm">No certificates match the current filters.</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table aria-label="Learning certificates">
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certificates.map((cert) => (
                    <TableRow key={cert.id} data-testid={`row-certificate-${cert.id}`}>
                      <TableCell className="font-medium">{employeeLabel(cert.employeeId)}</TableCell>
                      <TableCell className="text-muted-foreground">{cert.courseTitleSnapshot}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(cert.issuedAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-muted-foreground">{cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : 'Never'}</TableCell>
                      <TableCell>
                        {cert.status === 'revoked' ? (
                          <Badge variant="destructive">Revoked</Badge>
                        ) : isCertificateExpired(cert) ? (
                          <Badge variant="outline">Expired</Badge>
                        ) : (
                          <Badge variant="secondary">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {cert.status === 'active' && (
                          <RevokeCertificateDialog organizationId={organizationId} certificate={cert} onRevoked={() => certificatesQuery.refetch()} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {certTotalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {certPage} of {certTotalPages} ({certTotal} certificate{certTotal === 1 ? '' : 's'})
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={certPage <= 1} onClick={() => setCertPage((p) => Math.max(1, p - 1))} data-testid="button-certificates-prev-page">
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={certPage >= certTotalPages} onClick={() => setCertPage((p) => Math.min(certTotalPages, p + 1))} data-testid="button-certificates-next-page">
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={detailEnrollmentId !== null} onOpenChange={(open) => !open && setDetailEnrollmentId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Enrollment Detail</DialogTitle>
            <DialogDescription>Historical context is shown from the enrollment's own snapshot, taken at assignment — it does not follow later catalog or org-structure changes.</DialogDescription>
          </DialogHeader>
          {detailEnrollment && (
            <div className="space-y-6 py-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium" data-testid="text-detail-employee">{employeeLabel(detailEnrollment.employeeId)}</p>
                  <div className="flex gap-2">
                    <Badge variant={APPROVAL_VARIANT[detailEnrollment.approvalStatus]}>{APPROVAL_LABEL[detailEnrollment.approvalStatus] ?? detailEnrollment.approvalStatus}</Badge>
                    <Badge variant={STATUS_VARIANT[detailEnrollment.status]} data-testid="text-detail-status">{STATUS_LABEL[detailEnrollment.status] ?? detailEnrollment.status}</Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {detailEnrollment.courseTitleSnapshot} · {detailEnrollment.categorySnapshot} · {detailEnrollment.deliveryModeSnapshot.replace('_', ' ')}
                </p>
                <p className="text-sm text-muted-foreground">
                  Origin: {ORIGIN_LABEL[detailEnrollment.originType] ?? detailEnrollment.originType} · Manager of record (at assignment): {employeeLabel(detailEnrollment.managerEmployeeIdSnapshot)}
                </p>
                {detailEnrollment.cancelReason && <p className="text-sm text-muted-foreground">Cancel reason: {detailEnrollment.cancelReason}</p>}
                {detailEnrollment.passed != null && <p className="text-sm text-muted-foreground">Result: {detailEnrollment.passed ? 'Passed' : 'Failed'}{detailEnrollment.score != null ? ` (score ${detailEnrollment.score})` : ''}</p>}
              </div>

              <EnrollmentActions organizationId={organizationId} enrollment={detailEnrollment} onChanged={invalidateEnrollments} />

              <LearningEvidenceSection organizationId={organizationId} enrollmentId={detailEnrollment.id} canUpload={isHrCapable} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
