/**
 * Tests for the shared Learning Enrollment Evidence section (W90),
 * embedded on ESS "My Learning". @workspace/api-client-react is mocked at
 * the hook level — no real network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LearningEvidenceSection } from '@/components/learning-evidence';
import type { LearningEnrollmentEvidence } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    evidence: [] as LearningEnrollmentEvidence[],
    isLoading: false,
    error: undefined as unknown,
    uploadMutate: vi.fn() as (...args: unknown[]) => void,
    uploadPending: false,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useListLearningEnrollmentEvidence: () => ({ data: state.evidence, isLoading: state.isLoading, error: state.error }),
  getListLearningEnrollmentEvidenceQueryKey: () => ['learningEvidence'],
  useAddLearningEnrollmentEvidence: () => ({ mutate: state.uploadMutate, isPending: state.uploadPending }),
  getDownloadLearningEnrollmentEvidenceUrl: (orgId: number, enrollmentId: number, evidenceId: number) => `/api/organizations/${orgId}/learning/enrollments/${enrollmentId}/evidence/${evidenceId}/download`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

function evidenceItem(overrides: Partial<LearningEnrollmentEvidence> = {}): LearningEnrollmentEvidence {
  return {
    id: 1, organizationId: 10, enrollmentId: 1, employeeDocumentId: 1, addedByMembershipId: 5,
    addedAt: new Date().toISOString(), fileName: 'certificate-scan.pdf', mimeType: 'application/pdf', fileSize: 2048, uploadedBy: 1,
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

function renderSection(props: Partial<React.ComponentProps<typeof LearningEvidenceSection>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LearningEvidenceSection organizationId={10} enrollmentId={1} canUpload={false} {...props} />
    </QueryClientProvider>,
  );
}

describe('LearningEvidenceSection', () => {
  it('shows an empty state when no evidence is attached', () => {
    resetState();
    renderSection();
    expect(screen.getByText(/no evidence attached yet/i)).toBeInTheDocument();
  });

  it('lists existing evidence with filename, type, and size', () => {
    resetState();
    state.evidence = [evidenceItem()];
    renderSection();
    const row = screen.getByTestId('row-learning-evidence-1');
    expect(row).toHaveTextContent('certificate-scan.pdf');
    expect(row).toHaveTextContent('application/pdf');
    expect(row).toHaveTextContent('2.0 KB');
  });

  it('does not show the upload control when canUpload is false', () => {
    resetState();
    renderSection({ canUpload: false });
    expect(screen.queryByTestId('button-attach-learning-evidence-1')).not.toBeInTheDocument();
  });

  it('shows the upload control and accepted-types text when canUpload is true', () => {
    resetState();
    renderSection({ canUpload: true });
    expect(screen.getByTestId('button-attach-learning-evidence-1')).toBeInTheDocument();
    expect(screen.getByText(/PDF, JPEG, PNG, DOCX, or XLSX/i)).toBeInTheDocument();
  });

  it('uploads a selected file through the mutation', async () => {
    resetState();
    renderSection({ canUpload: true });
    const file = new File(['pdf-bytes'], 'proof.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('input-learning-evidence-file-1') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(state.uploadMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, id: 1, data: { file } }),
      expect.anything(),
    );
  });

  it('disables the upload button while a mutation is pending', () => {
    resetState();
    state.uploadPending = true;
    renderSection({ canUpload: true });
    expect(screen.getByTestId('button-attach-learning-evidence-1')).toBeDisabled();
  });

  it('shows a download action for each evidence row', () => {
    resetState();
    state.evidence = [evidenceItem()];
    renderSection();
    expect(screen.getByTestId('button-download-learning-evidence-1')).toBeInTheDocument();
  });
});
