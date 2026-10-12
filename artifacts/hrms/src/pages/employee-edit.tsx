import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetEmployee,
  getGetEmployeeQueryKey,
  useUpdateEmployee,
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
import { SelfAdministrationNotice } from '@/components/employees/self-administration-notice';
import {
  FIELD_LABEL,
  buildUpdatePatch,
  employeeToFormValues,
  type EmployeeFormValues,
} from '@/components/employees/employee-form-schema';
import { isOwnEmployeeRecord, useEmployeeAccess } from '@/hooks/use-employee-access';
import { useToast } from '@/hooks/use-toast';
import { RESTRICTED_FIELDS_CHANGED, describeEmployeeApiError, type EmployeeApiErrorDetails } from '@/lib/employee-api-error';
import { releaseNavigationGuard } from '@/lib/navigation-guard-registry';

/**
 * Edit an employee record — PATCH /organizations/:id/employees/:employeeId.
 *
 * The form is prefilled from the record the server returned to THIS caller
 * and submits only what changed (buildUpdatePatch), so:
 *   - a field the person never touched is never overwritten,
 *   - a sensitive value that arrived redacted (null) is never echoed back as
 *     an erasure,
 *   - an unchanged sensitive value is never sent, so a caller with
 *     employee.write alone can still save their general changes.
 *
 * The caller's own record is not editable here at all: the server would
 * refuse (`self_administration_forbidden`), so the page explains and points
 * to My Requests instead of rendering a form that cannot be submitted.
 */
export default function EmployeeEdit() {
  const params = useParams<{ id: string }>();
  const employeeId = Number(params.id);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = me?.activeOrganizationId ?? me?.organizationId ?? 0;
  const access = useEmployeeAccess(organizationId);

  const {
    data: employee,
    isLoading,
    error,
    refetch,
  } = useGetEmployee(organizationId, employeeId, {
    query: {
      queryKey: getGetEmployeeQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && Number.isInteger(employeeId) && employeeId > 0,
      retry: false,
    },
  });

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

  const initialValues = useMemo(() => (employee ? employeeToFormValues(employee) : null), [employee]);

  const updateMutation = useUpdateEmployee();
  const [serverError, setServerError] = useState<EmployeeApiErrorDetails | null>(null);

  const isOwnRecord = isOwnEmployeeRecord(employee, me?.id);
  const detailPath = `/employees/${employeeId}`;

  const handleSubmit = (values: EmployeeFormValues) => {
    if (!employee || updateMutation.isPending) return;
    setServerError(null);
    const { patch, changedFields, blockedFields } = buildUpdatePatch(values, employee, {
      includeSensitive: access.canWriteSensitive && employee.sensitiveFieldsRedacted !== true,
      includeNotes: access.canReadNotes,
    });

    // A change the caller may not make refuses the WHOLE submission, even when
    // other changes are permitted. Sending only the permitted part would
    // silently drop what the person typed and report success for an edit that
    // did not happen as they intended. The form offers a one-click undo of the
    // restricted fields; nothing is sent until that is resolved.
    if (blockedFields.length > 0) {
      const needsSensitive = blockedFields.some((f) => f !== 'notes');
      const needsNotes = blockedFields.includes('notes');
      const requiredPermission = [needsSensitive && 'employee.sensitive.write', needsNotes && 'employee.notes.read']
        .filter(Boolean)
        .join(' and ');
      setServerError({
        status: null,
        message: `You cannot change ${blockedFields.map((f) => FIELD_LABEL[f] ?? f).join(', ')} without the ${requiredPermission} permission.`,
        code: RESTRICTED_FIELDS_CHANGED,
        fields: blockedFields,
        requiredPermission,
        field: null,
      });
      toast({
        title: 'Nothing was saved',
        description: 'Some changes are to fields you are not permitted to change. Undo them to save the rest.',
        variant: 'destructive',
      });
      return;
    }

    if (changedFields.length === 0) {
      toast({ title: 'No changes to save' });
      return;
    }

    updateMutation.mutate(
      { organizationId, employeeId, data: patch },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(organizationId, employeeId) });
          queryClient.invalidateQueries({ queryKey: getListEmployeesQueryKey(organizationId) });
          const n = changedFields.length;
          toast({
            title: 'Employee updated',
            description: `${n} field${n === 1 ? '' : 's'} changed: ${changedFields.map((f) => FIELD_LABEL[f] ?? f).join(', ')}.`,
          });
          // Saved: leaving is the expected outcome, not data loss.
          releaseNavigationGuard();
          navigate(detailPath);
        },
        onError: (err) => {
          const details = describeEmployeeApiError(err);
          setServerError(details);
          toast({
            title: 'The changes could not be saved',
            description: details.message ?? 'Please check the highlighted details and try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const back = (
    <Link href={detailPath} className="inline-flex items-center gap-1 text-body-sm text-foreground-muted hover:text-foreground" data-testid="link-back-to-profile">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to profile
    </Link>
  );

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return (
      <PageContainer>
        <ErrorState title="Employee not found" message="This address does not point at an employee record." action={<Link href="/employees">Back to employees</Link>} />
      </PageContainer>
    );
  }

  if (organizationId === 0 || access.isLoading || isLoading) {
    return (
      <PageContainer>
        <LoadingState label="Loading employee record" />
      </PageContainer>
    );
  }

  if (error || !employee || !initialValues) {
    const details = describeEmployeeApiError(error);
    return (
      <PageContainer>
        {back}
        <ErrorState
          title={details.status === 404 || details.status === 403 ? 'Employee not available' : 'Failed to load employee'}
          message={
            details.status === 404 || details.status === 403
              ? 'This record does not exist in your organisation or you are not permitted to open it.'
              : 'Could not fetch this employee record.'
          }
          onRetry={details.status === 404 || details.status === 403 ? undefined : () => refetch()}
          data-testid="state-employee-edit-error"
        />
      </PageContainer>
    );
  }

  if (!access.canWrite) {
    return (
      <PageContainer>
        {back}
        <ErrorState
          title="You cannot edit employee records"
          message="Editing needs the employee-write permission. Ask an organisation administrator if you believe you should have it."
          data-testid="state-employee-edit-forbidden"
        />
      </PageContainer>
    );
  }

  if (isOwnRecord) {
    return (
      <PageContainer>
        {back}
        <PageHeader eyebrow="Employees" title={`${employee.firstName} ${employee.lastName}`} description="Your own employee record" />
        <SelfAdministrationNotice context="edit" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        {back}
        <PageHeader
          eyebrow="Edit employee"
          title={`${employee.firstName} ${employee.lastName}`}
          description={employee.employeeNumber ? `Employee number ${employee.employeeNumber}. Only the fields you change are saved.` : 'Only the fields you change are saved.'}
        />
      </div>
      <EmployeeForm
        key={`${employee.id}:${employee.updatedAt}`}
        mode="edit"
        organizationId={organizationId}
        initialValues={initialValues}
        original={employee}
        access={{
          canWriteSensitive: access.canWriteSensitive,
          canReadNotes: access.canReadNotes,
          canAllocateNumber: access.canAllocateNumber,
        }}
        lookups={lookups}
        onSubmit={handleSubmit}
        onCancel={() => navigate(detailPath)}
        isPending={updateMutation.isPending}
        serverError={serverError}
        onDismissError={() => setServerError(null)}
        showNoChangesHint
      />
    </PageContainer>
  );
}
