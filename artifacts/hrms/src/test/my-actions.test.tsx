/**
 * WS-15 (§31.34 row 13, §31.13) — ESS My Actions.
 *
 * The allow-list is the architecture, so these tests pin it down: three
 * sources appear, nothing else does, and the page never carries confidential
 * content from any module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import MyActions from '@/pages/my-actions';

const { state } = vi.hoisted(() => ({
  state: { linked: true, items: [] as any[] },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyActionCentre: () => ({
    data: { linked: state.linked, items: state.items },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListMyActionCentreQueryKey: (o: number) => ['myAc', o],
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/my-actions' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <MyActions />
      </Router>
    </QueryClientProvider>,
  );
}

const item = (over: Record<string, unknown> = {}) => ({
  sourceModule: 'onboarding',
  sourceType: 'onboarding_task',
  sourceId: 1,
  actionKind: 'complete',
  title: 'Return signed contract',
  employeeId: 3,
  employeeFirstName: null,
  employeeLastName: null,
  status: 'pending',
  createdAt: '2026-08-01T00:00:00.000Z',
  dueAt: null,
  overdue: null,
  deepLink: '/my-onboarding',
  inlineCommands: [],
  ...over,
});

describe('ESS My Actions', () => {
  beforeEach(() => {
    state.linked = true;
    state.items = [];
  });

  it('renders the three allow-listed kinds and links each to the surface that owns it', () => {
    state.items = [
      item(),
      item({
        sourceType: 'document_acknowledgement',
        sourceId: 2,
        actionKind: 'acknowledge',
        title: 'Employee Handbook 2026',
        dueAt: '2026-07-01T00:00:00.000Z',
        overdue: true,
      }),
      item({
        sourceModule: 'employee_requests',
        sourceType: 'service_request',
        sourceId: 3,
        title: 'Employment letter',
        deepLink: '/my-requests',
      }),
    ];
    renderPage();

    expect(screen.getByTestId('row-my-action-onboarding_task-1')).toHaveTextContent('Onboarding task');
    expect(screen.getByTestId('row-my-action-document_acknowledgement-2')).toHaveTextContent('To acknowledge');
    expect(screen.getByTestId('row-my-action-service_request-3')).toHaveTextContent('HR request');
    expect(screen.getByTestId('badge-overdue-document_acknowledgement-2')).toBeInTheDocument();
    // Each links out; this page owns no completion flow of its own.
    expect(screen.getByTestId('link-open-service_request-3')).toBeInTheDocument();
  });

  it('carries nothing from the excluded modules (§31.13)', () => {
    state.items = [item()];
    const { container } = renderPage();
    const text = container.textContent ?? '';
    for (const forbidden of [/grievance/i, /succession/i, /payroll/i, /salary/i, /readiness/i, /candidate/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('explains an unlinked account rather than showing an empty to-do list', () => {
    state.linked = false;
    renderPage();
    expect(screen.getByTestId('text-not-linked')).toBeInTheDocument();
    expect(screen.queryByTestId('text-no-my-actions')).toBeNull();
  });

  it('shows a genuine empty state when there is nothing to do', () => {
    state.linked = true;
    state.items = [];
    renderPage();
    expect(screen.getByTestId('text-no-my-actions')).toBeInTheDocument();
  });
});
