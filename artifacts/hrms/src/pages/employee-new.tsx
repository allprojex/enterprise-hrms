import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useCreateEmployee,
  useUploadEmployeeProfilePicture,
  getListEmployeesQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListPositions,
  getListPositionsQueryKey,
} from '@workspace/api-client-react';
import { PageContainer, PageHeader, ErrorState, LoadingState } from '@/components/foundation';
import { EmployeeForm } from '@/components/employees/employee-form';
import { EMPTY_EMPLOYEE_FORM, toCreatePayload, type EmployeeFormValues } from '@/components/employees/employee-form-schema';
import { useEmployeeAccess } from '@/hooks/use-employee-access';
import { useToast } from '@/hooks/use-toast';
import { describeEmployeeApiError, type EmployeeApiErrorDetails } from '@/lib/employee-api-error';
import { releaseNavigationGuard } from '@/lib/navigation-guard-registry';

/**
 * Register an employee — the HR record only.
 *
 * POST /organizations/:id/employees creates a person in the directory. It
 * cannot create a login (the input has no credential or user field; the API
 * drops unknown keys), sends no invitation, and the record stays unlinked
 * until an HR officer deliberately links an existing member from the
 * profile's Overview panel. The page says so next to the submit button.
 *
 * A photograph chosen here is uploaded to the new record's profile-picture
 * endpoint after creation succeeds — the same endpoint the profile uses — so
 * the create call itself stays JSON.
 */
export default function EmployeeNew() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = me?.activeOrganizationId ?? me?.organizationId ?? 0;
  const access = useEmployeeAccess(organizationId);

  const enabled = organizationId > 0 && access.canWrite;
  const { data: departments } = useListDepartments(organizationId, { query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled } });
  const { data: branches } = useListBranches(organizationId, { query: { queryKey: getListBranchesQueryKey(organizationId), enabled } });
  const { data: positions } = useListPositions(organizationId, { query: { queryKey: getListPositionsQueryKey(organizationId), enabled } });

  const lookups = useMemo(
    () => ({
      departments: (departments ?? []).map((d) => ({ id: d.id, name: d.name })),
      branches: (branches ?? []).map((b) => ({ id: b.id, name: b.name })),
      positions: (positions ?? []).map((p) => ({ id: p.id, name: p.title })),
    }),
    [departments, branches, positions],
  );

  const createMutation = useCreateEmployee();
  const uploadPhotoMutation = useUploadEmployeeProfilePicture();
  const [serverError, setServerError] = useState<EmployeeApiErrorDetails | null>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  }, [photoPreviewUrl]);

  const photo = {
    previewUrl: photoPreviewUrl,
    onSelect: (file: File) => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      setPhotoFile(file);
      setPhotoPreviewUrl(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
    },
    onClear: () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
      setPhotoFile(null);
      setPhotoPreviewUrl(null);
    },
  };

  const handleSubmit = (values: EmployeeFormValues) => {
    if (createMutation.isPending) return;
    setServerError(null);
    const data = toCreatePayload(values, {
      includeSensitive: access.canWriteSensitive,
      includeNotes: access.canReadNotes,
      includeEmployeeNumber: access.canAllocateNumber,
    });
    createMutation.mutate(
      { organizationId, data },
      {
        onSuccess: (employee) => {
          queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey(organizationId) });
          toast({
            title: 'Employee registered',
            description: `${employee.firstName} ${employee.lastName} has been added to the directory. No login account was created.`,
          });
          if (photoFile) {
            uploadPhotoMutation.mutate(
              { organizationId, employeeId: employee.id, data: { file: photoFile } },
              {
                onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey(organizationId) }),
                onError: () => {
                  toast({
                    title: 'Employee registered, but the photo could not be uploaded',
                    description: 'You can add a profile picture from the employee’s profile.',
                    variant: 'destructive',
                  });
                },
              },
            );
          }
          // Registered: leaving the form is the expected outcome, not data loss.
          releaseNavigationGuard();
          navigate(`/employees/${employee.id}`);
        },
        onError: (err) => {
          const details = describeEmployeeApiError(err);
          setServerError(details);
          toast({
            title: 'The employee could not be registered',
            description: details.message ?? 'Please check the highlighted details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const back = (
    <Link href="/employees" className="inline-flex items-center gap-1 text-body-sm text-foreground-muted hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to employees
    </Link>
  );

  if (organizationId === 0 || access.isLoading) {
    return (
      <PageContainer>
        <LoadingState label="Loading your permissions" />
      </PageContainer>
    );
  }

  if (!access.canWrite) {
    return (
      <PageContainer>
        {back}
        <ErrorState
          title="You cannot register employees"
          message="Registering an employee needs the employee-write permission. Ask an organisation administrator if you believe you should have it."
          data-testid="state-employee-new-forbidden"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        {back}
        <PageHeader
          eyebrow="Employees"
          title="Register employee"
          description="Create the HR record for a new employee. Fields marked with an asterisk are required; everything else can be completed later."
        />
      </div>
      <EmployeeForm
        mode="create"
        organizationId={organizationId}
        initialValues={EMPTY_EMPLOYEE_FORM}
        access={{
          canWriteSensitive: access.canWriteSensitive,
          canReadNotes: access.canReadNotes,
          canAllocateNumber: access.canAllocateNumber,
        }}
        lookups={lookups}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/employees')}
        isPending={createMutation.isPending}
        serverError={serverError}
        photo={photo}
      />
    </PageContainer>
  );
}
