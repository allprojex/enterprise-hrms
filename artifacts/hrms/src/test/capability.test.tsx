/**
 * WS-14 (§30.26 rows 4, 7, 8, 9, 10 and 14) — the HR capability workspace.
 *
 * §30.26 freezes these as user actions performable IN THE APPLICATION, so these
 * tests drive the write paths.
 *
 * The assertions that matter most are the ones about MEANING, not markup:
 *
 *   - "Record assessment" and "Verify" are separate controls that call separate
 *     endpoints, because an observation is not the organization's confirmation
 *     (§30.8);
 *   - a rejection cannot be submitted without a reason;
 *   - the gap view distinguishes an unverified claim from falling short, and
 *     never renders "no verified evidence" as incapability (§30.6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Capability from '@/pages/capability';

const { state, mutations } = vi.hoisted(() => ({
  state: {
    records: [] as unknown[],
    requirements: [] as unknown[],
    gaps: { gaps: [] as unknown[] },
    actions: [] as unknown[],
    removeRequirementFails: false,
  },
  mutations: {
    claim: vi.fn(),
    assess: vi.fn(),
    verify: vi.fn(),
    reject: vi.fn(),
    addRequirement: vi.fn(),
    removeRequirement: vi.fn(),
    // Withdrawal is confirmed first and awaited: resolves, or rejects when
    // `removeRequirementFails` is set (the hook's own onError toasts).
    removeRequirementAsync: vi.fn(() =>
      state.removeRequirementFails ? Promise.reject(new Error('Requirement not found')) : Promise.resolve(undefined),
    ),
    createAction: vi.fn(),
    updateAction: vi.fn(),
  },
}));

const SKILLS = [
  { id: 7, name: 'First Aid', code: 'FA', category: 'compliance', active: true, proficiencyApplicable: true },
  { id: 8, name: 'Safeguarding', code: 'SG', category: 'compliance', active: true, proficiencyApplicable: false },
];
const LEVELS = [
  { id: 21, ordinal: 1, label: 'Awareness' },
  { id: 22, ordinal: 2, label: 'Working' },
];

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListEmployees: () => ({
    data: { items: [{ id: 3, firstName: 'Ama', lastName: 'Mensah' }], total: 1, page: 1, pageSize: 20 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListEmployeesQueryKey: (o: number) => ['employees', o],
  useListPositions: () => ({ data: [{ id: 4, title: 'Ward Sister' }], isLoading: false, error: null, refetch: vi.fn() }),
  getListPositionsQueryKey: (o: number) => ['positions', o],
  useListSkills: () => ({ data: SKILLS, isLoading: false, error: null, refetch: vi.fn() }),
  getListSkillsQueryKey: (o: number) => ['skills', o],
  useGetProficiencyScale: () => ({
    data: { scale: { id: 1, name: 'Baseline', active: true }, levels: LEVELS },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getGetProficiencyScaleQueryKey: (o: number) => ['scale', o],
  useListEmployeeSkillRecords: () => ({ data: state.records, isLoading: false, error: null, refetch: vi.fn() }),
  getListEmployeeSkillRecordsQueryKey: (o: number) => ['records', o],
  useClaimEmployeeSkill: () => ({ mutate: mutations.claim, isPending: false }),
  useAssessEmployeeSkill: () => ({ mutate: mutations.assess, isPending: false }),
  useVerifyEmployeeSkill: () => ({ mutate: mutations.verify, isPending: false }),
  useRejectEmployeeSkill: () => ({ mutate: mutations.reject, isPending: false }),
  useListPositionSkillRequirements: () => ({ data: state.requirements, isLoading: false, error: null, refetch: vi.fn() }),
  getListPositionSkillRequirementsQueryKey: (o: number) => ['requirements', o],
  useAddPositionRequirement: () => ({ mutate: mutations.addRequirement, isPending: false }),
  useRemovePositionRequirement: () => ({
    mutate: mutations.removeRequirement,
    mutateAsync: mutations.removeRequirementAsync,
    isPending: false,
  }),
  useGetEmployeeSkillGaps: () => ({ data: state.gaps, isLoading: false, error: null, refetch: vi.fn() }),
  getGetEmployeeSkillGapsQueryKey: (o: number) => ['gaps', o],
  useListDevelopmentActions: () => ({ data: state.actions, isLoading: false, error: null, refetch: vi.fn() }),
  getListDevelopmentActionsQueryKey: (o: number) => ['actions', o],
  useCreateDevelopmentAction: () => ({ mutate: mutations.createAction, isPending: false }),
  useUpdateDevelopmentAction: () => ({ mutate: mutations.updateAction, isPending: false }),
}));

function renderPage() {
  const { hook } = memoryLocation({ path: '/capability' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Capability />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Capability workspace', () => {
  beforeEach(() => {
    state.records = [];
    state.requirements = [];
    state.gaps = { gaps: [] };
    state.actions = [];
    state.removeRequirementFails = false;
    for (const m of Object.values(mutations)) m.mockClear();
  });

  it('asks before withdrawing a position requirement, and Cancel withdraws nothing', async () => {
    const user = userEvent.setup();
    state.requirements = [{ id: 31, positionId: 4, skillId: 7, minimumLevelId: 22, mandatory: true, active: true }];
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Position requirements/i }));
    await user.selectOptions(await screen.findByTestId('select-requirement-position'), '4');
    await user.click(screen.getByTestId('button-remove-requirement-31'));

    const dialog = screen.getByTestId('dialog-withdraw-requirement');
    expect(dialog).toHaveTextContent('Withdraw requirement?');
    expect(dialog).toHaveTextContent('“First Aid” will no longer be required for “Ward Sister”');
    expect(dialog.textContent ?? '').not.toMatch(/delete/i);
    expect(mutations.removeRequirementAsync).not.toHaveBeenCalled();
    expect(mutations.removeRequirement).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('dialog-withdraw-requirement-cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog-withdraw-requirement')).toBeNull());
    expect(mutations.removeRequirementAsync).not.toHaveBeenCalled();
  });

  it('withdraws the requirement exactly once on confirm, and closes', async () => {
    const user = userEvent.setup();
    state.requirements = [{ id: 31, positionId: 4, skillId: 7, minimumLevelId: 22, mandatory: true, active: true }];
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Position requirements/i }));
    await user.selectOptions(await screen.findByTestId('select-requirement-position'), '4');
    await user.click(screen.getByTestId('button-remove-requirement-31'));
    await user.click(screen.getByTestId('dialog-withdraw-requirement-confirm'));

    await waitFor(() => expect(screen.queryByTestId('dialog-withdraw-requirement')).toBeNull());
    expect(mutations.removeRequirementAsync).toHaveBeenCalledTimes(1);
    expect(mutations.removeRequirementAsync).toHaveBeenCalledWith({ organizationId: 10, requirementId: 31 });
  });

  it('keeps the withdraw dialog open and the requirement listed when the withdrawal fails', async () => {
    const user = userEvent.setup();
    state.removeRequirementFails = true;
    state.requirements = [{ id: 31, positionId: 4, skillId: 7, minimumLevelId: 22, mandatory: true, active: true }];
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Position requirements/i }));
    await user.selectOptions(await screen.findByTestId('select-requirement-position'), '4');
    await user.click(screen.getByTestId('button-remove-requirement-31'));
    await user.click(screen.getByTestId('dialog-withdraw-requirement-confirm'));

    await waitFor(() => expect(mutations.removeRequirementAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dialog-withdraw-requirement-confirm')).toBeEnabled());
    expect(screen.getByTestId('dialog-withdraw-requirement')).toBeInTheDocument();
    expect(screen.getByTestId('row-requirement-31')).toBeInTheDocument();
  });

  it('records a skill against an employee (§30.26 row 4)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByTestId('select-capability-employee'), '3');
    await user.click(screen.getByTestId('button-open-hr-claim'));
    await user.selectOptions(screen.getByTestId('select-claim-skill'), '7');
    await user.selectOptions(screen.getByTestId('select-claim-level'), '21');
    await user.click(screen.getByTestId('button-submit-hr-claim'));

    await waitFor(() => expect(mutations.claim).toHaveBeenCalledTimes(1));
    const payload = mutations.claim.mock.calls[0]![0] as { employeeId: number; data: Record<string, unknown> };
    expect(payload.employeeId).toBe(3);
    expect(payload.data).toMatchObject({ skillId: 7, claimedLevelId: 21 });
    // Source is fixed by the route, never chosen by the browser.
    expect(payload.data).not.toHaveProperty('source');
  });

  it('keeps assessing and verifying as separate acts (§30.8)', async () => {
    const user = userEvent.setup();
    state.records = [
      { id: 11, skillId: 7, status: 'claimed', source: 'employee_self_service', claimedLevelId: 21, verifiedLevelId: null },
    ];
    renderPage();

    await user.selectOptions(screen.getByTestId('select-capability-employee'), '3');
    await user.click(screen.getByTestId('button-decide-11'));

    // Two distinct controls, calling two distinct endpoints.
    await user.click(screen.getByTestId('button-assess-11'));
    await waitFor(() => expect(mutations.assess).toHaveBeenCalledTimes(1));
    expect(mutations.verify).not.toHaveBeenCalled();

    // The panel is still open, and Verify is a different control calling a
    // different endpoint. Assessing did not verify anything.
    await user.click(screen.getByTestId('button-verify-11'));
    await waitFor(() => expect(mutations.verify).toHaveBeenCalledTimes(1));
    expect(mutations.assess).toHaveBeenCalledTimes(1);
    expect(mutations.assess.mock.calls[0]![0]).not.toEqual(mutations.verify.mock.calls[0]![0]);
  });

  it('will not submit a rejection without a reason', async () => {
    const user = userEvent.setup();
    state.records = [
      { id: 11, skillId: 7, status: 'claimed', source: 'employee_self_service', claimedLevelId: 21, verifiedLevelId: null },
    ];
    renderPage();

    await user.selectOptions(screen.getByTestId('select-capability-employee'), '3');
    await user.click(screen.getByTestId('button-decide-11'));
    expect(screen.getByTestId('button-reject-11')).toBeDisabled();

    await user.type(screen.getByTestId('input-decision-notes-11'), 'No supporting evidence');
    expect(screen.getByTestId('button-reject-11')).toBeEnabled();
    await user.click(screen.getByTestId('button-reject-11'));

    await waitFor(() => expect(mutations.reject).toHaveBeenCalledTimes(1));
    const payload = mutations.reject.mock.calls[0]![0] as { data: { reason: string } };
    expect(payload.data.reason).toBe('No supporting evidence');
  });

  it('adds a position requirement (§30.26 row 9)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Position requirements/i }));
    await user.selectOptions(await screen.findByTestId('select-requirement-position'), '4');
    await user.selectOptions(screen.getByTestId('select-requirement-skill'), '7');
    await user.selectOptions(screen.getByTestId('select-requirement-level'), '22');
    await user.click(screen.getByTestId('button-submit-requirement'));

    await waitFor(() => expect(mutations.addRequirement).toHaveBeenCalledTimes(1));
    const payload = mutations.addRequirement.mock.calls[0]![0] as {
      positionId: number;
      data: Record<string, unknown>;
    };
    expect(payload.positionId).toBe(4);
    expect(payload.data).toMatchObject({ skillId: 7, minimumLevelId: 22, mandatory: true });
  });

  it('separates an unverified claim from falling short, and never says the employee lacks the skill', async () => {
    const user = userEvent.setup();
    state.gaps = {
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
        {
          skillId: 8,
          skillName: 'Safeguarding',
          mandatory: false,
          requiredLevelOrdinal: 2,
          requiredLevelLabel: 'Working',
          verifiedLevelOrdinal: 1,
          verifiedLevelLabel: 'Awareness',
          hasUnverifiedClaim: false,
          evidenceExpired: false,
          state: 'below_requirement',
        },
      ],
    };
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Gap analysis/i }));
    await user.selectOptions(await screen.findByTestId('select-gap-employee'), '3');
    await user.selectOptions(screen.getByTestId('select-gap-position'), '4');

    const unverified = await screen.findByTestId('row-gap-7');
    expect(unverified).toHaveTextContent(/No verified evidence/i);
    // The unverified claim is surfaced, so a human can see it — and it is not
    // counted as satisfying the requirement.
    expect(screen.getByTestId('badge-unverified-7')).toBeInTheDocument();

    expect(screen.getByTestId('row-gap-8')).toHaveTextContent(/Below requirement/i);
    expect(screen.queryByTestId('badge-unverified-8')).toBeNull();

    // §30.6 — the two states are different, and neither is phrased as a finding
    // of incapability.
    const gapList = screen.getByTestId('list-gaps');
    expect(gapList.textContent ?? '').not.toMatch(/lacks|cannot|unable|incapab/i);
  });

  it('records a development action without enrolling anybody (§30.26 row 14)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: /Development/i }));
    await user.selectOptions(await screen.findByTestId('select-development-employee'), '3');
    await user.click(screen.getByTestId('button-open-action-form'));
    await user.type(screen.getByTestId('input-action-text'), 'Shadow the ward sister');
    await user.selectOptions(screen.getByTestId('select-action-skill'), '7');
    await user.click(screen.getByTestId('button-submit-action'));

    await waitFor(() => expect(mutations.createAction).toHaveBeenCalledTimes(1));
    const payload = mutations.createAction.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(payload.data).toMatchObject({ employeeId: 3, action: 'Shadow the ward sister', skillId: 7 });
    // The form offers no enrolment control at all — Learning stays authoritative.
    expect(payload.data).not.toHaveProperty('learningEnrollmentId');
  });
});
