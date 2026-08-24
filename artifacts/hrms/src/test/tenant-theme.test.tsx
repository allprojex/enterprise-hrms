/**
 * Tests for TenantTheme (WWM Presentation Readiness): the current tenant's
 * own theme tokens (if any) become CSS custom property overrides on the
 * document root, and are always cleared first so one organization's colors
 * can never persist onto another's render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TenantTheme } from '@/components/tenant-theme';

const { state } = vi.hoisted(() => ({
  state: {
    tenantContext: undefined as
      | { resolved: boolean; theme?: Record<string, string> | null }
      | undefined,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetTenantContext: () => ({ data: state.tenantContext }),
  getGetTenantContextQueryKey: () => ['tenantContext'],
}));

function renderTenantTheme() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TenantTheme />
    </QueryClientProvider>,
  );
}

describe('TenantTheme', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('leaves every CSS variable untouched when the organization has not configured a theme', () => {
    state.tenantContext = { resolved: true, theme: null };
    renderTenantTheme();
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });

  it('leaves every CSS variable untouched for an unresolved tenant', () => {
    state.tenantContext = { resolved: false };
    renderTenantTheme();
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('');
  });

  it("applies WWM's own theme tokens onto the matching CSS custom properties", () => {
    state.tenantContext = {
      resolved: true,
      theme: { sidebar: '217 45% 17%', sidebarForeground: '210 20% 96%', accent: '38 65% 50%' },
    };
    renderTenantTheme();
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('217 45% 17%');
    expect(document.documentElement.style.getPropertyValue('--sidebar-foreground')).toBe('210 20% 96%');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('38 65% 50%');
    // Not configured — untouched.
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });

  it("never lets a previous tenant's theme persist onto a differently-resolved render", () => {
    state.tenantContext = { resolved: true, theme: { sidebar: '217 45% 17%' } };
    const { rerender } = renderTenantTheme();
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('217 45% 17%');

    state.tenantContext = { resolved: true, theme: null };
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TenantTheme />
      </QueryClientProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--sidebar')).toBe('');
  });
});
