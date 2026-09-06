/**
 * WS-25 Organization Branding — the reusable OrganizationBrandingCard.
 *
 * Pins the governed upload flow end to end from the person's side: the card
 * names the organization being managed, refuses a bad file before any
 * request, previews a good one, uploads only on explicit confirmation
 * through the generated `useUploadOrganizationLogo` hook (never a direct
 * storage call), announces success, refreshes every reader of the logo, and
 * surfaces a server rejection inline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

const { state, uploadMutateSpy, removeMutateSpy } = vi.hoisted(() => ({
  state: {
    organization: { id: 10, name: 'Gloria Health', slug: 'gloria', type: 'hospital', status: 'active', logoUrl: null as string | null },
    isLoading: false,
    error: null as unknown,
    pending: false,
    /** Configures how the next mutate call resolves. */
    outcome: { kind: 'success', logoUrl: '/api/organizations/10/logo/new.png' } as
      | { kind: 'success'; logoUrl: string }
      | { kind: 'error'; error: unknown },
    removePending: false,
    removeOutcome: { kind: 'success', logoUrl: null } as
      | { kind: 'success'; logoUrl: string | null }
      | { kind: 'error'; error: unknown },
  },
  uploadMutateSpy: vi.fn(),
  removeMutateSpy: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetOrganization: () => ({
    data: state.isLoading || state.error ? undefined : state.organization,
    isLoading: state.isLoading,
    error: state.error,
    refetch: vi.fn(),
  }),
  getGetOrganizationQueryKey: (id: number) => ['organization', id],
  useUploadOrganizationLogo: () => ({
    isPending: state.pending,
    mutate: (variables: unknown, options: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      uploadMutateSpy(variables);
      if (state.outcome.kind === 'success') options.onSuccess?.({ logoUrl: state.outcome.logoUrl });
      else options.onError?.(state.outcome.error);
    },
  }),
  useDeleteOrganizationLogo: () => ({
    isPending: state.removePending,
    mutate: (variables: unknown, options: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      removeMutateSpy(variables);
      if (state.removeOutcome.kind === 'success') options.onSuccess?.({ logoUrl: state.removeOutcome.logoUrl });
      else options.onError?.(state.removeOutcome.error);
    },
  }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  getGetTenantContextQueryKey: () => ['tenantContext'],
}));

const { OrganizationBrandingCard } = await import('@/components/organization/organization-branding-card');

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];

function pngFile(name = 'official-logo.png', size = 2048): File {
  const body = new Uint8Array(size);
  body.set(PNG_HEADER);
  return new File([body], name, { type: 'image/png' });
}

function renderCard(queryClient = new QueryClient()) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <OrganizationBrandingCard organizationId={10} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  state.organization = { id: 10, name: 'Gloria Health', slug: 'gloria', type: 'hospital', status: 'active', logoUrl: null };
  state.isLoading = false;
  state.error = null;
  state.pending = false;
  state.outcome = { kind: 'success', logoUrl: '/api/organizations/10/logo/new.png' };
  uploadMutateSpy.mockReset();
});

describe('OrganizationBrandingCard — what is shown', () => {
  it('names the organization being managed and shows the initials fallback when there is no logo', () => {
    renderCard();
    expect(screen.getByTestId('branding-organization-name')).toHaveTextContent('Gloria Health');
    expect(screen.getByTestId('branding-organization-slug')).toHaveTextContent('gloria');
    expect(screen.getByTestId('organization-logo-preview')).toHaveAttribute('data-logo-state', 'initials');
    expect(screen.getByTestId('branding-preview-caption')).toHaveTextContent(/No logo uploaded/);
    expect(screen.getByRole('button', { name: /Upload logo/ })).toBeInTheDocument();
  });

  it('shows the current logo and a Change logo action when one exists', () => {
    state.organization.logoUrl = '/api/organizations/10/logo/current.png';
    renderCard();
    expect(screen.getByTestId('img-organization-logo-preview')).toHaveAttribute('src', '/api/organizations/10/logo/current.png');
    expect(screen.getByTestId('branding-preview-caption')).toHaveTextContent('Current logo');
    expect(screen.getByRole('button', { name: /Change logo/ })).toBeInTheDocument();
  });

  it('states the file requirements next to the control', () => {
    renderCard();
    expect(screen.getByText(/PNG, JPEG or WebP · up to 5 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload logo/ })).toHaveAttribute('aria-describedby', 'logo-file-requirements');
  });

  it('renders a retryable error state when the organization cannot be loaded', () => {
    state.error = new Error('boom');
    renderCard();
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load the organization/);
  });
});

describe('OrganizationBrandingCard — validation before any request', () => {
  it('refuses an SVG with a specific reason and never calls the upload hook', async () => {
    renderCard();
    const svg = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')], 'logo.svg', {
      type: 'image/svg+xml',
    });
    // The `accept` attribute already excludes SVG at the picker, so drive the
    // change handler directly to exercise the card's own defense-in-depth guard.
    fireEvent.change(screen.getByTestId('input-organization-logo-file'), { target: { files: [svg] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/SVG files are not accepted/);
    expect(screen.queryByTestId('button-save-logo')).not.toBeInTheDocument();
    expect(uploadMutateSpy).not.toHaveBeenCalled();
  });

  it('refuses a file over 5 MB', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.upload(screen.getByTestId('input-organization-logo-file'), pngFile('huge.png', 5 * 1024 * 1024 + 1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB or smaller/);
    expect(uploadMutateSpy).not.toHaveBeenCalled();
  });

  it('refuses a spoofed file whose bytes do not match its declared type', async () => {
    const user = userEvent.setup();
    renderCard();
    const spoofed = new File([new TextEncoder().encode('not really a png at all')], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('input-organization-logo-file'), spoofed);
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid PNG, JPEG or WebP/);
    expect(uploadMutateSpy).not.toHaveBeenCalled();
  });
});

