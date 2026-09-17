/**
 * Tests for the Profile page's profile-picture feature (src/pages/profile.tsx)
 * — the page had zero prior test coverage, so only the new picture
 * upload/remove behavior is exercised in depth, mirroring employees.test.tsx's
 * own "focused, non-crashing" precedent for the rest of the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Profile from '@/pages/profile';

const { state, uploadMutateMock, removeMutateMock, removeMutateAsyncMock } = vi.hoisted(() => ({
  state: {
    myEmployee: { linked: false, employee: null } as { linked: boolean; employee: { hasProfilePicture: boolean } | null },
    // One stable object, as the real query cache returns: the page re-seeds its
    // form whenever the user object's identity changes, so a fresh object on
    // every render would loop as soon as anything (e.g. a dialog) re-renders.
    me: {
      id: 1,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      role: 'employee',
      activeOrganizationId: 10,
      organizationId: 10,
      jobTitle: null,
      department: null,
      phoneNumber: null,
    },
  },
  uploadMutateMock: vi.fn(),
  removeMutateMock: vi.fn(),
  removeMutateAsyncMock: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: state.me, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useListMyOrganizations: () => ({ data: [{ organizationId: 10, organizationName: 'Acme', roles: ['employee'] }] }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useGetMyEmployee: () => ({ data: state.myEmployee }),
  getGetMyEmployeeQueryKey: () => ['getMyEmployee'],
  useUploadMyEmployeeProfilePicture: () => ({ mutate: uploadMutateMock, isPending: false }),
  useRemoveMyEmployeeProfilePicture: () => ({ mutate: removeMutateMock, mutateAsync: removeMutateAsyncMock, isPending: false }),
  getRemoveMyEmployeeProfilePictureUrl: () => '/api/me/employee/profile-picture',
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Profile />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  uploadMutateMock.mockReset();
  removeMutateMock.mockReset();
  removeMutateAsyncMock.mockReset();
  removeMutateAsyncMock.mockImplementation((_vars: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.();
    return Promise.resolve(undefined);
  });
  state.myEmployee = { linked: false, employee: null };
});

describe('Profile page — profile picture', () => {
  it('renders without a picture-change control when the caller has no linked employee record', () => {
    renderPage();
    expect(screen.queryByTestId('button-upload-photo')).not.toBeInTheDocument();
  });

  it('shows a change-picture control once linked to an employee record', () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: false } };
    renderPage();
    expect(screen.getByTestId('button-upload-photo')).toBeInTheDocument();
  });

  it('does not show a remove-picture control when there is no picture yet', () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: false } };
    renderPage();
    expect(screen.queryByTestId('button-remove-photo')).not.toBeInTheDocument();
  });

  it('shows a remove-picture control once a picture exists', () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: true } };
    renderPage();
    expect(screen.getByTestId('button-remove-photo')).toBeInTheDocument();
  });

  it('uploads a selected file through the self-service mutation', async () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: false } };
    renderPage();
    const user = userEvent.setup();
    const file = new File(['fake-bytes'], 'photo.png', { type: 'image/png' });

    const input = screen.getByTestId('input-photo-file') as HTMLInputElement;
    await user.upload(input, file);

    expect(uploadMutateMock).toHaveBeenCalledWith(
      { data: { file } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('asks for confirmation before removing the picture, and Cancel removes nothing', async () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: true } };
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('button-remove-photo'));

    expect(screen.getByTestId('dialog-remove-photo')).toBeInTheDocument();
    expect(screen.getByText('Remove profile picture?')).toBeInTheDocument();
    expect(removeMutateAsyncMock).not.toHaveBeenCalled();
    expect(removeMutateMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-remove-photo-cancel'));
    expect(screen.queryByTestId('dialog-remove-photo')).not.toBeInTheDocument();
    expect(removeMutateAsyncMock).not.toHaveBeenCalled();
  });

  it('removes the picture through the self-service mutation once confirmed, then closes', async () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: true } };
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('button-remove-photo'));
    await user.click(screen.getByTestId('dialog-remove-photo-confirm'));

    expect(removeMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(removeMutateAsyncMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByTestId('dialog-remove-photo')).not.toBeInTheDocument());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['getMyEmployee'] });
    invalidateSpy.mockRestore();
  });

  it('keeps the dialog open and the picture control in place when removal fails', async () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: true } };
    removeMutateAsyncMock.mockImplementation((_vars: unknown, options?: { onError?: (err: unknown) => void }) => {
      options?.onError?.(new Error('nope'));
      return Promise.reject(new Error('nope'));
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('button-remove-photo'));
    await user.click(screen.getByTestId('dialog-remove-photo-confirm'));

    expect(removeMutateAsyncMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('dialog-remove-photo-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-remove-photo')).toBeInTheDocument();
    expect(screen.getByTestId('button-remove-photo')).toBeInTheDocument();
  });
});
