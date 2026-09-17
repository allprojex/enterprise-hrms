/**
 * WS-14 — Skills catalogue: retiring or reinstating a skill is confirmed first.
 *
 * Retiring sets `active=false` (never a delete); the backend then refuses new
 * claims against it. The mutation is mocked at the hook level, following
 * capability.test.tsx — no real network requests are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import SkillsSettings from '@/pages/skills-settings';

const { state, mutations } = vi.hoisted(() => ({
  state: { updateFails: false },
  mutations: {
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    importSkills: vi.fn(),
    createScale: vi.fn(),
    relabel: vi.fn(),
  },
}));

const updateSkillAsync = vi.hoisted(() =>
  vi.fn(() => (state.updateFails ? Promise.reject(new Error('Skill not found')) : Promise.resolve({}))),
);

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10, activeOrganizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListSkills: () => ({
    data: [
      { id: 7, name: 'First Aid', code: 'FA', category: 'compliance', active: true, proficiencyApplicable: true },
      { id: 8, name: 'Safeguarding', code: 'SG', category: 'compliance', active: false, proficiencyApplicable: false },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListSkillsQueryKey: (o: number) => ['skills', o],
  useCreateSkill: () => ({ mutate: mutations.createSkill, isPending: false }),
  useUpdateSkill: () => ({ mutate: mutations.updateSkill, mutateAsync: updateSkillAsync, isPending: false }),
  useImportSkillsFromMasterData: () => ({ mutate: mutations.importSkills, isPending: false }),
  useGetProficiencyScale: () => ({ data: { scale: null, levels: [] }, isLoading: false, error: null, refetch: vi.fn() }),
  getGetProficiencyScaleQueryKey: (o: number) => ['scale', o],
  useCreateProficiencyScale: () => ({ mutate: mutations.createScale, isPending: false }),
  useRelabelProficiencyLevel: () => ({ mutate: mutations.relabel, isPending: false }),
}));

const DIALOG = 'dialog-toggle-skill';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SkillsSettings />
    </QueryClientProvider>,
  );
}

describe('Skills catalogue — retire / reinstate confirmation', () => {
  beforeEach(() => {
    state.updateFails = false;
    updateSkillAsync.mockClear();
    for (const m of Object.values(mutations)) m.mockClear();
  });

  it('asks before retiring a skill, and Cancel retires nothing', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-toggle-skill-7'));
    const dialog = screen.getByTestId(DIALOG);
    expect(dialog).toHaveTextContent('Retire skill?');
    expect(dialog).toHaveTextContent('“First Aid” will be retired and can no longer be recorded as a new skill');
    expect(dialog.textContent ?? '').not.toMatch(/delete/i);
    expect(screen.getByTestId(`${DIALOG}-confirm`)).toHaveTextContent('Retire Skill');
    expect(updateSkillAsync).not.toHaveBeenCalled();
    expect(mutations.updateSkill).not.toHaveBeenCalled();

    await user.click(screen.getByTestId(`${DIALOG}-cancel`));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(updateSkillAsync).not.toHaveBeenCalled();
  });

  it('retires exactly once on confirm, and closes', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-toggle-skill-7'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(screen.queryByTestId(DIALOG)).toBeNull());
    expect(updateSkillAsync).toHaveBeenCalledTimes(1);
    expect(updateSkillAsync).toHaveBeenCalledWith({ organizationId: 10, skillId: 7, data: { active: false } });
  });

  it('keeps the dialog open and the skill listed when retiring fails', async () => {
    const user = userEvent.setup();
    state.updateFails = true;
    renderPage();

    await user.click(screen.getByTestId('button-toggle-skill-7'));
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(updateSkillAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId(`${DIALOG}-confirm`)).toBeEnabled());
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
    expect(screen.getByTestId('row-skill-7')).toBeInTheDocument();
  });

  it('confirms reinstating a retired skill', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('button-toggle-skill-8'));
    expect(screen.getByTestId(DIALOG)).toHaveTextContent('Reinstate skill?');
    expect(screen.getByTestId(`${DIALOG}-confirm`)).toHaveTextContent('Reinstate Skill');
    await user.click(screen.getByTestId(`${DIALOG}-confirm`));

    await waitFor(() => expect(updateSkillAsync).toHaveBeenCalledTimes(1));
    expect(updateSkillAsync).toHaveBeenCalledWith({ organizationId: 10, skillId: 8, data: { active: true } });
  });
});
