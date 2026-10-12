/**
 * Edit employee page (Phase 2 — /employees/:id/edit).
 *
 * Covers: full prefill, diff-only PATCH, unchanged-sensitive handling for a
 * general-write caller, the viewer's own record, the server's
 * self_administration_forbidden refusal, status rules, cross-tenant load
 * failures, the unsaved-changes guard and post-save refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Employee } from '@workspace/api-client-react';
import EmployeeEdit from '@/pages/employee-edit';

const HR_FULL = ['employee.read', 'employee.write', 'employee.sensitive.read', 'employee.sensitive.write', 'employee.notes.read', 'employee_number.allocate'];
const HR_GENERAL = ['employee.read', 'employee.write'];

// A thirty-field form driven through jsdom is slow under full-suite load.
vi.setConfig({ testTimeout: 20_000 });
const now = '2026-10-01T00:00:00.000Z';

const { state } = vi.hoisted(() => ({
  state: {
    permissions: [] as string[],
    employee: undefined as unknown,
    employeeLoading: false,
    employeeError: undefined as unknown,
    updateMutate: vi.fn(),
    updatePending: false,
    setQueryData: vi.fn(),
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: [{ organizationId: 10, roles: ['custom_hr'], permissions: state.permissions }], isLoading: false }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useGetEmployee: () => ({ data: state.employee, isLoading: state.employeeLoading, error: state.employeeError, refetch: vi.fn() }),
  getGetEmployeeQueryKey: (orgId: number, id: number) => ['employee', orgId, id],
  useUpdateEmployee: () => ({ mutate: state.updateMutate, isPending: state.updatePending }),
  useListEmployees: () => ({ data: { items: [], total: 0 }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
  getListEmployeesQueryKey: (orgId: number, params?: unknown) => ['employees', orgId, ...(params ? [params] : [])],
  useListDepartments: () => ({ data: [{ id: 3, name: 'Engineering' }] }),
  getListDepartmentsQueryKey: (orgId: number) => ['departments', orgId],
  useListBranches: () => ({ data: [] }),
  getListBranchesQueryKey: (orgId: number) => ['branches', orgId],
  useListPositions: () => ({ data: [{ id: 7, title: 'Analyst' }] }),
  getListPositionsQueryKey: (orgId: number) => ['positions', orgId],
}));

function storedEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 42,
    organizationId: 10,
    employeeNumber: 'EMP-0042',
    firstName: 'Ada',
    lastName: 'Lovelace',
    middleName: null,
    preferredName: null,
    gender: 'female',
    dateOfBirth: '1990-12-10T00:00:00.000Z',
    nationality: 'Ghanaian',
    nationalId: 'GHA-123',
    personalEmail: 'ada@example.com',
    workEmail: 'ada@wwm.example',
    phoneNumber: '+233 20 000 0000',
    residentialAddress: { line1: '1 Analytical St', city: 'Accra' },
    emergencyContacts: [{ name: 'Charles', relationship: 'Spouse', phone: '+233200000001' }],
    departmentId: 3,
    departmentName: 'Engineering',
    positionId: 7,
    reportingManagerId: 9,
    reportingManagerName: 'Grace Hopper',
    employmentType: 'full_time',
    hireDate: '2024-01-15T00:00:00.000Z',
    employmentStatus: 'active',
    workLocation: 'Head office',
    notes: 'Internal note',
    sensitiveFieldsRedacted: false,
    linkedApplicationUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData = state.setQueryData as typeof queryClient.setQueryData;
  const location = memoryLocation({ path: '/employees/42/edit', record: true });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <Switch>
          <Route path="/employees/:id/edit">{() => <EmployeeEdit />}</Route>
          <Route path="/employees/:id">{(p) => <div data-testid="profile-page">profile {p.id}</div>}</Route>
        </Switch>
      </Router>
    </QueryClientProvider>
  );
  const utils = render(tree());
  // Re-render the same tree, e.g. after the caller's permissions change.
  return { ...utils, location, rerenderPage: () => utils.rerender(tree()) };
}

/** Same page under wouter's real browser-history router, as in Production. */
function renderPageInBrowserRouter() {
  history.replaceState(null, '', '/employees/42/edit');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData = state.setQueryData as typeof queryClient.setQueryData;
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <Switch>
          <Route path="/employees/:id/edit">{() => <EmployeeEdit />}</Route>
          <Route path="/employees/:id">{(p) => <div data-testid="profile-page">profile {p.id}</div>}</Route>
          <Route path="/employees">{() => <div data-testid="directory-page">directory</div>}</Route>
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
}

