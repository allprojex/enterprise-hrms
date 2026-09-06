import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImageUp, CheckCircle2 } from 'lucide-react';
import {
  useGetOrganization,
  getGetOrganizationQueryKey,
  useUploadOrganizationLogo,
  getListMyOrganizationsQueryKey,
  getGetTenantContextQueryKey,
  type Organization,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, OrganizationLogo } from '@/components/foundation';
import { useToast } from '@/hooks/use-toast';
import {
  LOGO_ACCEPT_ATTRIBUTE,
  LOGO_REQUIREMENTS_TEXT,
  formatFileSize,
  validateLogoFile,
} from '@/lib/logo-upload-validation';

/**
 * OrganizationBrandingCard (WS-25 Organization Branding).
 *
 * The reusable "Organization Branding" section: shows which organization is
 * being managed, its current logo (or the neutral fallback), and the governed
 * upload flow — choose → validate locally → preview → confirm → PATCH
 * /organizations/:id/logo → refreshed everywhere the logo is read.
 *
 * Authority is the server's: the caller must be authenticated, an active
 * member of `organizationId`, and hold `organization.update`. This card only
 * decides what to show; it never calls storage directly and never stores
 * base64 or a data URL. Every consumer of the logo (sidebar membership
 * summary, sign-in tenant context, the organization record) is invalidated
 * on success so the new file is fetched under its new, unique URL — the
 * previous URL is never re-requested, so a stale failed image cannot linger.
 */
export interface OrganizationBrandingCardProps {
  organizationId: number;
  className?: string;
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      return String((data as { error: unknown }).error);
    }
    if ('error' in err) return String((err as { error: unknown }).error);
    if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
  }
  return 'The logo could not be saved. Please try again.';
}

function createPreviewUrl(file: File): string | null {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string | null) {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Nothing to recover from: the object URL simply lives until unload.
  }
}

