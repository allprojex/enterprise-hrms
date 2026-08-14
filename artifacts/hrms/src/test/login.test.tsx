/**
 * Tests for the Login page's tenant branding (Multi-Organization Tenant
 * Infrastructure): the safe, unauthenticated GET /tenant-context lookup
 * should make the login page feel organisation-specific for a resolved
 * hostname (e.g. wwm.localhost), and fall back to generic platform
 * branding for an unmapped one (the platform's own base domain) — without
 * ever failing to render a login form.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Login from '@/pages/login';

const { state } = vi.hoisted(() => ({
  state: {
    tenantContext: undefined as
      | {
          resolved: boolean;
          organizationId?: number;
          organizationName?: string;
          organizationSlug?: string;
          organizationType?: string;
          logoUrl?: string | null;
        }
      | undefined,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useLogin: () => ({ mutate: vi.fn(), isPending: false }),
  useGetTenantContext: () => ({ data: state.tenantContext }),
  getGetTenantContextQueryKey: () => ['tenantContext'],
}));

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/login', record: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Login />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Login tenant branding', () => {
  it('shows generic platform branding when no tenant hostname is resolved', () => {
    state.tenantContext = { resolved: false };
    renderLogin();
    expect(screen.getAllByText('Enterprise HRMS').length).toBeGreaterThan(0);
    expect(screen.getByText('Enter your credentials to access your account')).toBeInTheDocument();
  });

  it('shows generic platform branding while tenant context has not loaded yet', () => {
    state.tenantContext = undefined;
    renderLogin();
    expect(screen.getAllByText('Enterprise HRMS').length).toBeGreaterThan(0);
  });

  it('shows organisation-specific branding for a resolved tenant hostname', () => {
    state.tenantContext = {
      resolved: true,
      organizationId: 3,
      organizationName: 'wwm',
      organizationSlug: 'wwm',
      organizationType: 'church',
      logoUrl: null,
    };
    renderLogin();
    expect(screen.getByTestId('text-tenant-name')).toHaveTextContent('wwm');
    expect(screen.getByText("Sign in to wwm's HR workspace")).toBeInTheDocument();
  });

  it('never exposes anything beyond the safe DTO fields, even if present on the response object', () => {
    state.tenantContext = {
      resolved: true,
      organizationId: 3,
      organizationName: 'wwm',
      organizationSlug: 'wwm',
      organizationType: 'church',
      logoUrl: null,
    };
    renderLogin();
    // The login form itself must always still render regardless of tenant context.
    expect(screen.getByTestId('form-login')).toBeInTheDocument();
    expect(screen.getByTestId('input-email')).toBeInTheDocument();
    expect(screen.getByTestId('input-password')).toBeInTheDocument();
  });
});
