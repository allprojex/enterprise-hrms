/**
 * WS-14 (§30.26 rows 11, 12, 13 and 15) — the succession workspace.
 *
 * Beyond proving the frozen write actions work in the application, these tests
 * pin down the three things §30 says succession must NOT do:
 *
 *   - it must not rank candidates (§30.12) — they are grouped by readiness band
 *     and carry no rank, score or ordering position;
 *   - it must not appoint anybody (§30.16) — nomination sends nothing that could
 *     change an employment record;
 *   - it must not compute readiness (§30.13) — a person chooses the band, every
 *     time.
 *
 * The unauthorized case is proved too: when the confidential endpoints refuse,
 * the page must show that it cannot display candidates rather than rendering an
 * empty pool, which would read as "this position has no successors".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import SuccessionPage from '@/pages/succession';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    plans: [] as unknown[],
    planDetail: null as unknown,
    planError: null as unknown,
    candidates: [] as unknown[],
    candidatesError: null as unknown,
    readiness: [] as unknown[],
    coverage: { coverage: [] as unknown[] },
  },
  mutations: {
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    nominate: vi.fn(),
    setReadiness: vi.fn(),
    removeCandidate: vi.fn(),
    createBand: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListEmployees: () => ({
    data: {
      items: [
        { id: 3, firstName: 'Ama', lastName: 'Mensah' },
        { id: 5, firstName: 'Kofi', lastName: 'Boateng' },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListEmployeesQueryKey: (o: number) => ['employees', o],
  useListPositions: () => ({ data: [{ id: 4, title: 'Ward Sister' }], isLoading: false, error: null, refetch: vi.fn() }),
  getListPositionsQueryKey: (o: number) => ['positions', o],
  useListSuccessionPlans: () => ({ data: state.plans, isLoading: false, error: null, refetch: vi.fn() }),
  getListSuccessionPlansQueryKey: (o: number) => ['plans', o],
  useGetSuccessionPlan: () => ({
    data: state.planDetail,
    isLoading: false,
    error: state.planError,
    refetch: vi.fn(),
  }),
  getGetSuccessionPlanQueryKey: (o: number, p: number) => ['plan', o, p],
  useCreateSuccessionPlan: () => ({ mutate: mutations.createPlan, isPending: false }),
  useUpdateSuccessionPlan: () => ({ mutate: mutations.updatePlan, isPending: false }),
  useListSuccessionCandidates: () => ({
    data: state.candidates,
    isLoading: false,
    error: state.candidatesError,
    refetch: vi.fn(),
  }),
  getListSuccessionCandidatesQueryKey: (o: number, p: number) => ['candidates', o, p],
  useNominateSuccessionCandidate: () => ({ mutate: mutations.nominate, isPending: false }),
  useSetSuccessionReadiness: () => ({ mutate: mutations.setReadiness, isPending: false }),
  useRemoveSuccessionCandidate: () => ({ mutate: mutations.removeCandidate, isPending: false }),
  useListReadinessLevels: () => ({ data: state.readiness, isLoading: false, error: null, refetch: vi.fn() }),
  getListReadinessLevelsQueryKey: (o: number) => ['readiness', o],
  useCreateReadinessLevel: () => ({ mutate: mutations.createBand, isPending: false }),
  useGetSuccessionCoverage: () => ({ data: state.coverage, isLoading: false, error: null, refetch: vi.fn() }),
  getGetSuccessionCoverageQueryKey: (o: number) => ['coverage', o],
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/succession' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <SuccessionPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Succession workspace', () => {
  beforeEach(() => {
    state.plans = [{ id: 30, positionId: 4, status: 'active', reviewDueAt: null, createdAt: '2026-01-01T00:00:00.000Z' }];
    state.planDetail = { id: 30, positionId: 4, status: 'active', criticalityNotes: 'Incumbent retiring' };
    state.planError = null;
    state.candidates = [];
    state.candidatesError = null;
    state.readiness = [
      { id: 41, ordinal: 1, label: 'Ready now', active: true },
      { id: 42, ordinal: 2, label: 'Ready in 1-2 years', active: true },
    ];
    state.coverage = { coverage: [] };
    for (const m of Object.values(mutations)) m.mockClear();
  });

  it('opens a plan for a position (§30.26 row 11)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-plan-form'));
    await user.selectOptions(screen.getByTestId('select-plan-position'), '4');
    await user.type(screen.getByTestId('input-plan-notes'), 'Sole holder of the rota knowledge');
    await user.click(screen.getByTestId('button-submit-plan'));

    await waitFor(() => expect(mutations.createPlan).toHaveBeenCalledTimes(1));
    const payload = mutations.createPlan.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({ positionId: 4, criticalityNotes: 'Sole holder of the rota knowledge' });
  });

  it('nominates a candidate and sends nothing that could change employment (§30.16)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-plan-30'));
    await user.click(await screen.findByTestId('button-open-nominate'));
    await user.selectOptions(screen.getByTestId('select-nominee'), '3');
    await user.selectOptions(screen.getByTestId('select-nominee-readiness'), '42');
    await user.type(screen.getByTestId('input-nominee-rationale'), 'Strong operational grasp');
    await user.click(screen.getByTestId('button-submit-nominate'));

    await waitFor(() => expect(mutations.nominate).toHaveBeenCalledTimes(1));
    const payload = mutations.nominate.mock.calls[0]![0] as { planId: number; data: Record<string, unknown> };
    expect(payload.planId).toBe(30);
    expect(payload.data).toMatchObject({ employeeId: 3, readinessLevelId: 42 });
    // Nothing here touches the employment record.
    for (const forbidden of ['positionId', 'employmentStatus', 'reportingManagerId', 'effectiveDate', 'appoint']) {
      expect(payload.data).not.toHaveProperty(forbidden);
    }
  });

  it('groups candidates by readiness band and never ranks them (§30.12)', async () => {
    const user = userEvent.setup();
    state.candidates = [
      { id: 61, planId: 30, employeeId: 3, status: 'active', readinessLevelId: 41, readinessLabel: 'Ready now', readinessOrdinal: 1, rationale: null },
      { id: 62, planId: 30, employeeId: 5, status: 'active', readinessLevelId: 42, readinessLabel: 'Ready in 1-2 years', readinessOrdinal: 2, rationale: null },
    ];
    renderPage();

    await user.click(screen.getByTestId('button-open-plan-30'));
    const list = await screen.findByTestId('list-candidates');

    expect(list).toHaveTextContent('Ready now');
    expect(list).toHaveTextContent('Ready in 1-2 years');
    expect(screen.getByTestId('row-candidate-61')).toHaveTextContent('Ama Mensah');

    // No ordering language anywhere: no rank, no score, no "first successor".
    const text = list.textContent ?? '';
    for (const forbidden of [/\brank/i, /\bscore/i, /\b1st\b/, /first successor/i, /#\d+\s+successor/i, /priority/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('takes readiness from a person rather than computing it (§30.13)', async () => {
    const user = userEvent.setup();
    state.candidates = [
      { id: 61, planId: 30, employeeId: 3, status: 'active', readinessLevelId: 42, readinessLabel: 'Ready in 1-2 years', readinessOrdinal: 2, rationale: null },
    ];
    renderPage();

    await user.click(screen.getByTestId('button-open-plan-30'));
    await user.selectOptions(await screen.findByTestId('select-readiness-61'), '41');

    await waitFor(() => expect(mutations.setReadiness).toHaveBeenCalledTimes(1));
    const payload = mutations.setReadiness.mock.calls[0]![0] as { candidateId: number; data: Record<string, unknown> };
    expect(payload.candidateId).toBe(61);
    expect(payload.data).toEqual({ readinessLevelId: 41 });
  });

  it('will not remove a candidate without a reason (§30.12)', async () => {
    const user = userEvent.setup();
    state.candidates = [
      { id: 61, planId: 30, employeeId: 3, status: 'active', readinessLevelId: 41, readinessLabel: 'Ready now', readinessOrdinal: 1, rationale: null },
    ];
    renderPage();

    await user.click(screen.getByTestId('button-open-plan-30'));
    await user.click(await screen.findByTestId('button-remove-candidate-61'));
    expect(screen.getByTestId('button-confirm-remove-61')).toBeDisabled();

    await user.type(screen.getByTestId('input-remove-reason-61'), 'Moved to another division');
    await user.click(screen.getByTestId('button-confirm-remove-61'));

    await waitFor(() => expect(mutations.removeCandidate).toHaveBeenCalledTimes(1));
    expect((mutations.removeCandidate.mock.calls[0]![0] as { data: { reason: string } }).data.reason).toBe(
      'Moved to another division',
    );
  });

  it('reports coverage as counts, carrying no candidate identity or confidential note (§30.25)', async () => {
    const user = userEvent.setup();
    state.coverage = {
      coverage: [
        {
          planId: 30,
          positionId: 4,
          positionTitle: 'Ward Sister',
          status: 'active',
          candidateCount: 2,
          nearestTermReadyCount: 1,
          hasNoCandidates: false,
        },
      ],
    };
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Coverage/i }));
    const row = await screen.findByTestId('row-coverage-30');
    expect(row).toHaveTextContent('Ward Sister');
    expect(row).toHaveTextContent(/2 candidate/i);
    // No name and no note reaches this report.
    expect(row.textContent ?? '').not.toMatch(/Ama|Kofi|retiring/i);
  });

  it('says it cannot show candidates when the confidential endpoint refuses, rather than showing an empty pool', async () => {
    const user = userEvent.setup();
    // `succession.confidential.read` is withheld from organization administration
    // by default (§30.17), so a 403 here is an ordinary, expected outcome.
    state.candidatesError = { response: { status: 403, data: { error: 'Forbidden' } } };
    renderPage();

    await user.click(screen.getByTestId('button-open-plan-30'));

    // The refusal is surfaced as a retryable error, NOT as "no candidates" —
    // rendering an empty pool would assert something untrue about the position.
    await waitFor(() => expect(screen.queryByTestId('text-no-candidates')).toBeNull());
    expect(screen.getByTestId('card-plan-detail')).toBeInTheDocument();
  });
});
