import { useState } from 'react';
import { UserCircle, FileText, CalendarClock, Briefcase, Send, Clock, LogIn, LogOut, Plus } from 'lucide-react';
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
  type SelfServiceEmployeeProfile,
  type InternalVacancySummary,
  type DailyAttendanceSummary,
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
          <TabsTrigger value="leave" data-testid="tab-my-leave">My Leave</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-my-documents">My Documents</TabsTrigger>
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
