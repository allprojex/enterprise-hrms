import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'wouter';
import { ArrowLeft, Loader2, Mail, Phone, Building, Network, Briefcase, Camera, UserPlus, UserCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  useGetEmployee,
  getGetEmployeeQueryKey,
  useUpdateEmployee,
  useUploadEmployeeProfilePicture,
  useLinkEmployeeToUser,
  useUnlinkEmployeeFromUser,
  useListMembers,
  getListMembersQueryKey,
  getRemoveEmployeeProfilePictureUrl,
  useGetMe,
  getGetMeQueryKey,
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

  const updateMutation = useUpdateEmployee();
  const uploadMutation = useUploadEmployeeProfilePicture();
  const linkMutation = useLinkEmployeeToUser();
  const unlinkMutation = useUnlinkEmployeeFromUser();

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState<UpdateEmployeeInputEmploymentStatus>('active');
  const [linkUserId, setLinkUserId] = useState('');

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
      </div>
    </div>
  );
}
