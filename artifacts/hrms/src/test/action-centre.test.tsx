/**
 * WS-15 (§31.34) — the HR Action Centre frontend acceptance table.
 *
 * §31.34 freezes rows 7–10 as inline WRITE actions that must be performable in
 * the application, and states plainly that a read-only surface does not satisfy
 * them. These tests therefore drive the controls, not just the list.
 *
 * The assertions that matter most are about what the page must NOT do:
 *
 *   - it must not invent visibility — a module the server omitted is absent
 *     from the rows, the counts and the filter options alike (§31.19);
 *   - it must not render a provider failure as "0 actions" (§31.22);
 *   - it must not offer an inline control the server did not authorize (§31.8);
 *   - it must not submit a rejection with no reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import ActionCentre from '@/pages/action-centre';

const { state, execute } = vi.hoisted(() => ({
  state: {
    items: [] as any[],
    unavailableSources: [] as string[],
    counts: { total: 0, overdue: 0, byModule: [] as any[], unavailableSources: [] as string[] },
  },
  execute: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListActionCentre: () => ({
    data: { items: state.items, unavailableSources: state.unavailableSources },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListActionCentreQueryKey: (o: number) => ['ac', o],
  useGetActionCentreCounts: () => ({ data: state.counts, isLoading: false, error: null, refetch: vi.fn() }),
  getGetActionCentreCountsQueryKey: (o: number) => ['acCounts', o],
  useExecuteActionCentreCommand: () => ({ mutate: execute, isPending: false }),
}));

function row(over: Record<string, unknown> = {}) {
  return {
    sourceModule: 'leave',
    sourceType: 'leave_request',
    sourceId: 5,
    actionKind: 'approve',
    title: 'Leave request',
    employeeId: 3,
    employeeFirstName: 'Ama',
    employeeLastName: 'Mensah',
    status: 'pending',
    createdAt: '2026-08-01T00:00:00.000Z',
    dueAt: null,
    overdue: null,
    deepLink: '/leave-approvals',
    inlineCommands: ['leave.approve', 'leave.reject'],
    ...over,
  };
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/action-centre' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <ActionCentre />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Action Centre', () => {
  beforeEach(() => {
    state.items = [];
    state.unavailableSources = [];
    state.counts = { total: 0, overdue: 0, byModule: [], unavailableSources: [] };
    execute.mockClear();
  });

  it('offers the three frozen scopes (§31.10)', () => {
    renderPage();
    expect(screen.getByTestId('tab-my-actions')).toBeInTheDocument();
    expect(screen.getByTestId('tab-assigned')).toBeInTheDocument();
    expect(screen.getByTestId('tab-oversight')).toBeInTheDocument();
  });

  it('approves a leave request inline, calling the owning module (§31.34 row 7)', async () => {
    const user = userEvent.setup();
    state.items = [row()];
    renderPage();

    await user.click(screen.getByTestId('button-approve-leave_request-5'));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const payload = execute.mock.calls[0]![0] as { command: string; data: { sourceId: number } };
    expect(payload.command).toBe('leave.approve');
    expect(payload.data.sourceId).toBe(5);
  });

  it('will not reject without a reason (§31.34 row 7)', async () => {
    const user = userEvent.setup();
    state.items = [row()];
    renderPage();

    await user.click(screen.getByTestId('button-reject-leave_request-5'));
    expect(screen.getByTestId('button-confirm-reject-leave_request-5')).toBeDisabled();

    await user.type(screen.getByTestId('input-reason-leave_request-5'), 'Insufficient cover');
    await user.click(screen.getByTestId('button-confirm-reject-leave_request-5'));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const payload = execute.mock.calls[0]![0] as { command: string; data: { reason: string } };
    expect(payload.command).toBe('leave.reject');
    expect(payload.data.reason).toBe('Insufficient cover');
  });

  it('completes an onboarding task inline (§31.34 row 9)', async () => {
    const user = userEvent.setup();
    state.items = [
      row({
        sourceModule: 'onboarding',
        sourceType: 'onboarding_task',
        sourceId: 11,
        actionKind: 'complete',
        title: 'Return signed contract',
        dueAt: '2026-07-01T00:00:00.000Z',
        overdue: true,
        deepLink: '/onboarding',
        inlineCommands: ['onboarding.complete'],
      }),
    ];
    renderPage();

    expect(screen.getByTestId('badge-overdue-onboarding_task-11')).toBeInTheDocument();
    await user.click(screen.getByTestId('button-complete-onboarding_task-11'));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect((execute.mock.calls[0]![0] as { command: string }).command).toBe('onboarding.complete');
  });

  it('verifies a skill inline (§31.34 row 10)', async () => {
    const user = userEvent.setup();
    state.items = [
      row({
        sourceModule: 'skills',
        sourceType: 'employee_skill_record',
        sourceId: 21,
        actionKind: 'verify',
        title: 'First Aid',
        deepLink: '/capability',
        inlineCommands: ['skill.verify', 'skill.reject'],
      }),
    ];
    renderPage();

    await user.click(screen.getByTestId('button-verify-employee_skill_record-21'));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect((execute.mock.calls[0]![0] as { command: string }).command).toBe('skill.verify');
  });

  it('offers no inline control for a deep-link-only row (§31.9)', () => {
    state.items = [
      row({
        sourceModule: 'employee_relations',
        sourceType: 'grievance_case',
        sourceId: 31,
        actionKind: 'decide',
        title: 'Grievance case #31',
        employeeId: null,
        employeeFirstName: null,
        employeeLastName: null,
        deepLink: '/employee-relations',
        inlineCommands: [],
      }),
    ];
    renderPage();

    // The row exists and links out, but carries no decision control at all.
    expect(screen.getByTestId('row-action-grievance_case-31')).toBeInTheDocument();
    expect(screen.getByTestId('link-open-grievance_case-31')).toBeInTheDocument();
    expect(screen.queryByTestId('button-approve-grievance_case-31')).toBeNull();
    expect(screen.queryByTestId('button-verify-grievance_case-31')).toBeNull();
    expect(screen.queryByTestId('button-complete-grievance_case-31')).toBeNull();
    // And the case reference is all it says — no narrative, no complainant.
    expect(screen.getByTestId('row-action-grievance_case-31')).toHaveTextContent('Grievance case #31');
    expect(screen.getByTestId('row-action-grievance_case-31')).toHaveTextContent(/No named subject/i);
  });

  it('names an unavailable source rather than showing an incomplete queue as complete (§31.34 row 14)', () => {
    state.unavailableSources = ['leave'];
    state.items = [];
    renderPage();

    const banner = screen.getByTestId('banner-unavailable-sources');
    expect(banner).toHaveTextContent(/may be incomplete/i);
    expect(banner).toHaveTextContent(/Leave/);
    // The empty state may also render, but the user has been told why.
    expect(banner).not.toHaveTextContent(/Error|stack|at Object/i);
  });

  it('shows no banner when every authorized source answered', () => {
    state.items = [row()];
    renderPage();
    expect(screen.queryByTestId('banner-unavailable-sources')).toBeNull();
  });

  it('renders only the modules the server returned, in counts and in the filter (§31.19)', async () => {
    const user = userEvent.setup();
    state.items = [row()];
    state.counts = {
      total: 1,
      overdue: 0,
      // The server omitted employee_relations and succession entirely, because
      // this caller may not read them. The page must not invent either.
      byModule: [{ sourceModule: 'leave', count: 1 }],
      unavailableSources: [],
    };
    renderPage();

    expect(screen.getByTestId('count-leave')).toHaveTextContent('Leave: 1');
    expect(screen.queryByTestId('count-employee_relations')).toBeNull();
    expect(screen.queryByTestId('count-succession')).toBeNull();

    // The filter is built from the same list, so a hidden module is not even
    // offered as an option — no existence signal anywhere.
    const options = [...screen.getByTestId('select-module-filter').querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['', 'leave']);
    await user.selectOptions(screen.getByTestId('select-module-filter'), 'leave');
    expect((screen.getByTestId('select-module-filter') as HTMLSelectElement).value).toBe('leave');
  });

  it('distinguishes an authorized zero from an omitted module', () => {
    state.items = [];
    state.counts = {
      total: 0,
      overdue: 0,
      // Leave answered and had nothing; employee_relations was never shown.
      byModule: [{ sourceModule: 'leave', count: 0 }],
      unavailableSources: [],
    };
    renderPage();

    expect(screen.getByTestId('count-leave')).toHaveTextContent('Leave: 0');
    expect(screen.queryByTestId('count-employee_relations')).toBeNull();
    expect(screen.getByTestId('text-no-actions')).toBeInTheDocument();
  });

  it('surfaces an overdue count when the server reports one', () => {
    state.items = [row({ dueAt: '2026-07-01T00:00:00.000Z', overdue: true })];
    state.counts = { total: 1, overdue: 1, byModule: [{ sourceModule: 'leave', count: 1 }], unavailableSources: [] };
    renderPage();
    expect(screen.getByTestId('badge-overdue-count')).toHaveTextContent('1 overdue');
  });

  it('says an undated item has no due date rather than implying it is on time (§31.16)', () => {
    state.items = [row({ dueAt: null, overdue: null })];
    renderPage();
    const rendered = screen.getByTestId('row-action-leave_request-5');
    expect(rendered).toHaveTextContent(/No due date/i);
    expect(screen.queryByTestId('badge-overdue-leave_request-5')).toBeNull();
  });
});
