import { describe, it, expect } from 'vitest';
import { isModuleAccessible } from './module-access';
import type { OrganizationModule } from '@workspace/api-client-react';

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

describe('isModuleAccessible', () => {
  it('is accessible when explicitly enabled', () => {
    const modules = [mod({ key: 'recruitment', enabled: true })];
    expect(isModuleAccessible(modules, 'recruitment')).toBe(true);
  });

  it('is not accessible when explicitly disabled', () => {
    const modules = [mod({ key: 'recruitment', enabled: false })];
    expect(isModuleAccessible(modules, 'recruitment')).toBe(false);
  });

  it('reflects the server-resolved default-enabled state as-is', () => {
    // The org-modules list already resolves "no override -> defaultEnabled"
    // server-side (W4); the client trusts the returned `enabled` field.
    const modules = [mod({ key: 'recruitment', defaultEnabled: true, enabled: true })];
    expect(isModuleAccessible(modules, 'recruitment')).toBe(true);
  });

  it('is not accessible when an unknown module key is requested (fails closed)', () => {
    const modules = [mod({ key: 'recruitment', enabled: true })];
    expect(isModuleAccessible(modules, 'nonexistent')).toBe(false);
  });

  it('is not accessible when the module is enabled but a required module is not (transitive)', () => {
    const modules = [
      mod({ key: 'recruitment', enabled: true, requiredModuleKeys: ['employee_self_service'] }),
      mod({ key: 'employee_self_service', enabled: false }),
    ];
    expect(isModuleAccessible(modules, 'recruitment')).toBe(false);
  });

  it('is accessible when the module and its full required chain are enabled (multi-level transitive)', () => {
    const modules = [
      mod({ key: 'a', enabled: true, requiredModuleKeys: ['b'] }),
      mod({ key: 'b', enabled: true, requiredModuleKeys: ['c'] }),
      mod({ key: 'c', enabled: true }),
    ];
    expect(isModuleAccessible(modules, 'a')).toBe(true);
  });

  it('fails closed on a dependency cycle instead of treating it as satisfied', () => {
    const modules = [
      mod({ key: 'a', enabled: true, requiredModuleKeys: ['b'] }),
      mod({ key: 'b', enabled: true, requiredModuleKeys: ['a'] }),
    ];
    expect(isModuleAccessible(modules, 'a')).toBe(false);
    expect(isModuleAccessible(modules, 'b')).toBe(false);
  });
});
