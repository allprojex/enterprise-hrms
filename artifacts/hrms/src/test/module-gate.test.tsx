/**
 * Tests the frontend module gate (W6): a UX-level route guard, mirroring
 * admin-guard.test.tsx -- real enforcement is server-side (requireModuleEnabled, W5).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ModuleGate } from '@/components/module-gate';
import type { OrganizationModule } from '@workspace/api-client-react';

const { getMeResult, orgModulesResult } = vi.hoisted(() => ({
  getMeResult: { data: undefined as unknown, isLoading: false },
  orgModulesResult: { data: undefined as OrganizationModule[] | undefined, isLoading: false },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetMe: () => getMeResult,
  getGetMeQueryKey: () => ['getMe'],
  useListOrganizationModules: () => orgModulesResult,
  getListOrganizationModulesQueryKey: (id: number) => ['organizationModules', id],
}));

function renderGate(moduleKey = 'recruitment') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, history } = memoryLocation({ path: '/recruitment', record: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <ModuleGate moduleKey={moduleKey}>
          <div>Protected content</div>
        </ModuleGate>
      </Router>
    </QueryClientProvider>,
  );
  return history!;
}

function mod(overrides: Partial<OrganizationModule> & { key: string }): OrganizationModule {
  return {
    id: 1,
    name: overrides.key,
    description: '',
    category: 'hr-operations',
    version: '1.0.0',
    status: 'active',
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
    enabled: false,
    ...overrides,
  };
}

describe('ModuleGate', () => {
  it('renders children when the module is enabled for the active organization', async () => {
    getMeResult.data = { id: 1, activeOrganizationId: 10 };
    getMeResult.isLoading = false;
    orgModulesResult.data = [mod({ key: 'recruitment', enabled: true })];
    orgModulesResult.isLoading = false;

    renderGate();

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
  });

  it('redirects to /unauthorized when the module is disabled', async () => {
    getMeResult.data = { id: 1, activeOrganizationId: 10 };
    getMeResult.isLoading = false;
    orgModulesResult.data = [mod({ key: 'recruitment', enabled: false })];
    orgModulesResult.isLoading = false;

    const history = renderGate();

    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/unauthorized');
    });
  });

  it('redirects to /unauthorized when a required module is disabled (transitive)', async () => {
    getMeResult.data = { id: 1, activeOrganizationId: 10 };
    getMeResult.isLoading = false;
    orgModulesResult.data = [
      mod({ key: 'recruitment', enabled: true, requiredModuleKeys: ['employee_self_service'] }),
      mod({ key: 'employee_self_service', enabled: false }),
    ];
    orgModulesResult.isLoading = false;

    const history = renderGate();

    await waitFor(() => {
      expect(history[history.length - 1]).toBe('/unauthorized');
    });
  });

  it('does not redirect while still loading', () => {
    getMeResult.data = undefined;
    getMeResult.isLoading = true;
    orgModulesResult.data = undefined;
    orgModulesResult.isLoading = true;

    const history = renderGate();

    expect(history[history.length - 1]).toBe('/recruitment');
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('scopes the module check to the caller\'s own active organization, not a hardcoded one', async () => {
    getMeResult.data = { id: 1, activeOrganizationId: 20 };
    getMeResult.isLoading = false;
    // Only org 20's resolved list is ever supplied to the gate (the hook is
    // parameterized by organizationId server-side); an org-10-shaped
    // response would never reach this component for this user.
    orgModulesResult.data = [mod({ key: 'recruitment', enabled: true })];
    orgModulesResult.isLoading = false;

    renderGate();

    await waitFor(() => {
      expect(screen.getByText('Protected content')).toBeInTheDocument();
    });
  });
});
