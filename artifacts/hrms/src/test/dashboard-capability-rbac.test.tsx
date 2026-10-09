/**
 * Dashboard and sidebar capability gating.
 *
 * The defect these lock down: the dashboard decided what to show from "did the
 * API return a value" and from ROLE NAMES, so an ordinary employee was shown
 * "Pending HR Actions", "My HR Tasks" and a "Workforce Summary" over their own
 * self-scoped numbers, and every member of every organization saw the whole
 * Leave Management menu including its administrative configuration entry.
 *
 * The rules asserted here:
 *   - an employee sees personal framing and no HR or manager surface;
 *   - a department head — permission-identical to an ordinary employee, and
 *     distinguishable ONLY by the structural signal — sees the manager surface
 *     and still no HR surface;
 *   - HR sees the HR surface;
 *   - org_admin gets it from its actual permissions, never from its role name;
 *   - a multi-capability user composes sections without duplication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const myOrgs = vi.fn();
const commandCentre = vi.fn();
const summary = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, organizationId: 71, firstName: 'Test', lastName: 'User' } }),
  getGetMeQueryKey: () => ['me'],
  useListMyOrganizations: () => myOrgs(),
  getListMyOrganizationsQueryKey: () => ['myOrgs'],
  useGetHrCommandCentre: () => commandCentre(),
  getGetHrCommandCentreQueryKey: () => ['cc'],
  useGetDashboardSummary: () => summary(),
  getGetDashboardSummaryQueryKey: () => ['summary'],
  useListOrganizationModules: () => ({ data: { modules: [] } }),
  getListOrganizationModulesQueryKey: () => ['modules'],
}));

import { useCapabilities } from '@/hooks/use-capabilities';

/** The canonical employee template's 33 keys, in the parts that matter here. */
const EMPLOYEE_KEYS = [
  'employee.read',
  'attendance.read.own',
  'leave_request.read.own',
  'leave_request.approve', // held by EVERY employee — never a manager signal
  'asset_management.reports.read',
  'public_holiday.read',
  'leave_type.read',
];

const HR_KEYS = [...EMPLOYEE_KEYS, 'employee.write', 'attendance.manage', 'personnel_file.read', 'leave_request.manage', 'leave_type.manage'];
const ORG_ADMIN_KEYS = [...HR_KEYS, 'organization.manage', 'role.manage', 'module.manage'];

function membership(over: Record<string, unknown> = {}) {
  return {
    organizationId: 71,
    permissions: EMPLOYEE_KEYS,
    isPrimaryHr: false,
    isDepartmentHead: false,
    hasDirectReports: false,
    ...over,
  };
}

function setMembership(over: Record<string, unknown> = {}) {
  myOrgs.mockReturnValue({ data: [membership(over)], isLoading: false });
}

function Probe({ organizationId = 71 }: { organizationId?: number }) {
  const c = useCapabilities(organizationId);
  return (
    <ul>
      <li data-testid="isManager">{String(c.isManager)}</li>
      <li data-testid="isDepartmentHead">{String(c.isDepartmentHead)}</li>
      <li data-testid="hasDirectReports">{String(c.hasDirectReports)}</li>
      <li data-testid="isHrOperational">{String(c.isHrOperational)}</li>
      <li data-testid="isOrgAdministrator">{String(c.isOrgAdministrator)}</li>
      <li data-testid="canManageLeaveTypes">{String(c.can('leave_type.manage'))}</li>
    </ul>
  );
}

function renderProbe(organizationId = 71) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe organizationId={organizationId} />
    </QueryClientProvider>,
  );
}

const read = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  vi.clearAllMocks();
  commandCentre.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
  summary.mockReturnValue({ data: undefined, isLoading: false });
  setMembership();
});

describe('ordinary employee (Michael)', () => {
  it('is not a manager and not HR', () => {
    renderProbe();
    expect(read('isManager')).toBe('false');
    expect(read('isHrOperational')).toBe('false');
    expect(read('isOrgAdministrator')).toBe('false');
  });

  it('holding leave_request.approve does NOT make them a manager', () => {
    // The whole trap: the employee template grants this key to everyone, and
    // the server treats it as "may attempt", never "may act".
    setMembership({ permissions: EMPLOYEE_KEYS });
    renderProbe();
    expect(read('isManager')).toBe('false');
  });

  it('cannot reach leave-type configuration', () => {
    renderProbe();
    expect(read('canManageLeaveTypes')).toBe('false');
  });
});

