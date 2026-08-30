/**
 * Tests for the Manager Portal page (Phase 3G, W111).
 * @workspace/api-client-react is mocked at the hook level — no real
 * network requests are made. Radix Tabs only mounts the active panel's
 * content, so tests targeting My Team/Pending Actions click that tab first
 * (mirroring employee-self-service.test.tsx's own established pattern).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManagerPortal from '@/pages/manager-portal';
import type { ManagerPortalTeamMember, ManagerPortalPendingActionItem, ManagerPortalDashboard } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    dashboard: undefined as ManagerPortalDashboard | undefined,
    dashboardLoading: false,
    dashboardError: undefined as unknown,
    team: undefined as { linked: boolean; directReports: ManagerPortalTeamMember[] } | undefined,
    teamLoading: false,
    teamError: undefined as unknown,
    pending: undefined as
      | {
          linked: boolean;
          items: ManagerPortalPendingActionItem[];
          // WS-15 P2 (§31.28) — the additive Recruitment sibling field.
          recruitmentParticipation?: {
            kind: string;
            id: number;
            title: string;
            status: string;
            occurredAt: string;
            deepLink: string;
          }[];
        }
      | undefined,
    pendingLoading: false,
    pendingError: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useGetManagerPortalDashboard: () => ({ data: state.dashboard, isLoading: state.dashboardLoading, error: state.dashboardError, refetch: vi.fn() }),
  getGetManagerPortalDashboardQueryKey: () => ['managerPortalDashboard'],
  useGetManagerPortalTeam: () => ({ data: state.team, isLoading: state.teamLoading, error: state.teamError, refetch: vi.fn() }),
  getGetManagerPortalTeamQueryKey: () => ['managerPortalTeam'],
  useGetManagerPortalPendingActions: () => ({ data: state.pending, isLoading: state.pendingLoading, error: state.pendingError, refetch: vi.fn() }),
  getGetManagerPortalPendingActionsQueryKey: () => ['managerPortalPendingActions'],
}));

function member(overrides: Partial<ManagerPortalTeamMember> = {}): ManagerPortalTeamMember {
  return {
    id: 900,
    employeeNumber: 'E-900',
    firstName: 'Amara',
    lastName: 'Owusu',
    positionId: 1,
    positionName: 'Software Engineer',
    departmentId: 1,
    departmentName: 'Engineering',
    branchId: 1,
    branchName: 'Head Office',
    employmentStatus: 'active',
    hasProfilePicture: false,
    ...overrides,
  };
}

function pendingItem(overrides: Partial<ManagerPortalPendingActionItem> = {}): ManagerPortalPendingActionItem {
  return {
    sourceModule: 'leave',
    id: 1,
    employeeId: 900,
    employeeFirstName: 'Amara',
    employeeLastName: 'Owusu',
    status: 'pending',
    title: 'Leave Request',
    createdAt: new Date('2026-01-01').toISOString(),
    ...overrides,
  };
}

function dashboard(overrides: Partial<ManagerPortalDashboard> = {}): ManagerPortalDashboard {
  return {
    linked: true,
    directReportsCount: 2,
    attendanceAbsentOrLateTodayCount: 1,
    pendingLeaveActionsCount: 0,
    pendingPerformanceActionsCount: 1,
    pendingLearningActionsCount: null,
    teamAssetsInCustodyCount: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ManagerPortal />
    </QueryClientProvider>,
  );
}

async function renderMyTeamTab() {
  renderPage();
  await userEvent.click(screen.getByTestId('tab-manager-my-team'));
}
async function renderPendingActionsTab() {
  renderPage();
  await userEvent.click(screen.getByTestId('tab-manager-pending-actions'));
}
/** Same tab, returning the render result for whole-section text assertions. */
async function renderPendingActionsTabWithContainer() {
  const result = renderPage();
  await userEvent.click(screen.getByTestId('tab-manager-pending-actions'));
  return result;
}

function resetState() {
  state.dashboard = dashboard();
  state.dashboardLoading = false;
  state.dashboardError = undefined;
  state.team = { linked: true, directReports: [member()] };
  state.teamLoading = false;
  state.teamError = undefined;
  state.pending = { linked: true, items: [pendingItem()] };
  state.pendingLoading = false;
  state.pendingError = undefined;
}

