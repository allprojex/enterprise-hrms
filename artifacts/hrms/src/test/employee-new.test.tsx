/**
 * Register employee page (Phase 2 — /employees/new).
 *
 * Covers: creation without any account, required and optional fields,
 * permission-aware sensitive fields, manager selection, date validation,
 * server-error mapping, duplicate-submission prevention and responsive layout.
 * Every API hook is stubbed at the module boundary; no network is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import EmployeeNew from '@/pages/employee-new';

const HR_FULL = ['employee.read', 'employee.write', 'employee.sensitive.read', 'employee.sensitive.write', 'employee.notes.read', 'employee_number.allocate'];
const HR_GENERAL = ['employee.read', 'employee.write'];

// A thirty-field form driven through jsdom is slow under full-suite load; a
// test that times out keeps running and leaks clicks into the next one.
vi.setConfig({ testTimeout: 20_000 });

const { state } = vi.hoisted(() => ({
  state: {
    permissions: [] as string[],
    createMutate: vi.fn(),
    createPending: false,
    uploadMutate: vi.fn(),
    directory: [] as Array<{ id: number; firstName: string; lastName: string; employeeNumber: string | null; employmentStatus: string; positionName?: string | null }>,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  useListMyOrganizations: () => ({ data: [{ organizationId: 10, roles: ['custom_hr'], permissions: state.permissions }], isLoading: false }),
  getListMyOrganizationsQueryKey: () => ['myOrganizations'],
  useCreateEmployee: () => ({ mutate: state.createMutate, isPending: state.createPending }),
  useUploadEmployeeProfilePicture: () => ({ mutate: state.uploadMutate, isPending: false }),
  useListEmployees: () => ({ data: { items: state.directory, total: state.directory.length }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
  getListEmployeesQueryKey: (orgId: number, params?: unknown) => ['employees', orgId, ...(params ? [params] : [])],
  useListDepartments: () => ({ data: [{ id: 3, name: 'Engineering' }] }),
  getListDepartmentsQueryKey: (orgId: number) => ['departments', orgId],
  useListBranches: () => ({ data: [{ id: 5, name: 'Head Office' }] }),
  getListBranchesQueryKey: (orgId: number) => ['branches', orgId],
  useListPositions: () => ({ data: [{ id: 7, title: 'Analyst' }] }),
  getListPositionsQueryKey: (orgId: number) => ['positions', orgId],
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const location = memoryLocation({ path: '/employees/new', record: true });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        {/* Switch, as in App.tsx: without it "/employees/:id" also matches "/employees/new". */}
        <Switch>
          <Route path="/employees/new">{() => <EmployeeNew />}</Route>
          <Route path="/employees/:id">{(p) => <div data-testid="profile-page">profile {p.id}</div>}</Route>
          <Route path="/employees">{() => <div data-testid="directory-page">directory</div>}</Route>
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
  return { ...utils, location };
}

function lastCreateCall() {
  const call = state.createMutate.mock.calls.at(-1) as [{ organizationId: number; data: Record<string, unknown> }, { onSuccess: (e: unknown) => void; onError: (e: unknown) => void }];
  return { variables: call[0], options: call[1] };
}

function apiError(status: number, data: unknown) {
  return Object.assign(new Error('Request failed'), { name: 'ApiError', status, data });
}

beforeEach(() => {
  state.permissions = [...HR_FULL];
  state.createMutate = vi.fn();
  state.createPending = false;
  state.uploadMutate = vi.fn();
  state.directory = [
    { id: 9, firstName: 'Grace', lastName: 'Hopper', employeeNumber: 'EMP-0009', employmentStatus: 'active', positionName: 'Director' },
    { id: 11, firstName: 'Alan', lastName: 'Turing', employeeNumber: 'EMP-0011', employmentStatus: 'terminated' },
  ];
});

