/**
 * WS-15 P2/P3 (§31.29) — Employee 360 cross-module sections.
 *
 * The assertions that matter are about what the page must NOT do:
 *
 *   - it must not invent a section the server omitted, and must not render a
 *     placeholder or a zero for one (§31.29);
 *   - it must not present a legacy row as current;
 *   - it must not render a failed section as "nothing recorded" (§31.22);
 *   - it must offer no write control anywhere — Employee 360 is visibility and
 *     navigation, and every section ends in a link into the owning module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Employee360Sections } from '@/components/employee-360-sections';

const { state } = vi.hoisted(() => ({
  state: { sections: [] as any[], unavailableSections: [] as string[], isLoading: false, error: null as unknown },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetEmployee360Sections: () => ({
    data: { sections: state.sections, unavailableSections: state.unavailableSections },
    isLoading: state.isLoading,
    error: state.error,
    refetch: vi.fn(),
  }),
  getGetEmployee360SectionsQueryKey: (o: number, e: number) => ['emp360', o, e],
}));

function section(over: Record<string, unknown> = {}) {
  return {
    key: 'skills',
    title: 'Skills and capability',
    provenance: 'current',
    stats: [
      { label: 'Verified', value: '1' },
      { label: 'Awaiting verification', value: '2' },
    ],
    rows: [
      { id: 1, label: 'First Aid', status: 'verified', occurredAt: '2026-08-01T00:00:00.000Z', provenance: 'current' },
      { id: 2, label: 'LEGACYCODE', status: null, occurredAt: '2024-01-01T00:00:00.000Z', provenance: 'legacy' },
    ],
    truncated: false,
    deepLink: '/capability',
    note: 'Legacy entries are free-text records with no proficiency scale and no verification.',
    ...over,
  };
}

function renderSections() {
  const { hook } = memoryLocation({ path: '/employees/3' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Employee360Sections organizationId={10} employeeId={3} />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Employee 360 sections', () => {
  beforeEach(() => {
    state.sections = [];
    state.unavailableSections = [];
    state.isLoading = false;
    state.error = null;
  });

  it('renders a section with its stats, rows and a link into the owning module', () => {
    state.sections = [section()];
    renderSections();

    expect(screen.getByTestId('card-360-skills')).toBeInTheDocument();
    expect(screen.getByTestId('stats-360-skills')).toHaveTextContent('Verified: 1');
    expect(screen.getByTestId('stats-360-skills')).toHaveTextContent('Awaiting verification: 2');
    expect(screen.getByTestId('link-360-skills')).toBeInTheDocument();
  });

  it('marks a legacy row as legacy and never as current', () => {
    state.sections = [section()];
    renderSections();

    expect(screen.getByTestId('badge-legacy-skills-2')).toHaveTextContent('Legacy');
    // The current row carries no legacy badge.
    expect(screen.queryByTestId('badge-legacy-skills-1')).toBeNull();
    expect(screen.getByTestId('note-360-skills')).toHaveTextContent(/no verification/i);
  });

  it('a claimed skill is never rendered as verified', () => {
    state.sections = [
      section({
        rows: [
          { id: 5, label: 'First Aid', status: 'claimed', occurredAt: null, provenance: 'current' },
        ],
        stats: [
          { label: 'Verified', value: '0' },
          { label: 'Awaiting verification', value: '1' },
        ],
      }),
    ];
    renderSections();
    const row = screen.getByTestId('row-360-skills-current-5');
    expect(row).toHaveTextContent('claimed');
    expect(row).not.toHaveTextContent('verified');
    expect(screen.getByTestId('stats-360-skills')).toHaveTextContent('Verified: 0');
  });

  it('renders only what the server sent — an omitted section leaves no trace', () => {
    // The server omitted employee_relations entirely, because this caller may
    // not read it. The page must not invent a card, a zero or a placeholder.
    state.sections = [section()];
    renderSections();
    expect(screen.queryByTestId('card-360-employee_relations')).toBeNull();
    expect(screen.queryByTestId('card-360-onboarding')).toBeNull();
    const text = (screen.getByTestId('employee-360-sections').textContent ?? '');
    for (const forbidden of [/grievance/i, /succession/i, /payroll/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('names a failed section instead of showing it as empty', () => {
    state.sections = [section()];
    state.unavailableSections = ['leave'];
    renderSections();

    const banner = screen.getByTestId('banner-employee-360-unavailable');
    expect(banner).toHaveTextContent(/could not be loaded/i);
    expect(banner).toHaveTextContent(/leave/i);
    expect(banner).not.toHaveTextContent(/stack|at Object|Error:/i);
  });

  it('shows a neutral empty state that reveals nothing about which modules exist', () => {
    state.sections = [];
    state.unavailableSections = [];
    renderSections();
    const empty = screen.getByTestId('card-employee-360-empty');
    expect(empty).toHaveTextContent(/No additional module records are available/i);
    // Crucially it names no module at all.
    for (const forbidden of [/grievance/i, /leave/i, /succession/i, /skills/i]) {
      expect(empty.textContent ?? '').not.toMatch(forbidden);
    }
  });

  it('offers no write control — every affordance is a link', () => {
    state.sections = [section(), section({ key: 'onboarding', title: 'Onboarding', note: undefined, rows: [] })];
    const { container } = renderSections();
    // The only buttons are the "Open" links wrapped by wouter.
    const buttons = [...container.querySelectorAll('button')];
    for (const button of buttons) {
      expect(button.textContent ?? '').toMatch(/open/i);
    }
  });

  it('flags a truncated section rather than implying it is complete', () => {
    state.sections = [section({ truncated: true })];
    renderSections();
    expect(screen.getByTestId('truncated-360-skills')).toHaveTextContent(/most recent only/i);
  });
});
