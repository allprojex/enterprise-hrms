import { useState, useEffect } from 'react';
import { UserCircle, FileText, CalendarClock, Briefcase, Send, Clock, LogIn, LogOut, Plus, Target, CheckCircle2, GraduationCap, PlayCircle, XCircle, Boxes, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { PerformanceEvidenceSection } from '@/components/performance-evidence';
import { LearningEvidenceSection } from '@/components/learning-evidence';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetMyEmployee,
  getGetMyEmployeeQueryKey,
  useListOrganizationModules,
  getListOrganizationModulesQueryKey,
  useListEmployeeDocuments,
  getListEmployeeDocumentsQueryKey,
  useListMyInternalVacancies,
  getListMyInternalVacanciesQueryKey,
  useApplyToInternalVacancy,
  useListMyInternalApplications,
  getListMyInternalApplicationsQueryKey,
  useRecordAttendanceEvent,
  useListAttendanceEvents,
  getListAttendanceEventsQueryKey,
  useGetAttendanceDailySummary,
  getGetAttendanceDailySummaryQueryKey,
  useRecordAttendanceAdjustment,
  RecordAttendanceAdjustmentInputAdjustmentType,
  useListMyPerformanceReviews,
  getListMyPerformanceReviewsQueryKey,
  useGetPerformanceReview,
  getGetPerformanceReviewQueryKey,
  useGetPerformanceRatingScale,
  getGetPerformanceRatingScaleQueryKey,
  useRateCompetency,
  useCreatePerformanceReviewGoal,
  useUpdatePerformanceReviewGoal,
  useSubmitSelfAssessment,
  useAcknowledgePerformanceReview,
  CreatePerformanceReviewGoalInputMeasurementType,
  useListLearningCourses,
  getListLearningCoursesQueryKey,
  useListLearningCourseSessions,
  getListLearningCourseSessionsQueryKey,
  useGetLearningCourseSession,
  getGetLearningCourseSessionQueryKey,
  useListMyLearningEnrollments,
  getListMyLearningEnrollmentsQueryKey,
  useRequestLearningEnrollment,
  useAdvanceLearningEnrollmentProgress,
  useCancelLearningEnrollment,
  useListMyLearningCertificates,
  getListMyLearningCertificatesQueryKey,
  useListMyAssetAssignments,
  getListMyAssetAssignmentsQueryKey,
  useAcknowledgeAssetAssignment,
  useReportAssetIssue,
  useGetMyEmploymentHistory,
  getGetMyEmploymentHistoryQueryKey,
  useGetMySkills,
  getGetMySkillsQueryKey,
  useGetMyQualifications,
  getGetMyQualificationsQueryKey,
  useGetMyCertifications,
  getGetMyCertificationsQueryKey,
  type SelfServiceEmployeeProfile,
  type InternalVacancySummary,
  type DailyAttendanceSummary,
  type PerformanceReviewCompetency,
  type PerformanceRatingScaleLevel,
  type PerformanceGoal,
  type PerformanceReview,
  type LearningCourse,
  type LearningEnrollment,
  type LearningCertificate,
  type AssetAssignment,
  type EmploymentPeriodSummary,
  type SelfServiceSkill,
  type SelfServiceQualification,
  type SelfServiceCertification,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryError } from '@/components/query-error';
import { isModuleAccessible } from '@/lib/module-access';
import { useToast } from '@/hooks/use-toast';
import MyLeave from './my-leave';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

function formatDate(value: string | null | undefined): string | null {
  return value ? new Date(value).toLocaleDateString() : null;
}

function ProfileField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value ?? '—'}</p>
    </div>
  );
}

