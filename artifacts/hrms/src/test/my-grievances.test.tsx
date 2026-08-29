/**
 * WS-12 (§28.5) — the Employee Self-Service grievance surface.
 *
 * §28.5 freezes two things this file exists to prove. Employees may SUBMIT
 * their own grievances through ESS, so a submission path must actually exist in
 * the application rather than only in the API. And the surface must never carry
 * confidential HR notes, investigator working notes, internal deliberations,
 * draft findings or protected audit information.
 *
 * The second is enforced on the server, which sends the allow-list view and
 * nothing else. That is deliberate and it is what makes the guarantee durable —
 * but a component that invented its own fields from a richer payload would
 * still break it, so the render assertions below check what actually reaches
 * the screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import MyGrievances from '@/pages/my-grievances';

const { state, submitMutate } = vi.hoisted(() => ({
  state: { grievances: [] as unknown[], isLoading: false, error: null as unknown },
  submitMutate: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyGrievances: () => ({
    data: state.grievances,
    isLoading: state.isLoading,
    error: state.error,
    refetch: vi.fn(),
  }),
  getListMyGrievancesQueryKey: (orgId: number) => ['myGrievances', orgId],
  useSubmitMyGrievance: () => ({ mutate: submitMutate, isPending: false }),
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/my-grievances' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <MyGrievances />
      </Router>
    </QueryClientProvider>,
  );
}

describe('My Grievances (ESS)', () => {
  beforeEach(() => {
    state.grievances = [];
    state.isLoading = false;
    state.error = null;
    submitMutate.mockClear();
  });

  it('offers a submission path, because §28.5 freezes ESS submission as a user action', async () => {
    renderPage();
    expect(screen.getByTestId('card-raise-grievance')).toBeInTheDocument();
    expect(screen.getByTestId('button-open-grievance-form')).toBeInTheDocument();
  });

  it('submits the employee\'s own grievance WITHOUT a complainant id', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-grievance-form'));
    await user.type(screen.getByTestId('input-grievance-category'), 'working conditions');
    await user.type(screen.getByTestId('input-grievance-subject'), 'Rota is unfair');
    await user.type(screen.getByTestId('input-grievance-description'), 'The weekend rota is not shared evenly.');
    await user.click(screen.getByTestId('button-submit-grievance'));

    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    const payload = submitMutate.mock.calls[0]![0] as { organizationId: number; data: Record<string, unknown> };
    expect(payload.organizationId).toBe(10);
    expect(payload.data.categoryCode).toBe('working conditions');
    expect(payload.data.subject).toBe('Rota is unfair');
    expect(payload.data.description).toBe('The weekend rota is not shared evenly.');

    // THE ASSERTION THIS TEST EXISTS FOR: the complainant is resolved from the
    // caller's own employee link on the server (§28.5), so the client must not
    // send one — an employee cannot file in a colleague's name.
    expect(payload.data).not.toHaveProperty('complainantEmployeeId');
  });

  it('will not submit an incomplete grievance', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-grievance-form'));
    await user.type(screen.getByTestId('input-grievance-subject'), 'Subject only');
    expect(screen.getByTestId('button-submit-grievance')).toBeDisabled();
    expect(submitMutate).not.toHaveBeenCalled();
  });

  it('renders only what the server chose to send, and no internal field', () => {
    state.grievances = [
      {
        id: 7,
        categoryCode: 'working conditions',
        subject: 'Rota',
        description: 'The rota is unfair.',
        status: 'resolved',
        submittedAt: '2026-04-01T00:00:00.000Z',
        acknowledgedAt: '2026-04-02T00:00:00.000Z',
        resolutionSummary: 'Rota rebalanced from May.',
        resolvedAt: '2026-04-20T00:00:00.000Z',
        closedAt: null,
        updates: [
          { id: 1, eventType: 'acknowledged', occurredAt: '2026-04-02T00:00:00.000Z', notes: null },
          {
            id: 2,
            eventType: 'resolution_recorded',
            occurredAt: '2026-04-20T00:00:00.000Z',
            notes: 'Rota rebalanced from May.',
          },
        ],
      },
    ];
    renderPage();

    expect(screen.getByTestId('card-my-grievance-7')).toBeInTheDocument();
    expect(screen.getByText('Rota')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Receipt acknowledged')).toBeInTheDocument();
    // The allow-list view carries no assignment, confidentiality or respondent,
    // so none of those labels can appear.
    expect(screen.queryByText(/investigator/i)).toBeNull();
    expect(screen.queryByText(/confidential/i)).toBeNull();
    expect(screen.queryByText(/respondent/i)).toBeNull();
  });

  it('shows an empty state rather than an error when the employee has raised nothing', () => {
    renderPage();
    expect(screen.getByText('You have not raised any grievances.')).toBeInTheDocument();
  });
});
