/**
 * Tests for the Team Assets manager page (Phase 3E, W98, Decision 3).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TeamAssets from '@/pages/team-assets';
import type { AssetAssignment, Employee } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    assignments: [] as AssetAssignment[],
    assignmentsLoading: false,
    assignmentsError: undefined as unknown,
    employees: [] as Employee[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListTeamAssetAssignments: () => ({
    data: state.assignments,
    isLoading: state.assignmentsLoading,
    error: state.assignmentsError,
    refetch: vi.fn(),
  }),
  getListTeamAssetAssignmentsQueryKey: () => ['teamAssetAssignments'],
  useListEmployees: () => ({ data: { items: state.employees, total: state.employees.length, page: 1, pageSize: 200 } }),
  getListEmployeesQueryKey: () => ['employees'],
}));

function assignment(overrides: Partial<AssetAssignment> = {}): AssetAssignment {
  return {
    id: 1,
    organizationId: 10,
    assetId: 1,
    employeeId: 200,
    assetTagSnapshot: 'AST-00001',
    assetNameSnapshot: 'ThinkPad X1',
    categorySnapshot: 'laptop',
    departmentIdSnapshot: null,
    positionIdSnapshot: null,
    issuedAt: new Date().toISOString(),
    issuedByMembershipId: 3,
    expectedReturnDate: null,
    issueCondition: 'good',
    issueNotes: null,
    acknowledgedAt: null,
    acknowledgementNote: null,
    custodyEndedAt: null,
    endReason: null,
    receivedByMembershipId: null,
    returnCondition: null,
    returnNotes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamAssets />
    </QueryClientProvider>,
  );
}

function resetState() {
  state.assignments = [];
  state.assignmentsLoading = false;
  state.assignmentsError = undefined;
  state.employees = [{ id: 200, firstName: 'Amara', lastName: 'Owusu' } as Employee];
}

describe('Team Assets page', () => {
  it('shows a loading state without crashing', () => {
    resetState();
    state.assignmentsLoading = true;
    renderPage();
    expect(screen.getByText('Team Assets')).toBeInTheDocument();
  });

  it('shows an error state with retry', () => {
    resetState();
    state.assignmentsError = { error: 'boom' };
    renderPage();
    expect(screen.getByText(/could not load your team's assets/i)).toBeInTheDocument();
  });

  it('shows an empty state when no direct report currently holds an asset', () => {
    resetState();
    renderPage();
    expect(screen.getByText(/no current custody to show/i)).toBeInTheDocument();
  });

  it('renders current custody with the employee name and a text acknowledgement label', () => {
    resetState();
    state.assignments = [assignment({ id: 1, employeeId: 200, acknowledgedAt: null })];
    renderPage();
    const row = screen.getByTestId('row-team-asset-1');
    expect(row).toHaveTextContent('Amara Owusu');
    expect(row).toHaveTextContent('ThinkPad X1');
    expect(screen.getByTestId('badge-team-ack-status-1')).toHaveTextContent('Not Yet Acknowledged');
  });

  it('shows an "Acknowledged" text label, not merely a color, when acknowledged', () => {
    resetState();
    state.assignments = [assignment({ id: 1, employeeId: 200, acknowledgedAt: new Date().toISOString() })];
    renderPage();
    expect(screen.getByTestId('badge-team-ack-status-1')).toHaveTextContent('Acknowledged');
  });

  it('falls back to "Employee #<id>" when the employee record is not in the resolved list', () => {
    resetState();
    state.assignments = [assignment({ id: 1, employeeId: 999 })];
    renderPage();
    expect(screen.getByTestId('row-team-asset-1')).toHaveTextContent('Employee #999');
  });

  it('exposes no assign/return/mutation/acknowledge-on-behalf-of/incident-review control anywhere on this page', () => {
    resetState();
    state.assignments = [assignment({ id: 1, employeeId: 200 })];
    renderPage();
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /condition/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark lost/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recover/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retire/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