describe('Register employee page', () => {
  it('refuses to render the form for a caller without employee.write', () => {
    state.permissions = ['employee.read'];
    renderPage();
    expect(screen.getByTestId('state-employee-new-forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('form-employee')).not.toBeInTheDocument();
  });

  it('registers an employee with only the required fields and creates no account', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();

    expect(screen.getByTestId('text-no-account-created')).toHaveTextContent(/No login account is created or invited/);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    await user.type(screen.getByTestId('input-employee-first-name'), ' Ada ');
    await user.type(screen.getByTestId('input-employee-last-name'), 'Lovelace');
    await user.click(screen.getByTestId('button-submit-employee'));

    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));
    const { variables, options } = lastCreateCall();
    expect(variables.organizationId).toBe(10);
    expect(variables.data).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    for (const forbidden of ['password', 'userId', 'applicationUserId', 'email', 'inviteUrl', 'roleId']) {
      expect(variables.data).not.toHaveProperty(forbidden);
    }

    options.onSuccess({ id: 77, firstName: 'Ada', lastName: 'Lovelace' });
    await waitFor(() => expect(location.history.at(-1)).toBe('/employees/77'));
    expect(state.uploadMutate).not.toHaveBeenCalled();
  });

  it('blocks submission and names the missing required fields', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('button-submit-employee'));
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(screen.getByText('Last name is required')).toBeInTheDocument();
    expect(state.createMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('input-employee-first-name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('validates dates the way the server does before anything is sent', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.type(screen.getByTestId('input-employee-last-name'), 'Lovelace');
    fireEvent.change(screen.getByTestId('input-employee-date-of-birth'), { target: { value: '2999-01-01' } });
    fireEvent.change(screen.getByTestId('input-employee-hire-date'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByTestId('input-employee-probation-end-date'), { target: { value: '2023-01-01' } });
    await user.click(screen.getByTestId('button-submit-employee'));

    expect(await screen.findByText('Date of birth cannot be in the future')).toBeInTheDocument();
    expect(screen.getByText('Probation end date cannot be before the hire date')).toBeInTheDocument();
    expect(state.createMutate).not.toHaveBeenCalled();
  });

  it('sends the full set of optional fields a sensitive-write holder enters, including an emergency contact', async () => {
    renderPage();
    const user = userEvent.setup();
    // Direct change events: this test is about the payload, not keystrokes,
    // and typing a dozen fields key by key in jsdom would exceed the timeout.
    const set = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

    set('input-employee-first-name', 'Ada');
    set('input-employee-last-name', 'Lovelace');
    set('input-employee-middle-name', 'King');
    set('input-employee-work-email', 'ada@wwm.example');
    set('input-employee-national-id', 'GHA-123');
    set('input-employee-phone-number', '+233 20 000 0000');
    set('input-employee-residential-address-line1', '1 Analytical St');
    set('input-employee-residential-address-city', 'Accra');
    set('input-employee-work-location', 'Head office');
    set('input-employee-employee-number', 'EMP-0100');
    set('input-employee-hire-date', '2026-02-01');

    await user.click(screen.getByTestId('button-add-emergency-contact'));
    const row = screen.getByTestId('emergency-contact-0');
    fireEvent.change(within(row).getByTestId('input-employee-emergency-contacts-0-name'), { target: { value: 'Charles Babbage' } });
    fireEvent.change(within(row).getByTestId('input-employee-emergency-contacts-0-relationship'), { target: { value: 'Spouse' } });
    fireEvent.change(within(row).getByTestId('input-employee-emergency-contacts-0-phone'), { target: { value: '+233200000001' } });

    set('input-employee-notes', 'Referred by the engineering lead');

    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));
    expect(lastCreateCall().variables.data).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      middleName: 'King',
      workEmail: 'ada@wwm.example',
      employeeNumber: 'EMP-0100',
      hireDate: '2026-02-01',
      workLocation: 'Head office',
      nationalId: 'GHA-123',
      phoneNumber: '+233 20 000 0000',
      residentialAddress: { line1: '1 Analytical St', line2: null, city: 'Accra', state: null, postalCode: null, country: null },
      emergencyContacts: [{ name: 'Charles Babbage', relationship: 'Spouse', phone: '+233200000001' }],
      notes: 'Referred by the engineering lead',
    });
  });

  it('for a general-write-only caller: sensitive fields are disabled and explained, and never sent', async () => {
    state.permissions = [...HR_GENERAL];
    renderPage();
    const user = userEvent.setup();

    expect(screen.getAllByTestId('text-sensitive-readonly').length).toBeGreaterThan(0);
    expect(screen.getByTestId('input-employee-national-id')).toBeDisabled();
    expect(screen.getByTestId('input-employee-phone-number')).toBeDisabled();
    expect(screen.getByTestId('input-employee-date-of-birth')).toBeDisabled();
    expect(screen.queryByTestId('button-add-emergency-contact')).not.toBeInTheDocument();
    // No notes permission → no notes section; no allocate permission → auto-number note.
    expect(screen.queryByTestId('input-employee-notes')).not.toBeInTheDocument();
    expect(screen.getByTestId('text-employee-number-auto')).toBeInTheDocument();
    expect(screen.queryByTestId('input-employee-employee-number')).not.toBeInTheDocument();

    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.type(screen.getByTestId('input-employee-last-name'), 'Lovelace');
    await user.type(screen.getByTestId('input-employee-work-email'), 'ada@wwm.example');
    await user.click(screen.getByTestId('button-submit-employee'));

    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));
    const { data } = lastCreateCall().variables;
    expect(data).toEqual({ firstName: 'Ada', lastName: 'Lovelace', workEmail: 'ada@wwm.example' });
    for (const key of ['nationalId', 'phoneNumber', 'dateOfBirth', 'residentialAddress', 'emergencyContacts', 'notes', 'employeeNumber']) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it('selects a reporting manager from the searchable directory, never offering a separated employee', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.type(screen.getByTestId('input-employee-last-name'), 'Lovelace');

    fireEvent.click(screen.getByTestId('select-reporting-manager'));
    expect(await screen.findByTestId('option-reporting-manager-9')).toHaveTextContent('Grace Hopper · EMP-0009');
    expect(screen.queryByTestId('option-reporting-manager-11')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('option-reporting-manager-9'));
    expect(screen.getByTestId('select-reporting-manager')).toHaveTextContent('Grace Hopper · EMP-0009');

    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));
    expect(lastCreateCall().variables.data).toMatchObject({ reportingManagerId: 9 });
  });

  it('maps a duplicate-identifier 409 onto the field and shows the server sentence', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.type(screen.getByTestId('input-employee-last-name'), 'Lovelace');
    await user.type(screen.getByTestId('input-employee-national-id'), 'GHA-123');
    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));

    lastCreateCall().options.onError(apiError(409, { error: 'An employee with this national ID already exists in the organization', field: 'nationalId' }));

    expect(await screen.findByTestId('alert-employee-form-error')).toHaveTextContent(/already in use/);
    // The server's sentence appears in the alert and again under the field it named.
    await waitFor(() => expect(screen.getByTestId('input-employee-national-id')).toHaveAttribute('aria-invalid', 'true'));
    expect(await screen.findAllByText('An employee with this national ID already exists in the organization')).toHaveLength(2);
    expect(screen.queryByTestId('profile-page')).not.toBeInTheDocument();
  });

  it('explains a refused sensitive write field by field, and a plain 400 as a form-level error', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.type(screen.getByTestId('input-employee-last-name'), 'Lovelace');
    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));

    lastCreateCall().options.onError(apiError(403, { error: 'Sensitive fields require employee.sensitive.write', fields: ['phoneNumber'], requiredPermission: 'employee.sensitive.write' }));
    expect(await screen.findByTestId('alert-employee-form-error')).toHaveTextContent(/Primary phone/);
    expect(await screen.findByText(/Changing this requires the employee.sensitive.write permission/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('input-employee-phone-number')).toHaveAttribute('aria-invalid', 'true'));

    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(2));
    lastCreateCall().options.onError(apiError(400, { error: 'Hire date cannot be before date of birth' }));
    expect(await screen.findByText('Hire date cannot be before date of birth')).toBeInTheDocument();
  });

  it('disables the submit control while a registration is in flight', () => {
    state.createPending = true;
    renderPage();
    expect(screen.getByTestId('button-submit-employee')).toBeDisabled();
    expect(screen.getByTestId('form-employee')).toHaveAttribute('aria-busy', 'true');
  });

  it('asks before discarding a dirty form, and leaves silently when nothing was typed', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('button-cancel-employee'));
    expect(screen.queryByTestId('dialog-discard-employee-changes')).not.toBeInTheDocument();
    await waitFor(() => expect(location.history.at(-1)).toBe('/employees'));
  });

  it('asks before discarding typed details', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.click(screen.getByTestId('button-cancel-employee'));
    expect(await screen.findByTestId('dialog-discard-employee-changes')).toBeInTheDocument();
  });

  it('confirming Discard leaves at once, without a second route-guard prompt', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByTestId('input-employee-first-name'), 'Ada');
    await user.click(screen.getByTestId('button-cancel-employee'));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(location.history.at(-1)).toBe('/employees'));
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
  });

  it('holds the "Back to employees" breadcrumb on a dirty registration (review finding 1)', async () => {
    const { location } = renderPage();
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('input-employee-first-name'), { target: { value: 'Ada' } });

    await user.click(screen.getByRole('link', { name: /Back to employees/ }));
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(location.history.at(-1)).toBe('/employees/new');
    expect(screen.queryByTestId('directory-page')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument());
    expect(screen.getByTestId('input-employee-first-name')).toHaveValue('Ada');
  });

  it('under the real browser router: a successful registration navigates to the profile with no warning', async () => {
    history.replaceState(null, '', '/employees/new');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <Switch>
            <Route path="/employees/new">{() => <EmployeeNew />}</Route>
            <Route path="/employees/:id">{(p) => <div data-testid="profile-page">profile {p.id}</div>}</Route>
          </Switch>
        </Router>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('input-employee-first-name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByTestId('input-employee-last-name'), { target: { value: 'Lovelace' } });
    await user.click(screen.getByTestId('button-submit-employee'));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalledTimes(1));

    // Registration still creates the HR record only — no account, password or invitation.
    expect(lastCreateCall().variables.data).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });

    act(() => lastCreateCall().options.onSuccess({ id: 77, firstName: 'Ada', lastName: 'Lovelace' }));
    expect(await screen.findByTestId('profile-page')).toHaveTextContent('profile 77');
    expect(window.location.pathname).toBe('/employees/77');
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
  });

  it('lays out every section as a single column that becomes two from the sm breakpoint, with sticky actions', () => {
    renderPage();
    for (const id of ['personal', 'contact', 'emergency', 'employment', 'notes']) {
      const section = screen.getByTestId(`section-employee-${id}`);
      const grid = section.querySelector('.grid');
      expect(grid?.className).toContain('sm:grid-cols-2');
      expect(grid?.className).not.toMatch(/(^|\s)grid-cols-[2-9]/);
    }
    expect(screen.getByTestId('form-employee-actions').className).toContain('sticky');
    expect(screen.getByTestId('form-employee-actions').className).toContain('flex-col-reverse');
    expect(screen.getByRole('navigation', { name: 'Form sections' }).className).toContain('hidden');
  });

  it('marks required fields visibly and for assistive technology', () => {
    renderPage();
    const first = screen.getByTestId('input-employee-first-name');
    expect(first).toHaveAttribute('aria-required', 'true');
    expect(screen.getByText('First name').parentElement?.textContent).toContain('*');
    expect(screen.getByTestId('input-employee-work-email')).not.toHaveAttribute('aria-required');
  });
});
