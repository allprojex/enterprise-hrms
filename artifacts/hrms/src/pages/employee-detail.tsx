import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, Loader2, Mail, Phone, Building, Network, Briefcase, Camera, UserPlus, UserCheck, UserX, RotateCcw, FileText, Upload, Trash2, Award, GraduationCap, Sparkles, Plus, ArrowLeftRight, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
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
  getRemoveEmployeeProfilePictureUrl,
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
  useTransferEmployee,
  usePromoteEmployee,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListPositions,
  getListPositionsQueryKey,
} from '@workspace/api-client-react';
import type { UpdateEmployeeInputEmploymentStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { getStoredToken } from '@/lib/auth';
import { QueryError } from '@/components/query-error';

const STATUS_OPTIONS: UpdateEmployeeInputEmploymentStatus[] = [
  'active',
  'probation',
  'on_leave',
  'suspended',
  'terminated',
];

/** Employee photos are served from an authenticated endpoint — a plain
 * <img src> can't attach the Bearer token, so this fetches the bytes
 * manually and hands the component an object URL. */
function useEmployeePhoto(organizationId: number, employeeId: number, hasPicture: boolean) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Nothing to fetch — leave state untouched rather than setState-ing
    // synchronously in the effect body; the hook's return value already
    // gates on `hasPicture` below, so a stale `src` here is never surfaced.
    if (!hasPicture) return;

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      const token = getStoredToken();
      const res = await fetch(getRemoveEmployeeProfilePictureUrl(organizationId, employeeId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok || cancelled) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setSrc(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [organizationId, employeeId, hasPicture]);

  return hasPicture ? src : null;
}

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

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: positions } = useListPositions(organizationId, {
    query: { queryKey: getListPositionsQueryKey(organizationId), enabled: organizationId > 0 },
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
      </div>
    </div>
  );
}
