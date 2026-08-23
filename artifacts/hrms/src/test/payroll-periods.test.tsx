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
import type { PayrollPeriod, PayrollRun, PayrollRunLineWithTrace, PayrollInputReference, PayrollCorrection, PayrollReportResult, Payslip } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    periods: [] as PayrollPeriod[],
    periodsLoading: false,
    periodsError: undefined as unknown,
    runs: [] as PayrollRun[],
    runLines: [] as PayrollRunLineWithTrace[],
    inputReferences: [] as PayrollInputReference[],
    corrections: [] as PayrollCorrection[],
    reportResult: undefined as PayrollReportResult | undefined,
    payslip: undefined as Payslip | undefined,
    createPeriodMutate: vi.fn() as (...args: unknown[]) => void,
    createRunMutate: vi.fn() as (...args: unknown[]) => void,
    calculateMutate: vi.fn() as (...args: unknown[]) => void,
    approveRunMutate: vi.fn() as (...args: unknown[]) => void,
    lockRunMutate: vi.fn() as (...args: unknown[]) => void,
    createInputMutate: vi.fn() as (...args: unknown[]) => void,
    deleteInputMutate: vi.fn() as (...args: unknown[]) => void,
    createCorrectionMutate: vi.fn() as (...args: unknown[]) => void,
    approveCorrectionMutate: vi.fn() as (...args: unknown[]) => void,
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
  useApprovePayrollRun: () => ({ mutate: state.approveRunMutate, isPending: false }),
  useLockPayrollRun: () => ({ mutate: state.lockRunMutate, isPending: false }),
  useGetPayrollRunLines: () => ({ data: state.runLines }),
  getGetPayrollRunLinesQueryKey: () => ['payrollRunLines'],
  useListPayrollInputReferences: () => ({ data: state.inputReferences }),
  getListPayrollInputReferencesQueryKey: () => ['payrollInputReferences'],
  useCreatePayrollInputReference: () => ({ mutate: state.createInputMutate, isPending: false }),
  useDeletePayrollInputReference: () => ({ mutate: state.deleteInputMutate, isPending: false }),
  useListPayrollCorrectionsForRun: () => ({ data: state.corrections }),
  getListPayrollCorrectionsForRunQueryKey: () => ['payrollCorrections'],
  useCreatePayrollCorrection: () => ({ mutate: state.createCorrectionMutate, isPending: false }),
  useApprovePayrollCorrection: () => ({ mutate: state.approveCorrectionMutate, isPending: false }),
  useGetPayrollReport: () => ({ data: state.reportResult }),
  getGetPayrollReportQueryKey: () => ['payrollReport'],
  getGetPayrollReportUrl: () => '/api/payroll-report',
  useGetPayslip: () => ({ data: state.payslip }),
  getGetPayslipQueryKey: () => ['payslip'],
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

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
  state.corrections = [];
  state.reportResult = undefined;
  state.payslip = undefined;
  state.createPeriodMutate = vi.fn();
  state.createRunMutate = vi.fn();
  state.calculateMutate = vi.fn();
  state.approveRunMutate = vi.fn();
  state.lockRunMutate = vi.fn();
  state.createInputMutate = vi.fn();
  state.deleteInputMutate = vi.fn();
  state.createCorrectionMutate = vi.fn();
  state.approveCorrectionMutate = vi.fn();
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

  it('a calculated run shows an Approve action that invokes the mutation', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'calculated', preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-31T00:00:00.000Z' }];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.queryByTestId('button-lock-run')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('button-approve-run'));
    expect(state.approveRunMutate).toHaveBeenCalledWith({ organizationId: 10, id: 7 }, expect.anything());
  });

  it('an approved run shows a Lock action (not Calculate/Approve) and invokes the mutation', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'approved', preparedByMembershipId: 5, approvedByMembershipId: 8, lockedAt: null, calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-31T00:00:00.000Z' }];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.queryByTestId('button-calculate-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-approve-run')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('button-lock-run'));
    expect(state.lockRunMutate).toHaveBeenCalledWith({ organizationId: 10, id: 7 }, expect.anything());
  });

  it('a locked run shows neither Calculate/Approve/Lock, and a Correct action per line', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'locked', preparedByMembershipId: 5, approvedByMembershipId: 8, lockedAt: '2026-02-01T00:00:00.000Z', calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }];
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
    expect(screen.queryByTestId('button-calculate-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-approve-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-lock-run')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-correct-line-501')).toBeInTheDocument();
  });

  it('creates a correction with a reason via the dialog', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'locked', preparedByMembershipId: 5, approvedByMembershipId: 8, lockedAt: '2026-02-01T00:00:00.000Z', calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }];
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
    await userEvent.click(screen.getByTestId('button-correct-line-501'));
    await userEvent.type(screen.getByTestId('input-correction-reason'), 'salary was under-entered');
    await userEvent.click(screen.getByTestId('button-submit-correction'));
    expect(state.createCorrectionMutate).toHaveBeenCalledWith(
      { organizationId: 10, runId: 7, data: { originalRunLineId: 1, reason: 'salary was under-entered' } },
      expect.anything(),
    );
  });

  it('shows a draft correction with an Approve action, and approves it', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'locked', preparedByMembershipId: 5, approvedByMembershipId: 8, lockedAt: '2026-02-01T00:00:00.000Z', calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }];
    state.corrections = [
      {
        id: 3, organizationId: 10, originalRunId: 7, originalRunLineId: 1, employeeId: 501, status: 'draft', reason: 'salary was under-entered',
        staffNumberSnapshot: 'EMP-501', payeBandsVersionId: 1, pensionRatesVersionId: 2, pensionEarningsCeilingVersionId: null,
        grossEarnings: '1500.00', pensionableEarnings: '1500.00', employeePensionDeduction: '82.50', employerPensionContribution: '195.00',
        tier1Amount: '202.50', tier2Amount: '75.00', taxableIncome: '1417.50', payeAmount: '91.75', otherDeductions: '0.00',
        netPay: '1325.75', netPayDelta: '403.00', currency: 'GHS', createdByMembershipId: 5, approvedByMembershipId: null, approvedAt: null,
        createdAt: '2026-02-02T00:00:00.000Z',
      },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    const row = screen.getByTestId('row-correction-3');
    expect(row).toHaveTextContent('1325.75');
    expect(row).toHaveTextContent('403.00');
    await userEvent.click(screen.getByTestId('button-approve-correction-3'));
    expect(state.approveCorrectionMutate).toHaveBeenCalledWith({ organizationId: 10, id: 3 }, expect.anything());
  });

  it('does not show the Payroll Outputs section while the run is only calculated (not locked)', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'calculated', preparedByMembershipId: 5, approvedByMembershipId: null, lockedAt: null, calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-31T00:00:00.000Z' }];
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.queryByTestId('section-payroll-outputs')).not.toBeInTheDocument();
  });

  it('shows the Payroll Outputs section with a report table and totals once the run is locked', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'locked', preparedByMembershipId: 5, approvedByMembershipId: 8, lockedAt: '2026-02-01T00:00:00.000Z', calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }];
    state.reportResult = {
      key: 'payroll_register', label: 'Payroll Register', generatedAt: '2026-02-01T00:00:00.000Z',
      columns: [{ key: 'employeeName', label: 'Employee Name' }, { key: 'netPay', label: 'Net Pay' }],
      rows: [{ employeeName: 'Ada Lovelace', netPay: '922.75' }],
      totals: { netPay: '922.75' },
    };
    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    expect(screen.getByTestId('section-payroll-outputs')).toBeInTheDocument();
    expect(screen.getByTestId('table-payroll-report')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('text-report-totals')).toHaveTextContent('922.75');
  });

  it('viewing a payslip shows original figures and, once corrected, the effective net pay', async () => {
    resetState();
    state.periods = [PERIOD];
    state.runs = [{ id: 7, organizationId: 10, payrollPeriodId: 1, status: 'locked', preparedByMembershipId: 5, approvedByMembershipId: 8, lockedAt: '2026-02-01T00:00:00.000Z', calculatedAt: '2026-01-31T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }];
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
      corrections: [
        {
          id: 9, status: 'approved', reason: 'salary was under-entered', netPayDelta: '403.00', approvedAt: '2026-02-05T00:00:00.000Z',
          grossEarnings: '1500.00', pensionableEarnings: '1500.00', employeePensionDeduction: '82.50', employerPensionContribution: '195.00',
          tier1Amount: '202.50', tier2Amount: '75.00', taxableIncome: '1417.50', payeAmount: '91.75', otherDeductions: '0.00', netPay: '1325.75',
          components: [],
        },
      ],
      effective: {
        grossEarnings: '1500.00', pensionableEarnings: '1500.00', employeePensionDeduction: '82.50', employerPensionContribution: '195.00',
        tier1Amount: '202.50', tier2Amount: '75.00', taxableIncome: '1417.50', payeAmount: '91.75', otherDeductions: '0.00', netPay: '1325.75',
        source: 'correction', correctionId: 9,
      },
    };

    renderPage();
    await userEvent.click(screen.getByTestId('button-select-period-1'));
    await userEvent.click(screen.getByTestId('button-view-payslip-501'));
    expect(screen.getByTestId('section-payslip-detail')).toBeInTheDocument();
    expect(screen.getByTestId('text-payslip-original-net')).toHaveTextContent('922.75');
    expect(screen.getByTestId('badge-payslip-effective-source')).toHaveTextContent('Corrected');
    expect(screen.getByTestId('text-payslip-effective-net')).toHaveTextContent('1325.75');
  });
});