function lastUpdateCall() {
  const call = state.updateMutate.mock.calls.at(-1) as [{ organizationId: number; employeeId: number; data: Record<string, unknown> }, { onSuccess: (e: unknown) => void; onError: (e: unknown) => void }];
  return { variables: call[0], options: call[1] };
}

const set = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

function apiError(status: number, data: unknown) {
  return Object.assign(new Error('Request failed'), { name: 'ApiError', status, data });
}

beforeEach(() => {
  state.permissions = [...HR_FULL];
  state.employee = storedEmployee();
  state.employeeLoading = false;
  state.employeeError = undefined;
  state.updateMutate = vi.fn();
  state.updatePending = false;
  state.setQueryData = vi.fn();
});

describe('Edit employee page', () => {
  it('prefills every supported field from the record and shows the manager by name', () => {
    renderPage();
    expect(screen.getByTestId('input-employee-first-name')).toHaveValue('Ada');
    expect(screen.getByTestId('input-employee-last-name')).toHaveValue('Lovelace');
    expect(screen.getByTestId('input-employee-work-email')).toHaveValue('ada@wwm.example');
    expect(screen.getByTestId('input-employee-national-id')).toHaveValue('GHA-123');
    expect(screen.getByTestId('input-employee-date-of-birth')).toHaveValue('1990-12-10');
    expect(screen.getByTestId('input-employee-hire-date')).toHaveValue('2024-01-15');
    expect(screen.getByTestId('input-employee-residential-address-line1')).toHaveValue('1 Analytical St');
    expect(screen.getByTestId('input-employee-emergency-contacts-0-name')).toHaveValue('Charles');
    expect(screen.getByTestId('input-employee-work-location')).toHaveValue('Head office');
    expect(screen.getByTestId('input-employee-notes')).toHaveValue('Internal note');
    expect(screen.getByTestId('select-reporting-manager')).toHaveTextContent('Grace Hopper');
    // The staff number is not editable here (changed only via allocate/release).
    expect(screen.queryByTestId('input-employee-employee-number')).not.toBeInTheDocument();
    expect(screen.getByText(/Employee number EMP-0042/)).toBeInTheDocument();
  });

  it('has nothing to save until something changes', () => {
    renderPage();
    expect(screen.getByTestId('button-submit-employee')).toBeDisabled();
    expect(screen.getByTestId('text-no-changes')).toBeInTheDocument();
  });

  it('sends only the edited field, then refreshes and returns to the profile', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();

    await user.clear(screen.getByTestId('input-employee-work-email'));
    await user.type(screen.getByTestId('input-employee-work-email'), 'ada.l@wwm.example');
    await user.click(screen.getByTestId('button-submit-employee'));

    await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
    const { variables, options } = lastUpdateCall();
    expect(variables).toMatchObject({ organizationId: 10, employeeId: 42 });
    expect(variables.data).toEqual({ workEmail: 'ada.l@wwm.example' });
    // Loaded-but-untouched values, sensitive or not, are never re-sent.
    for (const key of ['firstName', 'lastName', 'nationalId', 'phoneNumber', 'dateOfBirth', 'emergencyContacts', 'residentialAddress', 'notes', 'employmentStatus']) {
      expect(variables.data).not.toHaveProperty(key);
    }

    options.onSuccess(storedEmployee({ workEmail: 'ada.l@wwm.example', updatedAt: '2026-10-02T00:00:00.000Z' }));
    expect(state.setQueryData).toHaveBeenCalledWith(['employee', 10, 42], expect.objectContaining({ workEmail: 'ada.l@wwm.example' }));
    await waitFor(() => expect(location.history.at(-1)).toBe('/employees/42'));
  });

  it('lets a general-write caller save general changes while sensitive values stay read-only and unsent', async () => {
    state.permissions = [...HR_GENERAL];
    renderPage();
    const user = userEvent.setup();

    expect(screen.getByTestId('input-employee-national-id')).toBeDisabled();
    expect(screen.getByTestId('input-employee-national-id')).toHaveValue('GHA-123'); // visible: the caller holds sensitive.read in this scenario's response
    expect(screen.getAllByTestId('text-sensitive-readonly').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('input-employee-notes')).not.toBeInTheDocument();

    await user.clear(screen.getByTestId('input-employee-last-name'));
    await user.type(screen.getByTestId('input-employee-last-name'), 'Byron');
    await user.click(screen.getByTestId('button-submit-employee'));

    await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
    expect(lastUpdateCall().variables.data).toEqual({ lastName: 'Byron' });
  });

  it('hides redacted personal fields entirely and never echoes their nulls back', async () => {
    state.permissions = [...HR_GENERAL];
    state.employee = storedEmployee({ sensitiveFieldsRedacted: true, gender: undefined, dateOfBirth: undefined, nationalId: undefined, personalEmail: undefined, phoneNumber: undefined, residentialAddress: undefined, emergencyContacts: undefined, nationality: undefined, notes: undefined });
    renderPage();
    const user = userEvent.setup();

    expect(screen.getAllByTestId('text-sensitive-redacted').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('input-employee-national-id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('input-employee-phone-number')).not.toBeInTheDocument();

    await user.type(screen.getByTestId('input-employee-preferred-name'), 'Countess');
    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
    expect(lastUpdateCall().variables.data).toEqual({ preferredName: 'Countess' });
  });

  it('refuses to render the form on the viewer’s own record and routes them to My Requests', () => {
    state.employee = storedEmployee({ linkedApplicationUserId: 1 });
    renderPage();
    expect(screen.getByTestId('notice-self-administration')).toBeInTheDocument();
    expect(screen.getByTestId('link-my-requests')).toHaveAttribute('href', '/my-requests');
    expect(screen.queryByTestId('form-employee')).not.toBeInTheDocument();
    expect(screen.getByText(/Employment and placement changes are not available there/)).toBeInTheDocument();
  });

  it('explains a self_administration_forbidden refusal from the server without pretending it succeeded', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-preferred-name'), 'Countess');
    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));

    lastUpdateCall().options.onError(apiError(403, { error: 'You cannot perform this administrative action on your own employee record.', code: 'self_administration_forbidden', employeeId: 42 }));
    const alert = await screen.findByTestId('alert-employee-form-error');
    expect(alert).toHaveTextContent('You cannot administer your own record');
    expect(alert).toHaveTextContent(/own employee record/);
    expect(location.history.at(-1)).toBe('/employees/42/edit');
    expect(state.setQueryData).not.toHaveBeenCalled();
  });

  it('locks the status of a separated employee and points to Rehire', () => {
    state.employee = storedEmployee({ employmentStatus: 'terminated' });
    renderPage();
    const trigger = screen.getByTestId('select-employee-employment-status');
    expect(trigger).toBeDisabled();
    expect(screen.getByText(/reactivated with the Rehire action/)).toBeInTheDocument();
  });

  it('treats a 404 or 403 on load as “not available”, with no retry and no form (cross-tenant)', () => {
    state.employee = undefined;
    state.employeeError = apiError(404, { error: 'Employee not found' });
    renderPage();
    expect(screen.getByTestId('state-employee-edit-error')).toHaveTextContent('Employee not available');
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-employee')).not.toBeInTheDocument();
  });

  it('refuses the form to a caller without employee.write', () => {
    state.permissions = ['employee.read'];
    renderPage();
    expect(screen.getByTestId('state-employee-edit-forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('form-employee')).not.toBeInTheDocument();
  });

  it('asks before discarding edits, and discarding returns to the profile', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-preferred-name'), 'Countess');
    await user.click(screen.getByTestId('button-cancel-employee'));
    const dialog = await screen.findByTestId('dialog-discard-employee-changes');
    await user.click(dialog.querySelector('button[data-testid$="confirm"]') ?? screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(location.history.at(-1)).toBe('/employees/42'));
  });

  it('warns the browser before unloading a dirty form, and not a clean one', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderPage();
    const user = userEvent.setup();
    expect(addSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false);
    await user.type(screen.getByTestId('input-employee-preferred-name'), 'C');
    await waitFor(() => expect(addSpy.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true));
    addSpy.mockRestore();
  });

  describe('mixed permitted and restricted changes (review finding 2)', () => {

    it('refuses the whole submission, names the restricted fields, and sends nothing', async () => {
      const { rerenderPage } = renderPage();
      const user = userEvent.setup();

      // Edit a permitted field and a sensitive field while the caller still holds the key…
      set('input-employee-work-email', 'ada.l@wwm.example');
      set('input-employee-national-id', 'GHA-999');
      // …then the key is withdrawn before saving (membership refetched).
      state.permissions = [...HR_GENERAL, 'employee.sensitive.read'];
      rerenderPage();
      expect(screen.getByTestId('input-employee-national-id')).toBeDisabled();
      expect(screen.getByTestId('input-employee-national-id')).toHaveValue('GHA-999');

      await user.click(screen.getByTestId('button-submit-employee'));

      expect(state.updateMutate).not.toHaveBeenCalled();
      const alert = await screen.findByTestId('alert-employee-restricted-changes');
      expect(alert).toHaveTextContent('Some of your changes cannot be saved');
      expect(alert).toHaveTextContent('National ID');
      expect(alert).toHaveTextContent('Nothing has been saved');
      await waitFor(() => expect(screen.getByTestId('input-employee-national-id')).toHaveAttribute('aria-invalid', 'true'));
      expect(screen.getByText(/Changing this requires the employee.sensitive.write permission/)).toBeInTheDocument();
    });

    it('lets the user undo only the restricted changes, then saves exactly the permitted ones', async () => {
      const { rerenderPage } = renderPage();
      const user = userEvent.setup();

      set('input-employee-work-email', 'ada.l@wwm.example');
      set('input-employee-national-id', 'GHA-999');
      set('input-employee-phone-number', '+233 20 111 1111');
      state.permissions = [...HR_GENERAL, 'employee.sensitive.read'];
      rerenderPage();

      await user.click(screen.getByTestId('button-submit-employee'));
      await user.click(await screen.findByTestId('button-undo-restricted-changes'));

      expect(screen.getByTestId('input-employee-national-id')).toHaveValue('GHA-123');
      expect(screen.getByTestId('input-employee-phone-number')).toHaveValue('+233 20 000 0000');
      expect(screen.getByTestId('input-employee-work-email')).toHaveValue('ada.l@wwm.example');
      await waitFor(() => expect(screen.queryByTestId('alert-employee-restricted-changes')).not.toBeInTheDocument());

      await user.click(screen.getByTestId('button-submit-employee'));
      await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
      expect(lastUpdateCall().variables.data).toEqual({ workEmail: 'ada.l@wwm.example' });
    });

    it('still saves a sensitive change for a caller who holds the key, alongside general changes', async () => {
      renderPage();
      const user = userEvent.setup();
      set('input-employee-work-email', 'ada.l@wwm.example');
      set('input-employee-national-id', 'GHA-999');
      await user.click(screen.getByTestId('button-submit-employee'));
      await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
      expect(lastUpdateCall().variables.data).toEqual({ workEmail: 'ada.l@wwm.example', nationalId: 'GHA-999' });
      expect(screen.queryByTestId('alert-employee-restricted-changes')).not.toBeInTheDocument();
    });

    it('never treats a redacted (withheld) field as a restricted change', async () => {
      state.permissions = [...HR_GENERAL];
      state.employee = storedEmployee({ sensitiveFieldsRedacted: true, nationalId: undefined, phoneNumber: undefined, dateOfBirth: undefined, personalEmail: undefined, residentialAddress: undefined, emergencyContacts: undefined, gender: undefined, nationality: undefined, notes: undefined });
      renderPage();
      const user = userEvent.setup();
      set('input-employee-work-email', 'ada.l@wwm.example');
      await user.click(screen.getByTestId('button-submit-employee'));
      await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
      expect(lastUpdateCall().variables.data).toEqual({ workEmail: 'ada.l@wwm.example' });
    });
  });

  describe('in-app navigation while dirty (review finding 1)', () => {
    it('holds the "Back to profile" breadcrumb and leaves only on confirmation', async () => {
      const { location } = renderPage();
      const user = userEvent.setup();
      set('input-employee-preferred-name', 'Countess');

      await user.click(screen.getByTestId('link-back-to-profile'));
      expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
      expect(location.history.at(-1)).toBe('/employees/42/edit');

      await user.click(screen.getByRole('button', { name: 'Leave page' }));
      await waitFor(() => expect(location.history.at(-1)).toBe('/employees/42'));
    });

    it('does not warn on a clean form', async () => {
      const { location } = renderPage();
      await userEvent.setup().click(screen.getByTestId('link-back-to-profile'));
      await waitFor(() => expect(location.history.at(-1)).toBe('/employees/42'));
      expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
    });

    it('under the real browser router: a successful save navigates with no warning', async () => {
      renderPageInBrowserRouter();
      const user = userEvent.setup();
      set('input-employee-preferred-name', 'Countess');
      await user.click(screen.getByTestId('button-submit-employee'));
      await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));

      act(() => lastUpdateCall().options.onSuccess(storedEmployee({ preferredName: 'Countess', updatedAt: '2026-10-12T00:00:00.000Z' })));
      expect(await screen.findByTestId('profile-page')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/employees/42');
      expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
    });

    it('under the real browser router: a failed save keeps the guard armed', async () => {
      renderPageInBrowserRouter();
      const user = userEvent.setup();
      set('input-employee-preferred-name', 'Countess');
      await user.click(screen.getByTestId('button-submit-employee'));
      await waitFor(() => expect(state.updateMutate).toHaveBeenCalledTimes(1));
      act(() => lastUpdateCall().options.onError(apiError(400, { error: 'Validation failed' })));

      await user.click(screen.getByTestId('link-back-to-profile'));
      expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/employees/42/edit');
    });
  });
});
