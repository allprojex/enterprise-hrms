import { useState } from 'react';
import { GraduationCap, Plus, Settings, CalendarPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  useGetMe,
  getGetMeQueryKey,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useListLearningCourses,
  getListLearningCoursesQueryKey,
  useGetLearningCourse,
  getGetLearningCourseQueryKey,
  useCreateLearningCourse,
  useUpdateLearningCourse,
  useListLearningCourseSessions,
  getListLearningCourseSessionsQueryKey,
  useCreateLearningCourseSession,
  useUpdateLearningCourseSession,
  CreateLearningCourseInputDeliveryMode,
  type LearningCourseSession,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { QueryError } from '@/components/query-error';
import { isHrCapableRole } from '@/hooks/use-hr-capable';
import { ConfirmActionDialog } from '@/components/foundation';

function errorMessage(err: unknown): string | undefined {
  return err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
}

const STATUS_VARIANT: Record<string, 'secondary' | 'outline'> = {
  draft: 'outline',
  active: 'secondary',
  archived: 'outline',
};

function SessionsPanel({ organizationId, courseId, deliveryMode }: { organizationId: number; courseId: number; deliveryMode: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sessions, isLoading, error, refetch } = useListLearningCourseSessions(organizationId, courseId, {
    query: { queryKey: getListLearningCourseSessionsQueryKey(organizationId, courseId), enabled: organizationId > 0 },
  });

  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [instructorEmployeeId, setInstructorEmployeeId] = useState('');
  const [capacity, setCapacity] = useState('');

  const createMutation = useCreateLearningCourseSession();
  const updateMutation = useUpdateLearningCourseSession();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListLearningCourseSessionsQueryKey(organizationId, courseId) });

  const resetForm = () => {
    setScheduledAt('');
    setDurationMinutes('60');
    setLocation('');
    setMeetingLink('');
    setInstructorEmployeeId('');
    setCapacity('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduledAt || !durationMinutes) return;
    createMutation.mutate(
      {
        organizationId,
        id: courseId,
        data: {
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes),
          location: location.trim() || undefined,
          meetingLink: meetingLink.trim() || undefined,
          instructorEmployeeId: instructorEmployeeId ? Number(instructorEmployeeId) : undefined,
          capacity: capacity ? Number(capacity) : undefined,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          resetForm();
          toast({ title: 'Session scheduled' });
        },
        onError: (err) => toast({ title: 'Could not schedule session', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const [completeTarget, setCompleteTarget] = useState<LearningCourseSession | null>(null);
  const [cancelTarget, setCancelTarget] = useState<LearningCourseSession | null>(null);

  const handleTransition = (session: LearningCourseSession, status: 'completed' | 'cancelled') => {
    return updateMutation.mutateAsync(
      { organizationId, id: session.id, data: { status } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: status === 'completed' ? 'Session marked completed' : 'Session cancelled' });
        },
        onError: (err) => toast({ title: 'Could not update session', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  if (deliveryMode !== 'instructor_led') {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-sessions-not-applicable">
        This course is self-paced — sessions apply only to instructor-led courses.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <Label>Sessions</Label>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline" data-testid="button-add-session">
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Schedule Session
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>Schedule a Session</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="session-scheduled-at">Date &amp; Time</Label>
                  <Input id="session-scheduled-at" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required data-testid="input-session-scheduled-at" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-duration">Duration (minutes)</Label>
                  <Input id="session-duration" type="number" min={1} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} required data-testid="input-session-duration" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-location">Location (optional)</Label>
                  <Input id="session-location" value={location} onChange={(e) => setLocation(e.target.value)} data-testid="input-session-location" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-meeting-link">Meeting Link (optional)</Label>
                  <Input id="session-meeting-link" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} data-testid="input-session-meeting-link" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-instructor">Instructor Employee ID (optional)</Label>
                  <Input id="session-instructor" type="number" value={instructorEmployeeId} onChange={(e) => setInstructorEmployeeId(e.target.value)} data-testid="input-session-instructor" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-capacity">Capacity (optional)</Label>
                  <Input id="session-capacity" type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} data-testid="input-session-capacity" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-session">
                  {createMutation.isPending ? 'Scheduling…' : 'Schedule'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : error ? (
        <QueryError title="Could not load sessions" message={errorMessage(error) ?? 'Please try again.'} onRetry={() => refetch()} />
      ) : !sessions || sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions scheduled yet.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div key={session.id} className="flex items-center justify-between rounded-md border border-border p-3" data-testid={`row-session-${session.id}`}>
              <div className="text-sm">
                <p className="font-medium text-foreground">{new Date(session.scheduledAt).toLocaleString()}</p>
                <p className="text-muted-foreground">
                  {session.durationMinutes} min{session.location ? ` · ${session.location}` : ''}
                  {session.capacity != null ? ` · capacity ${session.capacity}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={session.status === 'scheduled' ? 'secondary' : 'outline'} className="capitalize">
                  {session.status}
                </Badge>
                {session.status === 'scheduled' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setCompleteTarget(session)} disabled={updateMutation.isPending} data-testid={`button-complete-session-${session.id}`}>
                      Complete
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => setCancelTarget(session)} disabled={updateMutation.isPending} data-testid={`button-cancel-session-${session.id}`}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmActionDialog
        open={completeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setCompleteTarget(null);
        }}
        title="Complete learning session?"
        description={
          <p>
            The session on {completeTarget ? new Date(completeTarget.scheduledAt).toLocaleString() : ''} will be marked completed. A completed
            session cannot be edited, cancelled or reopened. Attendance and completion for enrolled employees are recorded separately.
          </p>
        }
        confirmLabel="Complete Session"
        tone="default"
        onConfirm={() => (completeTarget ? handleTransition(completeTarget, 'completed') : undefined)}
        testId="dialog-complete-session"
      />

      <ConfirmActionDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => {
          if (!o) setCancelTarget(null);
        }}
        title="Cancel learning session?"
        description={
          <p>
            Are you sure you want to cancel the learning session on {cancelTarget ? new Date(cancelTarget.scheduledAt).toLocaleString() : ''}? A
            cancelled session cannot be edited or reopened — schedule a new session instead. Enrollments for this session are not
            cancelled automatically.
          </p>
        }
        confirmLabel="Cancel Session"
        cancelLabel="Keep Session"
        onConfirm={() => (cancelTarget ? handleTransition(cancelTarget, 'cancelled') : undefined)}
        testId="dialog-cancel-session"
      />
    </div>
  );
}

export default function LearningCourses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const { data: myOrganizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const currentOrg = myOrganizations?.find((m) => m.organizationId === organizationId);
  const isHrCapable = isHrCapableRole(currentOrg?.roles);

  const {
    data: courses,
    isLoading,
    error,
    refetch,
  } = useListLearningCourses(organizationId, {
    query: { queryKey: getListLearningCoursesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  // --- Create ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createCategoryCode, setCreateCategoryCode] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createDeliveryMode, setCreateDeliveryMode] = useState<CreateLearningCourseInputDeliveryMode | ''>('');
  const createMutation = useCreateLearningCourse();

  const resetCreateForm = () => {
    setCreateCategoryCode('');
    setCreateTitle('');
    setCreateDescription('');
    setCreateDeliveryMode('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createCategoryCode.trim() || !createTitle.trim() || !createDeliveryMode) return;
    createMutation.mutate(
      {
        organizationId,
        data: {
          categoryCode: createCategoryCode.trim(),
          title: createTitle.trim(),
          description: createDescription.trim() || undefined,
          deliveryMode: createDeliveryMode,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLearningCoursesQueryKey(organizationId) });
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: 'Course created' });
        },
        onError: (err) => toast({ title: 'Could not create course', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  // --- Manage (detail dialog: base fields + sessions) ---
  const [manageId, setManageId] = useState<number | null>(null);
  const {
    data: detail,
    isLoading: detailLoading,
    error: detailError,
  } = useGetLearningCourse(organizationId, manageId ?? 0, {
    query: { queryKey: getGetLearningCourseQueryKey(organizationId, manageId ?? 0), enabled: organizationId > 0 && manageId != null },
  });

  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategoryCode, setEditCategoryCode] = useState('');
  const [editDeliveryMode, setEditDeliveryMode] = useState<CreateLearningCourseInputDeliveryMode | ''>('');
  const [editStatus, setEditStatus] = useState<'draft' | 'active' | 'archived' | ''>('');
  const [editMandatoryDefault, setEditMandatoryDefault] = useState(false);
  const [editRequiresApproval, setEditRequiresApproval] = useState(false);
  const [editHasAssessment, setEditHasAssessment] = useState(false);
  const [editIssuesCertificate, setEditIssuesCertificate] = useState(false);
  const [editCertificateValidityMonths, setEditCertificateValidityMonths] = useState('');
  const [formSynced, setFormSynced] = useState(false);

  const openManage = (id: number) => {
    setManageId(id);
    setFormSynced(false);
  };
  const closeManage = () => {
    setManageId(null);
    setFormSynced(false);
  };

  // Sync local edit state whenever a fresh detail loads for the open course.
  if (detail && manageId === detail.id && !formSynced) {
    setEditTitle(detail.title);
    setEditDescription(detail.description ?? '');
    setEditCategoryCode(detail.categoryCode);
    setEditDeliveryMode(detail.deliveryMode);
    setEditStatus(detail.status);
    setEditMandatoryDefault(detail.mandatoryDefault);
    setEditRequiresApproval(detail.requiresApproval);
    setEditHasAssessment(detail.hasAssessment);
    setEditIssuesCertificate(detail.issuesCertificate);
    setEditCertificateValidityMonths(detail.certificateValidityMonths != null ? String(detail.certificateValidityMonths) : '');
    setFormSynced(true);
  }

  const updateMutation = useUpdateLearningCourse();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (manageId == null) return;
    updateMutation.mutate(
      {
        organizationId,
        id: manageId,
        data: {
          categoryCode: editCategoryCode.trim(),
          title: editTitle.trim(),
          description: editDescription.trim() || undefined,
          deliveryMode: editDeliveryMode || undefined,
          status: editStatus || undefined,
          mandatoryDefault: editMandatoryDefault,
          requiresApproval: editRequiresApproval,
          hasAssessment: editHasAssessment,
          issuesCertificate: editIssuesCertificate,
          certificateValidityMonths: editIssuesCertificate ? (editCertificateValidityMonths ? Number(editCertificateValidityMonths) : undefined) : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLearningCoursesQueryKey(organizationId) });
          queryClient.invalidateQueries({ queryKey: getGetLearningCourseQueryKey(organizationId, manageId) });
          toast({ title: 'Course updated' });
        },
        onError: (err) => toast({ title: 'Could not update course', description: errorMessage(err), variant: 'destructive' }),
      },
    );
  };

  const isArchived = detail?.status === 'archived';

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <GraduationCap className="h-7 w-7 text-primary" aria-hidden="true" />
            Learning Courses
          </h1>
          <p className="text-muted-foreground">The organization's training course catalog and instructor-led session schedule.</p>
        </div>
        {isHrCapable && (
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-course">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Course
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add Course</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="course-title">Title</Label>
                    <Input id="course-title" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} required data-testid="input-course-title" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="course-category">Category Code</Label>
                    <Input id="course-category" value={createCategoryCode} onChange={(e) => setCreateCategoryCode(e.target.value)} required data-testid="input-course-category" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="course-delivery-mode">Delivery Mode</Label>
                    <Select value={createDeliveryMode} onValueChange={(v) => setCreateDeliveryMode(v as CreateLearningCourseInputDeliveryMode)}>
                      <SelectTrigger id="course-delivery-mode" data-testid="select-course-delivery-mode">
                        <SelectValue placeholder="Choose a delivery mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="self_paced">Self-Paced</SelectItem>
                        <SelectItem value="instructor_led">Instructor-Led</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="course-description">Description (optional)</Label>
                    <Textarea id="course-description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} data-testid="input-course-description" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-course">
                    {createMutation.isPending ? 'Creating…' : 'Create Course'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading courses">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <QueryError title="Failed to load courses" message="Could not fetch courses. Try again." onRetry={() => refetch()} />
      ) : !courses || courses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <GraduationCap className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No courses yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">Add a course to start building the training catalog.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table aria-label="Learning courses">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((course) => (
                <TableRow key={course.id} data-testid={`row-course-${course.id}`}>
                  <TableCell className="font-medium">{course.title}</TableCell>
                  <TableCell className="text-muted-foreground">{course.categoryCode}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{course.deliveryMode.replace('_', ' ')}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[course.status] ?? 'outline'} className="capitalize">
                      {course.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => openManage(course.id)} data-testid={`button-manage-course-${course.id}`}>
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={manageId !== null} onOpenChange={(open) => !open && closeManage()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Course</DialogTitle>
            <DialogDescription>Edit configuration and manage sessions. Only what is configured here — no employee enrollment, approval, attendance, or certificate issuance happens on this page.</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : detailError ? (
            <QueryError title="Could not load this course" message={errorMessage(detailError) ?? 'Please try again.'} />
          ) : !detail ? null : (
            <div className="space-y-6 py-2">
              <form onSubmit={handleSave} className="space-y-4">
                {isArchived && (
                  <p className="text-sm text-muted-foreground" data-testid="text-course-archived">
                    This course is archived and locked. Set status back to draft or active to resume editing.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="edit-course-title">Title</Label>
                  <Input id="edit-course-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} disabled={isArchived} required data-testid="input-edit-course-title" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-category">Category Code</Label>
                  <Input id="edit-course-category" value={editCategoryCode} onChange={(e) => setEditCategoryCode(e.target.value)} disabled={isArchived} required data-testid="input-edit-course-category" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-description">Description</Label>
                  <Textarea id="edit-course-description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} disabled={isArchived} data-testid="input-edit-course-description" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-delivery-mode">Delivery Mode</Label>
                  <Select value={editDeliveryMode} onValueChange={(v) => setEditDeliveryMode(v as CreateLearningCourseInputDeliveryMode)} disabled={isArchived}>
                    <SelectTrigger id="edit-course-delivery-mode" data-testid="select-edit-course-delivery-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self_paced">Self-Paced</SelectItem>
                      <SelectItem value="instructor_led">Instructor-Led</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-course-status">Status</Label>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as 'draft' | 'active' | 'archived')}>
                    <SelectTrigger id="edit-course-status" data-testid="select-edit-course-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="edit-course-mandatory" checked={editMandatoryDefault} onCheckedChange={(c) => setEditMandatoryDefault(c === true)} disabled={isArchived} data-testid="checkbox-course-mandatory" />
                  <Label htmlFor="edit-course-mandatory" className="font-normal">Mandatory by default</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="edit-course-approval" checked={editRequiresApproval} onCheckedChange={(c) => setEditRequiresApproval(c === true)} disabled={isArchived} data-testid="checkbox-course-approval" />
                  <Label htmlFor="edit-course-approval" className="font-normal">Employee requests require approval</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="edit-course-assessment" checked={editHasAssessment} onCheckedChange={(c) => setEditHasAssessment(c === true)} disabled={isArchived} data-testid="checkbox-course-assessment" />
                  <Label htmlFor="edit-course-assessment" className="font-normal">Completion requires a pass/fail assessment</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="edit-course-certificate" checked={editIssuesCertificate} onCheckedChange={(c) => setEditIssuesCertificate(c === true)} disabled={isArchived} data-testid="checkbox-course-certificate" />
                  <Label htmlFor="edit-course-certificate" className="font-normal">Issues a certificate on completion</Label>
                </div>
                {editIssuesCertificate && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-course-certificate-validity">Certificate Validity (months, optional — blank = never expires)</Label>
                    <Input
                      id="edit-course-certificate-validity"
                      type="number"
                      min={1}
                      value={editCertificateValidityMonths}
                      onChange={(e) => setEditCertificateValidityMonths(e.target.value)}
                      disabled={isArchived}
                      data-testid="input-edit-course-certificate-validity"
                    />
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-course">
                    {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </form>

              <SessionsPanel organizationId={organizationId} courseId={detail.id} deliveryMode={detail.deliveryMode} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