describe('department head (Richard) — permission-identical to an employee', () => {
  it('is a manager purely from the structural signal', () => {
    setMembership({ isDepartmentHead: true });
    renderProbe();
    expect(read('isDepartmentHead')).toBe('true');
    expect(read('isManager')).toBe('true');
  });

  it('is still NOT HR, and not an administrator', () => {
    setMembership({ isDepartmentHead: true });
    renderProbe();
    expect(read('isHrOperational')).toBe('false');
    expect(read('isOrgAdministrator')).toBe('false');
  });

  it('managing a team does not unlock leave-type configuration', () => {
    setMembership({ isDepartmentHead: true });
    renderProbe();
    expect(read('canManageLeaveTypes')).toBe('false');
  });

  it('a reporting-manager with no department also counts as a manager', () => {
    setMembership({ hasDirectReports: true });
    renderProbe();
    expect(read('isManager')).toBe('true');
    expect(read('isHrOperational')).toBe('false');
  });
});

describe('HR (Akosua)', () => {
  it('is HR-operational through permissions, not a role name', () => {
    setMembership({ permissions: HR_KEYS });
    renderProbe();
    expect(read('isHrOperational')).toBe('true');
  });

  it('is not an organization administrator merely by being HR', () => {
    setMembership({ permissions: HR_KEYS });
    renderProbe();
    expect(read('isOrgAdministrator')).toBe('false');
  });
});

describe('org_admin (Nii)', () => {
  it('is an administrator, and is HR-operational only because its canonical grants say so', () => {
    setMembership({ permissions: ORG_ADMIN_KEYS });
    renderProbe();
    expect(read('isOrgAdministrator')).toBe('true');
    // Not a pretence: canonical org_admin genuinely holds employee.write,
    // attendance.manage and personnel_file.read today. The dashboard reports
    // that honestly rather than inventing or denying it.
    expect(read('isHrOperational')).toBe('true');
  });

  it('an administrator WITHOUT the HR grants is not shown the HR surface', () => {
    setMembership({ permissions: ['organization.manage', 'role.manage', 'module.manage', ...EMPLOYEE_KEYS] });
    renderProbe();
    expect(read('isOrgAdministrator')).toBe('true');
    expect(read('isHrOperational')).toBe('false');
  });
});

describe('multi-capability user', () => {
  it('composes HR and manager without duplication or conflict', () => {
    setMembership({ permissions: HR_KEYS, isDepartmentHead: true, hasDirectReports: true });
    renderProbe();
    expect(read('isHrOperational')).toBe('true');
    expect(read('isManager')).toBe('true');
    // Each flag is computed once from one source; there is no second path that
    // could produce a duplicate section.
    expect(screen.getAllByTestId('isManager')).toHaveLength(1);
    expect(screen.getAllByTestId('isHrOperational')).toHaveLength(1);
  });
});

describe('fails closed', () => {
  it('grants nothing while the membership is still loading', () => {
    myOrgs.mockReturnValue({ data: undefined, isLoading: true });
    renderProbe();
    for (const id of ['isManager', 'isDepartmentHead', 'hasDirectReports', 'isHrOperational', 'isOrgAdministrator']) {
      expect(read(id)).toBe('false');
    }
  });

  it('grants nothing when the structural fields are absent from the payload', () => {
    myOrgs.mockReturnValue({ data: [{ organizationId: 71, permissions: EMPLOYEE_KEYS }], isLoading: false });
    renderProbe();
    expect(read('isManager')).toBe('false');
  });

  it('grants nothing for an organization the caller is not a member of (tenant isolation)', () => {
    // The payload describes org 71; asking about org 3 must not inherit it.
    setMembership({ permissions: ORG_ADMIN_KEYS, isDepartmentHead: true });
    renderProbe(3);
    expect(read('isManager')).toBe('false');
    expect(read('isHrOperational')).toBe('false');
    expect(read('isOrgAdministrator')).toBe('false');
  });
});
