/**
 * Tests for the Legacy Personnel Import page (Phase 3H, W119).
 * @workspace/api-client-react is mocked at the hook level — no real network
 * requests are made, and no real file upload occurs.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PersonnelImportValidationSummary, PersonnelImportCommitResult } from '@workspace/api-client-react';

const { state } = vi.hoisted(() => ({
  state: {
    previewMutate: vi.fn(),
    previewPending: false,
    previewError: undefined as unknown,
    commitMutate: vi.fn(),
    commitPending: false,
    commitError: undefined as unknown,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => ({ data: { id: 1, activeOrganizationId: 10, organizationId: 10 } }),
  getGetMeQueryKey: () => ['getMe'],
  usePreviewPersonnelImport: () => ({ mutate: state.previewMutate, isPending: state.previewPending, error: state.previewError }),
  useCommitPersonnelImport: () => ({ mutate: state.commitMutate, isPending: state.commitPending, error: state.commitError }),
  getGetPersonnelImportTemplateUrl: (orgId: number) => `/api/organizations/${orgId}/personnel-records/import/template`,
}));

vi.mock('@/lib/auth', () => ({ getStoredToken: () => 'test-token' }));

// Imported after the mocks above so the page picks up the mocked module.
const { default: PersonnelImport } = await import('@/pages/personnel-import');

function resetState() {
  state.previewMutate = vi.fn();
  state.previewPending = false;
  state.previewError = undefined;
  state.commitMutate = vi.fn();
  state.commitPending = false;
  state.commitError = undefined;
}

function renderPage() {
  return render(<PersonnelImport />);
}

function summary(overrides: Partial<PersonnelImportValidationSummary> = {}): PersonnelImportValidationSummary {
  return {
    totalRows: 1,
    validCount: 1,
    warningCount: 0,
    invalidCount: 0,
    rows: [{ rowNumber: 1, status: 'valid', errors: [], warnings: [] }],
    ...overrides,
  };
}

async function chooseFile() {
  const user = userEvent.setup();
  const file = new File(['firstName,lastName\nJane,Doe\n'], 'import.csv', { type: 'text/csv' });
  const input = screen.getByTestId('input-import-file');
  await user.upload(input, file);
  return user;
}

describe('Legacy Personnel Import page', () => {
  it('renders without crashing and shows the template download control', () => {
    resetState();
    renderPage();
    expect(screen.getByText('Legacy Personnel Import')).toBeInTheDocument();
    expect(screen.getByTestId('button-download-import-template')).toBeInTheDocument();
  });

  it('does not call preview automatically on file selection — only on the explicit Validate click', async () => {
    resetState();
    renderPage();
    await chooseFile();
    expect(state.previewMutate).not.toHaveBeenCalled();
  });

  it('validates on click and shows row-level results with a text label, not color alone', async () => {
    resetState();
    state.previewMutate = vi.fn((_vars, opts) => opts.onSuccess(summary()));
    renderPage();
    const user = await chooseFile();
    await user.click(screen.getByTestId('button-preview-import'));

    await waitFor(() => expect(screen.getByTestId('row-import-1')).toBeInTheDocument());
    expect(screen.getByTestId('row-import-1')).toHaveTextContent('Valid');
  });

  it('disables commit when the summary has invalid rows', async () => {
    resetState();
    state.previewMutate = vi.fn((_vars, opts) => opts.onSuccess(summary({ validCount: 0, invalidCount: 1, rows: [{ rowNumber: 1, status: 'invalid', errors: ['lastName is required'], warnings: [] }] })));
    renderPage();
    const user = await chooseFile();
    await user.click(screen.getByTestId('button-preview-import'));

    await waitFor(() => expect(screen.getByTestId('button-commit-import')).toBeInTheDocument());
    expect(screen.getByTestId('button-commit-import')).toBeDisabled();
    expect(screen.getByTestId('row-import-1')).toHaveTextContent('lastName is required');
  });

  it('enables commit when every row is valid, and shows the result summary after committing', async () => {
    resetState();
    state.previewMutate = vi.fn((_vars, opts) => opts.onSuccess(summary()));
    const commitResult: PersonnelImportCommitResult = { count: 1, created: [{ rowNumber: 1, employeeId: 42, employeeNumber: 'WWM/SN/014', pifNumber: 'PIF-014' }] };
    state.commitMutate = vi.fn((_vars, opts) => opts.onSuccess(commitResult));
    renderPage();
    const user = await chooseFile();
    await user.click(screen.getByTestId('button-preview-import'));
    await waitFor(() => expect(screen.getByTestId('button-commit-import')).not.toBeDisabled());

    await user.click(screen.getByTestId('button-commit-import'));
    await waitFor(() => expect(screen.getByTestId('text-import-result-count')).toHaveTextContent('1 employee(s) created.'));
    expect(screen.getByText('WWM/SN/014')).toBeInTheDocument();
  });

  it('shows an access-denied message on a 403 from preview', () => {
    resetState();
    state.previewError = { status: 403 };
    renderPage();
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });
});
