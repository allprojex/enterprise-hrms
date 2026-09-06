import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/foundation/status-badge';
import { toneForStatus, formatStatusLabel } from '@/lib/status-tone';

describe('toneForStatus', () => {
  it.each([
    ['Active', 'success'],
    ['approved', 'success'],
    ['Healthy', 'success'],
    ['Trial', 'warning'],
    ['pending', 'warning'],
    ['Warning', 'warning'],
    ['Suspended', 'danger'],
    ['Rejected', 'danger'],
    ['Revoked', 'danger'],
    ['Critical', 'danger'],
    ['Invited', 'info'],
    ['in_review', 'info'],
    ['Expired', 'neutral'],
    ['Draft', 'neutral'],
  ] as const)('%s → %s', (status, tone) => {
    expect(toneForStatus(status)).toBe(tone);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(toneForStatus('  ACTIVE ')).toBe('success');
  });

  it('falls back to neutral for unknown or missing statuses (never invents a meaning)', () => {
    expect(toneForStatus('something_new')).toBe('neutral');
    expect(toneForStatus(null)).toBe('neutral');
    expect(toneForStatus(undefined)).toBe('neutral');
    expect(toneForStatus('')).toBe('neutral');
  });
});

describe('formatStatusLabel', () => {
  it('turns snake/kebab case into a sentence-case label', () => {
    expect(formatStatusLabel('in_progress')).toBe('In progress');
    expect(formatStatusLabel('on-hold')).toBe('On hold');
    expect(formatStatusLabel('Active')).toBe('Active');
  });
});

describe('<StatusBadge>', () => {
  it('always renders the status text so colour is never the only carrier', () => {
    render(<StatusBadge status="suspended" />);
    const badge = screen.getByText('Suspended');
    expect(badge).toHaveAttribute('data-tone', 'danger');
    expect(badge).toHaveAttribute('data-status', 'suspended');
    expect(badge.className).toContain('bg-danger-soft');
  });

  it('honours an explicit tone and label', () => {
    render(<StatusBadge status="custom" tone="info" label="Awaiting review" />);
    const badge = screen.getByText('Awaiting review');
    expect(badge).toHaveAttribute('data-tone', 'info');
    expect(badge.className).toContain('bg-info-soft');
  });

  it('renders "Unknown" for a missing status', () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText('Unknown')).toHaveAttribute('data-tone', 'neutral');
  });

  it('uses semantic tokens only (no hard-coded Tailwind palette colours)', () => {
    render(<StatusBadge status="active" data-testid="b" />);
    const cls = screen.getByTestId('b').className;
    expect(cls).not.toMatch(/bg-(green|amber|red|blue|emerald|yellow)-\d/);
  });
});
