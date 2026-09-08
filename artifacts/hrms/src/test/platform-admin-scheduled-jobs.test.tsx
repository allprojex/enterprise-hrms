/**
 * WS-6 — the platform-admin ScheduledJobsPanel: super_admin gating (reuses
 * the page's pre-existing WS-4 gate, unchanged), job listing, and that
 * cancel/retry actions only appear for the statuses that actually support
 * them.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import PlatformAdmin from '@/pages/platform-admin';

const { cancelMutate, retryMutate, emptyList } = vi.hoisted(() => ({
  cancelMutate: vi.fn(),
  retryMutate: vi.fn(),
  emptyList: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, role: 'super_admin', organizationId: 10 }, isLoading: false }),
  useListInstallations: emptyList,
  getListInstallationsQueryKey: () => ['installations'],
  useCreateInstallation: () => ({ mutate: vi.fn(), isPending: false }),
  useListInstallationOrganizations: emptyList,
  getListInstallationOrganizationsQueryKey: () => ['installationOrgs'],
  useLinkInstallationOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkInstallationOrganization: () => ({ mutate: vi.fn(), isPending: false }),
  useListBreakGlassGrants: emptyList,
  getListBreakGlassGrantsQueryKey: () => ['breakGlassGrants'],
  useCreateBreakGlassGrant: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeBreakGlassGrant: () => ({ mutate: vi.fn(), isPending: false }),
  useListOrganizations: emptyList,
  // WS-17 Slice 1: the Fleet Health section lives on this page, so its hooks
  // must be registered at the same module boundary this suite already mocks.
  // Empty fleet keeps these tests about scheduled jobs, which is what they test.
  useGetFleetHealth: () => ({ data: { installations: [] }, isLoading: false, isError: false }),
  useListInstallationDeployments: () => ({ data: { deployments: [] }, isLoading: false }),
  useListInstallationBackupRuns: () => ({ data: { runs: [] }, isLoading: false }),
  useListScheduledJobs: () => ({
    data: [
      { id: 1, jobType: 'reminder.notify', organizationId: 10, status: 'scheduled', attemptCount: 0, maxAttempts: 5, scheduledFor: new Date().toISOString(), lastErrorMessage: null },
      { id: 2, jobType: 'reminder.notify', organizationId: 10, status: 'failed', attemptCount: 5, maxAttempts: 5, scheduledFor: new Date().toISOString(), lastErrorMessage: 'boom' },
      { id: 3, jobType: 'diagnostics.ping', organizationId: null, status: 'completed', attemptCount: 1, maxAttempts: 5, scheduledFor: new Date().toISOString(), lastErrorMessage: null },
    ],
    isLoading: false,
    error: null,
  }),
  getListScheduledJobsQueryKey: () => ['scheduledJobs'],
  useCancelScheduledJob: () => ({ mutate: cancelMutate, isPending: false }),
  useRetryScheduledJob: () => ({ mutate: retryMutate, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformAdmin />
    </QueryClientProvider>,
  );
}

describe('Platform Admin — Scheduled Jobs panel', () => {
  it('renders every job with its status', () => {
    renderPage();
    expect(screen.getByTestId('row-job-1')).toBeInTheDocument();
    expect(screen.getByTestId('badge-job-status-2')).toHaveTextContent('failed');
  });

  it('shows Cancel only for a scheduled job, and Retry only for a failed one', () => {
    renderPage();
    expect(screen.getByTestId('button-cancel-job-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-cancel-job-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-cancel-job-3')).not.toBeInTheDocument();

    expect(screen.getByTestId('button-retry-job-2')).toBeInTheDocument();
    expect(screen.queryByTestId('button-retry-job-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-retry-job-3')).not.toBeInTheDocument();
  });

  it('cancel/retry buttons call their mutations with the job id', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('button-cancel-job-1'));
    fireEvent.click(screen.getByTestId('button-retry-job-2'));
    await waitFor(() => {
      expect(cancelMutate).toHaveBeenCalledWith({ id: 1 });
      expect(retryMutate).toHaveBeenCalledWith({ id: 2 });
    });
  });

  it('a platform-scoped job (organizationId null) is labeled distinctly, not shown as org 0/blank', () => {
    renderPage();
    const row = screen.getByTestId('row-job-3');
    expect(row).toHaveTextContent('platform');
  });
});

// Contrast defect regression: Super Admin → Installations → "+ New Installation"
// is a size="sm" primary Button. Before the cn()/tailwind-merge fix its
// text-primary-foreground class was dropped, leaving a dark label and icon on
// the dark brand background.
describe('Platform Admin — Installations "+ New Installation" button contrast', () => {
  it('renders as a primary button that keeps its high-contrast foreground class', () => {
    renderPage();
    const button = screen.getByTestId('button-new-installation');
    const cls = button.className.split(/\s+/);
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('text-primary-foreground');
    expect(cls).toContain('hover:bg-primary-hover');
    expect(cls).toContain('text-body-sm');
    expect(cls.filter((c) => /^text-(foreground|muted-foreground|primary)$/.test(c))).toEqual([]);
    // The leading icon inherits currentColor (no colour class of its own).
    const icon = button.querySelector('svg');
    expect(icon).not.toBeNull();
    expect([...icon!.classList].filter((c) => c.startsWith('text-'))).toEqual([]);
    expect(button).toHaveTextContent('New Installation');
  });
});
