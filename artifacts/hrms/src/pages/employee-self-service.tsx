import { useState } from 'react';
import { UserCircle, FileText, CalendarClock, Briefcase, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
  type SelfServiceEmployeeProfile,
  type InternalVacancySummary,
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
          <TabsTrigger value="leave" data-testid="tab-my-leave">My Leave</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-my-documents">My Documents</TabsTrigger>
          <TabsTrigger value="internal-vacancies" data-testid="tab-internal-vacancies">Internal Vacancies</TabsTrigger>
          <TabsTrigger value="my-internal-applications" data-testid="tab-my-internal-applications">My Applications</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <MyProfileTab employee={employee} />
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
