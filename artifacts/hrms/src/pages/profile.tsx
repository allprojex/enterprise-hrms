import { useRef, useState } from 'react';
import { User, Loader2, Building, Briefcase, Phone, Mail, Camera, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetMe,
  getGetMeQueryKey,
  useUpdateMyProfile,
  useListMyOrganizations,
  getListMyOrganizationsQueryKey,
  useGetMyEmployee,
  getGetMyEmployeeQueryKey,
  useUploadMyEmployeeProfilePicture,
  useRemoveMyEmployeeProfilePicture,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useMyProfilePhoto } from '@/hooks/use-employee-photo';
import { ConfirmActionDialog } from '@/components/foundation';

export default function Profile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: user, isLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: organizations } = useListMyOrganizations({ query: { queryKey: getListMyOrganizationsQueryKey() } });
  const updateProfileMutation = useUpdateMyProfile();

  const { data: myEmployeeResponse } = useGetMyEmployee({
    query: { queryKey: getGetMyEmployeeQueryKey(), enabled: !!user },
  });
  const hasProfilePicture = myEmployeeResponse?.employee?.hasProfilePicture ?? false;
  // A login linked to an employee record takes its name, job title and
  // department from that HR-owned record; only the account phone number is
  // editable here (PATCH /users/me refuses the rest for linked accounts). An
  // unlinked account — platform/Super Admin/bootstrap users — has no employee
  // record, so its own account fields remain its identity and stay editable.
  const linkedEmployee = myEmployeeResponse?.linked ? myEmployeeResponse.employee ?? null : null;
  const identity = linkedEmployee
    ? {
        firstName: linkedEmployee.firstName,
        lastName: linkedEmployee.lastName,
        jobTitle: linkedEmployee.positionName ?? null,
        department: linkedEmployee.departmentName ?? null,
      }
    : user
      ? { firstName: user.firstName, lastName: user.lastName, jobTitle: user.jobTitle ?? null, department: user.department ?? null }
      : null;
  const photoSrc = useMyProfilePhoto(hasProfilePicture);
  const uploadPhotoMutation = useUploadMyEmployeeProfilePicture();
  const removePhotoMutation = useRemoveMyEmployeeProfilePicture();

  const invalidateEmployeeProfile = () => {
    queryClient.invalidateQueries({ queryKey: getGetMyEmployeeQueryKey() });
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadPhotoMutation.mutate(
      { data: { file } },
      {
        onSuccess: () => {
          invalidateEmployeeProfile();
          toast({ title: 'Profile picture updated' });
        },
        onError: () => {
          toast({ title: 'Could not upload photo', description: 'JPEG, PNG, or WebP up to 5MB.', variant: 'destructive' });
        },
      },
    );
  };

  const [isRemovePhotoConfirmOpen, setIsRemovePhotoConfirmOpen] = useState(false);

  const handleRemovePhoto = () =>
    removePhotoMutation.mutateAsync(undefined, {
      onSuccess: () => {
        invalidateEmployeeProfile();
        toast({ title: 'Profile picture removed' });
      },
      onError: () => {
        toast({ title: 'Could not remove photo', variant: 'destructive' });
      },
    });

  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Sync local editable state from the fetched profile. Adjusting state
  // directly during render (rather than in an effect) avoids an extra
  // render pass and a synchronous setState call inside an effect body —
  // see https://react.dev/learn/you-might-not-need-an-effect
  const [prevUser, setPrevUser] = useState(user);
  if (user && user !== prevUser) {
    setPrevUser(user);
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setJobTitle(user.jobTitle || '');
    setDepartment(user.department || '');
    setPhoneNumber(user.phoneNumber || '');
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    updateProfileMutation.mutate(
      {
        data: linkedEmployee
          ? { phoneNumber: phoneNumber || null }
          : {
              firstName,
              lastName,
              jobTitle: jobTitle || null,
              department: department || null,
              phoneNumber: phoneNumber || null,
            },
      },
      {
        onSuccess: (updatedUser) => {
          queryClient.setQueryData(getGetMeQueryKey(), updatedUser);
          setIsEditing(false);
          toast({
            title: 'Profile updated',
            description: 'Your profile information has been saved successfully.',
          });
        },
        onError: (error) => {
          toast({
            title: 'Update failed',
            description: error instanceof Error ? error.message : 'Unable to update profile. Please try again.',
            variant: 'destructive',
          });
        }
      }
    );
  };

  const handleCancel = () => {
    if (user) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setJobTitle(user.jobTitle || '');
      setDepartment(user.department || '');
      setPhoneNumber(user.phoneNumber || '');
    }
    setIsEditing(false);
  };

  const activeOrganizationId = user?.activeOrganizationId ?? user?.organizationId;
  const currentOrg = organizations?.find(org => org.organizationId === activeOrganizationId);
  const identityLocked = linkedEmployee != null || !isEditing || updateProfileMutation.isPending;
  const userInitials = identity
    ? `${(identity.firstName ?? '').charAt(0)}${(identity.lastName ?? '').charAt(0)}`.toUpperCase() || '?'
    : '?';
  // user.role is the legacy platform-wide column -- it never reflects an
  // org_admin/hr_manager granted through the membership_roles system, so a
  // genuine organization administrator would see their own profile badge
  // say "Employee". Same currentOrg.roles source app-shell's nav gating
  // already reads from.
  const roleLabel = (() => {
    const roles = currentOrg?.roles ?? [];
    if (roles.includes('super_admin')) return 'Super Admin';
    if (roles.includes('org_admin')) return 'Organization Administrator';
    if (roles.includes('hr')) return 'HR';
    if (roles.includes('hr_administrator')) return 'HR Administrator';
    if (roles.includes('hr_manager')) return 'HR Manager';
    if (roles.includes('employee')) return 'Employee';
    if (roles.length > 0) return roles[0].replace(/_/g, ' ');
    return user?.role.replace('_', ' ') ?? '';
  })();

  if (isLoading) {
    return (
      <div className="p-6 lg:p-8 space-y-8">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-1" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">My Profile</h1>
        <p className="text-muted-foreground">Manage your personal information and account settings</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Card */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  {photoSrc && <AvatarImage src={photoSrc} alt="" />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-semibold">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                {myEmployeeResponse?.linked && (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadPhotoMutation.isPending}
                      aria-label="Change profile picture"
                      data-testid="button-upload-photo"
                    >
                      {uploadPhotoMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Camera className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                    {hasProfilePicture && (
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="absolute -top-1 -right-1 h-6 w-6 rounded-full"
                        onClick={() => setIsRemovePhotoConfirmOpen(true)}
                        disabled={removePhotoMutation.isPending}
                        aria-label="Remove profile picture"
                        data-testid="button-remove-photo"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </Button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handlePhotoChange}
                      data-testid="input-photo-file"
                    />
                  </>
                )}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-foreground" data-testid="text-profile-name">
                  {identity?.firstName} {identity?.lastName}
                </h3>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <Badge variant="secondary" className="capitalize">
                {roleLabel}
              </Badge>
            </div>

            {currentOrg && (
              <div className="pt-4 border-t border-border space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Organization</p>
                    <p className="font-medium text-foreground">{currentOrg.organizationName}</p>
                  </div>
                </div>
                {identity?.jobTitle && (
                  <div className="flex items-center gap-3 text-sm">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Job Title</p>
                      <p className="font-medium text-foreground">{identity.jobTitle}</p>
                    </div>
                  </div>
                )}
                {identity?.department && (
                  <div className="flex items-center gap-3 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Department</p>
                      <p className="font-medium text-foreground">{identity.department}</p>
                    </div>
                  </div>
                )}
                {user.phoneNumber && (
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="font-medium text-foreground">{user.phoneNumber}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Profile Form */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Personal Details</CardTitle>
                <CardDescription data-testid="text-profile-description">
                  {linkedEmployee
                    ? 'Your name, job title and department come from your employee record and are managed by HR.'
                    : 'Update your personal information'}
                </CardDescription>
              </div>
              {!isEditing && (
                <Button onClick={() => setIsEditing(true)} data-testid="button-edit">
                  Edit Profile
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6" data-testid="form-profile">
              {linkedEmployee && (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground" data-testid="text-identity-managed-by-hr">
                  Name, job title and department are maintained by HR on your employee record. To correct them, submit a request from My Requests.
                </p>
              )}
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    type="text"
                    value={linkedEmployee ? identity?.firstName ?? '' : firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={identityLocked}
                    required
                    data-testid="input-firstName"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    type="text"
                    value={linkedEmployee ? identity?.lastName ?? '' : lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={identityLocked}
                    required
                    data-testid="input-lastName"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={user.email}
                    disabled
                    className="bg-muted/30"
                    data-testid="input-email"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Email address cannot be changed. Contact your administrator.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job Title</Label>
                <Input
                  id="jobTitle"
                  type="text"
                  placeholder={linkedEmployee ? undefined : 'e.g. HR Manager'}
                  value={linkedEmployee ? identity?.jobTitle ?? '' : jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  disabled={identityLocked}
                  data-testid="input-jobTitle"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  type="text"
                  placeholder={linkedEmployee ? undefined : 'e.g. Human Resources'}
                  value={linkedEmployee ? identity?.department ?? '' : department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={identityLocked}
                  data-testid="input-department"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phoneNumber">Phone Number</Label>
                <Input
                  id="phoneNumber"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  disabled={!isEditing || updateProfileMutation.isPending}
                  data-testid="input-phoneNumber"
                />
              </div>

              {isEditing && (
                <div className="flex gap-3 pt-4">
                  <Button 
                    type="submit" 
                    disabled={updateProfileMutation.isPending}
                    data-testid="button-save"
                  >
                    {updateProfileMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleCancel}
                    disabled={updateProfileMutation.isPending}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      <ConfirmActionDialog
        open={isRemovePhotoConfirmOpen}
        onOpenChange={setIsRemovePhotoConfirmOpen}
        title="Remove profile picture?"
        description="Your current profile picture will be permanently deleted and your initials will be shown instead. You can upload a new picture at any time."
        confirmLabel="Remove Profile Picture"
        tone="destructive"
        onConfirm={handleRemovePhoto}
        testId="dialog-remove-photo"
      />
    </div>
  );
}
