/**
 * Assisted employee picker (WS-26, B2 + S2).
 *
 * Two behaviours are load-bearing here.
 *
 * S2 — the list is a SEARCH, not a browse. It must send the search term to the
 * server rather than filtering a pre-fetched workforce in the browser, and it
 * must not fire a request per keystroke.
 *
 * B2 — an employee with no linked login must be visibly marked and must still
 * be selectable. Preparing a form for someone who cannot reach the system is
 * the whole reason assisted completion exists (a new starter on day one); what
 * HR needs is to be TOLD, not blocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listEmployees = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useListEmployees: (...args: unknown[]) => listEmployees(...args),
  getListEmployeesQueryKey: (id: number, params: unknown) => ['employees', id, params],
}));

import { AssistedEmployeePicker } from '@/components/forms/assisted-employee-picker';
import { NO_ACCOUNT_NOTICE } from '@/lib/employee-account';

const LINKED = { id: 445, firstName: 'Ama', lastName: 'Mensah', employeeNumber: 'EMP-0050', linkedApplicationUserId: 900 };
const UNLINKED = { id: 446, firstName: 'Kofi', lastName: 'Boateng', employeeNumber: 'EMP-0051', linkedApplicationUserId: null };

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [LINKED, UNLINKED], total: 2, page: 1, pageSize: 20 },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  };
}

function renderPicker(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AssistedEmployeePicker organizationId={3} value={null} onChange={onChange} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

const openList = async () => {
  fireEvent.click(screen.getByTestId('select-assisted-employee'));
  await waitFor(() => expect(screen.getByTestId('input-assisted-employee-search')).toBeInTheDocument());
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listEmployees.mockReset();
  listEmployees.mockReturnValue(result());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('S2 — server-side search', () => {
  it('asks the server, scoped to the organization, rather than fetching the workforce', async () => {
    renderPicker();
    await openList();
    const [organizationId, params] = listEmployees.mock.calls[0]!;
    expect(organizationId).toBe(3);
    expect((params as { pageSize: number }).pageSize).toBeLessThanOrEqual(25);
    expect(params).not.toHaveProperty('search', '');
  });

  it('sends the typed term as a search parameter', async () => {
    renderPicker();
    await openList();
    fireEvent.change(screen.getByTestId('input-assisted-employee-search'), { target: { value: 'Ama' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    await waitFor(() => {
      const params = listEmployees.mock.calls.map((c) => c[1] as { search?: string });
      expect(params.some((p) => p.search === 'Ama')).toBe(true);
    });
  });

  it('debounces: typing does not immediately change the query', async () => {
    renderPicker();
    await openList();
    const callsBefore = listEmployees.mock.calls.length;
    fireEvent.change(screen.getByTestId('input-assisted-employee-search'), { target: { value: 'A' } });
    fireEvent.change(screen.getByTestId('input-assisted-employee-search'), { target: { value: 'Am' } });
    fireEvent.change(screen.getByTestId('input-assisted-employee-search'), { target: { value: 'Ama' } });
    const searchesSoFar = listEmployees.mock.calls
      .slice(callsBefore)
      .map((c) => (c[1] as { search?: string }).search)
      .filter(Boolean);
    // Nothing has settled yet, so no intermediate term reached the query.
    expect(searchesSoFar).toEqual([]);
  });

  it('renders the results it was given', async () => {
    renderPicker();
    await openList();
    expect(screen.getByTestId('option-assisted-employee-445')).toHaveTextContent('Ama Mensah');
    expect(screen.getByTestId('option-assisted-employee-446')).toHaveTextContent('Kofi Boateng');
  });

  it('shows a loading state while the first page is in flight', async () => {
    listEmployees.mockReturnValue(result({ data: undefined, isLoading: true }));
    renderPicker();
    await openList();
    expect(screen.getByTestId('state-assisted-employee-loading')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    listEmployees.mockReturnValue(result({ data: { items: [], total: 0, page: 1, pageSize: 20 } }));
    renderPicker();
    await openList();
    expect(screen.getByTestId('state-assisted-employee-empty')).toBeInTheDocument();
  });

  it('shows an error state with a retry rather than an empty list', async () => {
    const refetch = vi.fn();
    listEmployees.mockReturnValue(result({ data: undefined, error: new Error('boom'), refetch }));
    renderPicker();
    await openList();
    expect(screen.getByTestId('state-assisted-employee-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('says when results were truncated instead of silently hiding people', async () => {
    listEmployees.mockReturnValue(result({ data: { items: [LINKED, UNLINKED], total: 640, page: 1, pageSize: 20 } }));
    renderPicker();
    await openList();
    expect(screen.getByTestId('text-assisted-employee-truncated')).toHaveTextContent('640');
  });
});

describe('B2 — account linkage is visible', () => {
  it('marks an employee who has no login account', async () => {
    renderPicker();
    await openList();
    expect(screen.getByTestId('badge-no-account-446')).toBeInTheDocument();
  });

  it('does not mark an employee who has one', async () => {
    renderPicker();
    await openList();
    expect(screen.queryByTestId('badge-no-account-445')).not.toBeInTheDocument();
  });

  it('still allows HR to select an employee with no account', async () => {
    const { onChange } = renderPicker();
    await openList();
    fireEvent.click(screen.getByTestId('option-assisted-employee-446'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 446 }));
  });

  it('explains the consequence once such an employee is selected', () => {
    renderPicker({ value: UNLINKED });
    expect(screen.getByTestId('text-assisted-employee-no-account')).toHaveTextContent(NO_ACCOUNT_NOTICE);
  });

  it('says nothing when the selected employee has an account', () => {
    renderPicker({ value: LINKED });
    expect(screen.queryByTestId('text-assisted-employee-no-account')).not.toBeInTheDocument();
  });

  it('keeps the selected employee visible even when the search results change', async () => {
    const { rerender } = renderPicker({ value: UNLINKED });
    expect(screen.getByTestId('select-assisted-employee')).toHaveTextContent('Kofi Boateng');
    // A later search returns a completely different page; the selection is the
    // parent's state, so it must survive.
    listEmployees.mockReturnValue(result({ data: { items: [LINKED], total: 1, page: 1, pageSize: 20 } }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <AssistedEmployeePicker organizationId={3} value={UNLINKED as never} onChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('select-assisted-employee')).toHaveTextContent('Kofi Boateng');
    expect(screen.getByTestId('text-assisted-employee-no-account')).toBeInTheDocument();
  });
});

describe('it does not leak developer vocabulary', () => {
  it('uses plain language throughout', async () => {
    const { container } = renderPicker({ value: UNLINKED });
    await openList();
    for (const jargon of ['subject_employee', 'resolver', 'membership', 'application_user_id', 'linkedApplicationUserId']) {
      expect(document.body.textContent).not.toContain(jargon);
    }
    expect(container).toBeTruthy();
  });

  it('never offers a free-text employee id field', async () => {
    renderPicker();
    await openList();
    expect(screen.queryByPlaceholderText(/employee id/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('select-assisted-employee').tagName).not.toBe('INPUT');
  });
});
