/**
 * Tests for the My Payslips ESS page (Payroll, Workstream 5).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollMyPayslips from '@/pages/payroll-my-payslips';
import type { OwnPayslipSummary, Payslip } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    summaries: [] as OwnPayslipSummary[],
    summariesLoading: false,
    summariesError: undefined as unknown,
    payslip: undefined as Payslip | undefined,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListOwnPayslips: () => ({ data: state.summaries, isLoading: state.summariesLoading, error: state.summariesError }),
  getListOwnPayslipsQueryKey: () => ['ownPayslips'],
  useGetOwnPayslip: () => ({ data: state.payslip }),
  getGetOwnPayslipQueryKey: () => ['ownPayslip'],
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollMyPayslips />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.summaries = [];
  state.summariesLoading = false;
  state.summariesError = undefined;
  state.payslip = undefined;
}

describe('My Payslips page', () => {
  it('renders nothing when the read call is forbidden (reactive-403-hide)', () => {
    resetState();
    state.summariesError = { status: 403, error: 'Forbidden' };
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an empty state when there are no payslips', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no payslips yet/i)).toBeInTheDocument();
  });

  it('lists own payslip summaries', () => {
    resetState();
    state.summaries = [{ payrollRunId: 7, payrollRunLineId: 1, payrollPeriod: { id: 1, periodKey: '2026-01', payDate: '2026-01-31T00:00:00.000Z' }, netPay: '922.75', currency: 'GHS', hasApprovedCorrection: false }];
    renderPage();
    const row = screen.getByTestId('row-my-payslip-7');
    expect(row).toHaveTextContent('2026-01');
    expect(row).toHaveTextContent('922.75');
    expect(row).not.toHaveTextContent('Corrected');
  });

  it('flags a payslip that has an approved correction', () => {
    resetState();
    state.summaries = [{ payrollRunId: 7, payrollRunLineId: 1, payrollPeriod: { id: 1, periodKey: '2026-01', payDate: '2026-01-31T00:00:00.000Z' }, netPay: '1325.75', currency: 'GHS', hasApprovedCorrection: true }];
    renderPage();
    expect(screen.getByTestId('row-my-payslip-7')).toHaveTextContent('Corrected');
  });

  it('viewing a payslip shows its detail with the effective net pay', async () => {
    resetState();
    state.summaries = [{ payrollRunId: 7, payrollRunLineId: 1, payrollPeriod: { id: 1, periodKey: '2026-01', payDate: '2026-01-31T00:00:00.000Z' }, netPay: '922.75', currency: 'GHS', hasApprovedCorrection: false }];
    state.payslip = {
      organizationId: 10, payrollRunId: 7, payrollRunLineId: 1, employeeId: 501, employeeName: 'Ada Lovelace',
      staffNumberSnapshot: 'EMP-501',
      payrollPeriod: { id: 1, frequency: 'monthly', periodKey: '2026-01', startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-02-01T00:00:00.000Z', payDate: '2026-01-31T00:00:00.000Z' },
      currency: 'GHS',
      original: {
        grossEarnings: '1000.00', pensionableEarnings: '1000.00', employeePensionDeduction: '55.00', employerPensionContribution: '130.00',
        tier1Amount: '135.00', tier2Amount: '50.00', taxableIncome: '945.00', payeAmount: '22.25', otherDeductions: '0.00', netPay: '922.75',
        components: [],
      },
      corrections: [],
      effective: {
        grossEarnings: '1000.00', pensionableEarnings: '1000.00', employeePensionDeduction: '55.00', employerPensionContribution: '130.00',
        tier1Amount: '135.00', tier2Amount: '50.00', taxableIncome: '945.00', payeAmount: '22.25', otherDeductions: '0.00', netPay: '922.75',
        source: 'original', correctionId: null,
      },
    };
    renderPage();
    await userEvent.click(screen.getByTestId('button-view-my-payslip-7'));
    expect(screen.getByTestId('section-my-payslip-detail')).toBeInTheDocument();
    expect(screen.getByTestId('text-my-payslip-net')).toHaveTextContent('922.75');
  });
});
