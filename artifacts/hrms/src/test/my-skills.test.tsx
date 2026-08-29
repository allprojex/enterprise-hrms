/**
 * WS-14 (§30.26 rows 5 and 6) — an employee's own capability.
 *
 * §30.26 freezes these as user actions that must be performable IN THE
 * APPLICATION, so these tests drive the write path rather than asserting a list
 * renders.
 *
 * Two assertions carry the weight. The claim submission sends NO employee
 * identifier — the server resolves the subject from the caller's own employee
 * link (§30.18), and a client that sent one would be inviting the server to
 * trust it. And the page shows no succession content at all: §30.17 makes
 * succession confidential from the very people it concerns, so an employee is
 * never told they are a candidate, who else is, or how ready anybody was judged
 * to be.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import MySkills from '@/pages/my-skills';

const { state, claim } = vi.hoisted(() => ({
  state: {
    records: [] as unknown[],
    options: { skills: [] as unknown[], levels: [] as unknown[] },
    gaps: { positionId: null as number | null, gaps: [] as unknown[] },
  },
  claim: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMySkills: () => ({ data: state.records, isLoading: false, error: null, refetch: vi.fn() }),
  getListMySkillsQueryKey: (o: number) => ['mySkills', o],
  useListMySkillOptions: () => ({ data: state.options, isLoading: false, error: null, refetch: vi.fn() }),
  getListMySkillOptionsQueryKey: (o: number) => ['mySkillOptions', o],
  useClaimMySkill: () => ({ mutate: claim, isPending: false }),
  useGetMySkillGaps: () => ({ data: state.gaps, isLoading: false, error: null, refetch: vi.fn() }),
  getGetMySkillGapsQueryKey: (o: number) => ['mySkillGaps', o],
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/my-skills' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <MySkills />
      </Router>
    </QueryClientProvider>,
  );
}

describe('My Skills (ESS)', () => {
  beforeEach(() => {
    state.records = [];
    state.options = {
      skills: [
        { id: 7, name: 'First Aid', category: 'compliance', proficiencyApplicable: true },
        { id: 8, name: 'Safeguarding', category: 'compliance', proficiencyApplicable: false },
      ],
      levels: [
        { id: 21, label: 'Awareness' },
        { id: 22, label: 'Working' },
      ],
    };
    state.gaps = { positionId: null, gaps: [] };
    claim.mockClear();
  });

  it('claims a skill without ever sending an employee identifier', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-claim-form'));
    await user.selectOptions(screen.getByTestId('select-my-skill'), '7');
    await user.selectOptions(screen.getByTestId('select-my-level'), '22');
    await user.click(screen.getByTestId('button-submit-claim'));

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    const payload = claim.mock.calls[0]![0] as { organizationId: number; data: Record<string, unknown> };
    expect(payload.organizationId).toBe(10);
    expect(payload.data).toMatchObject({ skillId: 7, claimedLevelId: 22 });
    // The subject comes from the employee link server-side (§30.18).
    expect(payload.data).not.toHaveProperty('employeeId');
  });

  it('offers no level for a skill that carries no proficiency', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-open-claim-form'));
    await user.selectOptions(screen.getByTestId('select-my-skill'), '8');
    expect(screen.queryByTestId('select-my-level')).toBeNull();
  });

  it('shows an unverified claim as awaiting verification, never as a verified level', () => {
    state.records = [
      { id: 1, skillId: 7, status: 'claimed', source: 'employee_self_service', claimedLevelId: 22, verifiedLevelId: null },
    ];
    renderPage();

    expect(screen.getByTestId('row-my-skill-1')).toHaveTextContent(/Awaiting verification/i);
    expect(screen.getByTestId('row-my-skill-1')).toHaveTextContent(/You said: Working/i);
    expect(screen.getByTestId('row-my-skill-1')).not.toHaveTextContent(/Verified at/i);
  });

  it('describes a missing verification as not-yet-verified, not as incapability', async () => {
    const user = userEvent.setup();
    state.gaps = {
      positionId: 4,
      gaps: [
        {
          skillId: 7,
          skillName: 'First Aid',
          mandatory: true,
          requiredLevelOrdinal: 2,
          requiredLevelLabel: 'Working',
          verifiedLevelOrdinal: null,
          verifiedLevelLabel: null,
          hasUnverifiedClaim: true,
          evidenceExpired: false,
          state: 'no_verified_evidence',
        },
      ],
    };
    renderPage();

    await user.click(screen.getByRole('tab', { name: /My role requirements/i }));
    const row = await screen.findByTestId('row-my-gap-7');
    expect(row).toHaveTextContent(/Not yet verified/i);
    // §30.6: the wording must never present an unverified claim as a finding
    // that the employee cannot do the thing.
    expect(row).not.toHaveTextContent(/lacks|cannot|unable|incapab/i);
  });

  it('carries no succession content anywhere, because §30.17 withholds it from the employee', async () => {
    const user = userEvent.setup();
    state.records = [{ id: 1, skillId: 7, status: 'verified', source: 'hr_entry', claimedLevelId: 22, verifiedLevelId: 22 }];
    state.gaps = { positionId: 4, gaps: [] };
    const { container } = renderPage();

    await user.click(screen.getByRole('tab', { name: /My role requirements/i }));
    const text = container.textContent ?? '';
    for (const forbidden of [/succession/i, /successor/i, /candidate/i, /readiness/i, /ready now/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });
});
