/**
 * WS-15 P3 (§31.30) — the Reports tab after execution consolidation.
 *
 * The tab already listed every registered definition and ran the selected one
 * through the generic endpoint, so consolidation makes 43 previously-404ing
 * reports work with no UI change. What this file pins down is the part that
 * DID change:
 *
 *   - typed parameter controls appear only for the reports that support them,
 *     and never as a generic JSON box;
 *   - a Payroll report is not requested until its required run id is supplied;
 *   - the CSV export carries exactly the parameters the on-screen result used,
 *     never a broader query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const { state, runReportSpy, urlSpy } = vi.hoisted(() => ({
  state: {
    reports: [] as any[],
    result: undefined as any,
  },
  runReportSpy: vi.fn(),
  urlSpy: vi.fn(() => 'https://example.invalid/report.csv'),
}));

// Mirrors admin-guard.test.tsx's own mock set — the Admin console reaches for
// all of these on mount, and the Reports tab is only reachable once the page
// itself renders for an org_admin.
vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 10 }, isLoading: false }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({
    data: [
      {
        organizationId: 10,
        organizationName: 'Acme',
        organizationSlug: 'acme',
        status: 'active',
        roles: ['org_admin'],
        isPrimaryHr: false,
      },
    ],
    isLoading: false,
  }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useListMembers: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  getListMembersQueryKey: (id: number) => ['members', id],
  useAddMember: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateInvitation: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeMember: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
  useListOrganizationRoles: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  getListOrganizationRolesQueryKey: (id: number) => ['organizationRoles', id],
  useGetPrimaryHr: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  getGetPrimaryHrQueryKey: (id: number) => ['primaryHr', id],
  useSetPrimaryHr: () => ({ mutate: vi.fn(), isPending: false }),
  useGetOrganizationConfig: () => ({
    data: { organizationId: 10, namespace: 'general', schemaVersion: 1, data: {}, updatedAt: null },
    isLoading: false,
  }),
  getGetOrganizationConfigQueryKey: (id: number, namespace: string) => ['config', id, namespace],
  useUpdateOrganizationConfig: () => ({ mutate: vi.fn(), isPending: false }),
  // WS-25 Organization Branding card (Primary HR & Settings tab).
  useGetOrganization: () => ({
    data: { id: 10, name: 'Acme', slug: 'acme', type: 'business', status: 'active', logoUrl: null },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getGetOrganizationQueryKey: (id: number) => ['organization', id],
  useUploadOrganizationLogo: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrganizationLogo: () => ({ mutate: vi.fn(), isPending: false }),
  getGetTenantContextQueryKey: () => ['tenantContext'],
  useListAuditEvents: () => ({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  getListAuditEventsQueryKey: (id: number) => ['auditEvents', id],

  // The WS-15 P3 surface under test.
  useListReports: () => ({ data: state.reports, isLoading: false }),
  getListReportsQueryKey: () => ['reports'],
  useRunReport: (organizationId: number, reportKey: string, params: unknown, options: any) => {
    runReportSpy({ organizationId, reportKey, params, enabled: options?.query?.enabled });
    return { data: state.result, isLoading: false, error: null, refetch: vi.fn() };
  },
  getRunReportQueryKey: (o: number, k: string, p: unknown) => ['runReport', o, k, p],
  getRunReportUrl: urlSpy,
}));

const { default: Admin } = await import('@/pages/admin');

function tree() {
  const { hook } = memoryLocation({ path: '/admin/10' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Switch>
          <Route path="/admin/:organizationId" component={Admin} />
          <Route path="/admin" component={Admin} />
        </Switch>
      </Router>
    </QueryClientProvider>
  );
}

/**
 * Opens the Reports tab with `reports` loaded.
 *
 * The tab is not the default view, and its shipped auto-select only fires when
 * the report list ARRIVES AFTER mount — which is the real behaviour, since the
 * query resolves asynchronously. The list therefore starts empty and is
 * delivered on a re-render, rather than the test reaching into the Radix Select.
 */
