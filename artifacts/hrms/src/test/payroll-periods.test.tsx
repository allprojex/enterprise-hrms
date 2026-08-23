/**
 * Tests for the Payroll Periods page (Payroll, Workstream 3).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollPeriods from '@/pages/payroll-periods';
import type { PayrollPeriod, PayrollRun, PayrollRunLineWithTrace, PayrollInputReference } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    periods: [] as PayrollPeriod[],
    periodsLoading: false,
    periodsError: undefined as unknown,
    runs: [] as PayrollRun[],
    runLines: [] as PayrollRunLineWithTrace[],
    inputReferences: [] as PayrollInputReference[],
    createPeriodMutate: vi.fn() as (...args: unknown[]) => void,
    createRunMutate: vi.fn() as (...args: unknown[]) => void,
    calculateMutate: vi.fn() as (...args: unknown[]) => void,
    createInputMutate: vi.fn() as (...args: unknown[]) => void,
    deleteInputMutate: vi.fn() as (...args: unknown[]) => void,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListPayrollPeriods: () => ({ data: state.periods, isLoading: state.periodsLoading, error: state.periodsError }),
  getListPayrollPeriodsQueryKey: () => ['payrollPeriods'],
  useCreatePayrollPeriod: () => ({ mutate: state.createPeriodMutate, isPending: false }),
  useListPayrollRuns: () => ({ data: state.runs }),
  getListPayrollRunsQueryKey: () => ['payrollRuns'],
  useCreatePayrollRun: () => ({ mutate: state.createRunMutate, isPending: false }),
  useCalculatePayrollRun: () => ({ mutate: state.calculateMutate, isPending: false }),
  useGetPayrollRunLines: () => ({ data: state.runLines }),
  getGetPayrollRunLinesQueryKey: () => ['payrollRunLines'],
  useListPayrollInputReferences: () => ({ data: state.inputReferences }),
  getListPayrollInputReferencesQueryKey: () => ['payrollInputReferences'],
  useCreatePayrollInputReference: () => ({ mutate: state.createInputMutate, isPending: false }),
  useDeletePayrollInputReference: () => ({ mutate: state.deleteInputMutate, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollPeriods />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.periods = [];
  state.periodsLoading = false;
  state.periodsError = undefined;
  state.runs = [];
  state.runLines = [];
  state.inputReferences = [];
  state.createPeriodMutate = vi.fn();
  state.createRunMutate = vi.fn();
  state.calculateMutate = vi.fn();
  state.createInputMutate = vi.fn();
  state.deleteInputMutate = vi.fn();
}

const PERIOD: PayrollPeriod = {
  id: 1,
  organizationId: 10,
  frequency: 'monthly',
  periodKey: '2026-01',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-02-01T00:00:00.000Z',
  payDate: '2026-01-31T00:00:00.000Z',
  createdByMembershipId: 5,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Payroll Periods page', () => {
  it('renders nothing when the read call is forbidden (reactive-403-hide)', () => {
    resetState();
    state.periodsError = { status: 403, error: 'Forbidden' };
    const { container } = renderPage();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an empty state when there are no periods', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no payroll periods yet/i)).toBeInTheDocument();
  });

  it('renders periods in a table', () => {
    resetState();
    state.periods = [PERIOD];
    renderPage();
    const row = screen.getByTestId('row-period-1');
    expect(row).toHaveTextContent('2026-01');
    expect(row).toHaveTextContent('monthly');
  });

  it('submits a new period with computed ISO dates', async () => {
    resetState();
    renderPage();
    await userEvent.click(screen.getByTestId('button-add-period'));
    await userEvent.type(screen.getByTestId('input-start-date'), '2026-01-01');
    await userEvent.type(screen.getByTestId('input-end-date'), '2026-02-01');
    await userEvent.type(screen.getByTestId('input-pay-date'), '2026-01-31');
    await userEvent.click(screen.getByTestId('button-submit-period'));
    expect(state.createPeriodMutate).toHaveBeenCalled();
    const [payload] = vi.mocked(state.createPeriodMutate).mock.calls[0] as [{ organizationId: number; data: Record<string, unknown> }];
    expect(payload.organizationId).toBe(10);
    expect(payload.data.frequency).toBe('monthly');
  });

  it('selecting a period with no run shows Create Draft Run', async () => {
    resetState();
    state.periods = [PERIOD];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.getByTestId('button-create-run')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('button-create-run'));
    expect(state.createRunMutate).toHaveBeenCalledWith({ organizationId: 10, data: { payrollPeriodId: 1 } }, expect.anything());
  });

  it('a draft run shows a Calculate action that invokes the mutation', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'draft', preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.getByTestId('badge-run-status')).toHaveTextContent('draft');
    await userEvent.click(screen.getByTestId('button-calculate-run'));
    expect(state.calculateMutate).toHaveBeenCalledWith({ organizationId: 10, id: 7 }, expect.anything());
  });

  it('shows the calculated run lines', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'calculated', preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-31T00:00:00.000Z' }];
    state.runLines = [
      {
        line: {
          id: 1, organizationId: 10, payrollRunId: 7, employeeId: 501, staffNumberSnapshot: 'EMP-501',
          payeBandsVersionId: 1, pensionRatesVersionId: 2, pensionEarningsCeilingVersionId: null,
          grossEarnings: '1000.00', pensionableEarnings: '1000.00', employeePensionDeduction: '55.00',
          employerPensionContribution: '130.00', tier1Amount: '135.00', tier2Amount: '50.00',
          taxableIncome: '945.00', payeAmount: '22.25', otherDeductions: '0.00', netPay: '922.75',
          currency: 'GHS', calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-31T00:00:00.000Z', updatedAt: '2026-01-31T00:00:00.000Z',
        },
        components: [],
      },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    const row = screen.getByTestId('row-run-line-501');
    expect(row).toHaveTextContent('EMP-501');
    expect(row).toHaveTextContent('922.75');
  });

  it('adds a one-off input via the form', async () => {
    resetState();
    state.periods = [PERIOD];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));

    await userEvent.type(screen.getByTestId('input-oneoff-employee-id'), '501');
    await userEvent.type(screen.getByTestId('input-oneoff-component-type'), 'bonus_oneoff');
    await userEvent.type(screen.getByTestId('input-oneoff-amount'), '300.00');
    await userEvent.click(screen.getByTestId('button-add-oneoff-input'));
    expect(state.createInputMutate).toHaveBeenCalled();
    const [payload] = vi.mocked(state.createInputMutate).mock.calls[0] as [{ organizationId: number; periodId: number; data: Record<string, unknown> }];
    expect(payload.organizationId).toBe(10);
    expect(payload.periodId).toBe(1);
    expect(payload.data.employeeId).toBe(501);
  });

  it('removes an existing one-off input', async () => {
    resetState();
    state.periods = [PERIOD];
    state.inputReferences = [
      { id: 9, organizationId: 10, payrollPeriodId: 1, employeeId: 501, sourceType: 'manual', sourceId: null, category: 'earning', componentTypeCode: 'bonus_oneoff', amount: '300.00', currency: 'GHS', taxableTreatment: 'bonus', description: null, createdByMembershipId: 5, approvedByMembershipId: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.getByTestId('row-oneoff-input-9')).toHaveTextContent('bonus_oneoff');
    await userEvent.click(screen.getByTestId('button-delete-oneoff-9'));
    expect(state.deleteInputMutate).toHaveBeenCalledWith({ organizationId: 10, periodId: 1, id: 9 }, expect.anything());
  });
});