// Read-only by design (W39) — Employee Self-Service never edits core
// employee fields; every value here is display-only.
function MyProfileTab({ employee }: { employee: SelfServiceEmployeeProfile }) {
  const address = employee.residentialAddress as { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string } | null;
  const addressLine = address
    ? [address.line1, address.line2, address.city, address.state, address.postalCode, address.country].filter(Boolean).join(', ')
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ProfileField label="Employee Number" value={employee.employeeNumber} />
          <ProfileField label="Full Name" value={[employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ')} />
          <ProfileField label="Preferred Name" value={employee.preferredName} />
          <ProfileField label="Gender" value={employee.gender} />
          <ProfileField label="Date of Birth" value={formatDate(employee.dateOfBirth)} />
          <ProfileField label="Marital Status" value={employee.maritalStatus} />
          <ProfileField label="Nationality" value={employee.nationality} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ProfileField label="Work Email" value={employee.workEmail} />
          <ProfileField label="Personal Email" value={employee.personalEmail} />
          <ProfileField label="Phone" value={employee.phoneNumber} />
          <ProfileField label="Alternate Phone" value={employee.alternatePhoneNumber} />
          <ProfileField label="Address" value={addressLine} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ProfileField label="Department" value={employee.departmentName} />
          <ProfileField label="Branch" value={employee.branchName} />
          <ProfileField label="Position" value={employee.positionName} />
          <ProfileField label="Reporting Manager" value={employee.reportingManagerName} />
          <ProfileField label="Employment Type" value={employee.employmentType} />
          <ProfileField label="Hire Date" value={formatDate(employee.hireDate)} />
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge variant={employee.employmentStatus === 'active' ? 'secondary' : 'outline'} className="capitalize">
              {employee.employmentStatus.replace('_', ' ')}
            </Badge>
          </div>
          <ProfileField label="Work Location" value={employee.workLocation} />
          {employee.separationDate && <ProfileField label="Separation Date" value={formatDate(employee.separationDate)} />}
          {employee.separationReason && <ProfileField label="Separation Reason" value={employee.separationReason} />}
        </CardContent>
      </Card>
    </div>
  );
}

// Read-only list — reuses W23's existing employee-document self-access
// capability unchanged; no upload/delete affordance here.
function MyDocumentsTab({ organizationId, employeeId }: { organizationId: number; employeeId: number }) {
  const {
    data: documents,
    isLoading,
    error,
    refetch,
  } = useListEmployeeDocuments(organizationId, employeeId, {
    query: {
      queryKey: getListEmployeeDocumentsQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && employeeId > 0,
    },
  });

  if (error) return <QueryError title="Could not load your documents" onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (!documents || documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No documents on file</h3>
          <p className="text-sm text-muted-foreground max-w-sm">Documents your organisation has on file for you will appear here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <ul className="divide-y divide-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-my-document-${doc.id}`}>
              <div>
                <p className="text-sm font-medium text-foreground">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.categoryCode} · {new Date(doc.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Badge variant="outline">{doc.mimeType}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Career Profile (Phase 3F, W106): read-only aggregation of the employee's own
// employment history, skills, qualifications, and external certifications —
// closes the long-deferred W39 roadmap item. Ungated by any additional
// module, same precedent as My Profile/My Documents above — every entity
// here is Core HR data, not tied to any Phase 3 module. No employee
// create/edit/delete/upload control exists anywhere in this section, by
// design (Owner Decision 1) — HR remains the sole writer via the existing,
// unchanged employee-detail.tsx CRUD. Certifications deliberately reads only
// employee_certifications — Learning's own system-issued certificates stay
// exclusively in the My Learning tab above, never duplicated here (Learning's
// own frozen Owner Decision 3).
// -----------------------------------------------------------------------------

function EmploymentHistorySection({ organizationId }: { organizationId: number }) {
  const { data, isLoading, isError, refetch } = useGetMyEmploymentHistory({
    query: { queryKey: getGetMyEmploymentHistoryQueryKey(), enabled: organizationId > 0 },
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="loading-my-employment-history">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (isError) {
    return <QueryError title="Failed to load your employment history" onRetry={() => refetch()} />;
  }

  const items: EmploymentPeriodSummary[] = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-my-employment-history">
        No employment history recorded yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="list-my-employment-history">
      {items.map((period) => (
        <li key={period.id} className="py-3" data-testid={`row-my-employment-history-${period.id}`}>
          <div className="flex items-center justify-between gap-4">
            <Badge variant="outline" className="capitalize">
              {period.eventType}
            </Badge>
            <span className="text-xs text-muted-foreground">{formatDate(period.effectiveDate)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SkillsSection({ organizationId }: { organizationId: number }) {
  const { data, isLoading, isError, refetch } = useGetMySkills({
    query: { queryKey: getGetMySkillsQueryKey(), enabled: organizationId > 0 },
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="loading-my-skills">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (isError) {
    return <QueryError title="Failed to load your skills" onRetry={() => refetch()} />;
  }

  const items: SelfServiceSkill[] = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-my-skills">
        No skills on record yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="list-my-skills">
      {items.map((skill) => (
        <li key={skill.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-my-skill-${skill.id}`}>
          <p className="text-sm font-medium text-foreground">{skill.skillCode}</p>
          {skill.proficiencyLevel && <Badge variant="outline">{skill.proficiencyLevel}</Badge>}
        </li>
      ))}
    </ul>
  );
}

function QualificationsSection({ organizationId }: { organizationId: number }) {
  const { data, isLoading, isError, refetch } = useGetMyQualifications({
    query: { queryKey: getGetMyQualificationsQueryKey(), enabled: organizationId > 0 },
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="loading-my-qualifications">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (isError) {
    return <QueryError title="Failed to load your qualifications" onRetry={() => refetch()} />;
  }

  const items: SelfServiceQualification[] = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-my-qualifications">
        No qualifications on record yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="list-my-qualifications">
      {items.map((qualification) => (
        <li key={qualification.id} className="py-3" data-testid={`row-my-qualification-${qualification.id}`}>
          <p className="text-sm font-medium text-foreground">{qualification.qualificationTypeCode}</p>
          {(qualification.institution || qualification.fieldOfStudy) && (
            <p className="text-xs text-muted-foreground">
              {[qualification.institution, qualification.fieldOfStudy].filter(Boolean).join(' · ')}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Expired" is never a value the API returns — mirrors My Learning's own
 * established isCertificateExpired precedent exactly: a pure, live,
 * client-side computation on top of expiryDate, recomputed on every render.
 */
function isEmployeeCertificationExpired(certification: SelfServiceCertification): boolean {
  return certification.expiryDate != null && new Date(certification.expiryDate) < new Date();
}

function CertificationsSection({ organizationId }: { organizationId: number }) {
  const { data, isLoading, isError, refetch } = useGetMyCertifications({
    query: { queryKey: getGetMyCertificationsQueryKey(), enabled: organizationId > 0 },
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="loading-my-certifications">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (isError) {
    return <QueryError title="Failed to load your certifications" onRetry={() => refetch()} />;
  }

  const items: SelfServiceCertification[] = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-my-certifications">
        No certifications on record yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="list-my-certifications">
      {items.map((certification) => {
        const expired = isEmployeeCertificationExpired(certification);
        return (
          <li key={certification.id} className="py-3" data-testid={`row-my-certification-${certification.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">{certification.certificationTypeCode}</p>
                {certification.issuingOrganization && (
                  <p className="text-xs text-muted-foreground">{certification.issuingOrganization}</p>
                )}
              </div>
              <Badge variant={expired ? 'outline' : 'secondary'} data-testid={`badge-my-certification-status-${certification.id}`}>
                {expired ? 'Expired' : 'Active'}
              </Badge>
            </div>
            {certification.expiryDate && (
              <p className="text-xs text-muted-foreground mt-1">Valid until {formatDate(certification.expiryDate)}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CareerProfileTab({ organizationId }: { organizationId: number }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Employment History</CardTitle>
          <CardDescription>Internal movement (transfer, promotion, confirmation) on your own record — read-only, most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmploymentHistorySection organizationId={organizationId} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>Skills your organisation has on file for you — read-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <SkillsSection organizationId={organizationId} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Qualifications</CardTitle>
          <CardDescription>Academic and professional qualifications on file — read-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <QualificationsSection organizationId={organizationId} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Certifications</CardTitle>
          <CardDescription>
            External and HR-maintained certifications on file — read-only. System-issued Learning certificates remain in the My Learning tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CertificationsSection organizationId={organizationId} />
        </CardContent>
      </Card>
    </div>
  );
}

const SUMMARY_STATUS_LABEL: Record<string, string> = {
  present: 'Present',
  late: 'Late',
  partial: 'Partial',
  absent: 'Absent',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  non_working_day: 'Non-Working Day',
};

const SUMMARY_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  present: 'secondary',
  late: 'outline',
  partial: 'outline',
  absent: 'destructive',
  on_leave: 'outline',
  holiday: 'outline',
  non_working_day: 'outline',
};

const ADJUSTMENT_TYPE_LABEL: Record<string, string> = {
  manual_clock_in: 'Correct my clock-in time',
  manual_clock_out: 'Correct my clock-out time',
  mark_present: 'Mark a day as present',
  mark_absent: 'Mark a day as absent',
  excuse_absence: 'Excuse an absence',
};

const EVENT_TYPE_LABEL: Record<string, string> = { clock_in: 'Clocked In', clock_out: 'Clocked Out' };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Last 7 organization-local-ish days ending today — a display-window choice
// only (which dates to ask the read-model about), never a computation of
// what those days' statuses actually are. The backend's civil-date
// derivation (W66) is authoritative regardless of this browser-local
// boundary being off by a day near midnight.
function recentRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function SummaryStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) {
    return <Badge variant="outline">Not Applicable</Badge>;
  }
  return (
    <Badge variant={SUMMARY_STATUS_VARIANT[status] ?? 'outline'} className="capitalize">
      {SUMMARY_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/**
 * Reuses W65 (clock events), W66 (daily summary read-model), and W67
 * (employee correction requests) exactly as they already exist — no new
 * backend route (W68's own frozen "Backend/API impact: none new"). No
 * request-history list is shown: the frozen plan's own W67 scope never
 * added a GET/list route for attendance_adjustments ("Backend/API impact:
 * the three routes above" is exhaustive), so a submitted request is
 * confirmed via toast, not rendered in a persisted list here — showing one
 * would mean inventing frontend-only data the backend can't actually back.
 */
function MyAttendanceTab({ organizationId, employeeId }: { organizationId: number; employeeId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { from, to } = recentRange();

  const eventsQuery = useListAttendanceEvents(organizationId, undefined, {
    query: { queryKey: getListAttendanceEventsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const summaryQuery = useGetAttendanceDailySummary(
    organizationId,
    employeeId,
    { from, to },
    {
      query: {
        queryKey: getGetAttendanceDailySummaryQueryKey(organizationId, employeeId, { from, to }),
        enabled: organizationId > 0 && employeeId > 0,
      },
    },
  );

  const clockMutation = useRecordAttendanceEvent();
  const requestMutation = useRecordAttendanceAdjustment();

  const [requestOpen, setRequestOpen] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<string>('');
  const [date, setDate] = useState('');
  const [correctedClockIn, setCorrectedClockIn] = useState('');
  const [correctedClockOut, setCorrectedClockOut] = useState('');
  const [reason, setReason] = useState('');

  const invalidateAttendance = () => {
    queryClient.invalidateQueries({ queryKey: getListAttendanceEventsQueryKey(organizationId) });
    queryClient.invalidateQueries({ queryKey: getGetAttendanceDailySummaryQueryKey(organizationId, employeeId, { from, to }) });
  };

  const handleClock = (eventType: 'clock_in' | 'clock_out') => {
    clockMutation.mutate(
      { organizationId, data: { eventType } },
      {
        onSuccess: () => {
          invalidateAttendance();
          toast({ title: eventType === 'clock_in' ? 'Clocked in' : 'Clocked out' });
        },
        onError: (err) => toast({ title: 'Could not record the clock event', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const resetRequestForm = () => {
    setAdjustmentType('');
    setDate('');
    setCorrectedClockIn('');
    setCorrectedClockOut('');
    setReason('');
  };

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentType || !date || !reason.trim()) return;
    requestMutation.mutate(
      {
        organizationId,
        // employeeId is required by the request shape but never trusted for
        // this branch — the backend always overrides it with the caller's
        // own server-derived identity (see attendanceAdjustments.ts, W67).
        // Sent here only to satisfy the request type, not as a real trust
        // boundary.
        data: {
          employeeId,
          date,
          adjustmentType: adjustmentType as RecordAttendanceAdjustmentInputAdjustmentType,
          correctedClockIn: adjustmentType === 'manual_clock_in' && correctedClockIn ? correctedClockIn : undefined,
          correctedClockOut: adjustmentType === 'manual_clock_out' && correctedClockOut ? correctedClockOut : undefined,
          reason: reason.trim(),
        },
      },
      {
        onSuccess: () => {
          setRequestOpen(false);
          resetRequestForm();
          invalidateAttendance();
          toast({ title: 'Correction request submitted', description: 'Your request is pending review by HR.' });
        },
        onError: (err) => toast({ title: 'Could not submit correction request', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const summaries: DailyAttendanceSummary[] = Array.isArray(summaryQuery.data) ? summaryQuery.data : [];
  const recentEvents = (eventsQuery.data ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex gap-3">
          <Button
            onClick={() => handleClock('clock_in')}
            disabled={clockMutation.isPending}
            data-testid="button-clock-in"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {clockMutation.isPending ? 'Recording…' : 'Clock In'}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleClock('clock_out')}
            disabled={clockMutation.isPending}
            data-testid="button-clock-out"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {clockMutation.isPending ? 'Recording…' : 'Clock Out'}
          </Button>
        </div>

        <Dialog open={requestOpen} onOpenChange={(open) => { setRequestOpen(open); if (!open) resetRequestForm(); }}>
          <DialogTrigger asChild>
            <Button variant="secondary" data-testid="button-request-correction">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Request a Correction
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmitRequest}>
              <DialogHeader>
                <DialogTitle>Request an Attendance Correction</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="attendance-correction-type">Correction Type *</Label>
                  <Select value={adjustmentType} onValueChange={setAdjustmentType}>
                    <SelectTrigger id="attendance-correction-type" data-testid="select-correction-type">
                      <SelectValue placeholder="Choose a correction type" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ADJUSTMENT_TYPE_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="attendance-correction-date">Date *</Label>
                  <Input
                    id="attendance-correction-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    max={todayIso()}
                    required
                    data-testid="input-correction-date"
                  />
                </div>
                {adjustmentType === 'manual_clock_in' && (
                  <div className="space-y-2">
                    <Label htmlFor="attendance-correction-clock-in">Corrected Clock-In Time *</Label>
                    <Input
                      id="attendance-correction-clock-in"
                      type="datetime-local"
                      value={correctedClockIn}
                      onChange={(e) => setCorrectedClockIn(e.target.value)}
                      required
                      data-testid="input-correction-clock-in"
                    />
                  </div>
                )}
                {adjustmentType === 'manual_clock_out' && (
                  <div className="space-y-2">
                    <Label htmlFor="attendance-correction-clock-out">Corrected Clock-Out Time *</Label>
                    <Input
                      id="attendance-correction-clock-out"
                      type="datetime-local"
                      value={correctedClockOut}
                      onChange={(e) => setCorrectedClockOut(e.target.value)}
                      required
                      data-testid="input-correction-clock-out"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="attendance-correction-reason">Reason *</Label>
                  <Textarea
                    id="attendance-correction-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    data-testid="input-correction-reason"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    requestMutation.isPending ||
                    !adjustmentType ||
                    !date ||
                    !reason.trim() ||
                    (adjustmentType === 'manual_clock_in' && !correctedClockIn) ||
                    (adjustmentType === 'manual_clock_out' && !correctedClockOut)
                  }
                  data-testid="button-submit-correction-request"
                >
                  {requestMutation.isPending ? 'Submitting…' : 'Submit Request'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {summaryQuery.error ? (
        <QueryError
          title="Could not load your attendance summary"
          message={errorMessage(summaryQuery.error) ?? 'Please try again.'}
          onRetry={() => summaryQuery.refetch()}
        />
      ) : summaryQuery.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Attendance</CardTitle>
            <CardDescription>Last 7 days, most recent first</CardDescription>
          </CardHeader>
          <CardContent>
            {summaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendance history yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {[...summaries].reverse().map((day) => (
                  <li key={day.date} className="flex items-center justify-between gap-4 py-3" data-testid={`row-attendance-summary-${day.date}`}>
                    <div>
                      <p className="text-sm font-medium text-foreground">{new Date(`${day.date}T00:00:00Z`).toLocaleDateString()}</p>
                      {day.status === 'present' || day.status === 'late' ? (
                        <p className="text-xs text-muted-foreground">
                          {day.firstClockIn ? new Date(day.firstClockIn).toLocaleTimeString() : '—'} –{' '}
                          {day.lastClockOut ? new Date(day.lastClockOut).toLocaleTimeString() : '—'}
                        </p>
                      ) : null}
                    </div>
                    <SummaryStatusBadge status={day.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {eventsQuery.error ? (
        <QueryError title="Could not load your recent clock events" onRetry={() => eventsQuery.refetch()} />
      ) : eventsQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : recentEvents.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Clock Events</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {recentEvents.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-4 py-2" data-testid={`row-attendance-event-${event.id}`}>
                  <span className="text-sm text-foreground">{EVENT_TYPE_LABEL[event.eventType] ?? event.eventType}</span>
                  <span className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const REVIEW_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  self_assessment: 'Self-Assessment',
  manager_review: 'Manager Review',
  hr_review: 'HR Review',
  finalized: 'Finalized',
  acknowledged: 'Acknowledged',
};

// Matches performance-reviews.tsx's own formatScoreLine exactly (an
// override is never displayed as if it were the manager's own result) —
// duplicated locally rather than shared, mirroring this file's existing
// REVIEW_STATUS_LABEL duplication precedent.
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

const GOAL_APPROVAL_LABEL: Record<string, string> = {
  accepted: 'Official',
  proposed: 'Proposed — awaiting your manager',
  rejected: 'Not accepted',
};

const GOAL_APPROVAL_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  accepted: 'secondary',
  proposed: 'outline',
  rejected: 'destructive',
};

function CompetencySelfRateRow({
  competency,
  levels,
  locked,
  onSave,
  isSaving,
}: {
  competency: PerformanceReviewCompetency;
  levels: PerformanceRatingScaleLevel[];
  locked: boolean;
  onSave: (value: number, comment: string) => void;
  isSaving: boolean;
}) {
  const [value, setValue] = useState<string>(competency.employeeRatingValue != null ? String(competency.employeeRatingValue) : '');
  const [comment, setComment] = useState(competency.employeeComment ?? '');

  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`row-competency-${competency.id}`}>
      <div>
        <p className="font-medium text-sm text-foreground">{competency.label}</p>
        {competency.description && <p className="text-xs text-muted-foreground">{competency.description}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
        <div className="space-y-1">
          <Label htmlFor={`competency-rating-${competency.id}`}>Your Rating</Label>
          <Select value={value} onValueChange={setValue} disabled={locked}>
            <SelectTrigger id={`competency-rating-${competency.id}`} data-testid={`select-competency-rating-${competency.id}`}>
              <SelectValue placeholder="Choose a rating" />
            </SelectTrigger>
            <SelectContent>
              {levels.map((l) => (
                <SelectItem key={l.id} value={String(l.value)}>{l.label} ({l.value})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`competency-comment-${competency.id}`}>Comment</Label>
          <Textarea
            id={`competency-comment-${competency.id}`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={locked}
            data-testid={`textarea-competency-comment-${competency.id}`}
          />
        </div>
      </div>
      {!locked && (
        <Button
          size="sm"
          disabled={!value || isSaving}
          onClick={() => onSave(Number(value), comment)}
          data-testid={`button-save-competency-${competency.id}`}
        >
          {isSaving ? 'Saving…' : 'Save Rating'}
        </Button>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  locked,
  onSaveComment,
  onEditProposal,
  isSaving,
}: {
  goal: PerformanceGoal;
  locked: boolean;
  onSaveComment: (comment: string) => void;
  onEditProposal: (fields: { title: string; target?: number; weight: number }) => void;
  isSaving: boolean;
}) {
  const [comment, setComment] = useState(goal.employeeComment ?? '');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [target, setTarget] = useState(goal.target ?? '');
  const [weight, setWeight] = useState(String(goal.weight));

  const isOwnProposal = goal.originType === 'employee_proposed';
  const canEditProposal = isOwnProposal && goal.approvalStatus === 'proposed' && !locked;

  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`row-goal-${goal.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-foreground">{goal.title}</p>
          <p className="text-xs text-muted-foreground capitalize">{goal.measurementType} · weight {goal.weight}{goal.originType === 'employee_proposed' ? ' · your proposal' : ' · set by your manager'}</p>
        </div>
        <Badge variant={GOAL_APPROVAL_VARIANT[goal.approvalStatus]} data-testid={`badge-goal-status-${goal.id}`}>
          {GOAL_APPROVAL_LABEL[goal.approvalStatus]}
        </Badge>
      </div>

      {goal.approvalStatus === 'rejected' && goal.managerComment && (
        <p className="text-xs text-muted-foreground">Reason: {goal.managerComment}</p>
      )}

      {canEditProposal && (
        <div className="space-y-2">
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid={`input-goal-title-${goal.id}`} />
              {goal.measurementType !== 'qualitative' && goal.measurementType !== 'boolean' && goal.measurementType !== 'rating' && (
                <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target" data-testid={`input-goal-target-${goal.id}`} />
              )}
              <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Weight" data-testid={`input-goal-weight-${goal.id}`} />
              <div className="sm:col-span-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => { onEditProposal({ title, target: target === '' ? undefined : Number(target), weight: Number(weight) }); setEditing(false); }}
                  disabled={isSaving}
                  data-testid={`button-save-goal-edit-${goal.id}`}
                >
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid={`button-edit-goal-${goal.id}`}>Edit Proposal</Button>
          )}
        </div>
      )}

      {goal.approvalStatus === 'accepted' && (
        <div className="space-y-2">
          <Label htmlFor={`goal-comment-${goal.id}`}>Your Comment / Progress</Label>
          <Textarea id={`goal-comment-${goal.id}`} value={comment} onChange={(e) => setComment(e.target.value)} disabled={locked} data-testid={`textarea-goal-comment-${goal.id}`} />
          {!locked && (
            <Button size="sm" onClick={() => onSaveComment(comment)} disabled={isSaving} data-testid={`button-save-goal-comment-${goal.id}`}>
              {isSaving ? 'Saving…' : 'Save Comment'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// My Performance (W77): reuses this ESS page's own independent per-module
// gating pattern (attendanceAccessible/leaveAccessible above) — Performance
// is checked separately from employee_self_service, so a disabled
// Performance module degrades only this tab, never the rest of ESS.
function MyPerformanceTab({ organizationId, employeeId }: { organizationId: number; employeeId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedReviewId, setSelectedReviewId] = useState<number | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalMeasurementType, setGoalMeasurementType] = useState<CreatePerformanceReviewGoalInputMeasurementType | ''>('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalUnit, setGoalUnit] = useState('');
  const [goalWeight, setGoalWeight] = useState('0');
  const [finalComment, setFinalComment] = useState('');

  const reviewsQuery = useListMyPerformanceReviews(organizationId, {
    query: { queryKey: getListMyPerformanceReviewsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const reviews = reviewsQuery.data ?? [];

  useEffect(() => {
    if (selectedReviewId == null && reviews.length > 0) {
      const inProgress = reviews.find((r) => r.status === 'self_assessment');
      setSelectedReviewId((inProgress ?? reviews[reviews.length - 1]).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews.length]);

  useEffect(() => {
    setFinalComment('');
  }, [selectedReviewId]);

  const detailQuery = useGetPerformanceReview(organizationId, selectedReviewId ?? 0, {
    query: { queryKey: getGetPerformanceReviewQueryKey(organizationId, selectedReviewId ?? 0), enabled: organizationId > 0 && !!selectedReviewId },
  });
  const detail = detailQuery.data;
  const review = detail?.review;
  const scaleId = review?.ratingScaleId;

  const scaleQuery = useGetPerformanceRatingScale(organizationId, scaleId ?? 0, {
    query: { queryKey: getGetPerformanceRatingScaleQueryKey(organizationId, scaleId ?? 0), enabled: organizationId > 0 && !!scaleId },
  });
  const levels = scaleQuery.data?.levels ?? [];

  const rateMutation = useRateCompetency();
  const createGoalMutation = useCreatePerformanceReviewGoal();
  const updateGoalMutation = useUpdatePerformanceReviewGoal();
  const submitMutation = useSubmitSelfAssessment();
  const acknowledgeMutation = useAcknowledgePerformanceReview();

  const invalidateDetail = () => {
    if (selectedReviewId) queryClient.invalidateQueries({ queryKey: getGetPerformanceReviewQueryKey(organizationId, selectedReviewId) });
    queryClient.invalidateQueries({ queryKey: getListMyPerformanceReviewsQueryKey(organizationId) });
  };

  const handleAcknowledge = () => {
    if (!selectedReviewId) return;
    acknowledgeMutation.mutate(
      { organizationId, id: selectedReviewId, data: finalComment.trim() ? { employeeFinalComment: finalComment.trim() } : undefined },
      {
        onSuccess: () => {
          setFinalComment('');
          invalidateDetail();
          toast({ title: 'Review acknowledged', description: 'Your manager and HR can see that you have seen this review.' });
        },
        onError: (err) => toast({ title: 'Could not acknowledge review', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const resetProposeForm = () => {
    setGoalTitle('');
    setGoalMeasurementType('');
    setGoalTarget('');
    setGoalUnit('');
    setGoalWeight('0');
  };

  const handlePropose = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReviewId || !goalTitle.trim() || !goalMeasurementType) return;
    createGoalMutation.mutate(
      {
        organizationId,
        id: selectedReviewId,
        data: {
          title: goalTitle.trim(),
          measurementType: goalMeasurementType,
          target: goalTarget === '' ? undefined : Number(goalTarget),
          unit: goalUnit || undefined,
          weight: Number(goalWeight),
        },
      },
      {
        onSuccess: () => {
          setProposeOpen(false);
          resetProposeForm();
          invalidateDetail();
          toast({ title: 'Goal proposed', description: 'Your manager will review this proposal.' });
        },
        onError: (err) => toast({ title: 'Could not propose goal', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const isLocked = review ? review.status !== 'self_assessment' : true;

  if (reviewsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (reviewsQuery.error) {
    return <QueryError title="Could not load your performance reviews" onRetry={() => reviewsQuery.refetch()} />;
  }
  if (reviews.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Target className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No performance reviews yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">You don't have any assigned reviews right now. Check back once your organisation opens a review cycle.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {reviews.length > 1 && (
        <Select value={selectedReviewId ? String(selectedReviewId) : ''} onValueChange={(v) => setSelectedReviewId(Number(v))}>
          <SelectTrigger className="w-full sm:w-64" data-testid="select-my-review">
            <SelectValue placeholder="Choose a review" />
          </SelectTrigger>
          <SelectContent>
            {reviews.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>Review #{r.id} — {REVIEW_STATUS_LABEL[r.status] ?? r.status}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {detailQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : detailQuery.error ? (
        <QueryError title="Could not load this review" onRetry={() => detailQuery.refetch()} />
      ) : detail && review ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-base">Review #{review.id}</CardTitle>
                <Badge variant={review.status === 'self_assessment' ? 'outline' : 'secondary'} data-testid="badge-review-status">
                  {REVIEW_STATUS_LABEL[review.status] ?? review.status}
                </Badge>
              </div>
              <CardDescription>
                {isLocked
                  ? 'Your self-assessment has been submitted and can no longer be edited.'
                  : 'Complete your self-assessment below, then submit it for your manager to review.'}
              </CardDescription>
            </CardHeader>
          </Card>

          {(review.status === 'finalized' || review.status === 'acknowledged') && (
            <Card data-testid="card-acknowledgement">
              <CardHeader>
                <CardTitle className="text-base">Your Finalized Result</CardTitle>
                <CardDescription>{formatScoreLine(review)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {review.status === 'acknowledged' ? (
                  <div className="flex items-start gap-2 text-sm" data-testid="text-acknowledged-state">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-medium text-foreground">
                        Acknowledged{review.acknowledgedAt ? ` on ${new Date(review.acknowledgedAt).toLocaleDateString()}` : ''}
                      </p>
                      {review.employeeFinalComment && (
                        <p className="text-muted-foreground mt-1" data-testid="text-final-comment">Your comment: {review.employeeFinalComment}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      This review has been finalized. Acknowledging it confirms only that <strong>you have seen this review</strong> — it does not mean you agree with it. If you disagree, you may record a final comment below; it will not change the outcome or reopen the review.
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="acknowledge-comment">Final comment (optional)</Label>
                      <Textarea
                        id="acknowledge-comment"
                        value={finalComment}
                        onChange={(e) => setFinalComment(e.target.value)}
                        placeholder="Optional — anything you'd like on record, not a formal appeal"
                        data-testid="input-final-comment"
                      />
                    </div>
                    <Button onClick={handleAcknowledge} disabled={acknowledgeMutation.isPending} data-testid="button-acknowledge-review">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {acknowledgeMutation.isPending ? 'Acknowledging…' : 'I Have Seen This Review'}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Goals</CardTitle>
                {!isLocked && (
                  <Dialog open={proposeOpen} onOpenChange={(open) => { setProposeOpen(open); if (!open) resetProposeForm(); }}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="secondary" data-testid="button-propose-goal">
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Propose a Goal
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handlePropose}>
                        <DialogHeader>
                          <DialogTitle>Propose a Goal</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="propose-goal-title">Title *</Label>
                            <Input id="propose-goal-title" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} required data-testid="input-propose-goal-title" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="propose-goal-type">Measurement Type *</Label>
                            <Select value={goalMeasurementType} onValueChange={(v) => setGoalMeasurementType(v as CreatePerformanceReviewGoalInputMeasurementType)}>
                              <SelectTrigger id="propose-goal-type" data-testid="select-propose-goal-type">
                                <SelectValue placeholder="Choose a type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="numeric">Numeric</SelectItem>
                                <SelectItem value="percentage">Percentage</SelectItem>
                                <SelectItem value="currency">Currency</SelectItem>
                                <SelectItem value="boolean">Yes/No</SelectItem>
                                <SelectItem value="rating">Rating</SelectItem>
                                <SelectItem value="qualitative">Qualitative</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {(goalMeasurementType === 'numeric' || goalMeasurementType === 'percentage' || goalMeasurementType === 'currency') && (
                            <div className="space-y-2">
                              <Label htmlFor="propose-goal-target">Target *</Label>
                              <Input id="propose-goal-target" type="number" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} data-testid="input-propose-goal-target" />
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label htmlFor="propose-goal-weight">Weight</Label>
                            <Input
                              id="propose-goal-weight"
                              type="number"
                              value={goalWeight}
                              onChange={(e) => setGoalWeight(e.target.value)}
                              disabled={goalMeasurementType === 'qualitative'}
                              data-testid="input-propose-goal-weight"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={createGoalMutation.isPending} data-testid="button-submit-propose-goal">
                            {createGoalMutation.isPending ? 'Proposing…' : 'Propose'}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.goals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No goals yet.</p>
              ) : (
                detail.goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    locked={isLocked}
                    isSaving={updateGoalMutation.isPending}
                    onSaveComment={(comment) =>
                      updateGoalMutation.mutate(
                        { organizationId, id: review.id, goalId: goal.id, data: { employeeComment: comment } },
                        { onSuccess: () => { invalidateDetail(); toast({ title: 'Comment saved' }); }, onError: (err) => toast({ title: 'Could not save comment', description: errorMessage(err), variant: 'destructive' }) },
                      )
                    }
                    onEditProposal={(fields) =>
                      updateGoalMutation.mutate(
                        { organizationId, id: review.id, goalId: goal.id, data: fields },
                        { onSuccess: () => { invalidateDetail(); toast({ title: 'Proposal updated' }); }, onError: (err) => toast({ title: 'Could not update proposal', description: errorMessage(err), variant: 'destructive' }) },
                      )
                    }
                  />
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Competencies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.competencies.map((competency) => (
                <CompetencySelfRateRow
                  key={competency.id}
                  competency={competency}
                  levels={levels}
                  locked={isLocked}
                  isSaving={rateMutation.isPending}
                  onSave={(value, comment) =>
                    rateMutation.mutate(
                      { organizationId, id: review.id, competencyId: competency.id, data: { employeeRatingValue: value, employeeComment: comment || undefined } },
                      { onSuccess: () => { invalidateDetail(); toast({ title: 'Rating saved' }); }, onError: (err) => toast({ title: 'Could not save rating', description: errorMessage(err), variant: 'destructive' }) },
                    )
                  }
                />
              ))}
            </CardContent>
          </Card>

          <PerformanceEvidenceSection organizationId={organizationId} reviewId={review.id} canUpload={!isLocked} />

          {!isLocked && (
            <Card>
              <CardContent className="py-6 space-y-3">
                {submitMutation.isError && (
                  <div className="text-sm text-destructive space-y-1" data-testid="text-submission-problems">
                    <p className="font-medium">Your self-assessment isn't ready to submit:</p>
                    <ul className="list-disc list-inside">
                      {(((submitMutation.error as { problems?: string[] })?.problems) ?? [errorMessage(submitMutation.error) ?? 'Please review your entries.']).map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <Button
                  onClick={() =>
                    submitMutation.mutate(
                      { organizationId, id: review.id },
                      { onSuccess: () => { invalidateDetail(); toast({ title: 'Self-assessment submitted', description: 'Your manager can now review it.' }); }, onError: () => {} },
                    )
                  }
                  disabled={submitMutation.isPending}
                  data-testid="button-submit-self-assessment"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {submitMutation.isPending ? 'Submitting…' : 'Submit Self-Assessment'}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

const STAGE_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  applied: 'outline',
  screening: 'secondary',
  interview: 'secondary',
  assessment: 'secondary',
  offer: 'secondary',
  hired: 'secondary',
  rejected: 'destructive',
  withdrawn: 'destructive',
};

/** linked/active are both intentional 200-OK controlled states from the backend (never a 403) — this card renders identically for either, since both mean "nothing to show here right now," not an error. */
function NotEligibleForInternalCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
          <Briefcase className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">Internal applications aren't available</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          This is only available to active employees with a linked employee record. Please contact your HR administrator if you believe this is unexpected.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * No dedicated internal vacancy *detail* route exists in the frozen §10
 * API — the list response already carries every field a detail view
 * needs, so "detail" is just showing the same already-fetched item in a
 * dialog, never a second network fetch.
 */
function InternalVacanciesTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useListMyInternalVacancies({
    query: { queryKey: getListMyInternalVacanciesQueryKey(), enabled: organizationId > 0 },
  });
  const applyMutation = useApplyToInternalVacancy();

  const [selected, setSelected] = useState<InternalVacancySummary | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const openVacancy = (vacancy: InternalVacancySummary) => {
    setAnswers({});
    setSelected(vacancy);
  };

  const handleApply = () => {
    if (!selected) return;
    const answerList = Object.entries(answers)
      .filter(([, text]) => text.trim())
      .map(([vacancyQuestionId, answerText]) => ({ vacancyQuestionId: Number(vacancyQuestionId), answerText }));
    applyMutation.mutate(
      { publicId: selected.publicId, data: answerList.length ? { answers: answerList } : undefined },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListMyInternalApplicationsQueryKey() });
          setSelected(null);
          toast({ title: result.isNew ? 'Application submitted' : "You've already applied to this vacancy" });
        },
        onError: (err) => toast({ title: 'Could not submit application', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (error) return <QueryError title="Could not load internal vacancies" onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data || !data.linked || !data.active) return <NotEligibleForInternalCard />;

  if (data.items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <Briefcase className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No internal vacancies right now</h3>
          <p className="text-sm text-muted-foreground max-w-sm">Check back later for openings you're eligible to apply to.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.items.map((vacancy) => (
          <Card key={vacancy.publicId} data-testid={`card-internal-vacancy-${vacancy.publicId}`}>
            <CardHeader>
              <CardTitle className="text-base">{vacancy.title}</CardTitle>
              <CardDescription>{vacancy.departmentName ?? 'Unspecified department'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {vacancy.employmentType && <Badge variant="outline" className="capitalize">{vacancy.employmentType.replace('_', ' ')}</Badge>}
                {vacancy.workplaceType && <Badge variant="outline" className="capitalize">{vacancy.workplaceType}</Badge>}
              </div>
              <Button size="sm" onClick={() => openVacancy(vacancy)} data-testid={`button-view-internal-vacancy-${vacancy.publicId}`}>
                View &amp; Apply
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={selected != null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {selected.jobDescription && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.jobDescription}</p>}
                {selected.responsibilities && (
                  <div>
                    <p className="text-sm font-medium text-foreground">Responsibilities</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.responsibilities}</p>
                  </div>
                )}
                {selected.requirements && (
                  <div>
                    <p className="text-sm font-medium text-foreground">Requirements</p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.requirements}</p>
                  </div>
                )}
                {selected.questions.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <p className="text-sm font-medium text-foreground">Screening Questions</p>
                    {selected.questions.map((q) => (
                      <div key={q.id} className="space-y-1">
                        <Label htmlFor={`question-${q.id}`}>{q.questionText}</Label>
                        <Input
                          id={`question-${q.id}`}
                          value={answers[q.id] ?? ''}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          data-testid={`input-internal-answer-${q.id}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleApply} disabled={applyMutation.isPending} data-testid="button-submit-internal-application">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {applyMutation.isPending ? 'Submitting…' : 'Submit Application'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MyInternalApplicationsTab({ organizationId }: { organizationId: number }) {
  const { data, isLoading, error, refetch } = useListMyInternalApplications({
    query: { queryKey: getListMyInternalApplicationsQueryKey(), enabled: organizationId > 0 },
  });

  if (error) return <QueryError title="Could not load your internal applications" onRetry={() => refetch()} />;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data || !data.linked || !data.active) return <NotEligibleForInternalCard />;

  if (data.items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
            <Send className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No internal applications yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">Applications you submit from the Internal Vacancies tab will appear here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <ul className="divide-y divide-border">
          {data.items.map((application) => (
            <li key={application.id} className="py-3 flex items-center justify-between" data-testid={`row-my-internal-application-${application.id}`}>
              <div>
                <p className="text-sm font-medium text-foreground">{application.vacancyTitle}</p>
                <p className="text-xs text-muted-foreground">{new Date(application.submittedAt).toLocaleDateString()}</p>
              </div>
              <Badge variant={STAGE_VARIANT[application.currentStageCategory] ?? 'outline'} className="capitalize">
                {application.currentStageCategory}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const LEARNING_STATUS_LABEL: Record<string, string> = {
  assigned: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const LEARNING_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  assigned: 'outline',
  in_progress: 'secondary',
  completed: 'secondary',
  failed: 'destructive',
  cancelled: 'outline',
};

const LEARNING_APPROVAL_LABEL: Record<string, string> = {
  auto_approved: 'Approved',
  pending: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

const LEARNING_APPROVAL_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  auto_approved: 'secondary',
  pending: 'outline',
  approved: 'secondary',
  rejected: 'destructive',
};

/**
 * Own session details for an instructor-led enrollment — a single
 * on-demand fetch per enrollment row (no session list is ever
 * pre-fetched for every enrollment; there is no dedicated "enrollment +
 * session" combined read, so this is the only honest way to show it
 * without inventing an endpoint).
 */
function EnrollmentSessionInfo({ organizationId, sessionId }: { organizationId: number; sessionId: number }) {
  const { data: session, isLoading } = useGetLearningCourseSession(organizationId, sessionId, {
    query: { queryKey: getGetLearningCourseSessionQueryKey(organizationId, sessionId), enabled: organizationId > 0 },
  });
  if (isLoading) return <Skeleton className="h-4 w-40" />;
  if (!session) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Session: {new Date(session.scheduledAt).toLocaleString()}
      {session.location ? ` · ${session.location}` : ''}
    </p>
  );
}

/**
 * §8.3/§9: every field below reads the enrollment's own historical
 * *snapshot* columns, never a live join to the current course row — a
 * later course edit must never rewrite what this employee was actually
 * enrolled into (verified explicitly in this workstream's own live QA).
 */
function EnrollmentCard({
  organizationId,
  enrollment,
  onStart,
  onComplete,
  onCancel,
  isMutating,
}: {
  organizationId: number;
  enrollment: LearningEnrollment;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
  isMutating: boolean;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const canStart = enrollment.deliveryModeSnapshot === 'self_paced' && enrollment.status === 'assigned' && (enrollment.approvalStatus === 'auto_approved' || enrollment.approvalStatus === 'approved');
  const canComplete = enrollment.deliveryModeSnapshot === 'self_paced' && enrollment.status === 'in_progress' && (enrollment.approvalStatus === 'auto_approved' || enrollment.approvalStatus === 'approved');
  const canCancel = enrollment.status === 'assigned' && !enrollment.mandatoryAtAssignment;
  const awaitingApproval = enrollment.approvalStatus === 'pending';

  return (
    <div className="border rounded-md p-4 space-y-3" data-testid={`row-enrollment-${enrollment.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-foreground">{enrollment.courseTitleSnapshot}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {enrollment.categorySnapshot} · {enrollment.deliveryModeSnapshot.replace('_', ' ')}
          </p>
          {enrollment.sessionId != null && <EnrollmentSessionInfo organizationId={organizationId} sessionId={enrollment.sessionId} />}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Badge variant={LEARNING_STATUS_VARIANT[enrollment.status]} data-testid={`badge-enrollment-status-${enrollment.id}`}>
            {LEARNING_STATUS_LABEL[enrollment.status] ?? enrollment.status}
          </Badge>
          <Badge variant={LEARNING_APPROVAL_VARIANT[enrollment.approvalStatus]} data-testid={`badge-enrollment-approval-${enrollment.id}`}>
            {LEARNING_APPROVAL_LABEL[enrollment.approvalStatus] ?? enrollment.approvalStatus}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {enrollment.mandatoryAtAssignment && <Badge variant="outline">Mandatory</Badge>}
        {enrollment.hasAssessmentSnapshot && <Badge variant="outline">Assessment Required</Badge>}
        {enrollment.issuesCertificateSnapshot && (
          <Badge variant="outline">
            Certificate Eligible{enrollment.certificateValidityMonthsSnapshot ? ` (valid ${enrollment.certificateValidityMonthsSnapshot}mo)` : ''}
          </Badge>
        )}
      </div>

      {awaitingApproval && (
        <p className="text-xs text-muted-foreground">Waiting on your manager's or HR's approval before you can begin.</p>
      )}
      {enrollment.approvalStatus === 'rejected' && (
        <p className="text-xs text-muted-foreground">This request was not approved. It remains on your record for reference.</p>
      )}
      {enrollment.status === 'cancelled' && enrollment.cancelReason && (
        <p className="text-xs text-muted-foreground">Cancellation reason: {enrollment.cancelReason}</p>
      )}

      {(canStart || canComplete || canCancel) && (
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <Button size="sm" onClick={onStart} disabled={isMutating} data-testid={`button-start-enrollment-${enrollment.id}`}>
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Start Training
            </Button>
          )}
          {canComplete && (
            <Button size="sm" onClick={onComplete} disabled={isMutating} data-testid={`button-complete-enrollment-${enrollment.id}`}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Mark Complete
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={isMutating} data-testid={`button-cancel-enrollment-${enrollment.id}`}>
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      )}

      <Button size="sm" variant="ghost" onClick={() => setShowEvidence((v) => !v)} data-testid={`button-toggle-evidence-${enrollment.id}`}>
        {showEvidence ? 'Hide Evidence' : 'Evidence'}
      </Button>
      {showEvidence && <LearningEvidenceSection organizationId={organizationId} enrollmentId={enrollment.id} canUpload />}
    </div>
  );
}

/** Instructor-led courses only — self-paced courses skip this dialog entirely and request immediately. Only 'scheduled' sessions are ever offered; a completed or cancelled session is never enrollable (§10.2). */
function RequestTrainingDialog({
  organizationId,
  course,
  open,
  onOpenChange,
  onRequest,
  isPending,
}: {
  organizationId: number;
  course: LearningCourse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequest: (sessionId?: number) => void;
  isPending: boolean;
}) {
  const [sessionId, setSessionId] = useState<string>('');
  const sessionsQuery = useListLearningCourseSessions(organizationId, course.id, {
    query: { queryKey: getListLearningCourseSessionsQueryKey(organizationId, course.id), enabled: open && organizationId > 0 },
  });
  const scheduledSessions = (sessionsQuery.data ?? []).filter((s) => s.status === 'scheduled');

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setSessionId(''); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request: {course.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {sessionsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : scheduledSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no open sessions for this course right now.</p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="learning-session-select">Choose a Session *</Label>
              <Select value={sessionId} onValueChange={setSessionId}>
                <SelectTrigger id="learning-session-select" data-testid="select-learning-session">
                  <SelectValue placeholder="Choose a session" />
                </SelectTrigger>
                <SelectContent>
                  {scheduledSessions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {new Date(s.scheduledAt).toLocaleString()}{s.location ? ` · ${s.location}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => onRequest(sessionId ? Number(sessionId) : undefined)}
            disabled={isPending || !sessionId}
            data-testid="button-submit-request-training"
          >
            {isPending ? 'Requesting…' : 'Request Training'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CERTIFICATE_STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  active: 'secondary',
  revoked: 'destructive',
};

/**
 * "Expired" is never a stored status (§10.4 rule 9) — the only two real
 * status values are active/revoked. This is a pure, live client-side
 * computation on top of expiresAt, recomputed on every render, never
 * cached or sent to the backend — matching the same discipline the API
 * itself enforces server-side.
 */
function isCertificateExpired(cert: LearningCertificate): boolean {
  return cert.status === 'active' && cert.expiresAt != null && new Date(cert.expiresAt) < new Date();
}

function CertificateRow({ certificate }: { certificate: LearningCertificate }) {
  const expired = isCertificateExpired(certificate);
  return (
    <div className="border rounded-md p-4 space-y-2" data-testid={`row-certificate-${certificate.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="font-medium text-sm text-foreground">{certificate.courseTitleSnapshot}</p>
          <p className="text-xs text-muted-foreground">
            Issued {new Date(certificate.issuedAt).toLocaleDateString()}
            {certificate.expiresAt ? ` · Valid until ${new Date(certificate.expiresAt).toLocaleDateString()}` : ' · Never expires'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Badge variant={CERTIFICATE_STATUS_VARIANT[certificate.status] ?? 'outline'} data-testid={`badge-certificate-status-${certificate.id}`}>
            {certificate.status === 'revoked' ? 'Revoked' : 'Active'}
          </Badge>
          {expired && (
            <Badge variant="outline" data-testid={`badge-certificate-expired-${certificate.id}`}>
              Expired
            </Badge>
          )}
        </div>
      </div>
      {certificate.status === 'revoked' && certificate.revokeReason && (
        <p className="text-xs text-muted-foreground">Revocation reason: {certificate.revokeReason}</p>
      )}
    </div>
  );
}

/**
 * ESS "My Learning" (§15, W88/W90): catalog browse (active courses only,
 * §29), self-enroll/request, own enrollment list with the two-axis
 * approval/status state, own self-paced progress-marking, own
 * certificates, own evidence upload/list. No manager/HR/instructor
 * controls of any kind live here — those are W89/W91's own surfaces.
 * Certificate state is a genuinely third, distinct concept from
 * approvalStatus/status — its own card, its own badges, never collapsed
 * into the enrollment badges above. "Expired" is always computed live
 * here from expiresAt, never a value the API itself returns as status.
 */
function MyLearningTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [requestDialogCourse, setRequestDialogCourse] = useState<LearningCourse | null>(null);

  const coursesQuery = useListLearningCourses(organizationId, {
    query: { queryKey: getListLearningCoursesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const enrollmentsQuery = useListMyLearningEnrollments(organizationId, {
    query: { queryKey: getListMyLearningEnrollmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const certificatesQuery = useListMyLearningCertificates(organizationId, {
    query: { queryKey: getListMyLearningCertificatesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const requestMutation = useRequestLearningEnrollment();
  const progressMutation = useAdvanceLearningEnrollmentProgress();
  const cancelMutation = useCancelLearningEnrollment();

  const invalidateEnrollments = () => queryClient.invalidateQueries({ queryKey: getListMyLearningEnrollmentsQueryKey(organizationId) });

  const activeCourses = (coursesQuery.data ?? []).filter((c) => c.status === 'active');
  const enrollments = enrollmentsQuery.data ?? [];
  // Proactive UI hint only — never a security control. The backend's own
  // duplicate-enrollment check (§8.3, W87) remains authoritative; this
  // merely avoids sending a request the employee can already see will 409.
  const nonTerminalCourseIds = new Set(
    enrollments.filter((e) => e.status !== 'completed' && e.status !== 'failed' && e.status !== 'cancelled').map((e) => e.courseId),
  );

  const handleRequest = (course: LearningCourse, sessionId?: number) => {
    requestMutation.mutate(
      { organizationId, id: course.id, data: sessionId ? { sessionId } : undefined },
      {
        onSuccess: (enrollment) => {
          setRequestDialogCourse(null);
          invalidateEnrollments();
          toast({
            title: enrollment.approvalStatus === 'pending' ? 'Request submitted' : 'Enrolled',
            description: enrollment.approvalStatus === 'pending' ? 'Your request is awaiting approval.' : 'You are now enrolled in this course.',
          });
        },
        onError: (err) => toast({ title: 'Could not request this training', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleStart = (enrollment: LearningEnrollment) => {
    progressMutation.mutate(
      { organizationId, id: enrollment.id, data: { status: 'in_progress' } },
      {
        onSuccess: () => { invalidateEnrollments(); toast({ title: 'Training started' }); },
        onError: (err) => toast({ title: 'Could not start this training', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleComplete = (enrollment: LearningEnrollment) => {
    progressMutation.mutate(
      { organizationId, id: enrollment.id, data: { status: 'completed' } },
      {
        onSuccess: () => { invalidateEnrollments(); toast({ title: 'Training marked complete' }); },
        onError: (err) => toast({ title: 'Could not mark this training complete', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const handleCancel = (enrollment: LearningEnrollment) => {
    cancelMutation.mutate(
      { organizationId, id: enrollment.id },
      {
        onSuccess: () => { invalidateEnrollments(); toast({ title: 'Enrollment cancelled' }); },
        onError: (err) => toast({ title: 'Could not cancel this enrollment', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const isMutating = progressMutation.isPending || cancelMutation.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Course Catalog</CardTitle>
          <CardDescription>Browse available training and request enrollment.</CardDescription>
        </CardHeader>
        <CardContent>
          {coursesQuery.error ? (
            <QueryError title="Could not load the course catalog" onRetry={() => coursesQuery.refetch()} />
          ) : coursesQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : activeCourses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses are open for enrollment right now.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCourses.map((course) => {
                const alreadyEnrolled = nonTerminalCourseIds.has(course.id);
                return (
                  <div key={course.id} className="border rounded-md p-4 space-y-2" data-testid={`card-catalog-course-${course.id}`}>
                    <div>
                      <p className="font-medium text-sm text-foreground">{course.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {course.categoryCode} · {course.deliveryMode.replace('_', ' ')}
                      </p>
                    </div>
                    {course.description && <p className="text-xs text-muted-foreground">{course.description}</p>}
                    <div className="flex flex-wrap gap-2">
                      {course.mandatoryDefault && <Badge variant="outline">Usually Mandatory</Badge>}
                      {course.requiresApproval && <Badge variant="outline">Requires Approval</Badge>}
                      {course.hasAssessment && <Badge variant="outline">Assessment</Badge>}
                      {course.issuesCertificate && <Badge variant="outline">Certificate</Badge>}
                    </div>
                    <Button
                      size="sm"
                      disabled={alreadyEnrolled}
                      onClick={() => {
                        if (course.deliveryMode === 'instructor_led') {
                          setRequestDialogCourse(course);
                        } else {
                          handleRequest(course);
                        }
                      }}
                      data-testid={`button-request-course-${course.id}`}
                    >
                      <GraduationCap className="h-4 w-4" aria-hidden="true" />
                      {alreadyEnrolled ? 'Already Enrolled' : 'Request Training'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Enrollments</CardTitle>
          <CardDescription>Your current and past training, including requests awaiting approval.</CardDescription>
        </CardHeader>
        <CardContent>
          {enrollmentsQuery.error ? (
            <QueryError title="Could not load your enrollments" onRetry={() => enrollmentsQuery.refetch()} />
          ) : enrollmentsQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no training enrollments yet.</p>
          ) : (
            <div className="space-y-3">
              {enrollments.map((enrollment) => (
                <EnrollmentCard
                  key={enrollment.id}
                  organizationId={organizationId}
                  enrollment={enrollment}
                  isMutating={isMutating}
                  onStart={() => handleStart(enrollment)}
                  onComplete={() => handleComplete(enrollment)}
                  onCancel={() => handleCancel(enrollment)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Certificates</CardTitle>
          <CardDescription>Certificates issued automatically when eligible training is completed.</CardDescription>
        </CardHeader>
        <CardContent>
          {certificatesQuery.error ? (
            <QueryError title="Could not load your certificates" onRetry={() => certificatesQuery.refetch()} />
          ) : certificatesQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (certificatesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no certificates yet.</p>
          ) : (
            <div className="space-y-3">
              {(certificatesQuery.data ?? []).map((certificate) => (
                <CertificateRow key={certificate.id} certificate={certificate} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {requestDialogCourse && (
        <RequestTrainingDialog
          organizationId={organizationId}
          course={requestDialogCourse}
          open={!!requestDialogCourse}
          onOpenChange={(open) => !open && setRequestDialogCourse(null)}
          onRequest={(sessionId) => handleRequest(requestDialogCourse, sessionId)}
          isPending={requestMutation.isPending}
        />
      )}
    </div>
  );
}

// --- My Assets (Phase 3E, W98) ---
// Reuses W97's own acknowledge route verbatim (no second acknowledgement
// engine). Acknowledgement wording is deliberately literal — "I confirm I
// received this item" — never framed as approval, agreement to liability,
// acceptance of damage, or acceptance of financial responsibility (Decision
// 1). Incident reporting is report-only: submitting one never changes this
// tab's own display of the asset's status/condition/custody, since the
// backend itself never mutates any of those on report (Decision 2) — HR
// review of a submitted report is a separate, later workstream.

function AcknowledgeAssetDialog({ organizationId, assignment, onAcknowledged }: { organizationId: number; assignment: AssetAssignment; onAcknowledged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const mutation = useAcknowledgeAssetAssignment();

  const handle = () => {
    mutation.mutate(
      { organizationId, id: assignment.id, data: { acknowledgementNote: note.trim() || undefined } },
      {
        onSuccess: () => {
          setOpen(false);
          setNote('');
          onAcknowledged();
          toast({ title: 'Receipt acknowledged' });
        },
        onError: (err) => toast({ title: 'Could not record acknowledgement', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNote(''); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid={`button-open-acknowledge-${assignment.id}`}>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Acknowledge Receipt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Acknowledge Receipt</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This confirms you received this item into your custody. It is not an approval, an agreement to liability, an acceptance of damage, or an acceptance of financial responsibility.
        </p>
        <div className="space-y-2 py-2">
          <Label htmlFor={`ack-note-${assignment.id}`}>Note (optional)</Label>
          <Textarea id={`ack-note-${assignment.id}`} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`textarea-ack-note-${assignment.id}`} />
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending} data-testid={`button-confirm-acknowledge-${assignment.id}`}>
            {mutation.isPending ? 'Confirming…' : 'I confirm I received this item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportAssetIssueDialog({ organizationId, assignment, onReported }: { organizationId: number; assignment: AssetAssignment; onReported: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [incidentType, setIncidentType] = useState<'damage' | 'loss' | ''>('');
  const [description, setDescription] = useState('');
  const mutation = useReportAssetIssue();

  const reset = () => {
    setIncidentType('');
    setDescription('');
  };

  const handle = () => {
    if (!incidentType || !description.trim()) return;
    mutation.mutate(
      { organizationId, id: assignment.assetId, data: { incidentType, description: description.trim() } },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
          onReported();
          toast({ title: 'Issue reported', description: 'Your report has been submitted for review.' });
        },
        onError: (err) => toast({ title: 'Could not submit this report', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid={`button-open-report-issue-${assignment.assetId}`}>
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Report an Issue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a Loss or Damage Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`incident-type-${assignment.assetId}`}>Issue Type</Label>
            <Select value={incidentType} onValueChange={(v) => setIncidentType(v as 'damage' | 'loss')}>
              <SelectTrigger id={`incident-type-${assignment.assetId}`} data-testid={`select-incident-type-${assignment.assetId}`}>
                <SelectValue placeholder="Choose an issue type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="loss">Loss</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`incident-description-${assignment.assetId}`}>Description</Label>
            <Textarea id={`incident-description-${assignment.assetId}`} value={description} onChange={(e) => setDescription(e.target.value)} data-testid={`textarea-incident-description-${assignment.assetId}`} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handle} disabled={mutation.isPending || !incidentType || !description.trim()} data-testid={`button-confirm-report-issue-${assignment.assetId}`}>
            {mutation.isPending ? 'Submitting…' : 'Submit Report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MyAssetsTab({ organizationId }: { organizationId: number }) {
  const queryClient = useQueryClient();
  const assignmentsQuery = useListMyAssetAssignments(organizationId, {
    query: { queryKey: getListMyAssetAssignmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListMyAssetAssignmentsQueryKey(organizationId) });

  const assignments = assignmentsQuery.data ?? [];
  const current = assignments.filter((a) => a.custodyEndedAt == null);
  const history = assignments.filter((a) => a.custodyEndedAt != null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Currently Assigned to Me</CardTitle>
          <CardDescription>Assets currently in your custody.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignmentsQuery.error ? (
            <QueryError title="Could not load your assets" onRetry={() => assignmentsQuery.refetch()} />
          ) : assignmentsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : current.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have no assets currently assigned to you.</p>
          ) : (
            <div className="space-y-3">
              {current.map((a) => (
                <div key={a.id} className="border rounded-md p-4 space-y-2" data-testid={`card-my-asset-${a.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm text-foreground">{a.assetNameSnapshot}</p>
                      <p className="text-xs text-muted-foreground">{a.assetTagSnapshot} · {a.categorySnapshot}</p>
                    </div>
                    <Badge variant={a.acknowledgedAt ? 'secondary' : 'outline'} data-testid={`badge-ack-status-${a.id}`}>
                      {a.acknowledgedAt ? 'Acknowledged' : 'Not Yet Acknowledged'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Issued {new Date(a.issuedAt).toLocaleDateString()}
                    {a.expectedReturnDate ? ` · expected back ${new Date(a.expectedReturnDate).toLocaleDateString()}` : ''}
                  </p>
                  {a.acknowledgedAt && (
                    <p className="text-xs text-muted-foreground">Acknowledged {new Date(a.acknowledgedAt).toLocaleDateString()}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!a.acknowledgedAt && <AcknowledgeAssetDialog organizationId={organizationId} assignment={a} onAcknowledged={invalidate} />}
                    <ReportAssetIssueDialog organizationId={organizationId} assignment={a} onReported={invalidate} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Asset History</CardTitle>
          <CardDescription>Assets you have previously held.</CardDescription>
        </CardHeader>
        <CardContent>
          {assignmentsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past asset history yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm" data-testid={`row-my-asset-history-${a.id}`}>
                  <div>
                    <p className="font-medium text-foreground">{a.assetNameSnapshot}</p>
                    <p className="text-muted-foreground text-xs">
                      {a.assetTagSnapshot} · {new Date(a.issuedAt).toLocaleDateString()} – {a.custodyEndedAt ? new Date(a.custodyEndedAt).toLocaleDateString() : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className="capitalize" data-testid={`badge-history-end-reason-${a.id}`}>{a.endReason ?? 'closed'}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployeeSelfService() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const {
    data: myEmployeeResponse,
    isLoading,
    error,
    refetch,
  } = useGetMyEmployee({ query: { queryKey: getGetMyEmployeeQueryKey(), enabled: !!user } });

  // The Leave module is separate from employee_self_service (Architecture
  // Principle 1: module gating answers "does this org have the feature,"
  // never conflated across modules) — checked here, not via <ModuleGate>,
  // so a disabled Leave module swaps out just this tab's content instead of
  // redirecting the whole ESS page away.
  const { data: modules } = useListOrganizationModules(organizationId, {
    query: { queryKey: getListOrganizationModulesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const leaveAccessible = !!modules && isModuleAccessible(modules, 'leave');
  // Same independent-gating rule as Leave (§8) — Internal Vacancies/My
  // Applications degrade to a controlled message when recruitment is
  // disabled, never blocking the rest of the ESS page.
  const recruitmentAccessible = !!modules && isModuleAccessible(modules, 'recruitment');
  // Attendance (W68) is checked independently within this page — the same
  // pattern as My Leave/Internal Vacancies (§5); employee_self_service
  // stays this page's own outer gate, unaffected by Attendance's own state.
  const attendanceAccessible = !!modules && isModuleAccessible(modules, 'attendance');
  // Performance (W77) is checked independently within this page too —
  // employee_self_service stays this page's own outer gate, unaffected by
  // Performance's own state, exactly mirroring Attendance/Leave above.
  const performanceAccessible = !!modules && isModuleAccessible(modules, 'performance');
  // Learning (W85) is checked independently within this page too — a
  // disabled Learning module degrades only this tab, exactly mirroring
  // Attendance/Performance/Leave above (Architecture Principle 1).
  const learningAccessible = !!modules && isModuleAccessible(modules, 'learning');
  // Asset Management (Phase 3E, W95-W98) is checked independently within
  // this page too — a disabled asset_management module degrades only My
  // Assets, exactly mirroring Attendance/Performance/Learning/Leave above.
  const assetManagementAccessible = !!modules && isModuleAccessible(modules, 'asset_management');

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Could not load your Employee Self-Service data" onRetry={() => refetch()} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const employee = myEmployeeResponse?.employee ?? null;

  if (!employee) {
    return (
      <div className="p-6 lg:p-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <UserCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Not linked to an employee record</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Your user account has not yet been linked to an employee record. Please contact your HR administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          <UserCircle className="h-7 w-7 text-primary" aria-hidden="true" />
          Employee Self-Service
        </h1>
        <p className="text-muted-foreground">Your own profile, leave, and documents</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile" data-testid="tab-my-profile">My Profile</TabsTrigger>
          <TabsTrigger value="attendance" data-testid="tab-my-attendance">My Attendance</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-my-performance">My Performance</TabsTrigger>
          <TabsTrigger value="learning" data-testid="tab-my-learning">My Learning</TabsTrigger>
          <TabsTrigger value="assets" data-testid="tab-my-assets">My Assets</TabsTrigger>
          <TabsTrigger value="leave" data-testid="tab-my-leave">My Leave</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-my-documents">My Documents</TabsTrigger>
          <TabsTrigger value="career-profile" data-testid="tab-career-profile">Career Profile</TabsTrigger>
          <TabsTrigger value="internal-vacancies" data-testid="tab-internal-vacancies">Internal Vacancies</TabsTrigger>
          <TabsTrigger value="my-internal-applications" data-testid="tab-my-internal-applications">My Applications</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <MyProfileTab employee={employee} />
        </TabsContent>
        <TabsContent value="attendance">
          {attendanceAccessible ? (
            <MyAttendanceTab organizationId={organizationId} employeeId={employee.id} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Clock className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Attendance isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Attendance module, so clocking and attendance history aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="performance">
          {performanceAccessible ? (
            <MyPerformanceTab organizationId={organizationId} employeeId={employee.id} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Target className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Performance isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Performance module, so reviews and self-assessment aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="learning">
          {learningAccessible ? (
            <MyLearningTab organizationId={organizationId} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <GraduationCap className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Learning isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Learning module, so courses and enrollments aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="assets">
          {assetManagementAccessible ? (
            <MyAssetsTab organizationId={organizationId} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Boxes className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Asset Management isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Asset Management module, so your assigned assets aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="leave">
          {leaveAccessible ? (
            // MyLeave is a full page component with its own p-6/lg:p-8
            // wrapper; negate it here so it doesn't double up with this
            // page's own padding when embedded as a tab.
            <div className="-m-6 lg:-m-8">
              <MyLeave />
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <CalendarClock className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Leave isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Leave module, so leave requests and balances aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="documents">
          <MyDocumentsTab organizationId={organizationId} employeeId={employee.id} />
        </TabsContent>
        <TabsContent value="career-profile">
          <CareerProfileTab organizationId={organizationId} />
        </TabsContent>
        <TabsContent value="internal-vacancies">
          {recruitmentAccessible ? (
            <InternalVacanciesTab organizationId={organizationId} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Briefcase className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Recruitment isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Recruitment module, so internal vacancies aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="my-internal-applications">
          {recruitmentAccessible ? (
            <MyInternalApplicationsTab organizationId={organizationId} />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Send className="h-8 w-8 text-muted-foreground mb-4" aria-hidden="true" />
                <h3 className="text-lg font-semibold text-foreground mb-2">Recruitment isn't enabled</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Your organisation hasn't enabled the Recruitment module, so your internal applications aren't available here.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