async function openReportsTab(reports: any[]) {
  state.reports = [];
  const utils = render(tree());
  await waitFor(() => expect(screen.getByTestId('tab-reports')).toBeInTheDocument());
  await userEvent.click(screen.getByTestId('tab-reports'));

  state.reports = reports;
  utils.rerender(tree());
  await waitFor(() => expect(screen.getByTestId('select-report')).toBeInTheDocument());
  return utils;
}

describe('Admin Reports tab (WS-15 P3)', () => {
  beforeEach(() => {
    state.reports = [];
    state.result = undefined;
    runReportSpy.mockClear();
    urlSpy.mockClear();
  });

  it('offers no parameter controls for a report that takes none', async () => {
    await openReportsTab([{ key: 'headcount', label: 'Headcount', description: '', category: 'workforce' }]);

    // No date range, no run id, and crucially no generic JSON box.
    expect(screen.queryByTestId('input-report-from')).toBeNull();
    expect(screen.queryByTestId('input-report-to')).toBeNull();
    expect(screen.queryByTestId('input-report-run-id')).toBeNull();
  });

  it('offers a date range only for an Attendance report', async () => {
    await openReportsTab([
      { key: 'attendance_daily_register', label: 'Daily register', description: '', category: 'attendance' },
    ]);

    expect(screen.getByTestId('input-report-from')).toBeInTheDocument();
    expect(screen.getByTestId('input-report-to')).toBeInTheDocument();
    expect(screen.queryByTestId('input-report-run-id')).toBeNull();
  });

  it('offers a run id only for a Payroll report, and does not run until it is supplied', async () => {
    const user = userEvent.setup();
    await openReportsTab([
      { key: 'payroll_register', label: 'Payroll register', description: '', category: 'payroll' },
    ]);

    expect(screen.getByTestId('input-report-run-id')).toBeInTheDocument();
    expect(screen.queryByTestId('input-report-from')).toBeNull();

    // Payroll reports are per locked run, so the query stays disabled until one
    // is entered — a 400 is correct from the API but pointless to trigger on
    // every keystroke.
    const beforeCalls = runReportSpy.mock.calls.map((c) => c[0]);
    expect(beforeCalls.every((c: any) => c.enabled === false)).toBe(true);

    await user.type(screen.getByTestId('input-report-run-id'), '7');

    const afterCalls = runReportSpy.mock.calls.map((c) => c[0]);
    const enabled = afterCalls.filter((c: any) => c.enabled === true);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled[enabled.length - 1].params).toMatchObject({ runId: 7 });
  });

  it('passes the typed date range through to the execution call', async () => {
    const user = userEvent.setup();
    await openReportsTab([
      { key: 'attendance_late_arrivals', label: 'Late arrivals', description: '', category: 'attendance' },
    ]);

    await user.type(screen.getByTestId('input-report-from'), '2026-01-01');
    await user.type(screen.getByTestId('input-report-to'), '2026-01-31');

    const last = runReportSpy.mock.calls[runReportSpy.mock.calls.length - 1]![0] as any;
    expect(last.params).toMatchObject({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('exports CSV with the same parameters as the on-screen result', async () => {
    const user = userEvent.setup();
    state.result = { key: 'attendance_absenteeism', label: 'Absenteeism', columns: [], rows: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['a']) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } as never);
    await openReportsTab([
      { key: 'attendance_absenteeism', label: 'Absenteeism', description: '', category: 'attendance' },
    ]);

    await user.type(screen.getByTestId('input-report-from'), '2026-02-01');
    await user.click(screen.getByTestId('button-download-report-csv'));

    const call = urlSpy.mock.calls[urlSpy.mock.calls.length - 1] as any;
    // The export never runs a broader query than the interactive result.
    expect(call[2]).toMatchObject({ from: '2026-02-01', format: 'csv' });
    vi.unstubAllGlobals();
  });
});
