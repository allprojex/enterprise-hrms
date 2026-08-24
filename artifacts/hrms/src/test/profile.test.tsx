/**
 * Tests for the Profile page's profile-picture feature (src/pages/profile.tsx)
 * — the page had zero prior test coverage, so only the new picture
 * upload/remove behavior is exercised in depth, mirroring employees.test.tsx's
 * own "focused, non-crashing" precedent for the rest of the page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Profile from '@/pages/profile';

const { state, uploadMutateMock, removeMutateMock } = vi.hoisted(() => ({
  state: {
    myEmployee: { linked: false, employee: null } as { linked: boolean; employee: { hasProfilePicture: boolean } | null },
  },
  uploadMutateMock: vi.fn(),
  removeMutateMock: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({
    data: {
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
    isLoading: false,
  }),
  getGetMeQueryKey: () => ['getMe'],
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useListMyOrganizations: () => ({ data: [{ organizationId: 10, organizationName: 'Acme', roles: ['employee'] }] }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useGetMyEmployee: () => ({ data: state.myEmployee }),
  getGetMyEmployeeQueryKey: () => ['getMyEmployee'],
  useUploadMyEmployeeProfilePicture: () => ({ mutate: uploadMutateMock, isPending: false }),
  useRemoveMyEmployeeProfilePicture: () => ({ mutate: removeMutateMock, isPending: false }),
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

  it('removes the picture through the self-service mutation', async () => {
    state.myEmployee = { linked: true, employee: { hasProfilePicture: true } };
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('button-remove-photo'));

    expect(removeMutateMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
