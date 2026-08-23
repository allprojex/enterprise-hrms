/**
 * Tests for the Payroll Statutory Rules page (Payroll, Workstream 1).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollStatutoryRules from '@/pages/payroll-statutory-rules';
import type { PayrollStatutoryRuleVersion } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    versions: [] as PayrollStatutoryRuleVersion[],
    versionsLoading: false,
    versionsError: undefined as unknown,
    createMutate: vi.fn() as (...args: unknown[]) => void,
    validateMutate: vi.fn() as (...args: unknown[]) => void,
    approveMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListPayrollStatutoryRuleVersions: () => ({ data: state.versions, isLoading: state.versionsLoading, error: state.versionsError }),
  getListPayrollStatutoryRuleVersionsQueryKey: () => ['payrollStatutoryRuleVersions'],
  useCreatePayrollStatutoryRuleVersion: () => ({ mutate: state.createMutate, isPending: false }),
  useValidatePayrollStatutoryRuleVersion: () => ({ mutate: state.validateMutate, isPending: false }),
  useApprovePayrollStatutoryRuleVersion: () => ({ mutate: state.approveMutate, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollStatutoryRules />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.versions = [];
  state.versionsLoading = false;
  state.versionsError = undefined;
  state.createMutate = vi.fn();
  state.validateMutate = vi.fn();
  state.approveMutate = vi.fn();
}

describe('Payroll Statutory Rules page', () => {
  it('renders nothing when the read call is forbidden (reactive-403-hide, matching every other Phase 3H sensitive surface)', () => {
    resetState();
    state.versionsError = { status: 403, error: 'Forbidden' };
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an empty state when there are no versions and access is allowed', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no statutory rule versions yet/i)).toBeInTheDocument();
  });

  it('renders versions in a table with status badges', () => {
    resetState();
    state.versions = [
      { id: 1, ruleType: 'pension_rates', status: 'draft', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, createdByMembershipId: 5, approvedByMembershipId: null, approvedAt: null, sourceUrl: null, sourceDescription: null, sourceRetrievedAt: null, confirmedBy: null, confirmedAt: null, reasonNote: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    renderPage();
    const row = screen.getByTestId('row-statutory-rule-1');
    expect(row).toHaveTextContent('pension_rates');
    expect(row).toHaveTextContent('draft');
  });

  it('shows a Validate action for a draft version and calls the mutation', async () => {
    resetState();
    state.versions = [
      { id: 1, ruleType: 'pension_rates', status: 'draft', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, createdByMembershipId: 5, approvedByMembershipId: null, approvedAt: null, sourceUrl: null, sourceDescription: null, sourceRetrievedAt: null, confirmedBy: null, confirmedAt: null, reasonNote: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-validate-1'));
    expect(state.validateMutate).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    expect(screen.queryByTestId('button-approve-1')).not.toBeInTheDocument();
  });

  it('shows an Approve action for a validated version and calls the mutation', async () => {
    resetState();
    state.versions = [
      { id: 1, ruleType: 'pension_rates', status: 'validated', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, createdByMembershipId: 5, approvedByMembershipId: null, approvedAt: null, sourceUrl: null, sourceDescription: null, sourceRetrievedAt: null, confirmedBy: null, confirmedAt: null, reasonNote: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-approve-1'));
    expect(state.approveMutate).toHaveBeenCalledWith({ organizationId: 10, id: 1 }, expect.anything());
    expect(screen.queryByTestId('button-validate-1')).not.toBeInTheDocument();
  });

  it('shows neither action for an approved version', () => {
    resetState();
    state.versions = [
      { id: 1, ruleType: 'pension_rates', status: 'approved', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, createdByMembershipId: 5, approvedByMembershipId: 6, approvedAt: '2026-01-02T00:00:00.000Z', sourceUrl: null, sourceDescription: null, sourceRetrievedAt: null, confirmedBy: null, confirmedAt: null, reasonNote: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
    ];
    renderPage();
    expect(screen.queryByTestId('button-validate-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-approve-1')).not.toBeInTheDocument();
  });

  it('submits a pension_rates draft with the entered percentages', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-statutory-rule'));
    await userEvent.click(screen.getByTestId('select-rule-type'));
    await userEvent.click(screen.getByRole('option', { name: 'Pension Rates' }));
    await userEvent.type(screen.getByTestId('input-effective-from'), '2026-01-01');
    await userEvent.type(screen.getByTestId('input-employee-rate'), '5.5');
    await userEvent.type(screen.getByTestId('input-employer-rate'), '13');
    await userEvent.type(screen.getByTestId('input-tier1-rate'), '13.5');
    await userEvent.type(screen.getByTestId('input-tier2-rate'), '5');
    await userEvent.click(screen.getByTestId('button-submit-statutory-rule'));
    expect(state.createMutate).toHaveBeenCalled();
    const [payload] = vi.mocked(state.createMutate).mock.calls[0] as [{ organizationId: number; data: Record<string, unknown> }];
    expect(payload.organizationId).toBe(10);
    expect(payload.data.pensionRates).toEqual({ employeeRatePercent: '5.5', employerRatePercent: '13', tier1AllocationPercent: '13.5', tier2AllocationPercent: '5' });
  });

  it('disables submission for paye_bands in this minimal Workstream 1 form (no band-table editor yet)', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-statutory-rule'));
    expect(screen.getByTestId('button-submit-statutory-rule')).toBeDisabled();
  });
});