describe('Manager Portal page', () => {
  describe('route / heading', () => {
    it('renders the Manager Portal heading and three tabs', () => {
      resetState();
      renderPage();
      expect(screen.getByText('Manager Portal')).toBeInTheDocument();
      expect(screen.getByTestId('tab-manager-overview')).toBeInTheDocument();
      expect(screen.getByTestId('tab-manager-my-team')).toBeInTheDocument();
      expect(screen.getByTestId('tab-manager-pending-actions')).toBeInTheDocument();
    });
  });

  describe('Overview', () => {
    it('renders all six dashboard tiles', () => {
      resetState();
      renderPage();
      expect(screen.getByTestId('card-manager-tile-direct-reports')).toBeInTheDocument();
      expect(screen.getByTestId('card-manager-tile-attendance')).toBeInTheDocument();
      expect(screen.getByTestId('card-manager-tile-leave')).toBeInTheDocument();
      expect(screen.getByTestId('card-manager-tile-performance')).toBeInTheDocument();
      expect(screen.getByTestId('card-manager-tile-learning')).toBeInTheDocument();
      expect(screen.getByTestId('card-manager-tile-assets')).toBeInTheDocument();
    });

    it('renders a real zero distinctly from a null/unavailable tile', () => {
      resetState();
      state.dashboard = dashboard({ pendingLeaveActionsCount: 0, pendingLearningActionsCount: null });
      renderPage();
      expect(screen.getByTestId('text-manager-tile-value-leave')).toHaveTextContent('0');
      expect(screen.queryByTestId('text-manager-tile-unavailable-leave')).not.toBeInTheDocument();
      expect(screen.getByTestId('text-manager-tile-unavailable-learning')).toHaveTextContent(/unavailable/i);
      expect(screen.queryByTestId('text-manager-tile-value-learning')).not.toBeInTheDocument();
    });

    it('never renders "0" for a null Attendance tile (timezone-not-configured / disabled / unauthorized all collapse to the same unavailable state)', () => {
      resetState();
      state.dashboard = dashboard({ attendanceAbsentOrLateTodayCount: null });
      renderPage();
      expect(screen.getByTestId('text-manager-tile-unavailable-attendance')).toBeInTheDocument();
      expect(screen.queryByTestId('text-manager-tile-value-attendance')).not.toBeInTheDocument();
    });

    it('renders a mixture of positive integer, real zero, and null tiles correctly in the same response', () => {
      resetState();
      state.dashboard = {
        linked: true,
        directReportsCount: 2,
        attendanceAbsentOrLateTodayCount: 1,
        pendingLeaveActionsCount: 0,
        pendingPerformanceActionsCount: null,
        pendingLearningActionsCount: null,
        teamAssetsInCustodyCount: 3,
      };
      renderPage();
      expect(screen.getByTestId('text-manager-tile-value-direct-reports')).toHaveTextContent('2');
      expect(screen.getByTestId('text-manager-tile-value-attendance')).toHaveTextContent('1');
      expect(screen.getByTestId('text-manager-tile-value-leave')).toHaveTextContent('0');
      expect(screen.getByTestId('text-manager-tile-unavailable-performance')).toBeInTheDocument();
      expect(screen.getByTestId('text-manager-tile-unavailable-learning')).toBeInTheDocument();
      expect(screen.getByTestId('text-manager-tile-value-assets')).toHaveTextContent('3');
    });

    it('does not recalculate any count client-side — renders exactly the server value', () => {
      resetState();
      state.dashboard = dashboard({ directReportsCount: 7, pendingPerformanceActionsCount: 4 });
      renderPage();
      expect(screen.getByTestId('text-manager-tile-value-direct-reports')).toHaveTextContent('7');
      expect(screen.getByTestId('text-manager-tile-value-performance')).toHaveTextContent('4');
    });

    it('links an available tile to its authoritative module page, and never makes an unavailable tile a link', () => {
      resetState();
      state.dashboard = dashboard({ pendingLeaveActionsCount: 3, pendingLearningActionsCount: null });
      renderPage();
      const leaveLink = screen.getByTestId('link-manager-tile-leave');
      expect(leaveLink).toHaveAttribute('href', '/leave-approvals');
      expect(screen.queryByTestId('link-manager-tile-learning')).not.toBeInTheDocument();
    });

    it('shows loading skeletons without crashing', () => {
      resetState();
      state.dashboardLoading = true;
      renderPage();
      expect(screen.getByText('Manager Portal')).toBeInTheDocument();
    });

    it('shows an error state with retry', () => {
      resetState();
      state.dashboardError = { error: 'boom' };
      renderPage();
      expect(screen.getByText(/could not load your dashboard/i)).toBeInTheDocument();
    });

    it('shows the not-linked state instead of the six tiles when linked:false', () => {
      resetState();
      state.dashboard = dashboard({ linked: false, directReportsCount: 0, attendanceAbsentOrLateTodayCount: 0, pendingLeaveActionsCount: 0, pendingPerformanceActionsCount: 0, pendingLearningActionsCount: 0, teamAssetsInCustodyCount: 0 });
      renderPage();
      expect(screen.getByTestId('text-manager-not-linked')).toBeInTheDocument();
      expect(screen.queryByTestId('card-manager-tile-direct-reports')).not.toBeInTheDocument();
    });
  });

  describe('My Team', () => {
    it('renders a populated team with only the narrow DTO fields', async () => {
      resetState();
      state.team = { linked: true, directReports: [member({ id: 900, firstName: 'Amara', lastName: 'Owusu', positionName: 'Software Engineer', departmentName: 'Engineering', branchName: 'Head Office', employmentStatus: 'active' })] };
      await renderMyTeamTab();
      const row = screen.getByTestId('row-manager-team-900');
      expect(row).toHaveTextContent('Amara Owusu');
      expect(row).toHaveTextContent('Software Engineer');
      expect(row).toHaveTextContent('Engineering');
      expect(row).toHaveTextContent('Head Office');
      expect(within(row).getByTestId('badge-manager-team-status-900')).toHaveTextContent('active');
    });

    it('shows an initials avatar fallback, never an actual photo, regardless of hasProfilePicture', async () => {
      resetState();
      state.team = { linked: true, directReports: [member({ id: 900, hasProfilePicture: true })] };
      await renderMyTeamTab();
      const row = screen.getByTestId('row-manager-team-900');
      expect(within(row).queryByRole('img')).not.toBeInTheDocument();
      expect(row).toHaveTextContent('AO');
    });

    it('shows the frozen empty state for a linked manager with zero direct reports — not an error', async () => {
      resetState();
      state.team = { linked: true, directReports: [] };
      await renderMyTeamTab();
      expect(screen.getByTestId('text-manager-team-empty')).toBeInTheDocument();
    });

    it('shows the not-linked state distinctly from the zero-direct-reports empty state', async () => {
      resetState();
      state.team = { linked: false, directReports: [] };
      await renderMyTeamTab();
      expect(screen.getByTestId('text-manager-not-linked')).toBeInTheDocument();
      expect(screen.queryByTestId('text-manager-team-empty')).not.toBeInTheDocument();
    });

    it('never renders a sensitive field beyond the frozen DTO (no address/email/phone/nationalId)', async () => {
      resetState();
      state.team = {
        linked: true,
        directReports: [
          {
            ...member({ id: 900 }),
            // @ts-expect-error -- a broader shape a full Employee record would carry, but the DTO type doesn't include it
            nationalId: 'SECRET-ID',
            personalEmail: 'amara@example.com',
          },
        ],
      };
      await renderMyTeamTab();
      const row = screen.getByTestId('row-manager-team-900');
      expect(row).not.toHaveTextContent('SECRET-ID');
      expect(row).not.toHaveTextContent('amara@example.com');
    });

    it('shows loading skeletons without crashing', async () => {
      resetState();
      state.teamLoading = true;
      await renderMyTeamTab();
      expect(screen.getByText('Manager Portal')).toBeInTheDocument();
    });

    it('shows a team error state with retry', async () => {
      resetState();
      state.teamError = { error: 'boom' };
      await renderMyTeamTab();
      expect(screen.getByText(/could not load your team/i)).toBeInTheDocument();
    });
  });

  describe('Pending Actions', () => {
    it('renders a Leave item with source label, status, title, and employee name', async () => {
      resetState();
      state.pending = { linked: true, items: [pendingItem({ sourceModule: 'leave', id: 1, title: 'Leave Request', status: 'pending' })] };
      await renderPendingActionsTab();
      const row = screen.getByTestId('row-manager-pending-leave-1');
      expect(within(row).getByTestId('badge-manager-pending-source-leave-1')).toHaveTextContent('Leave');
      expect(within(row).getByTestId('badge-manager-pending-status-leave-1')).toHaveTextContent('pending');
      expect(row).toHaveTextContent('Leave Request');
      expect(row).toHaveTextContent('Amara Owusu');
    });

    it('renders a Performance item', async () => {
      resetState();
      state.pending = { linked: true, items: [pendingItem({ sourceModule: 'performance', id: 2, title: 'Performance Review — Cycle', status: 'manager_review' })] };
      await renderPendingActionsTab();
      const row = screen.getByTestId('row-manager-pending-performance-2');
      expect(within(row).getByTestId('badge-manager-pending-source-performance-2')).toHaveTextContent('Performance');
      expect(row).toHaveTextContent('manager_review');
    });

    it('renders a Learning item', async () => {
      resetState();
      state.pending = { linked: true, items: [pendingItem({ sourceModule: 'learning', id: 3, title: 'Safety Training', status: 'pending' })] };
      await renderPendingActionsTab();
      const row = screen.getByTestId('row-manager-pending-learning-3');
      expect(within(row).getByTestId('badge-manager-pending-source-learning-3')).toHaveTextContent('Learning');
      expect(row).toHaveTextContent('Safety Training');
    });

    it('deep-links each item to its authoritative module page, never a Manager Portal-owned detail page', async () => {
      resetState();
      state.pending = {
        linked: true,
        items: [
          pendingItem({ sourceModule: 'leave', id: 1 }),
          pendingItem({ sourceModule: 'performance', id: 2 }),
          pendingItem({ sourceModule: 'learning', id: 3 }),
        ],
      };
      await renderPendingActionsTab();
      expect(screen.getByTestId('link-manager-pending-open-leave-1')).toHaveAttribute('href', '/leave-approvals');
      expect(screen.getByTestId('link-manager-pending-open-performance-2')).toHaveAttribute('href', '/performance-team');
      expect(screen.getByTestId('link-manager-pending-open-learning-3')).toHaveAttribute('href', '/learning-team-training');
    });

    it('shows the frozen empty state when there is nothing pending', async () => {
      resetState();
      state.pending = { linked: true, items: [] };
      await renderPendingActionsTab();
      expect(screen.getByTestId('text-manager-pending-empty')).toBeInTheDocument();
    });

    it('never renders an Attendance or Assets item — only leave/performance/learning are valid sourceModule values', async () => {
      resetState();
      state.pending = {
        linked: true,
        items: [pendingItem({ sourceModule: 'leave', id: 1 }), pendingItem({ sourceModule: 'performance', id: 2 }), pendingItem({ sourceModule: 'learning', id: 3 })],
      };
      await renderPendingActionsTab();
      expect(screen.queryAllByTestId(/row-manager-pending-attendance-/).length).toBe(0);
      expect(screen.queryAllByTestId(/row-manager-pending-assets-/).length).toBe(0);
    });

    it('shows an error state with retry', async () => {
      resetState();
      state.pendingError = { error: 'boom' };
      await renderPendingActionsTab();
      expect(screen.getByText(/could not load pending actions/i)).toBeInTheDocument();
    });
  });

  describe('boundary — no inline mutations, no unrelated modules', () => {
    it('exposes no approve/reject/submit/assign/complete/return/mark/correct control anywhere on this page', async () => {
      resetState();
      state.pending = { linked: true, items: [pendingItem({ sourceModule: 'leave', id: 1 }), pendingItem({ sourceModule: 'performance', id: 2 }), pendingItem({ sourceModule: 'learning', id: 3 })] };
      await renderPendingActionsTab();
      expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^reject/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^submit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^assign/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^complete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^return/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^mark/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^correct/i })).not.toBeInTheDocument();
    });

    it('never mentions Recruitment, Workforce, or Scheduling anywhere on the page', () => {
      resetState();
      renderPage();
      expect(screen.queryByText(/recruitment/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/workforce/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/scheduling/i)).not.toBeInTheDocument();
    });

    it('never renders a report or CSV control', () => {
      resetState();
      renderPage();
      expect(screen.queryByText(/csv/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
    });

    it('never renders Career Profile, document, payroll, or banking content', () => {
      resetState();
      renderPage();
      expect(screen.queryByText(/career profile/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/payroll/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/banking/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/compensation/i)).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('uses an accessible tab structure', () => {
      resetState();
      renderPage();
      expect(screen.getAllByRole('tab').length).toBe(3);
    });

    it('renders team status as visible text, not color alone', async () => {
      resetState();
      state.team = { linked: true, directReports: [member({ id: 900, employmentStatus: 'probation' })] };
      await renderMyTeamTab();
      expect(screen.getByTestId('badge-manager-team-status-900')).toHaveTextContent('probation');
    });

    it('renders pending-action status and source as visible text, not color alone', async () => {
      resetState();
      state.pending = { linked: true, items: [pendingItem({ sourceModule: 'performance', id: 2, status: 'manager_review' })] };
      await renderPendingActionsTab();
      expect(screen.getByTestId('badge-manager-pending-status-performance-2')).toHaveTextContent('manager_review');
      expect(screen.getByTestId('badge-manager-pending-source-performance-2')).toHaveTextContent('Performance');
    });
  });

  /**
   * WS-15 P2 (§31.28) — Recruitment participation.
   *
   * The section is additive: the shipped Leave/Performance/Learning list is
   * unchanged, and Recruitment appears beside it because those rows have no
   * employee subject to key on. These tests pin down that the addition does not
   * disturb the existing surface and that no candidate data reaches a row.
   */
  describe('Recruitment participation (WS-15 P2)', () => {
    const recruitmentRow = (over: Record<string, unknown> = {}) => ({
      kind: 'interview_scorecard',
      id: 7,
      title: 'Interview scorecard outstanding',
      status: 'completed',
      occurredAt: '2026-08-01T00:00:00.000Z',
      deepLink: '/interviews/7/scorecard',
      ...over,
    });

    it('renders outstanding scorecard work and links into Recruitment', async () => {
      state.pending = { linked: true, items: [], recruitmentParticipation: [recruitmentRow()] };
      await renderPendingActionsTab();

      const row = screen.getByTestId('row-manager-recruitment-interview_scorecard-7');
      expect(row).toHaveTextContent('Interview scorecard outstanding');
      expect(screen.getByTestId('badge-manager-recruitment-kind-interview_scorecard-7')).toHaveTextContent(
        'Scorecard due',
      );
      // The only affordance is a link out; Manager Portal grants no Recruitment
      // authority of its own.
      expect(screen.getByTestId('link-manager-recruitment-open-interview_scorecard-7')).toBeInTheDocument();
    });

    it('shows Recruitment work even when there is no Leave, Performance or Learning work', async () => {
      state.pending = { linked: true, items: [], recruitmentParticipation: [recruitmentRow()] };
      await renderPendingActionsTab();
      // The shipped empty state must not swallow the new source.
      expect(screen.queryByTestId('text-manager-pending-empty')).toBeNull();
      expect(screen.getByTestId('list-manager-recruitment')).toBeInTheDocument();
    });

    it('still shows the empty state when nothing at all is pending', async () => {
      state.pending = { linked: true, items: [], recruitmentParticipation: [] };
      await renderPendingActionsTab();
      expect(screen.getByTestId('text-manager-pending-empty')).toBeInTheDocument();
      expect(screen.queryByTestId('list-manager-recruitment')).toBeNull();
    });

    it('shows an unlinked interviewer their own panel work rather than the not-linked card', async () => {
      // Panel membership keys on the membership, so an unlinked account is
      // still a legitimate interviewer.
      state.pending = {
        linked: false,
        items: [],
        recruitmentParticipation: [recruitmentRow({ kind: 'interview_panel', id: 9, deepLink: '/interviews/9' })],
      };
      await renderPendingActionsTab();
      expect(screen.getByTestId('row-manager-recruitment-interview_panel-9')).toBeInTheDocument();
    });

    it('leaves the shipped Leave/Performance/Learning rows untouched', async () => {
      state.pending = {
        linked: true,
        items: [pendingItem({ sourceModule: 'leave', id: 1, title: 'Leave Request', status: 'pending' })],
        recruitmentParticipation: [recruitmentRow()],
      };
      await renderPendingActionsTab();
      expect(screen.getByTestId('row-manager-pending-leave-1')).toBeInTheDocument();
      expect(screen.getByTestId('row-manager-recruitment-interview_scorecard-7')).toBeInTheDocument();
    });

    it('carries no candidate data in a Recruitment row', async () => {
      state.pending = {
        linked: true,
        items: [],
        recruitmentParticipation: [recruitmentRow({ kind: 'job_requisition', id: 3, title: 'Ward Sister', deepLink: '/requisitions/3' })],
      };
      const { container } = await renderPendingActionsTabWithContainer();
      const text = container.textContent ?? '';
      // A requisition title is the role, not a person; nothing candidate-shaped
      // may appear (§31.28).
      for (const forbidden of [/candidate/i, /applicant/i, /salary/i, /compensation/i, /recommendation/i]) {
        expect(text).not.toMatch(forbidden);
      }
    });
  });
});
