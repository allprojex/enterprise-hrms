/**
 * Tests for the shared Performance Evidence/Attachments section (W82),
 * embedded on My Performance / My Team Reviews / the internal HR review
 * detail. @workspace/api-client-react is mocked at the hook level — no
 * real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PerformanceEvidenceSection } from '@/components/performance-evidence';
import type { PerformanceReviewEvidence } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    evidence: [] as PerformanceReviewEvidence[],
    isLoading: false,
    error: undefined as unknown,
    uploadMutate: vi.fn() as (...args: unknown[]) => void,
    uploadPending: false,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useListPerformanceReviewEvidence: () => ({ data: state.evidence, isLoading: state.isLoading, error: state.error }),
  getListPerformanceReviewEvidenceQueryKey: () => ['evidence'],
  useAddPerformanceReviewEvidence: () => ({ mutate: state.uploadMutate, isPending: state.uploadPending }),
  getDownloadPerformanceReviewEvidenceUrl: (orgId: number, reviewId: number, evidenceId: number) => `/api/organizations/${orgId}/performance/reviews/${reviewId}/evidence/${evidenceId}/download`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function evidenceItem(overrides: Partial<PerformanceReviewEvidence> = {}): PerformanceReviewEvidence {
  return {
    id: 1, organizationId: 10, reviewId: 1, goalId: null, employeeDocumentId: 1, addedByMembershipId: 5,
    addedAt: new Date().toISOString(), fileName: 'evidence.pdf', mimeType: 'application/pdf', fileSize: 2048, uploadedBy: 1,
    ...overrides,
  };
}

function resetState() {
  state.evidence = [];
  state.isLoading = false;
  state.error = undefined;
  state.uploadMutate = vi.fn();
  state.uploadPending = false;
}

function renderSection(props: Partial<React.ComponentProps<typeof PerformanceEvidenceSection>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceEvidenceSection organizationId={10} reviewId={1} canUpload={false} {...props} />
    </QueryClientProvider>,
  );
}

describe('PerformanceEvidenceSection', () => {
  it('shows an empty state when no evidence is attached', () => {
    resetState();
    renderSection();
    expect(screen.getByText(/no evidence attached yet/i)).toBeInTheDocument();
  });

  it('lists existing evidence with filename, type, and size', () => {
    resetState();
    state.evidence = [evidenceItem()];
    renderSection();
    const row = screen.getByTestId('row-evidence-1');
    expect(row).toHaveTextContent('evidence.pdf');
    expect(row).toHaveTextContent('application/pdf');
    expect(row).toHaveTextContent('2.0 KB');
  });

  it('does not show the upload control when canUpload is false', () => {
    resetState();
    renderSection({ canUpload: false });
    expect(screen.queryByTestId('button-attach-evidence')).not.toBeInTheDocument();
  });

  it('shows the upload control and accepted-types text when canUpload is true', () => {
    resetState();
    renderSection({ canUpload: true });
    expect(screen.getByTestId('button-attach-evidence')).toBeInTheDocument();
    expect(screen.getByText(/PDF, JPEG, PNG, DOCX, or XLSX/i)).toBeInTheDocument();
  });

  it('uploads a selected file through the mutation, with the given goalId', async () => {
    resetState();
    renderSection({ canUpload: true, goalId: 7 });
    const file = new File(['pdf-bytes'], 'proof.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('input-evidence-file') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(state.uploadMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: { file, goalId: 7 } }),
      expect.anything(),
    );
  });

  it('disables the upload button while a mutation is pending', () => {
    resetState();
    state.uploadPending = true;
    renderSection({ canUpload: true });
    expect(screen.getByTestId('button-attach-evidence')).toBeDisabled();
  });

  it('shows a download action for each evidence row', () => {
    resetState();
    state.evidence = [evidenceItem()];
    renderSection();
    expect(screen.getByTestId('button-download-evidence-1')).toBeInTheDocument();
  });
});
