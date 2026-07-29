/**
 * Tests for the Recruitment Settings page (Phase 3A, W44).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RecruitmentSettings from '@/pages/recruitment-settings';
import type { RecruitmentSettings as RecruitmentSettingsType, RecruitmentWorkflow, RecruitmentStage } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    settings: undefined as RecruitmentSettingsType | undefined,
    settingsLoading: false,
    settingsError: undefined as unknown,
    workflows: [] as RecruitmentWorkflow[],
    workflowsLoading: false,
    workflowsError: undefined as unknown,
    stages: [] as RecruitmentStage[],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetRecruitmentSettings: () => ({ data: state.settings, isLoading: state.settingsLoading, error: state.settingsError, refetch: vi.fn() }),
  getGetRecruitmentSettingsQueryKey: (id: number) => ['recruitmentSettings', id],
  useUpdateRecruitmentSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useListRecruitmentWorkflows: () => ({ data: state.workflows, isLoading: state.workflowsLoading, error: state.workflowsError, refetch: vi.fn() }),
  getListRecruitmentWorkflowsQueryKey: (id: number) => ['recruitmentWorkflows', id],
  useCreateRecruitmentWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRecruitmentWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveRecruitmentWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateRecruitmentWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultRecruitmentWorkflow: () => ({ mutate: vi.fn(), isPending: false }),
  useListRecruitmentStages: () => ({ data: state.stages, isLoading: false }),
  getListRecruitmentStagesQueryKey: (orgId: number, workflowId: number) => ['recruitmentStages', orgId, workflowId],
  useCreateRecruitmentStage: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRecruitmentStage: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveRecruitmentStage: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateRecruitmentStage: () => ({ mutate: vi.fn(), isPending: false }),
}));

function baseSettings(overrides: Partial<RecruitmentSettingsType> = {}): RecruitmentSettingsType {
  return {
    organizationId: 10,
    enabled: false,
    internalRecruitmentEnabled: true,
    externalRecruitmentEnabled: true,
    requireCandidateAccount: false,
    defaultWorkflowId: null,
    candidateDataRetentionMonths: null,
    reapplicationWaitingDays: 0,
    duplicateCandidatePolicy: 'flag',
    defaultOfferExpiryDays: null,
    defaultDocumentRequirements: [],
    applicationLimitPerCandidate: null,
    updatedAt: null,
    ...overrides,
  };
}

function baseWorkflow(overrides: Partial<RecruitmentWorkflow> = {}): RecruitmentWorkflow {
  return {
    id: 1,
    organizationId: 10,
    name: 'Standard Hiring',
    description: null,
    isActive: true,
    isDefault: false,
    displayOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecruitmentSettings />
    </QueryClientProvider>,
  );
}

describe('Recruitment Settings page', () => {
  it('shows a loading state without crashing', () => {
    state.settings = undefined;
    state.settingsLoading = true;
    state.settingsError = undefined;
    state.workflows = [];
    renderPage();
    expect(screen.queryByTestId('button-save-recruitment-settings')).not.toBeInTheDocument();
  });

  it('shows an error state without crashing', () => {
    state.settings = undefined;
    state.settingsLoading = false;
    state.settingsError = { error: 'boom' };
    state.workflows = [];
    renderPage();
    expect(screen.getByText(/could not load recruitment settings/i)).toBeInTheDocument();
  });

  it('renders the settings form with saved values', () => {
    state.settings = baseSettings({ enabled: true, reapplicationWaitingDays: 14 });
    state.settingsLoading = false;
    state.settingsError = undefined;
    state.workflows = [];
    renderPage();
    expect(screen.getByTestId('checkbox-recruitment-enabled')).toBeInTheDocument();
    expect(screen.getByTestId('input-reapplication-waiting-days')).toHaveValue(14);
  });

  it('shows the empty state when no workflows exist yet', () => {
    state.settings = baseSettings();
    state.settingsLoading = false;
    state.settingsError = undefined;
    state.workflows = [];
    renderPage();
    expect(screen.getByText(/no recruitment workflows yet/i)).toBeInTheDocument();
  });

  it('renders workflows with name, default badge, and status', () => {
    state.settings = baseSettings();
    state.settingsLoading = false;
    state.settingsError = undefined;
    state.workflows = [baseWorkflow({ id: 1, name: 'Standard Hiring', isDefault: true }), baseWorkflow({ id: 2, name: 'Volunteer Onboarding', isDefault: false })];
    renderPage();
    expect(screen.getByTestId('row-workflow-1')).toHaveTextContent('Standard Hiring');
    expect(screen.getByTestId('row-workflow-1')).toHaveTextContent('Default');
    expect(screen.getByTestId('row-workflow-2')).toHaveTextContent('Volunteer Onboarding');
    // The default workflow has no "Set Default" action; the non-default one does.
    expect(screen.queryByTestId('button-set-default-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('button-set-default-2')).toBeInTheDocument();
  });

  it('expands to show the Stages panel for a workflow', async () => {
    state.settings = baseSettings();
    state.settingsLoading = false;
    state.settingsError = undefined;
    state.workflows = [baseWorkflow({ id: 1 })];
    state.stages = [
      { id: 1, organizationId: 10, workflowId: 1, name: 'Applied', category: 'applied', displayOrder: 0, color: null, icon: null, isRequired: false, isTerminal: false, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    renderPage();
    await userEvent.click(screen.getByTestId('button-manage-stages-1'));
    expect(screen.getByTestId('row-stage-1')).toHaveTextContent('Applied');
  });
});
