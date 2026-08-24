import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, Loader2, Mail, Phone, Building, Network, Briefcase, Camera, UserPlus, UserCheck, UserX, RotateCcw, FileText, Upload, Trash2, Award, GraduationCap, Sparkles, Plus, ArrowLeftRight, TrendingUp, BadgeCheck, ShieldAlert, LogOut, IdCard, History, MapPin, AlertTriangle, PackageSearch } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useGetEmployee,
  getGetEmployeeQueryKey,
  useUpdateEmployee,
  useUploadEmployeeProfilePicture,
  useLinkEmployeeToUser,
  useUnlinkEmployeeFromUser,
  useSeparateEmployee,
  useRehireEmployee,
  useListMembers,
  getListMembersQueryKey,
  useListMasterDataItems,
  getListMasterDataItemsQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useListEmployeeDocuments,
  getListEmployeeDocumentsQueryKey,
  useUploadEmployeeDocument,
  useRemoveEmployeeDocument,
  useListEmployeeSkills,
  getListEmployeeSkillsQueryKey,
  useAddEmployeeSkill,
  useRemoveEmployeeSkill,
  useListEmployeeQualifications,
  getListEmployeeQualificationsQueryKey,
  useAddEmployeeQualification,
  useRemoveEmployeeQualification,
  useListEmployeeCertifications,
  getListEmployeeCertificationsQueryKey,
  useAddEmployeeCertification,
  useRemoveEmployeeCertification,
  useListEmployeeEmploymentHistory,
  getListEmployeeEmploymentHistoryQueryKey,
  useTransferEmployee,
  usePromoteEmployee,
  useConfirmEmployee,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListPositions,
  getListPositionsQueryKey,
  useListEmployeeDisciplinaryRecords,
  getListEmployeeDisciplinaryRecordsQueryKey,
  useAddEmployeeDisciplinaryRecord,
  useListEmployeeExitProcesses,
  getListEmployeeExitProcessesQueryKey,
  useCreateEmployeeExitProcess,
  useUpdateEmployeeExitProcess,
  useGetPersonnelFileByEmployee,
  getGetPersonnelFileByEmployeeQueryKey,
  useCreatePersonnelFile,
  useListEmployeeNumberHistory,
  getListEmployeeNumberHistoryQueryKey,
  useGetPersonnelFileCustody,
  getGetPersonnelFileCustodyQueryKey,
  useListPersonnelFileMovements,
  getListPersonnelFileMovementsQueryKey,
  useListRecordsLocations,
  getListRecordsLocationsQueryKey,
  useCreateRecordsLocation,
  useCheckoutPersonnelFile,
  useReturnPersonnelFile,
  useMarkPersonnelFileMissing,
  useRecoverPersonnelFile,
  useListPerformanceCycles,
  getListPerformanceCyclesQueryKey,
  useListPerformanceReviews,
  getListPerformanceReviewsQueryKey,
  useRunAssetReport,
  getRunAssetReportQueryKey,
} from '@workspace/api-client-react';
import type { CreatePersonnelFileInputMode } from '@workspace/api-client-react';
import type { UpdateEmployeeInputEmploymentStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useEmployeePhoto } from '@/hooks/use-employee-photo';
import { QueryError } from '@/components/query-error';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const NONE_PROBATION_REVIEW = '__none__';

const STATUS_OPTIONS: UpdateEmployeeInputEmploymentStatus[] = [
  'active',
  'probation',
  'on_leave',
  'suspended',
  'terminated',
];

