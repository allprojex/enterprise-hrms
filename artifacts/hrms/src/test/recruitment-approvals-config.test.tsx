/**
 * Tests for the Recruitment Approvals configuration page (WS-9) — the
 * remove-stage confirmation. @workspace/api-client-react is mocked at the
 * hook level — no real network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecruitmentApprovalsConfig from '@/pages/recruitment-approvals-config';

type MutateOpts = { onSuccess?: (data?: unknown) => void; onError?: (err: unknown) => void };

const { state } = vi.hoisted(() => ({
  state: {
    stages: [] as Array<{ id: number; stageOrder: number; name: string; resolverType: string; resolverConfig: unknown }>,
    error: undefined as unknown,
    refetch: (() => undefined) as () => unknown,
    deleteAsync: (() => Promise.resolve()) as (vars: unknown, opts?: unknown) => Promise<unknown>,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListRecruitmentApprovalStages: () => ({ data: { stages: state.stages }, error: state.error, refetch: state.refetch }),
  getListRecruitmentApprovalStagesQueryKey: (orgId: number, params: unknown) => ['recruitmentApprovalStages', orgId, params],
  useCreateRecruitmentApprovalStage: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteRecruitmentApprovalStage: () => ({ mutate: vi.fn(), mutateAsync: state.deleteAsync, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecruitmentApprovalsConfig />
    </QueryClientProvider>,
  );
}

describe('Recruitment Approvals configuration — remove stage', () => {
  beforeEach(() => {
    state.stages = [{ id: 41, stageOrder: 1, name: 'Department Head', resolverType: 'department_head', resolverConfig: null }];
    state.error = undefined;
    state.refetch = vi.fn();
  });

  it('opens a confirmation instead of deleting on click, and Cancel deletes nothing', async () => {
    state.deleteAsync = vi.fn(() => Promise.resolve());
    renderPage();
    await userEvent.click(screen.getByTestId('button-remove-stage-1'));

    const dialog = screen.getByTestId('dialog-remove-approval-stage');
    expect(dialog).toHaveTextContent('Remove approval stage?');
    expect(dialog).toHaveTextContent('“Department Head”, will be permanently deleted from the hire authorization chain');
    expect(state.deleteAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('dialog-remove-approval-stage-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-remove-approval-stage')).not.toBeInTheDocument());
    expect(state.deleteAsync).not.toHaveBeenCalled();
  });

  it('deletes exactly once on confirm, refetches, and closes', async () => {
    state.deleteAsync = vi.fn((_vars: unknown, opts?: MutateOpts) => {
      opts?.onSuccess?.();
      return Promise.resolve();
    });
    renderPage();
    await userEvent.click(screen.getByTestId('button-remove-stage-1'));
    await userEvent.click(screen.getByTestId('dialog-remove-approval-stage-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-remove-approval-stage')).not.toBeInTheDocument());
    expect(state.deleteAsync).toHaveBeenCalledTimes(1);
    expect(state.deleteAsync).toHaveBeenCalledWith({ organizationId: 10, stageId: 41 }, expect.anything());
    expect(state.refetch).toHaveBeenCalled();
  });

  it('keeps the dialog open and the stage row rendered when the delete fails', async () => {
    state.deleteAsync = vi.fn((_vars: unknown, opts?: MutateOpts) => {
      const err = new Error('boom');
      opts?.onError?.(err);
      return Promise.reject(err);
    });
    renderPage();
    await userEvent.click(screen.getByTestId('button-remove-stage-1'));
    await userEvent.click(screen.getByTestId('dialog-remove-approval-stage-confirm'));

    await waitFor(() => expect(state.deleteAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('dialog-remove-approval-stage')).toBeInTheDocument();
    expect(screen.getByTestId('row-stage-1')).toBeInTheDocument();
    expect(state.refetch).not.toHaveBeenCalled();
  });

  it('shows the access-denied state (and no remove control) for a 403', () => {
    state.error = { status: 403 };
    renderPage();
    expect(screen.getByText(/do not have access to recruitment approval settings/i)).toBeInTheDocument();
    expect(screen.queryByTestId('button-remove-stage-1')).not.toBeInTheDocument();
  });
});
