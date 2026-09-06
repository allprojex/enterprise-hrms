/**
 * Component-level visual proof for WS-25A: the development-only showcase
 * mounts every foundation primitive in its states. If any primitive's
 * contract breaks, this page — and therefore this test — breaks with it.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DesignFoundationShowcase from '@/pages/dev/design-foundation';
import { ALL_TENANT_CSS_VARIABLES } from '@/lib/tenant-theme-tokens';

describe('Design foundation showcase (dev only)', () => {
  it('renders every section', () => {
    render(<DesignFoundationShowcase />);
    expect(screen.getByRole('heading', { level: 1, name: 'Design Foundation Showcase' })).toBeInTheDocument();
    for (const name of ['Tenant branding on top of the system', 'Typography', 'Buttons', 'Form controls', 'Cards and surfaces', 'Status badges', 'Table foundation', 'Tabs, dialog, menu, toast', 'Loading, empty and error states']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('never uses a hard-coded status colour or sub-12px text', () => {
    const { container } = render(<DesignFoundationShowcase />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/bg-(amber|green|blue|red|emerald|yellow)-(50|100)/);
    expect(html).not.toMatch(/text-\[1[01]px\]/);
  });

  it('switching the tenant sample applies and clears brand tokens on the document root only', async () => {
    render(<DesignFoundationShowcase />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--primary')).toBe('');

    await userEvent.click(screen.getByLabelText('WWM navy / gold'));
    expect(root.style.getPropertyValue('--primary')).toBe('220 55% 16%');
    expect(root.style.getPropertyValue('--primary-soft')).not.toBe('');
    // platform-owned semantic tokens untouched
    expect(root.style.getPropertyValue('--success')).toBe('');
    expect(root.style.getPropertyValue('--danger')).toBe('');

    await userEvent.click(screen.getByLabelText('Unreadable pair'));
    expect(root.style.getPropertyValue('--primary')).toBe('48 100% 50%');
    // white on yellow was clamped to a readable foreground
    expect(root.style.getPropertyValue('--primary-foreground')).not.toBe('0 0% 100%');

    await userEvent.click(screen.getByLabelText('Platform'));
    for (const cssVar of ALL_TENANT_CSS_VARIABLES) expect(root.style.getPropertyValue(cssVar)).toBe('');
  });

  it('table shows a selected row and status badges carry their text', () => {
    render(<DesignFoundationShowcase />);
    const table = screen.getAllByRole('table')[0];
    const rows = within(table).getAllByRole('row');
    expect(rows.some((r) => r.getAttribute('data-state') === 'selected')).toBe(true);
    expect(within(table).getByText('Suspended')).toHaveAttribute('data-tone', 'danger');
  });

  it('opens the dialog with focus management and closes on Escape', async () => {
    render(<DesignFoundationShowcase />);
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Suspend organization')).toBeInTheDocument();
    expect(dialog.className).toContain('motion-dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
