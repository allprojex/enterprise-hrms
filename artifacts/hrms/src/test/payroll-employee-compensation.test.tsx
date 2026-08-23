/**
 * Tests for the Payroll Employee Compensation page (Payroll, Workstream 2).
 * @workspace/api-client-react is mocked at the hook level.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollEmployeeCompensation from '@/pages/payroll-employee-compensation';
import type { EmployeeCompensationComponent, EmployeeBankingDetail, EmployeeStatutoryIdentifier } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    compensation: [] as EmployeeCompensationComponent[],
    compensationError: undefined as unknown,
    banking: null as EmployeeBankingDetail | null,
    bankingError: undefined as unknown,
    statutory: null as EmployeeStatutoryIdentifier | null,
    statutoryError: undefined as unknown,
    createCompensationMutate: vi.fn(),
    createBankingMutate: vi.fn(),
    createStatutoryMutate: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListEmployeeCompensation: () => ({ data: state.compensation, error: state.compensationError }),
  getListEmployeeCompensationQueryKey: () => ['compensation'],
  useCreateEmployeeCompensationComponent: () => ({ mutate: state.createCompensationMutate, isPending: false }),
  useGetEmployeeBankingDetail: () => ({ data: state.banking, error: state.bankingError }),
  getGetEmployeeBankingDetailQueryKey: () => ['banking'],
  useCreateEmployeeBankingDetail: () => ({ mutate: state.createBankingMutate, isPending: false }),
  useGetEmployeeStatutoryIdentifier: () => ({ data: state.statutory, error: state.statutoryError }),
  getGetEmployeeStatutoryIdentifierQueryKey: () => ['statutory'],
  useCreateEmployeeStatutoryIdentifier: () => ({ mutate: state.createStatutoryMutate, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollEmployeeCompensation />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.compensation = [];
  state.compensationError = undefined;
  state.banking = null;
  state.bankingError = undefined;
  state.statutory = null;
  state.statutoryError = undefined;
  state.createCompensationMutate = vi.fn();
  state.createBankingMutate = vi.fn();
  state.createStatutoryMutate = vi.fn();
}

describe('Payroll Employee Compensation page', () => {
  it('shows only the employee-id loader until an employee is loaded', () => {
    resetState();
    renderPage();
    expect(screen.getByTestId('input-employee-id-search')).toBeInTheDocument();
    expect(screen.queryByText(/current compensation components/i)).not.toBeInTheDocument();
  });

  it('loads an employee by id and shows the empty states', async () => {
    resetState();
    renderPage();
    await userEvent.type(screen.getByTestId('input-employee-id-search'), '42');
    await userEvent.click(screen.getByTestId('button-load-employee'));
    expect(screen.getByText(/no compensation components on file/i)).toBeInTheDocument();
    expect(screen.getByText(/no banking details on file/i)).toBeInTheDocument();
    expect(screen.getByText(/no statutory identifiers on file/i)).toBeInTheDocument();
  });

  it('hides the compensation section entirely when the read call is forbidden (reactive-403-hide)', async () => {
    resetState();
    state.compensationError = { status: 403, error: 'Forbidden' };
    renderPage();
    await userEvent.type(screen.getByTestId('input-employee-id-search'), '42');
    await userEvent.click(screen.getByTestId('button-load-employee'));
    expect(screen.queryByText(/current compensation components/i)).not.toBeInTheDocument();
    // Banking/statutory sections remain visible — permissions are independent.
    expect(screen.getByText(/no banking details on file/i)).toBeInTheDocument();
  });

  it('renders existing compensation components in a table', async () => {
    resetState();
    state.compensation = [
      { id: 1, organizationId: 10, employeeId: 42, category: 'earning', componentTypeCode: 'basic_salary', amount: '1000.00', currency: 'GHS', recurring: true, taxableTreatment: 'ordinary', pensionable: true, sourceReferenceType: null, sourceReferenceId: null, validFrom: '2026-01-01T00:00:00.000Z', validTo: null, createdByMembershipId: 5, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    renderPage();
    await userEvent.type(screen.getByTestId('input-employee-id-search'), '42');
    await userEvent.click(screen.getByTestId('button-load-employee'));
    const row = screen.getByTestId('row-component-1');
    expect(row).toHaveTextContent('earning');
    expect(row).toHaveTextContent('basic_salary');
    expect(row).toHaveTextContent('1000.00');
  });

  it('submits a new compensation component with the entered values', async () => {
    resetState();
    renderPage();
    await userEvent.type(screen.getByTestId('input-employee-id-search'), '42');
    await userEvent.click(screen.getByTestId('button-load-employee'));
    await userEvent.click(screen.getByTestId('button-add-component'));
    await userEvent.clear(screen.getByTestId('input-component-type-code'));
    await userEvent.type(screen.getByTestId('input-component-type-code'), 'basic_salary');
    await userEvent.type(screen.getByTestId('input-amount'), '1500');
    await userEvent.type(screen.getByTestId('input-valid-from'), '2026-01-01');
    await userEvent.click(screen.getByTestId('button-submit-component'));
    expect(state.createCompensationMutate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 10, employeeId: 42, data: expect.objectContaining({ componentTypeCode: 'basic_salary', amount: '1500' }) }),
      expect.anything(),
    );
  });

  it('shows current banking details when present', async () => {
    resetState();
    state.banking = { id: 1, organizationId: 10, employeeId: 42, bankCode: 'gcb', accountNumber: '1234567890', accountName: 'Ada Lovelace', branch: null, validFrom: '2026-01-01T00:00:00.000Z', validTo: null, createdByMembershipId: 5, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    renderPage();
    await userEvent.type(screen.getByTestId('input-employee-id-search'), '42');
    await userEvent.click(screen.getByTestId('button-load-employee'));
    expect(screen.getByTestId('text-current-banking')).toHaveTextContent('gcb');
    expect(screen.getByTestId('text-current-banking')).toHaveTextContent('7890');
    expect(screen.getByTestId('text-current-banking')).not.toHaveTextContent('1234567890');
  });
});