export default function EmployeeDetail() {
  const params = useParams<{ id: string }>();
  const employeeId = Number(params.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: currentUser } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = currentUser?.activeOrganizationId ?? currentUser?.organizationId ?? 0;

  const {
    data: employee,
    isLoading,
    error,
    refetch,
  } = useGetEmployee(organizationId, employeeId, {
    query: { queryKey: getGetEmployeeQueryKey(organizationId, employeeId), enabled: organizationId > 0 && !isNaN(employeeId) },
  });

  const photoSrc = useEmployeePhoto(organizationId, employeeId, employee?.hasProfilePicture ?? false);

  const { data: members } = useListMembers(organizationId, {
    query: { queryKey: getListMembersQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const { data: separationReasons } = useListMasterDataItems(organizationId, 'separation_reason', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'separation_reason'), enabled: organizationId > 0 },
  });

  const { data: documentCategories } = useListMasterDataItems(organizationId, 'document_category', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'document_category'), enabled: organizationId > 0 },
  });

  const { data: documents } = useListEmployeeDocuments(organizationId, employeeId, {
    query: {
      queryKey: getListEmployeeDocumentsQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && !isNaN(employeeId),
    },
  });

  const { data: skillOptions } = useListMasterDataItems(organizationId, 'skill', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'skill'), enabled: organizationId > 0 },
  });
  const { data: qualificationTypeOptions } = useListMasterDataItems(organizationId, 'qualification_type', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'qualification_type'), enabled: organizationId > 0 },
  });
  const { data: certificationTypeOptions } = useListMasterDataItems(organizationId, 'certification_type', {
    query: { queryKey: getListMasterDataItemsQueryKey(organizationId, 'certification_type'), enabled: organizationId > 0 },
  });

  const { data: skills } = useListEmployeeSkills(organizationId, employeeId, {
    query: { queryKey: getListEmployeeSkillsQueryKey(organizationId, employeeId), enabled: organizationId > 0 && !isNaN(employeeId) },
  });
  const { data: qualifications } = useListEmployeeQualifications(organizationId, employeeId, {
    query: { queryKey: getListEmployeeQualificationsQueryKey(organizationId, employeeId), enabled: organizationId > 0 && !isNaN(employeeId) },
  });
  const { data: certifications } = useListEmployeeCertifications(organizationId, employeeId, {
    query: { queryKey: getListEmployeeCertificationsQueryKey(organizationId, employeeId), enabled: organizationId > 0 && !isNaN(employeeId) },
  });
  const {
    data: employmentHistory,
    isLoading: employmentHistoryLoading,
    isError: employmentHistoryError,
    refetch: refetchEmploymentHistory,
  } = useListEmployeeEmploymentHistory(organizationId, employeeId, {
    query: { queryKey: getListEmployeeEmploymentHistoryQueryKey(organizationId, employeeId), enabled: organizationId > 0 && !isNaN(employeeId) },
  });

  // Phase 3H, W115 — Personnel File / PIF. A 404 here just means "no
  // personnel file yet" (a normal, expected state, not an error to hide the
  // section for) — only a permission-denied (403, from lacking
  // personnel_file.read) hides the whole card, mirroring
  // disciplinaryRecordsError's own reactive-to-403 pattern below.
  const {
    data: personnelFile,
    error: personnelFileError,
    isLoading: personnelFileLoading,
  } = useGetPersonnelFileByEmployee(organizationId, employeeId, {
    query: {
      queryKey: getGetPersonnelFileByEmployeeQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && !isNaN(employeeId),
      retry: false,
    },
  });
  const personnelFileErrorStatus =
    personnelFileError && typeof personnelFileError === 'object' && 'status' in personnelFileError
      ? (personnelFileError as { status: number }).status
      : undefined;
  const personnelFileForbidden = personnelFileErrorStatus === 403;

  const {
    data: staffNumberHistory,
    isLoading: staffNumberHistoryLoading,
  } = useListEmployeeNumberHistory(organizationId, employeeId, {
    query: {
      queryKey: getListEmployeeNumberHistoryQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && !isNaN(employeeId) && !personnelFileForbidden,
    },
  });

  // Phase 3H, W116 — Physical Filing, Locations & Movement. Custody/overdue
  // are only meaningful once a personnel file exists — every query below is
  // gated on personnelFile?.id, not merely on the employee id.
  const { data: custody, isLoading: custodyLoading } = useGetPersonnelFileCustody(organizationId, personnelFile?.id ?? 0, {
    query: {
      queryKey: getGetPersonnelFileCustodyQueryKey(organizationId, personnelFile?.id ?? 0),
      enabled: organizationId > 0 && !!personnelFile?.id,
    },
  });
  const { data: movements, isLoading: movementsLoading } = useListPersonnelFileMovements(organizationId, personnelFile?.id ?? 0, undefined, {
    query: {
      queryKey: getListPersonnelFileMovementsQueryKey(organizationId, personnelFile?.id ?? 0),
      enabled: organizationId > 0 && !!personnelFile?.id,
    },
  });
  const { data: recordsLocations } = useListRecordsLocations(organizationId, {
    query: { queryKey: getListRecordsLocationsQueryKey(organizationId), enabled: organizationId > 0 && !!personnelFile?.id },
  });

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: positions } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const { data: disciplinaryRecords, error: disciplinaryRecordsError } = useListEmployeeDisciplinaryRecords(organizationId, employeeId, {
    query: {
      queryKey: getListEmployeeDisciplinaryRecordsQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && !isNaN(employeeId),
    },
  });

  const { data: exitProcesses } = useListEmployeeExitProcesses(organizationId, employeeId, {
    query: {
      queryKey: getListEmployeeExitProcessesQueryKey(organizationId, employeeId),
      enabled: organizationId > 0 && !isNaN(employeeId),
    },
  });

  const updateMutation = useUpdateEmployee();
  const uploadMutation = useUploadEmployeeProfilePicture();
  const linkMutation = useLinkEmployeeToUser();
  const unlinkMutation = useUnlinkEmployeeFromUser();
  const separateMutation = useSeparateEmployee();
  const rehireMutation = useRehireEmployee();
  const uploadDocumentMutation = useUploadEmployeeDocument();
  const removeDocumentMutation = useRemoveEmployeeDocument();
  const addSkillMutation = useAddEmployeeSkill();
  const removeSkillMutation = useRemoveEmployeeSkill();
  const addQualificationMutation = useAddEmployeeQualification();
  const removeQualificationMutation = useRemoveEmployeeQualification();
  const addCertificationMutation = useAddEmployeeCertification();
  const removeCertificationMutation = useRemoveEmployeeCertification();
  const transferMutation = useTransferEmployee();
  const promoteMutation = usePromoteEmployee();
  const createPersonnelFileMutation = useCreatePersonnelFile();
  const createRecordsLocationMutation = useCreateRecordsLocation();
  const checkoutMutation = useCheckoutPersonnelFile();
  const returnMutation = useReturnPersonnelFile();
  const markMissingMutation = useMarkPersonnelFileMissing();
  const recoverMutation = useRecoverPersonnelFile();
  const confirmMutation = useConfirmEmployee();
  const addDisciplinaryRecordMutation = useAddEmployeeDisciplinaryRecord();
  const createExitProcessMutation = useCreateEmployeeExitProcess();
  const updateExitProcessMutation = useUpdateEmployeeExitProcess();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState<UpdateEmployeeInputEmploymentStatus>('active');
  const [linkUserId, setLinkUserId] = useState('');
  const [isSeparateOpen, setIsSeparateOpen] = useState(false);
  const [separationDate, setSeparationDate] = useState('');
  const [separationReason, setSeparationReason] = useState('');
  const [documentCategoryCode, setDocumentCategoryCode] = useState('');
  const documentFileInputRef = useRef<HTMLInputElement>(null);
  const [newSkillCode, setNewSkillCode] = useState('');
  const [newSkillProficiency, setNewSkillProficiency] = useState('');
  const [newQualificationCode, setNewQualificationCode] = useState('');
  const [newQualificationInstitution, setNewQualificationInstitution] = useState('');
  const [newCertificationCode, setNewCertificationCode] = useState('');
  const [newCertificationIssuer, setNewCertificationIssuer] = useState('');
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferEffectiveDate, setTransferEffectiveDate] = useState('');
  const [transferDepartmentId, setTransferDepartmentId] = useState('');
  const [transferBranchId, setTransferBranchId] = useState('');
  const [transferPositionId, setTransferPositionId] = useState('');
  const [isPromoteOpen, setIsPromoteOpen] = useState(false);
  const [promoteEffectiveDate, setPromoteEffectiveDate] = useState('');
  const [promotePositionId, setPromotePositionId] = useState('');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [confirmEffectiveDate, setConfirmEffectiveDate] = useState('');
  const [confirmProbationReviewId, setConfirmProbationReviewId] = useState(NONE_PROBATION_REVIEW);
  const [newDisciplinaryActionType, setNewDisciplinaryActionType] = useState('');
  const [newDisciplinaryDescription, setNewDisciplinaryDescription] = useState('');
  const [newDisciplinaryActionDate, setNewDisciplinaryActionDate] = useState('');

  const [isPersonnelFileDialogOpen, setIsPersonnelFileDialogOpen] = useState(false);
  const [personnelFileMode, setPersonnelFileMode] = useState<CreatePersonnelFileInputMode>('generate');
  const [manualPifNumber, setManualPifNumber] = useState('');
  const [showStaffNumberHistory, setShowStaffNumberHistory] = useState(false);

  const [showMovementHistory, setShowMovementHistory] = useState(false);
  const [isCheckoutDialogOpen, setIsCheckoutDialogOpen] = useState(false);
  const [checkoutDestination, setCheckoutDestination] = useState('');
  const [checkoutPurpose, setCheckoutPurpose] = useState('');
  const [checkoutExpectedReturnDate, setCheckoutExpectedReturnDate] = useState('');
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  const [returnLocationId, setReturnLocationId] = useState('');
  const [isMissingDialogOpen, setIsMissingDialogOpen] = useState(false);
  const [missingReason, setMissingReason] = useState('');
  const [isRecoverDialogOpen, setIsRecoverDialogOpen] = useState(false);
  const [recoverLocationId, setRecoverLocationId] = useState('');
  const [isLocationsDialogOpen, setIsLocationsDialogOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationParentId, setNewLocationParentId] = useState('');

  // Phase 3H, W118 (Decision 14 — prepopulation). Only fetched while the
  // Confirm dialog is open, since a probation review can only be linked
  // from there. If the caller lacks performance.manage (or Performance is
  // disabled) these silently 403/empty and the picker just doesn't
  // render — the plain "confirm with no review" path underneath is
  // completely unaffected, exactly as it was before W118.
  const { data: probationCandidateCycles } = useListPerformanceCycles(organizationId, {
    query: { queryKey: getListPerformanceCyclesQueryKey(organizationId), enabled: isConfirmOpen && organizationId > 0, retry: false },
  });
  const { data: probationCandidateReviews } = useListPerformanceReviews(organizationId, { employeeId }, {
    query: { queryKey: getListPerformanceReviewsQueryKey(organizationId, { employeeId }), enabled: isConfirmOpen && organizationId > 0 && !isNaN(employeeId), retry: false },
  });
  const probationReviewOptions = (probationCandidateReviews?.items ?? [])
    .filter((r) => (probationCandidateCycles ?? []).some((c) => c.id === r.cycleId && c.cycleType === 'probation'))
    .map((r) => ({
      review: r,
      cycleName: (probationCandidateCycles ?? []).find((c) => c.id === r.cycleId)?.name ?? `Cycle #${r.cycleId}`,
    }));

  // Phase 3H, W118 (§11 — separation warnings). Only fetched while the
  // Separate dialog is open; reuses Assets' own existing, unmodified
  // asset_unreturned_by_employee report (never a new report or a second
  // source of truth) scoped to this one employee. A 403 (Assets module
  // disabled, or the caller lacks asset_management.reports.read) simply
  // means this one warning source is unavailable — never blocks
  // separation, and the other two warning sources are unaffected.
  const { data: unreturnedAssetsReport } = useRunAssetReport(organizationId, 'asset_unreturned_by_employee', { employeeId }, {
    query: { queryKey: getRunAssetReportQueryKey(organizationId, 'asset_unreturned_by_employee', { employeeId }), enabled: isSeparateOpen && organizationId > 0 && !isNaN(employeeId), retry: false },
  });
  const unreturnedAssetCount =
    unreturnedAssetsReport && typeof unreturnedAssetsReport === 'object' && 'rows' in unreturnedAssetsReport
      ? unreturnedAssetsReport.rows.length
      : 0;
  const separationWarnings: string[] = [];
  if (custody?.currentCustodyState === 'checked_out') {
    separationWarnings.push('The personnel file is still checked out — it is not required to be returned before separating, but remains open until it is.');
  }
  if (employee?.employeeNumber) {
    separationWarnings.push(`Staff number ${employee.employeeNumber} is still allocated. Release is a separate, deliberate action — it is not required before separating.`);
  }
  if (unreturnedAssetCount > 0) {
    separationWarnings.push(`${unreturnedAssetCount} asset${unreturnedAssetCount === 1 ? '' : 's'} still assigned to this employee — not yet returned.`);
  }

  const [prevEmployee, setPrevEmployee] = useState(employee);
  if (employee && employee !== prevEmployee) {
    setPrevEmployee(employee);
    setFirstName(employee.firstName);
    setLastName(employee.lastName);
    setWorkEmail(employee.workEmail ?? '');
    setPhoneNumber(employee.phoneNumber ?? '');
    setStatus(employee.employmentStatus);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetEmployeeQueryKey(organizationId, employeeId) });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      {
        organizationId,
        employeeId,
        data: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          workEmail: workEmail.trim() || null,
          phoneNumber: phoneNumber.trim() || null,
          employmentStatus: status,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          setIsEditing(false);
          toast({ title: 'Employee updated' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not update employee',
            description: message ?? 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadMutation.mutate(
      { organizationId, employeeId, data: { file } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Profile picture updated' });
        },
        onError: () => {
          toast({ title: 'Could not upload photo', description: 'JPEG, PNG, or WebP up to 5MB.', variant: 'destructive' });
        },
      },
    );
  };

  const handleLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUserId) return;
    linkMutation.mutate(
      { organizationId, employeeId, data: { applicationUserId: Number(linkUserId) } },
      {
        onSuccess: () => {
          setLinkUserId('');
          toast({ title: 'Employee linked to login account' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not link account', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleUnlink = () => {
    unlinkMutation.mutate(
      { organizationId, employeeId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Employee unlinked from login account' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not unlink account', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleSeparate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!separationDate) return;
    separateMutation.mutate(
      { organizationId, employeeId, data: { separationDate, separationReason: separationReason || undefined } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          setIsSeparateOpen(false);
          setSeparationDate('');
          setSeparationReason('');
          toast({ title: 'Employee separated' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not separate employee', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleRehire = () => {
    rehireMutation.mutate(
      { organizationId, employeeId },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          toast({ title: 'Employee rehired' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not rehire employee', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferEffectiveDate) return;
    transferMutation.mutate(
      {
        organizationId,
        employeeId,
        data: {
          effectiveDate: transferEffectiveDate,
          departmentId: transferDepartmentId ? Number(transferDepartmentId) : undefined,
          branchId: transferBranchId ? Number(transferBranchId) : undefined,
          positionId: transferPositionId ? Number(transferPositionId) : undefined,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          setIsTransferOpen(false);
          setTransferEffectiveDate('');
          setTransferDepartmentId('');
          setTransferBranchId('');
          setTransferPositionId('');
          toast({ title: 'Employee transferred' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not transfer employee', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handlePromote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoteEffectiveDate || !promotePositionId) return;
    promoteMutation.mutate(
      {
        organizationId,
        employeeId,
        data: { effectiveDate: promoteEffectiveDate, positionId: Number(promotePositionId) },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          setIsPromoteOpen(false);
          setPromoteEffectiveDate('');
          setPromotePositionId('');
          toast({ title: 'Employee promoted' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not promote employee', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmEffectiveDate) return;
    confirmMutation.mutate(
      {
        organizationId,
        employeeId,
        data: {
          effectiveDate: confirmEffectiveDate,
          probationReviewId: confirmProbationReviewId === NONE_PROBATION_REVIEW ? undefined : Number(confirmProbationReviewId),
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetEmployeeQueryKey(organizationId, employeeId), updated);
          setIsConfirmOpen(false);
          setConfirmEffectiveDate('');
          setConfirmProbationReviewId(NONE_PROBATION_REVIEW);
          toast({ title: 'Employee confirmed' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not confirm employee', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleAddDisciplinaryRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDisciplinaryActionType || !newDisciplinaryDescription || !newDisciplinaryActionDate) return;
    addDisciplinaryRecordMutation.mutate(
      {
        organizationId,
        employeeId,
        data: {
          actionType: newDisciplinaryActionType,
          description: newDisciplinaryDescription,
          actionDate: newDisciplinaryActionDate,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeDisciplinaryRecordsQueryKey(organizationId, employeeId) });
          setNewDisciplinaryActionType('');
          setNewDisciplinaryDescription('');
          setNewDisciplinaryActionDate('');
          toast({ title: 'Disciplinary record added' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not add disciplinary record', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleCreatePersonnelFile = () => {
    if (personnelFileMode === 'manual' && !manualPifNumber.trim()) return;
    createPersonnelFileMutation.mutate(
      {
        organizationId,
        employeeId,
        data: personnelFileMode === 'manual' ? { mode: 'manual', pifNumber: manualPifNumber.trim() } : { mode: 'generate' },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPersonnelFileByEmployeeQueryKey(organizationId, employeeId) });
          setIsPersonnelFileDialogOpen(false);
          setManualPifNumber('');
          setPersonnelFileMode('generate');
          toast({ title: 'Personnel file created' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not create personnel file', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const invalidateCustody = () => {
    queryClient.invalidateQueries({ queryKey: getGetPersonnelFileCustodyQueryKey(organizationId, personnelFile?.id ?? 0) });
    queryClient.invalidateQueries({ queryKey: getListPersonnelFileMovementsQueryKey(organizationId, personnelFile?.id ?? 0) });
  };

  const onCustodyError = (title: string) => (err: unknown) => {
    const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
    toast({ title, description: message ?? 'Please try again.', variant: 'destructive' });
  };

  const handleCheckout = () => {
    if (!personnelFile || !checkoutDestination.trim()) return;
    checkoutMutation.mutate(
      {
        organizationId,
        personnelFileId: personnelFile.id,
        data: {
          destination: checkoutDestination.trim(),
          purpose: checkoutPurpose.trim() || undefined,
          expectedReturnDate: checkoutExpectedReturnDate || undefined,
        },
      },
      {
        onSuccess: () => {
          invalidateCustody();
          setIsCheckoutDialogOpen(false);
          setCheckoutDestination('');
          setCheckoutPurpose('');
          setCheckoutExpectedReturnDate('');
          toast({ title: 'Personnel file checked out' });
        },
        onError: onCustodyError('Could not check out personnel file'),
      },
    );
  };

  const handleReturn = () => {
    if (!personnelFile) return;
    returnMutation.mutate(
      { organizationId, personnelFileId: personnelFile.id, data: { locationId: returnLocationId ? Number(returnLocationId) : undefined } },
      {
        onSuccess: () => {
          invalidateCustody();
          setIsReturnDialogOpen(false);
          setReturnLocationId('');
          toast({ title: 'Personnel file returned' });
        },
        onError: onCustodyError('Could not return personnel file'),
      },
    );
  };

  const handleMarkMissing = () => {
    if (!personnelFile || !missingReason.trim()) return;
    markMissingMutation.mutate(
      { organizationId, personnelFileId: personnelFile.id, data: { notes: missingReason.trim() } },
      {
        onSuccess: () => {
          invalidateCustody();
          setIsMissingDialogOpen(false);
          setMissingReason('');
          toast({ title: 'Personnel file marked missing' });
        },
        onError: onCustodyError('Could not mark personnel file missing'),
      },
    );
  };

  const handleRecover = () => {
    if (!personnelFile) return;
    recoverMutation.mutate(
      { organizationId, personnelFileId: personnelFile.id, data: { locationId: recoverLocationId ? Number(recoverLocationId) : undefined } },
      {
        onSuccess: () => {
          invalidateCustody();
          setIsRecoverDialogOpen(false);
          setRecoverLocationId('');
          toast({ title: 'Personnel file recovered' });
        },
        onError: onCustodyError('Could not recover personnel file'),
      },
    );
  };

  const handleCreateRecordsLocation = () => {
    if (!newLocationName.trim()) return;
    createRecordsLocationMutation.mutate(
      { organizationId, data: { name: newLocationName.trim(), parentId: newLocationParentId ? Number(newLocationParentId) : undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRecordsLocationsQueryKey(organizationId) });
          setNewLocationName('');
          setNewLocationParentId('');
          toast({ title: 'Location created' });
        },
        onError: onCustodyError('Could not create location'),
      },
    );
  };

  const invalidateExitProcesses = () => {
    queryClient.invalidateQueries({ queryKey: getListEmployeeExitProcessesQueryKey(organizationId, employeeId) });
  };

  const handleStartExitProcess = () => {
    createExitProcessMutation.mutate(
      { organizationId, employeeId },
      {
        onSuccess: () => {
          invalidateExitProcesses();
          toast({ title: 'Exit process started' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not start exit process', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const handleUpdateExitProcess = (
    exitProcessId: number,
    data: { checklistCompleted?: boolean; clearanceCompleted?: boolean; exitInterviewCompleted?: boolean; exitInterviewNotes?: string },
  ) => {
    updateExitProcessMutation.mutate(
      { organizationId, employeeId, exitProcessId, data },
      {
        onSuccess: () => invalidateExitProcesses(),
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not update exit process', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const invalidateDocuments = () => {
    queryClient.invalidateQueries({ queryKey: getListEmployeeDocumentsQueryKey(organizationId, employeeId) });
  };

  const handleDocumentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !documentCategoryCode) return;
    uploadDocumentMutation.mutate(
      { organizationId, employeeId, data: { file, categoryCode: documentCategoryCode } },
      {
        onSuccess: () => {
          invalidateDocuments();
          toast({ title: 'Document uploaded' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({
            title: 'Could not upload document',
            description: message ?? 'PDF, JPEG, PNG, DOCX, or XLSX up to 10MB.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleRemoveDocument = (documentId: number) => {
    removeDocumentMutation.mutate(
      { organizationId, employeeId, documentId },
      {
        onSuccess: () => {
          invalidateDocuments();
          toast({ title: 'Document removed' });
        },
        onError: (err) => {
          const message =
            err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
          toast({ title: 'Could not remove document', description: message ?? 'Please try again.', variant: 'destructive' });
        },
      },
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const genericErrorHandler = (title: string) => (err: unknown) => {
    const message = err && typeof err === 'object' && 'error' in err ? String((err as { error: unknown }).error) : undefined;
    toast({ title, description: message ?? 'Please try again.', variant: 'destructive' });
  };

  const handleAddSkill = () => {
    if (!newSkillCode) return;
    addSkillMutation.mutate(
      { organizationId, employeeId, data: { skillCode: newSkillCode, proficiencyLevel: newSkillProficiency || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeSkillsQueryKey(organizationId, employeeId) });
          setNewSkillCode('');
          setNewSkillProficiency('');
          toast({ title: 'Skill added' });
        },
        onError: genericErrorHandler('Could not add skill'),
      },
    );
  };

  const handleRemoveSkill = (skillId: number) => {
    removeSkillMutation.mutate(
      { organizationId, employeeId, skillId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeSkillsQueryKey(organizationId, employeeId) });
          toast({ title: 'Skill removed' });
        },
        onError: genericErrorHandler('Could not remove skill'),
      },
    );
  };

  const handleAddQualification = () => {
    if (!newQualificationCode) return;
    addQualificationMutation.mutate(
      { organizationId, employeeId, data: { qualificationTypeCode: newQualificationCode, institution: newQualificationInstitution || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeQualificationsQueryKey(organizationId, employeeId) });
          setNewQualificationCode('');
          setNewQualificationInstitution('');
          toast({ title: 'Qualification added' });
        },
        onError: genericErrorHandler('Could not add qualification'),
      },
    );
  };

  const handleRemoveQualification = (qualificationId: number) => {
    removeQualificationMutation.mutate(
      { organizationId, employeeId, qualificationId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeQualificationsQueryKey(organizationId, employeeId) });
          toast({ title: 'Qualification removed' });
        },
        onError: genericErrorHandler('Could not remove qualification'),
      },
    );
  };

  const handleAddCertification = () => {
    if (!newCertificationCode) return;
    addCertificationMutation.mutate(
      { organizationId, employeeId, data: { certificationTypeCode: newCertificationCode, issuingOrganization: newCertificationIssuer || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeCertificationsQueryKey(organizationId, employeeId) });
          setNewCertificationCode('');
          setNewCertificationIssuer('');
          toast({ title: 'Certification added' });
        },
        onError: genericErrorHandler('Could not add certification'),
      },
    );
  };

  const handleRemoveCertification = (certificationId: number) => {
    removeCertificationMutation.mutate(
      { organizationId, employeeId, certificationId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEmployeeCertificationsQueryKey(organizationId, employeeId) });
          toast({ title: 'Certification removed' });
        },
        onError: genericErrorHandler('Could not remove certification'),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 lg:p-8">
        <QueryError title="Failed to load employee" message="Could not fetch this employee record." onRetry={() => refetch()} />
      </div>
    );
  }

  if (!employee) return null;

  const initials = `${employee.firstName[0]}${employee.lastName[0]}`.toUpperCase();

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="space-y-2">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to employees
        </Link>
        <h1 className="text-3xl font-bold text-foreground">
          {employee.firstName} {employee.lastName}
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  {photoSrc && <AvatarImage src={photoSrc} alt="" />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                  aria-label="Change profile picture"
                  data-testid="button-upload-photo"
                >
                  {uploadMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Camera className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-photo-file"
                />
              </div>
              {employee.employeeNumber && (
                <p className="text-sm text-muted-foreground font-mono">{employee.employeeNumber}</p>
              )}
              <Badge variant="secondary" className="capitalize">
                {employee.employmentStatus.replace('_', ' ')}
              </Badge>
              {employee.employmentStatus === 'terminated' ? (
                <div className="space-y-1 text-center">
                  {employee.separationDate && (
                    <p className="text-xs text-muted-foreground">
                      Separated {new Date(employee.separationDate).toLocaleDateString()}
                      {employee.separationReason ? ` · ${employee.separationReason}` : ''}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRehire}
                    disabled={rehireMutation.isPending}
                    data-testid="button-rehire-employee"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Rehire
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" data-testid="button-transfer-employee">
                        <ArrowLeftRight className="mr-2 h-4 w-4" aria-hidden="true" />
                        Transfer
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handleTransfer}>
                        <DialogHeader>
                          <DialogTitle>Transfer Employee</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="transfer-effective-date">Effective Date *</Label>
                            <Input
                              id="transfer-effective-date"
                              type="date"
                              value={transferEffectiveDate}
                              onChange={(e) => setTransferEffectiveDate(e.target.value)}
                              required
                              data-testid="input-transfer-effective-date"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="transfer-department">Department</Label>
                            <Select value={transferDepartmentId} onValueChange={setTransferDepartmentId}>
                              <SelectTrigger id="transfer-department" data-testid="select-transfer-department">
                                <SelectValue placeholder="Keep current" />
                              </SelectTrigger>
                              <SelectContent>
                                {(departments ?? []).map((d) => (
                                  <SelectItem key={d.id} value={String(d.id)}>
                                    {d.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="transfer-branch">Branch</Label>
                            <Select value={transferBranchId} onValueChange={setTransferBranchId}>
                              <SelectTrigger id="transfer-branch" data-testid="select-transfer-branch">
                                <SelectValue placeholder="Keep current" />
                              </SelectTrigger>
                              <SelectContent>
                                {(branches ?? []).map((b) => (
                                  <SelectItem key={b.id} value={String(b.id)}>
                                    {b.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="transfer-position">Position</Label>
                            <Select value={transferPositionId} onValueChange={setTransferPositionId}>
                              <SelectTrigger id="transfer-position" data-testid="select-transfer-position">
                                <SelectValue placeholder="Keep current" />
                              </SelectTrigger>
                              <SelectContent>
                                {(positions ?? []).map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={transferMutation.isPending || !transferEffectiveDate}
                            data-testid="button-confirm-transfer"
                          >
                            {transferMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                Transferring…
                              </>
                            ) : (
                              'Confirm Transfer'
                            )}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={isPromoteOpen} onOpenChange={setIsPromoteOpen}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" data-testid="button-promote-employee">
                        <TrendingUp className="mr-2 h-4 w-4" aria-hidden="true" />
                        Promote
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handlePromote}>
                        <DialogHeader>
                          <DialogTitle>Promote Employee</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="promote-effective-date">Effective Date *</Label>
                            <Input
                              id="promote-effective-date"
                              type="date"
                              value={promoteEffectiveDate}
                              onChange={(e) => setPromoteEffectiveDate(e.target.value)}
                              required
                              data-testid="input-promote-effective-date"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="promote-position">New Position *</Label>
                            <Select value={promotePositionId} onValueChange={setPromotePositionId}>
                              <SelectTrigger id="promote-position" data-testid="select-promote-position">
                                <SelectValue placeholder="Choose a position" />
                              </SelectTrigger>
                              <SelectContent>
                                {(positions ?? []).map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            type="submit"
                            disabled={promoteMutation.isPending || !promoteEffectiveDate || !promotePositionId}
                            data-testid="button-confirm-promote"
                          >
                            {promoteMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                Promoting…
                              </>
                            ) : (
                              'Confirm Promotion'
                            )}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>

                  {employee.employmentStatus === 'probation' && (
                    <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm" data-testid="button-confirm-employee-probation">
                          <BadgeCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                          Confirm
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <form onSubmit={handleConfirm}>
                          <DialogHeader>
                            <DialogTitle>Confirm Employee</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label htmlFor="confirm-effective-date">Effective Date *</Label>
                              <Input
                                id="confirm-effective-date"
                                type="date"
                                value={confirmEffectiveDate}
                                onChange={(e) => setConfirmEffectiveDate(e.target.value)}
                                required
                                data-testid="input-confirm-effective-date"
                              />
                            </div>
                            {probationReviewOptions.length > 0 && (
                              <div className="space-y-2">
                                <Label htmlFor="confirm-probation-review-id">Probation Review (optional)</Label>
                                <Select value={confirmProbationReviewId} onValueChange={setConfirmProbationReviewId}>
                                  <SelectTrigger id="confirm-probation-review-id" data-testid="select-confirm-probation-review-id">
                                    <SelectValue placeholder="No review linked" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NONE_PROBATION_REVIEW}>No review linked</SelectItem>
                                    {probationReviewOptions.map(({ review, cycleName }) => (
                                      <SelectItem key={review.id} value={String(review.id)}>
                                        {cycleName} · {review.status.replace(/_/g, ' ')}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </div>
                          <DialogFooter>
                            <Button
                              type="submit"
                              disabled={confirmMutation.isPending || !confirmEffectiveDate}
                              data-testid="button-confirm-confirmation"
                            >
                              {confirmMutation.isPending ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                  Confirming…
                                </>
                              ) : (
                                'Confirm Employee'
                              )}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}

                  <Dialog open={isSeparateOpen} onOpenChange={setIsSeparateOpen}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" data-testid="button-separate-employee">
                        <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                        Separate
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <form onSubmit={handleSeparate}>
                        <DialogHeader>
                          <DialogTitle>Separate Employee</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          {separationWarnings.length > 0 && (
                            <Alert data-testid="alert-separation-warnings">
                              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                              <AlertTitle>Nothing here blocks separation — for your awareness:</AlertTitle>
                              <AlertDescription>
                                <ul className="list-disc space-y-1 pl-4">
                                  {separationWarnings.map((warning) => (
                                    <li key={warning}>{warning}</li>
                                  ))}
                                </ul>
                              </AlertDescription>
                            </Alert>
                          )}
                          <div className="space-y-2">
                            <Label htmlFor="separation-date">Separation Date *</Label>
                            <Input
                              id="separation-date"
                              type="date"
                              value={separationDate}
                              onChange={(e) => setSeparationDate(e.target.value)}
                              required
                              data-testid="input-separation-date"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="separation-reason">Reason</Label>
                            <Select value={separationReason} onValueChange={setSeparationReason}>
                              <SelectTrigger id="separation-reason" data-testid="select-separation-reason">
                                <SelectValue placeholder="Choose a reason" />
                              </SelectTrigger>
                              <SelectContent>
                                {(separationReasons ?? []).map((item) => (
                                  <SelectItem key={item.code} value={item.code}>
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            type="submit"
                            variant="destructive"
                            disabled={separateMutation.isPending || !separationDate}
                            data-testid="button-confirm-separate"
                          >
                            {separateMutation.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                Separating…
                              </>
                            ) : (
                              'Confirm Separation'
                            )}
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-border space-y-3">
              {employee.departmentName && (
                <div className="flex items-center gap-3 text-sm">
                  <Network className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-muted-foreground">Department</p>
                    <p className="font-medium text-foreground">{employee.departmentName}</p>
                  </div>
                </div>
              )}
              {employee.branchName && (
                <div className="flex items-center gap-3 text-sm">
                  <Building className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-muted-foreground">Branch</p>
                    <p className="font-medium text-foreground">{employee.branchName}</p>
                  </div>
                </div>
              )}
              {employee.positionName && (
                <div className="flex items-center gap-3 text-sm">
                  <Briefcase className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-muted-foreground">Position</p>
                    <p className="font-medium text-foreground">{employee.positionName}</p>
                  </div>
                </div>
              )}
            </div>

            {employee.linkedApplicationUserId != null ? (
              (() => {
                const linkedMember = (members ?? []).find(
                  (m) => m.applicationUserId === employee.linkedApplicationUserId,
                );
                return (
                  <div className="pt-4 border-t border-border space-y-2">
                    <Label className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4" aria-hidden="true" />
                      Linked login account
                    </Label>
                    <p className="text-sm text-foreground" data-testid="text-linked-user">
                      {linkedMember ? `${linkedMember.firstName} ${linkedMember.lastName} (${linkedMember.email})` : `User #${employee.linkedApplicationUserId}`}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleUnlink}
                      disabled={unlinkMutation.isPending}
                      data-testid="button-unlink-user"
                    >
                      Unlink
                    </Button>
                  </div>
                );
              })()
            ) : (
              <form onSubmit={handleLink} className="pt-4 border-t border-border space-y-2">
                <Label htmlFor="link-user" className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Link to a login account
                </Label>
                <div className="flex gap-2">
                  <Select value={linkUserId} onValueChange={setLinkUserId}>
                    <SelectTrigger id="link-user" className="flex-1" data-testid="select-link-user">
                      <SelectValue placeholder="Choose a member" />
                    </SelectTrigger>
                    <SelectContent>
                      {(members ?? []).map((m) => (
                        <SelectItem key={m.applicationUserId} value={String(m.applicationUserId)}>
                          {m.firstName} {m.lastName} ({m.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="submit" variant="outline" disabled={linkMutation.isPending || !linkUserId} data-testid="button-link-user">
                    Link
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Connects this HR record to an existing member's login account. The member must already have an
                  active membership in this organisation.
                </p>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Employee Details</CardTitle>
                <CardDescription>Core contact and employment information</CardDescription>
              </div>
              {!isEditing && (
                <Button onClick={() => setIsEditing(true)} data-testid="button-edit-employee">
                  Edit
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6" data-testid="form-employee">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="employee-detail-first-name">First Name *</Label>
                  <Input
                    id="employee-detail-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={!isEditing || updateMutation.isPending}
                    required
                    data-testid="input-detail-first-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employee-detail-last-name">Last Name *</Label>
                  <Input
                    id="employee-detail-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={!isEditing || updateMutation.isPending}
                    required
                    data-testid="input-detail-last-name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="employee-detail-email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Work Email
                </Label>
                <Input
                  id="employee-detail-email"
                  type="email"
                  value={workEmail}
                  onChange={(e) => setWorkEmail(e.target.value)}
                  disabled={!isEditing || updateMutation.isPending}
                  data-testid="input-detail-email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="employee-detail-phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Phone Number
                </Label>
                <Input
                  id="employee-detail-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={!isEditing || updateMutation.isPending}
                  data-testid="input-detail-phone"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="employee-detail-status">Employment Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as UpdateEmployeeInputEmploymentStatus)}
                  disabled={!isEditing || updateMutation.isPending}
                >
                  <SelectTrigger id="employee-detail-status" data-testid="select-detail-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">
                        {s.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isEditing && (
                <div className="flex gap-3 pt-4">
                  <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-employee">
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        Saving…
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsEditing(false);
                      setFirstName(employee.firstName);
                      setLastName(employee.lastName);
                      setWorkEmail(employee.workEmail ?? '');
                      setPhoneNumber(employee.phoneNumber ?? '');
                      setStatus(employee.employmentStatus);
                    }}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-employee"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
            <CardDescription>Files attached to this employee's record</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-2 sm:w-64">
                <Label htmlFor="document-category">Category</Label>
                <Select value={documentCategoryCode} onValueChange={setDocumentCategoryCode}>
                  <SelectTrigger id="document-category" data-testid="select-document-category">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {(documentCategories ?? []).map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => documentFileInputRef.current?.click()}
                disabled={!documentCategoryCode || uploadDocumentMutation.isPending}
                data-testid="button-upload-document"
              >
                {uploadDocumentMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Upload document
              </Button>
              <input
                ref={documentFileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,.docx,.xlsx"
                className="hidden"
                onChange={handleDocumentFileChange}
                data-testid="input-document-file"
              />
            </div>

            {(documents ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(documents ?? []).map((doc) => {
                  const categoryLabel = (documentCategories ?? []).find((c) => c.code === doc.categoryCode)?.label ?? doc.categoryCode;
                  return (
                    <li key={doc.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-document-${doc.id}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{doc.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            {categoryLabel} · {formatFileSize(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveDocument(doc.id)}
                        disabled={removeDocumentMutation.isPending}
                        aria-label={`Remove ${doc.fileName}`}
                        data-testid={`button-remove-document-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              Skills
            </CardTitle>
            <CardDescription>Skills this employee has, from the "skill" Master Data domain</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-2 sm:w-56">
                <Label htmlFor="new-skill-code">Skill</Label>
                <Select value={newSkillCode} onValueChange={setNewSkillCode}>
                  <SelectTrigger id="new-skill-code" data-testid="select-new-skill">
                    <SelectValue placeholder="Choose a skill" />
                  </SelectTrigger>
                  <SelectContent>
                    {(skillOptions ?? []).map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:w-48">
                <Label htmlFor="new-skill-proficiency">Proficiency</Label>
                <Input
                  id="new-skill-proficiency"
                  value={newSkillProficiency}
                  onChange={(e) => setNewSkillProficiency(e.target.value)}
                  placeholder="e.g. Advanced"
                  data-testid="input-new-skill-proficiency"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddSkill}
                disabled={!newSkillCode || addSkillMutation.isPending}
                data-testid="button-add-skill"
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </div>

            {(skills ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No skills recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(skills ?? []).map((skill) => {
                  const label = (skillOptions ?? []).find((s) => s.code === skill.skillCode)?.label ?? skill.skillCode;
                  return (
                    <li key={skill.id} className="flex items-center justify-between gap-4 py-3" data-testid={`row-skill-${skill.id}`}>
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        {skill.proficiencyLevel && <p className="text-xs text-muted-foreground">{skill.proficiencyLevel}</p>}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveSkill(skill.id)}
                        disabled={removeSkillMutation.isPending}
                        aria-label={`Remove ${label}`}
                        data-testid={`button-remove-skill-${skill.id}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5" aria-hidden="true" />
              Qualifications
            </CardTitle>
            <CardDescription>Education and qualifications, from the "qualification_type" Master Data domain</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-2 sm:w-56">
                <Label htmlFor="new-qualification-code">Qualification</Label>
                <Select value={newQualificationCode} onValueChange={setNewQualificationCode}>
                  <SelectTrigger id="new-qualification-code" data-testid="select-new-qualification">
                    <SelectValue placeholder="Choose a qualification" />
                  </SelectTrigger>
                  <SelectContent>
                    {(qualificationTypeOptions ?? []).map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:w-48">
                <Label htmlFor="new-qualification-institution">Institution</Label>
                <Input
                  id="new-qualification-institution"
                  value={newQualificationInstitution}
                  onChange={(e) => setNewQualificationInstitution(e.target.value)}
                  placeholder="e.g. University of Ghana"
                  data-testid="input-new-qualification-institution"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddQualification}
                disabled={!newQualificationCode || addQualificationMutation.isPending}
                data-testid="button-add-qualification"
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </div>

            {(qualifications ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No qualifications recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(qualifications ?? []).map((qualification) => {
                  const label =
                    (qualificationTypeOptions ?? []).find((q) => q.code === qualification.qualificationTypeCode)?.label ??
                    qualification.qualificationTypeCode;
                  return (
                    <li
                      key={qualification.id}
                      className="flex items-center justify-between gap-4 py-3"
                      data-testid={`row-qualification-${qualification.id}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        {qualification.institution && <p className="text-xs text-muted-foreground">{qualification.institution}</p>}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveQualification(qualification.id)}
                        disabled={removeQualificationMutation.isPending}
                        aria-label={`Remove ${label}`}
                        data-testid={`button-remove-qualification-${qualification.id}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5" aria-hidden="true" />
              Certifications
            </CardTitle>
            <CardDescription>Certifications held, from the "certification_type" Master Data domain</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-2 sm:w-56">
                <Label htmlFor="new-certification-code">Certification</Label>
                <Select value={newCertificationCode} onValueChange={setNewCertificationCode}>
                  <SelectTrigger id="new-certification-code" data-testid="select-new-certification">
                    <SelectValue placeholder="Choose a certification" />
                  </SelectTrigger>
                  <SelectContent>
                    {(certificationTypeOptions ?? []).map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:w-48">
                <Label htmlFor="new-certification-issuer">Issuing organization</Label>
                <Input
                  id="new-certification-issuer"
                  value={newCertificationIssuer}
                  onChange={(e) => setNewCertificationIssuer(e.target.value)}
                  placeholder="e.g. PMI"
                  data-testid="input-new-certification-issuer"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddCertification}
                disabled={!newCertificationCode || addCertificationMutation.isPending}
                data-testid="button-add-certification"
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </div>

            {(certifications ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No certifications recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(certifications ?? []).map((certification) => {
                  const label =
                    (certificationTypeOptions ?? []).find((c) => c.code === certification.certificationTypeCode)?.label ??
                    certification.certificationTypeCode;
                  return (
                    <li
                      key={certification.id}
                      className="flex items-center justify-between gap-4 py-3"
                      data-testid={`row-certification-${certification.id}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{label}</p>
                        {certification.issuingOrganization && (
                          <p className="text-xs text-muted-foreground">{certification.issuingOrganization}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveCertification(certification.id)}
                        disabled={removeCertificationMutation.isPending}
                        aria-label={`Remove ${label}`}
                        data-testid={`button-remove-certification-${certification.id}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" aria-hidden="true" />
              Employment History
            </CardTitle>
            <CardDescription>
              Internal movement (transfer, promotion, confirmation) recorded through this employee's own record — read-only, most recent first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {employmentHistoryLoading ? (
              <div className="space-y-2" data-testid="loading-employment-history">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : employmentHistoryError ? (
              <QueryError
                title="Failed to load employment history"
                message="Could not fetch this employee's employment history."
                onRetry={() => refetchEmploymentHistory()}
              />
            ) : (employmentHistory ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-employment-history">
                No employment history recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="list-employment-history">
                {(employmentHistory ?? []).map((period) => (
                  <li key={period.id} className="py-3" data-testid={`row-employment-history-${period.id}`}>
                    <div className="flex items-center justify-between gap-4">
                      <Badge variant="outline" className="capitalize">
                        {period.eventType}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(period.effectiveDate).toLocaleDateString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {!personnelFileForbidden && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <IdCard className="h-5 w-5" aria-hidden="true" />
                    Personnel File
                  </CardTitle>
                  <CardDescription>
                    The permanent personnel record (PIF) — never released or reassigned, independent of staff-number reuse.
                  </CardDescription>
                </div>
                {!personnelFileLoading && !personnelFile && (
                  <Dialog open={isPersonnelFileDialogOpen} onOpenChange={setIsPersonnelFileDialogOpen}>
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" data-testid="button-create-personnel-file">
                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                        Create Personnel File
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Create Personnel File</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          For {employee?.firstName} {employee?.lastName}
                          {employee?.employeeNumber ? ` (${employee.employeeNumber})` : ''} — a permanent PIF number will be
                          assigned and can never be reassigned to anyone else.
                        </p>
                        <div className="space-y-2">
                          <Label htmlFor="personnel-file-mode">PIF Number</Label>
                          <Select value={personnelFileMode} onValueChange={(v) => setPersonnelFileMode(v as CreatePersonnelFileInputMode)}>
                            <SelectTrigger id="personnel-file-mode" data-testid="select-personnel-file-mode">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="generate">Generate automatically</SelectItem>
                              <SelectItem value="manual">Enter manually</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {personnelFileMode === 'manual' && (
                          <div className="space-y-2">
                            <Label htmlFor="manual-pif-number">PIF Number *</Label>
                            <Input
                              id="manual-pif-number"
                              value={manualPifNumber}
                              onChange={(e) => setManualPifNumber(e.target.value)}
                              placeholder="e.g. PIF-001"
                              data-testid="input-manual-pif-number"
                            />
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button
                          type="button"
                          onClick={handleCreatePersonnelFile}
                          disabled={createPersonnelFileMutation.isPending || (personnelFileMode === 'manual' && !manualPifNumber.trim())}
                          data-testid="button-confirm-create-personnel-file"
                        >
                          {createPersonnelFileMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Create
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {personnelFileLoading ? (
                <Skeleton className="h-10 w-full" data-testid="loading-personnel-file" />
              ) : personnelFile ? (
                <div className="grid gap-4 sm:grid-cols-2" data-testid="personnel-file-summary">
                  <div>
                    <p className="text-xs text-muted-foreground">PIF Number</p>
                    <p className="font-mono text-sm font-medium" data-testid="text-pif-number">{personnelFile.pifNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Current Staff Number</p>
                    <p className="font-mono text-sm font-medium">{employee?.employeeNumber ?? '—'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <Badge variant="outline" className="capitalize">{personnelFile.allocationMethod}</Badge>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-personnel-file">
                  No personnel file yet.
                </p>
              )}

              {personnelFile && (
                <div className="space-y-3 border-t border-border pt-4" data-testid="physical-custody-section">
                  {custodyLoading ? (
                    <Skeleton className="h-10 w-full" data-testid="loading-custody" />
                  ) : custody ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Physical Custody:</span>
                        <Badge
                          variant={custody.currentCustodyState === 'missing' ? 'destructive' : custody.currentCustodyState === 'checked_out' ? 'secondary' : 'outline'}
                          data-testid="badge-custody-state"
                        >
                          {custody.currentCustodyState === 'in_registry' ? 'In Registry' : custody.currentCustodyState === 'checked_out' ? 'Checked Out' : 'Missing'}
                        </Badge>
                        {custody.overdue && (
                          <Badge variant="destructive" data-testid="badge-overdue" className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Overdue (computed)
                          </Badge>
                        )}
                        {custody.currentLocationId != null && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                            {(recordsLocations ?? []).find((l) => l.id === custody.currentLocationId)?.name ?? `Location #${custody.currentLocationId}`}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {custody.currentCustodyState === 'in_registry' && (
                          <Dialog open={isCheckoutDialogOpen} onOpenChange={setIsCheckoutDialogOpen}>
                            <DialogTrigger asChild>
                              <Button type="button" variant="outline" size="sm" data-testid="button-checkout">Check Out</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader><DialogTitle>Check Out Personnel File</DialogTitle></DialogHeader>
                              <div className="space-y-4">
                                <div className="space-y-2">
                                  <Label htmlFor="checkout-destination">Checked Out To *</Label>
                                  <Input id="checkout-destination" value={checkoutDestination} onChange={(e) => setCheckoutDestination(e.target.value)} placeholder="e.g. Jane Doe (HR)" data-testid="input-checkout-destination" />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="checkout-purpose">Purpose</Label>
                                  <Input id="checkout-purpose" value={checkoutPurpose} onChange={(e) => setCheckoutPurpose(e.target.value)} placeholder="e.g. Audit review" />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="checkout-expected-return">Expected Return Date</Label>
                                  <Input id="checkout-expected-return" type="date" value={checkoutExpectedReturnDate} onChange={(e) => setCheckoutExpectedReturnDate(e.target.value)} />
                                </div>
                              </div>
                              <DialogFooter>
                                <Button type="button" onClick={handleCheckout} disabled={checkoutMutation.isPending || !checkoutDestination.trim()} data-testid="button-confirm-checkout">
                                  {checkoutMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                  Check Out
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        )}

                        {(custody.currentCustodyState === 'checked_out' || custody.currentCustodyState === 'missing') && (
                          <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
                            <DialogTrigger asChild>
                              <Button type="button" variant="outline" size="sm" data-testid="button-return">Return</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader><DialogTitle>Return Personnel File</DialogTitle></DialogHeader>
                              <div className="space-y-2">
                                <Label htmlFor="return-location">Return To Location</Label>
                                <Select value={returnLocationId} onValueChange={setReturnLocationId}>
                                  <SelectTrigger id="return-location"><SelectValue placeholder="Select a location" /></SelectTrigger>
                                  <SelectContent>
                                    {(recordsLocations ?? []).filter((l) => l.status === 'active').map((l) => (
                                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <DialogFooter>
                                <Button type="button" onClick={handleReturn} disabled={returnMutation.isPending} data-testid="button-confirm-return">
                                  {returnMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                  Return
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        )}

                        {custody.currentCustodyState === 'checked_out' && (
                          <Dialog open={isMissingDialogOpen} onOpenChange={setIsMissingDialogOpen}>
                            <DialogTrigger asChild>
                              <Button type="button" variant="outline" size="sm" data-testid="button-mark-missing">Mark Missing</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader><DialogTitle>Mark Personnel File Missing</DialogTitle></DialogHeader>
                              <div className="space-y-2">
                                <Label htmlFor="missing-reason">Reason *</Label>
                                <Input id="missing-reason" value={missingReason} onChange={(e) => setMissingReason(e.target.value)} placeholder="e.g. Not found during audit" data-testid="input-missing-reason" />
                              </div>
                              <DialogFooter>
                                <Button type="button" variant="destructive" onClick={handleMarkMissing} disabled={markMissingMutation.isPending || !missingReason.trim()} data-testid="button-confirm-mark-missing">
                                  {markMissingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                  Mark Missing
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        )}

                        {custody.currentCustodyState === 'missing' && (
                          <Dialog open={isRecoverDialogOpen} onOpenChange={setIsRecoverDialogOpen}>
                            <DialogTrigger asChild>
                              <Button type="button" variant="outline" size="sm" data-testid="button-recover">Recover</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader><DialogTitle>Recover Personnel File</DialogTitle></DialogHeader>
                              <div className="space-y-2">
                                <Label htmlFor="recover-location">Found At Location</Label>
                                <Select value={recoverLocationId} onValueChange={setRecoverLocationId}>
                                  <SelectTrigger id="recover-location"><SelectValue placeholder="Select a location" /></SelectTrigger>
                                  <SelectContent>
                                    {(recordsLocations ?? []).filter((l) => l.status === 'active').map((l) => (
                                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <DialogFooter>
                                <Button type="button" onClick={handleRecover} disabled={recoverMutation.isPending} data-testid="button-confirm-recover">
                                  {recoverMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                                  Recover
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        )}

                        <Dialog open={isLocationsDialogOpen} onOpenChange={setIsLocationsDialogOpen}>
                          <DialogTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" data-testid="button-manage-locations">
                              <PackageSearch className="mr-2 h-4 w-4" aria-hidden="true" />
                              Manage Locations
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Records Locations</DialogTitle></DialogHeader>
                            <div className="space-y-4">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                  <Label htmlFor="new-location-name">Name *</Label>
                                  <Input id="new-location-name" value={newLocationName} onChange={(e) => setNewLocationName(e.target.value)} placeholder="e.g. Cabinet 2" data-testid="input-new-location-name" />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="new-location-parent">Parent (optional)</Label>
                                  <Select value={newLocationParentId} onValueChange={setNewLocationParentId}>
                                    <SelectTrigger id="new-location-parent"><SelectValue placeholder="None (root)" /></SelectTrigger>
                                    <SelectContent>
                                      {(recordsLocations ?? []).map((l) => (
                                        <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <Button type="button" size="sm" onClick={handleCreateRecordsLocation} disabled={createRecordsLocationMutation.isPending || !newLocationName.trim()} data-testid="button-add-location">
                                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                                Add Location
                              </Button>
                              <ul className="divide-y divide-border max-h-64 overflow-y-auto" data-testid="list-records-locations">
                                {(recordsLocations ?? []).map((l) => (
                                  <li key={l.id} className="py-2 flex items-center justify-between gap-2">
                                    <span className="text-sm">
                                      {l.name}
                                      {l.parentId != null && (
                                        <span className="text-xs text-muted-foreground"> (in {(recordsLocations ?? []).find((p) => p.id === l.parentId)?.name ?? `#${l.parentId}`})</span>
                                      )}
                                    </span>
                                    <Badge variant={l.status === 'retired' ? 'outline' : 'default'}>{l.status}</Badge>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </>
                  ) : null}

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMovementHistory((v) => !v)}
                    data-testid="button-toggle-movement-history"
                  >
                    <History className="mr-2 h-4 w-4" aria-hidden="true" />
                    {showMovementHistory ? 'Hide' : 'View'} movement history
                  </Button>
                  {showMovementHistory && (
                    <div>
                      {movementsLoading ? (
                        <Skeleton className="h-10 w-full" />
                      ) : (movements ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No movement history recorded yet.</p>
                      ) : (
                        <ul className="divide-y divide-border" data-testid="list-movement-history">
                          {(movements ?? []).map((m) => (
                            <li key={m.id} className="py-2 flex items-center justify-between gap-4" data-testid={`row-movement-${m.id}`}>
                              <Badge variant="outline" className="capitalize">{m.eventType.replace('_', ' ')}</Badge>
                              <span className="text-xs text-muted-foreground">{new Date(m.occurredAt).toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowStaffNumberHistory((v) => !v)}
                  data-testid="button-toggle-staff-number-history"
                >
                  <History className="mr-2 h-4 w-4" aria-hidden="true" />
                  {showStaffNumberHistory ? 'Hide' : 'View'} staff-number history
                </Button>
                {showStaffNumberHistory && (
                  <div className="mt-2">
                    {staffNumberHistoryLoading ? (
                      <Skeleton className="h-10 w-full" />
                    ) : (staffNumberHistory ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">No staff-number allocations recorded yet.</p>
                    ) : (
                      <ul className="divide-y divide-border" data-testid="list-staff-number-history">
                        {(staffNumberHistory ?? []).map((allocation) => (
                          <li key={allocation.id} className="py-2 flex items-center justify-between gap-4" data-testid={`row-staff-number-history-${allocation.id}`}>
                            <span className="font-mono text-sm">{allocation.employeeNumber}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant={allocation.validTo === null ? 'default' : 'outline'}>
                                {allocation.validTo === null ? 'Current' : 'Released'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{allocation.allocationMethod}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!disciplinaryRecordsError && (
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
                Disciplinary Records
              </CardTitle>
              <CardDescription>Warnings and disciplinary actions — append-only, prior records are never replaced</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleAddDisciplinaryRecord} className="grid gap-3 sm:grid-cols-4 sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="new-disciplinary-action-type">Action Type *</Label>
                  <Input
                    id="new-disciplinary-action-type"
                    value={newDisciplinaryActionType}
                    onChange={(e) => setNewDisciplinaryActionType(e.target.value)}
                    placeholder="e.g. Written Warning"
                    required
                    data-testid="input-new-disciplinary-action-type"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="new-disciplinary-description">Description *</Label>
                  <Input
                    id="new-disciplinary-description"
                    value={newDisciplinaryDescription}
                    onChange={(e) => setNewDisciplinaryDescription(e.target.value)}
                    placeholder="Details of the incident/action"
                    required
                    data-testid="input-new-disciplinary-description"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-disciplinary-date">Action Date *</Label>
                  <Input
                    id="new-disciplinary-date"
                    type="date"
                    value={newDisciplinaryActionDate}
                    onChange={(e) => setNewDisciplinaryActionDate(e.target.value)}
                    required
                    data-testid="input-new-disciplinary-date"
                  />
                </div>
                <div className="sm:col-span-4">
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      addDisciplinaryRecordMutation.isPending ||
                      !newDisciplinaryActionType ||
                      !newDisciplinaryDescription ||
                      !newDisciplinaryActionDate
                    }
                    data-testid="button-add-disciplinary-record"
                  >
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Record Action
                  </Button>
                </div>
              </form>

              {(disciplinaryRecords ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No disciplinary records.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(disciplinaryRecords ?? []).map((record) => (
                    <li key={record.id} className="py-3" data-testid={`row-disciplinary-record-${record.id}`}>
                      <p className="text-sm font-medium text-foreground">{record.actionType}</p>
                      <p className="text-sm text-muted-foreground">{record.description}</p>
                      <p className="text-xs text-muted-foreground">{new Date(record.actionDate).toLocaleDateString()}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <LogOut className="h-5 w-5" aria-hidden="true" />
                  Exit Management
                </CardTitle>
                <CardDescription>Off-boarding checklist, clearance, and exit interview — attached to the separation event</CardDescription>
              </div>
              {employee.employmentStatus === 'terminated' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleStartExitProcess}
                  disabled={createExitProcessMutation.isPending}
                  data-testid="button-start-exit-process"
                >
                  {createExitProcessMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Start Exit Process
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(exitProcesses ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No exit process started.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(exitProcesses ?? []).map((process) => (
                  <li key={process.id} className="space-y-3 py-4" data-testid={`row-exit-process-${process.id}`}>
                    <p className="text-sm font-medium text-foreground">
                      Separation on {new Date(process.separationDate).toLocaleDateString()}
                    </p>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={process.checklistCompleted}
                          onCheckedChange={(checked) => handleUpdateExitProcess(process.id, { checklistCompleted: checked === true })}
                          data-testid={`checkbox-exit-checklist-${process.id}`}
                        />
                        Checklist complete
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={process.clearanceCompleted}
                          onCheckedChange={(checked) => handleUpdateExitProcess(process.id, { clearanceCompleted: checked === true })}
                          data-testid={`checkbox-exit-clearance-${process.id}`}
                        />
                        Clearance complete
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={process.exitInterviewCompleted}
                          onCheckedChange={(checked) => handleUpdateExitProcess(process.id, { exitInterviewCompleted: checked === true })}
                          data-testid={`checkbox-exit-interview-${process.id}`}
                        />
                        Exit interview complete
                      </label>
                    </div>
                    <div className="space-y-2 sm:max-w-md">
                      <Label htmlFor={`exit-interview-notes-${process.id}`}>Exit interview notes</Label>
                      <Input
                        id={`exit-interview-notes-${process.id}`}
                        defaultValue={process.exitInterviewNotes ?? ''}
                        onBlur={(e) => handleUpdateExitProcess(process.id, { exitInterviewNotes: e.target.value })}
                        placeholder="Notes from the exit interview"
                        data-testid={`input-exit-interview-notes-${process.id}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