describe('OrganizationBrandingCard — preview, confirm, upload', () => {
  it('previews a valid file and waits for explicit confirmation before uploading', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.upload(screen.getByTestId('input-organization-logo-file'), pngFile());

    expect(await screen.findByTestId('branding-selected-file')).toHaveTextContent('official-logo.png');
    expect(screen.getByTestId('branding-preview-caption')).toHaveTextContent(/not saved yet/);
    expect(screen.getByTestId('button-save-logo')).toBeInTheDocument();
    expect(screen.getByTestId('button-cancel-logo')).toBeInTheDocument();
    expect(uploadMutateSpy).not.toHaveBeenCalled();
  });

  it('cancel discards the selection without uploading', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.upload(screen.getByTestId('input-organization-logo-file'), pngFile());
    await user.click(await screen.findByTestId('button-cancel-logo'));
    expect(screen.queryByTestId('branding-selected-file')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload logo/ })).toBeInTheDocument();
    expect(uploadMutateSpy).not.toHaveBeenCalled();
  });

  it('uploads through the governed hook with the organization id and file, then refreshes every logo reader', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['organization', 10], { ...state.organization });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderCard(queryClient);

    const file = pngFile();
    await user.upload(screen.getByTestId('input-organization-logo-file'), file);
    await user.click(await screen.findByTestId('button-save-logo'));

    expect(uploadMutateSpy).toHaveBeenCalledTimes(1);
    const variables = uploadMutateSpy.mock.calls[0][0] as { id: number; data: { file: File } };
    expect(variables.id).toBe(10);
    expect(variables.data.file).toBe(file);

    await waitFor(() => expect(screen.getByTestId('branding-status')).toHaveTextContent(/Logo updated/));
    expect(screen.queryByTestId('branding-selected-file')).not.toBeInTheDocument();

    // The organization record is updated in place and every other reader is
    // invalidated so the new URL is fetched fresh.
    expect(queryClient.getQueryData<{ logoUrl: string | null }>(['organization', 10])?.logoUrl).toBe(
      '/api/organizations/10/logo/new.png',
    );
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys).toEqual(
      expect.arrayContaining([JSON.stringify(['organization', 10]), JSON.stringify(['myOrganizations']), JSON.stringify(['tenantContext'])]),
    );
  });

  it('surfaces a server rejection inline and keeps the selection for retry', async () => {
    const user = userEvent.setup();
    state.outcome = { kind: 'error', error: { status: 400, data: { error: 'File content does not match its declared image type' } } };
    renderCard();
    await user.upload(screen.getByTestId('input-organization-logo-file'), pngFile());
    await user.click(await screen.findByTestId('button-save-logo'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not match its declared image type/);
    expect(screen.getByTestId('branding-selected-file')).toBeInTheDocument();
  });

  it('marks the save control busy while the upload is in flight', async () => {
    const user = userEvent.setup();
    state.pending = true;
    renderCard();
    await user.upload(screen.getByTestId('input-organization-logo-file'), pngFile());
    const save = await screen.findByTestId('button-save-logo');
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(save).toBeDisabled();
    expect(screen.getByTestId('button-cancel-logo')).toBeDisabled();
  });
});

describe('OrganizationBrandingCard — governed logo removal', () => {
  it('shows no Remove control when the organization has no logo', async () => {
    state.organization = { id: 10, name: 'Gloria Health', slug: 'gloria', type: 'hospital', status: 'active', logoUrl: null };
    renderCard();
    await waitFor(() => expect(screen.getByTestId('card-organization-branding')).toBeInTheDocument());
    expect(screen.queryByTestId('button-remove-logo')).not.toBeInTheDocument();
  });

  it('offers Remove when a logo exists and requires explicit confirmation (cancel keeps it)', async () => {
    state.organization = { id: 10, name: 'Gloria Health', slug: 'gloria', type: 'hospital', status: 'active', logoUrl: '/api/organizations/10/logo/current.png' };
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByTestId('button-remove-logo'));
    // A confirmation dialog naming the organization appears; no request yet.
    expect(await screen.findByTestId('dialog-remove-logo')).toHaveTextContent(/Gloria Health/);
    expect(removeMutateSpy).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('button-remove-logo-cancel'));
    expect(removeMutateSpy).not.toHaveBeenCalled();
  });

  it('removes the logo on confirmation and reports success', async () => {
    state.organization = { id: 10, name: 'Gloria Health', slug: 'gloria', type: 'hospital', status: 'active', logoUrl: '/api/organizations/10/logo/current.png' };
    state.removeOutcome = { kind: 'success', logoUrl: null };
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByTestId('button-remove-logo'));
    await user.click(await screen.findByTestId('button-remove-logo-confirm'));
    expect(removeMutateSpy).toHaveBeenCalledWith({ id: 10 });
    await waitFor(() => expect(screen.getByTestId('branding-status')).toHaveTextContent(/Logo removed/));
  });

  it('surfaces an error when removal fails', async () => {
    state.organization = { id: 10, name: 'Gloria Health', slug: 'gloria', type: 'hospital', status: 'active', logoUrl: '/api/organizations/10/logo/current.png' };
    state.removeOutcome = { kind: 'error', error: { data: { error: 'Storage unavailable' } } };
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByTestId('button-remove-logo'));
    await user.click(await screen.findByTestId('button-remove-logo-confirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Storage unavailable/);
  });
});
