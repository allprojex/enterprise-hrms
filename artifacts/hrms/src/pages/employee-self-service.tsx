import { UserCircle, FileText, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetMyEmployee,
  getGetMyEmployeeQueryKey,
  useListOrganizationModules,
  getListOrganizationModulesQueryKey,
  useListEmployeeDocuments,
  getListEmployeeDocumentsQueryKey,
  type SelfServiceEmployeeProfile,
} from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';
import { isModuleAccessible } from '@/lib/module-access';
import MyLeave from './my-leave';

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
      </Tabs>
    </div>
  );
}
