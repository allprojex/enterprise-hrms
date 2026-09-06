/**
 * WS-25 Organization Branding — OrganizationLogo.
 *
 * The one guarantee that matters most is that the browser's broken-image
 * glyph never renders: a logoUrl whose binary is gone (the Production WWM
 * case) must fall back to initials on the same footprint, and a replacement
 * URL must be attempted again rather than inheriting the earlier failure.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrganizationLogo } from '@/components/foundation/organization-logo';
import { organizationInitials } from '@/lib/organization-initials';

describe('organizationInitials', () => {
  it('takes the first letter of the first and last word, upper-cased', () => {
    expect(organizationInitials('Worldwide Word Ministries')).toBe('WM');
    expect(organizationInitials('Acme')).toBe('A');
    expect(organizationInitials('  gloria   health  ')).toBe('GH');
  });

  it('ignores punctuation-only words and empty names', () => {
    expect(organizationInitials('St. Mary & Co.')).toBe('SC');
    expect(organizationInitials('')).toBe('');
    expect(organizationInitials(null)).toBe('');
    expect(organizationInitials('---')).toBe('');
  });
});

describe('OrganizationLogo', () => {
  it('renders the fitted image with an accessible name when the logo loads', () => {
    render(<OrganizationLogo logoUrl="/api/organizations/3/logo/abc.png" name="Acme" imgTestId="logo-img" />);
    const img = screen.getByTestId('logo-img');
    expect(img).toHaveAttribute('src', '/api/organizations/3/logo/abc.png');
    expect(img).toHaveAttribute('alt', 'Acme logo');
    expect(img).toHaveClass('object-contain');
    expect(img.parentElement).toHaveAttribute('data-logo-state', 'image');
  });

  it('falls back to initials — never a broken image — when the image fails to load', () => {
    render(
      <OrganizationLogo logoUrl="/api/organizations/3/logo/missing.png" name="Worldwide Word Ministries" imgTestId="logo-img" />,
    );
    fireEvent.error(screen.getByTestId('logo-img'));
    expect(screen.queryByTestId('logo-img')).not.toBeInTheDocument();
    const fallback = screen.getByRole('img', { name: 'Worldwide Word Ministries logo' });
    expect(fallback).toHaveAttribute('data-logo-state', 'initials');
    expect(fallback).toHaveTextContent('WM');
  });

  it('retries a new URL after a failure (a replaced logo is not stuck in the failed state)', () => {
    const { rerender } = render(
      <OrganizationLogo logoUrl="/api/organizations/3/logo/old.png" name="Acme" imgTestId="logo-img" />,
    );
    fireEvent.error(screen.getByTestId('logo-img'));
    expect(screen.queryByTestId('logo-img')).not.toBeInTheDocument();

    rerender(<OrganizationLogo logoUrl="/api/organizations/3/logo/new.png" name="Acme" imgTestId="logo-img" />);
    expect(screen.getByTestId('logo-img')).toHaveAttribute('src', '/api/organizations/3/logo/new.png');
  });

  it('shows initials with a role of img when there is no logo at all', () => {
    render(<OrganizationLogo logoUrl={null} name="Gloria Health" />);
    const fallback = screen.getByRole('img', { name: 'Gloria Health logo' });
    expect(fallback).toHaveAttribute('data-logo-state', 'initials');
    expect(fallback).toHaveTextContent('GH');
  });

  it('shows a neutral placeholder mark when neither logo nor name is known', () => {
    render(<OrganizationLogo logoUrl={undefined} />);
    const fallback = screen.getByRole('img', { name: 'Organization logo' });
    expect(fallback).toHaveAttribute('data-logo-state', 'placeholder');
    expect(fallback).toHaveTextContent('');
  });

  it('treats a blank URL as no logo', () => {
    render(<OrganizationLogo logoUrl="   " name="Acme" />);
    expect(screen.getByRole('img', { name: 'Acme logo' })).toHaveAttribute('data-logo-state', 'initials');
  });

  it('hides a decorative logo and its fallback from assistive technology', () => {
    const { rerender } = render(
      <OrganizationLogo logoUrl="/api/organizations/3/logo/abc.png" name="Acme" decorative imgTestId="logo-img" />,
    );
    expect(screen.getByTestId('logo-img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(<OrganizationLogo logoUrl={null} name="Acme" decorative />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-logo-state="initials"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the icon rather than unreadable initials at the smallest size', () => {
    render(<OrganizationLogo logoUrl={null} name="Acme" size="xs" />);
    expect(screen.getByRole('img', { name: 'Acme logo' })).toHaveAttribute('data-logo-state', 'placeholder');
  });
});