export function OrganizationBrandingCard({ organizationId, className }: OrganizationBrandingCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: organization,
    isLoading,
    error,
    refetch,
  } = useGetOrganization(organizationId, {
    query: { queryKey: getGetOrganizationQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const uploadMutation = useUploadOrganizationLogo();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Release the object URL whenever it is replaced or the card unmounts.
  useEffect(() => () => revokePreviewUrl(previewUrl), [previewUrl]);

  const clearSelection = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openChooser = () => {
    setValidationError(null);
    setUploadError(null);
    setSuccessMessage(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Reset so choosing the same file again re-triggers `change`.
    event.target.value = '';
    setValidationError(null);
    setUploadError(null);
    setSuccessMessage(null);
    if (!file) return;

    setChecking(true);
    const result = await validateLogoFile(file);
    setChecking(false);
    if (!result.ok) {
      clearSelection();
      setValidationError(result.reason);
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(createPreviewUrl(file));
  };

  const handleConfirm = () => {
    if (!selectedFile) return;
    setUploadError(null);
    setSuccessMessage(null);
    uploadMutation.mutate(
      { id: organizationId, data: { file: selectedFile } },
      {
        onSuccess: (response) => {
          // The organization record this card reads.
          queryClient.setQueryData<Organization | undefined>(getGetOrganizationQueryKey(organizationId), (previous) =>
            previous ? { ...previous, logoUrl: response.logoUrl } : previous,
          );
          queryClient.invalidateQueries({ queryKey: getGetOrganizationQueryKey(organizationId) });
          // Every other reader of the logo: sidebar membership summaries and
          // the hostname-scoped sign-in context.
          queryClient.invalidateQueries({ queryKey: getListMyOrganizationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTenantContextQueryKey() });
          clearSelection();
          setSuccessMessage('Logo updated. It now appears on the sign-in page, in navigation and on invitations.');
          toast({ title: 'Logo updated', description: 'The new organization logo is live.', variant: 'success' });
        },
        onError: (err) => {
          const message = extractErrorMessage(err);
          setUploadError(message);
          toast({ title: 'Logo not saved', description: message, variant: 'destructive' });
        },
      },
    );
  };

  const handleCancel = () => {
    clearSelection();
    setValidationError(null);
    setUploadError(null);
  };

  if (isLoading) {
    return (
      <Card className={className} data-testid="card-organization-branding" aria-busy="true">
        <CardHeader>
          <CardTitle>Organization branding</CardTitle>
          <CardDescription>Loading organization…</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-5">
          <Skeleton className="h-24 w-48" />
          <Skeleton className="h-24 flex-1" />
        </CardContent>
      </Card>
    );
  }

  if (error || !organization) {
    return (
      <Card className={className} data-testid="card-organization-branding">
        <CardHeader>
          <CardTitle>Organization branding</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            size="sm"
            title="Could not load the organization"
            message="The branding section needs the organization record to know which logo to show."
            onRetry={() => refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const hasLogo = Boolean(organization.logoUrl);
  const displayedLogoUrl = previewUrl ?? organization.logoUrl ?? null;
  const previewCaption = selectedFile
    ? 'New logo (not saved yet)'
    : hasLogo
      ? 'Current logo'
      : 'No logo uploaded — initials are shown instead';
  const isSaving = uploadMutation.isPending;

  return (
    <Card className={className} data-testid="card-organization-branding">
      <CardHeader>
        <CardTitle>Organization branding</CardTitle>
        <CardDescription>
          The logo shown on the sign-in page, in navigation and on invitations for{' '}
          <span className="font-medium text-foreground" data-testid="branding-organization-name">
            {organization.name}
          </span>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex w-full flex-col items-center gap-2 sm:w-auto sm:items-start">
            <OrganizationLogo
              logoUrl={displayedLogoUrl}
              name={organization.name}
              size="wide"
              variant="plate"
              data-testid="organization-logo-preview"
              imgTestId="img-organization-logo-preview"
            />
            <span className="text-meta text-foreground-muted" data-testid="branding-preview-caption">
              {previewCaption}
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
              <dt className="text-foreground-muted">Organization</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{organization.name}</dd>
              <dt className="text-foreground-muted">Tenant code</dt>
              <dd className="min-w-0 truncate font-mono text-helper text-foreground-muted" data-testid="branding-organization-slug">
                {organization.slug}
              </dd>
            </dl>

            <p className="text-helper text-foreground-muted" id="logo-file-requirements">
              {LOGO_REQUIREMENTS_TEXT}. Transparent PNG or WebP backgrounds are kept; the original proportions are
              always preserved.
            </p>

            <input
              ref={fileInputRef}
              id="organization-logo-file"
              type="file"
              accept={LOGO_ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose organization logo file"
              aria-describedby="logo-file-requirements"
              onChange={handleFileChange}
              data-testid="input-organization-logo-file"
            />

            {selectedFile ? (
              <div className="space-y-3">
                <p className="text-body-sm text-foreground" data-testid="branding-selected-file">
                  Selected: <span className="font-medium">{selectedFile.name}</span>{' '}
                  <span className="text-foreground-muted">({formatFileSize(selectedFile.size)})</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={handleConfirm} loading={isSaving} data-testid="button-save-logo">
                    <CheckCircle2 aria-hidden="true" />
                    Save logo
                  </Button>
                  <Button variant="ghost" onClick={handleCancel} disabled={isSaving} data-testid="button-cancel-logo">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={openChooser}
                  loading={checking}
                  aria-describedby="logo-file-requirements"
                  data-testid="button-choose-logo"
                >
                  <ImageUp aria-hidden="true" />
                  {hasLogo ? 'Change logo' : 'Upload logo'}
                </Button>
              </div>
            )}

            {(validationError || uploadError) && (
              <p role="alert" className="text-body-sm text-danger-soft-foreground" data-testid="branding-error">
                {validationError ?? uploadError}
              </p>
            )}
            <p
              role="status"
              aria-live="polite"
              className={successMessage ? 'flex items-start gap-2 text-body-sm text-success-soft-foreground' : 'sr-only'}
              data-testid="branding-status"
            >
              {successMessage && <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
              {successMessage}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
