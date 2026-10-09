/**
 * PWA installability and — more importantly — the service worker's cache
 * policy.
 *
 * The security requirement for this feature is that the HRMS must not become
 * an offline database: no employee or personnel record, no API response
 * carrying tenant business data, no authentication or session response, no
 * report, payroll, personnel file, leave, attendance, performance, inventory,
 * asset or audit data may ever be written to a cache.
 *
 * Asserting that by reading the worker's source would prove nothing. Instead
 * this file loads public/sw.js into a stubbed ServiceWorkerGlobalScope,
 * captures the listeners it registers, dispatches synthetic events at them and
 * inspects what actually reaches the Cache API. Every `cache.put` and
 * `cache.add` is recorded, so a future change that starts caching API traffic
 * fails here rather than in Production.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const HRMS_ROOT = path.resolve(__dirname, '..', '..');
const ORIGIN = 'https://hrms.example.test';

// ---------------------------------------------------------------- manifest --

describe('web app manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HRMS_ROOT, 'public', 'manifest.webmanifest'), 'utf8'),
  );

  it('carries the stable platform identity, not a tenant name', () => {
    expect(manifest.name).toBe('Enterprise HRMS');
    expect(manifest.short_name).toBe('HRMS');
    // A tenant name in the manifest would mean one installed app per customer.
    expect(JSON.stringify(manifest)).not.toMatch(/volta|meridian|worldwide|wwm/i);
  });

  it('declares the fields browsers require to offer installation', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('provides 192 and 512 icons for both any and maskable purposes', () => {
    const bySize = (size: string, purpose: string) =>
      manifest.icons.filter((i: { sizes: string; purpose: string }) => i.sizes === size && i.purpose === purpose);
    expect(bySize('192x192', 'any')).toHaveLength(1);
    expect(bySize('512x512', 'any')).toHaveLength(1);
    expect(bySize('192x192', 'maskable')).toHaveLength(1);
    expect(bySize('512x512', 'maskable')).toHaveLength(1);
  });

  it('every declared icon resolves to a real PNG on disk', () => {
    for (const icon of manifest.icons as { src: string; type: string }[]) {
      const file = path.join(HRMS_ROOT, 'public', icon.src.replace(/^\//, ''));
      expect(fs.existsSync(file), `${icon.src} is missing`).toBe(true);
      expect(icon.type).toBe('image/png');
      // PNG magic number — catches a renamed or truncated file.
      const header = fs.readFileSync(file).subarray(0, 8);
      expect([...header]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('is linked from the document together with the platform icons', () => {
    const html = fs.readFileSync(path.join(HRMS_ROOT, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('rel="apple-touch-icon"');
  });
});

// ---------------------------------------------------- service worker policy --

interface Recorded {
  puts: string[];
  adds: string[];
}

function loadServiceWorker() {
  const source = fs.readFileSync(path.join(HRMS_ROOT, 'public', 'sw.js'), 'utf8');
  const recorded: Recorded = { puts: [], adds: [] };
  const listeners: Record<string, (event: unknown) => void> = {};

  const cache = {
    put: vi.fn(async (request: Request | string) => {
      recorded.puts.push(typeof request === 'string' ? request : request.url);
    }),
    add: vi.fn(async (request: string) => {
      recorded.adds.push(request);
    }),
    match: vi.fn(async () => undefined),
  };

  const scope = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners[type] = handler;
    },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
    location: { origin: ORIGIN },
    caches: {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
      match: vi.fn(async () => undefined),
    },
    // A same-origin browser response reports type 'basic'; Node's Response
    // reports 'default', so the worker's own guard would reject it. The stub
    // models the browser, since that guard is exactly what is under test.
    fetch: vi.fn(async () => {
      const response = { status: 200, type: 'basic', clone: () => response };
      return response;
    }),
    console,
    URL,
    Request,
    Response,
    Promise,
    Error,
    Boolean,
    caches_recorded: recorded,
  };

  const context = vm.createContext({ ...scope, self: scope, globalThis: scope });
  vm.runInContext(source, context);
  return { listeners, recorded, cache, scope };
}

/** A synthetic FetchEvent that records whether the worker took over the response. */
function fetchEvent(url: string, init: { method?: string; mode?: string } = {}) {
  let responded = false;
  let responsePromise: Promise<Response> | undefined;
  return {
    event: {
      // A plain shape rather than a real Request: `mode` is getter-only on the
      // platform class, and the worker reads only these three fields.
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith(promise: Promise<Response>) {
        responded = true;
        responsePromise = promise;
      },
      waitUntil(promise: Promise<unknown>) {
        return promise;
      },
    },
    get responded() {
      return responded;
    },
    get responsePromise() {
      return responsePromise;
    },
  };
}

describe('service worker cache policy', () => {
  let sw: ReturnType<typeof loadServiceWorker>;

  beforeEach(() => {
    sw = loadServiceWorker();
  });

  it('registers install, activate and fetch handlers', () => {
    expect(typeof sw.listeners.install).toBe('function');
    expect(typeof sw.listeners.activate).toBe('function');
    // A fetch handler is what makes the app installable in Chrome and Edge.
    expect(typeof sw.listeners.fetch).toBe('function');
  });

  const API_PATHS = [
    '/api/auth/me',
    '/api/auth/login',
    '/api/organizations/71/employees',
    '/api/organizations/71/employees/463',
    '/api/organizations/71/reports/headcount/run',
    '/api/organizations/71/personnel-files',
    '/api/organizations/71/leave-requests',
    '/api/organizations/71/attendance/events',
    '/api/organizations/71/performance/cycles',
    '/api/organizations/71/office-inventory/items',
    '/api/organizations/71/assets',
    '/api/organizations/71/audit-events',
    '/api/organizations/71/payroll/payslips',
  ];

  it.each(API_PATHS)('never intercepts or caches %s', async (apiPath) => {
    const probe = fetchEvent(`${ORIGIN}${apiPath}`);
    sw.listeners.fetch(probe.event);
    // Not calling respondWith leaves the request entirely to normal networking.
    expect(probe.responded).toBe(false);
    expect(sw.recorded.puts).toHaveLength(0);
    expect(sw.recorded.adds).toHaveLength(0);
  });

  it('never intercepts an API navigation either', () => {
    const probe = fetchEvent(`${ORIGIN}/api/organizations/71/employees`, { mode: 'navigate' });
    sw.listeners.fetch(probe.event);
    expect(probe.responded).toBe(false);
    expect(sw.recorded.puts).toHaveLength(0);
  });

  it('ignores non-GET requests', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const probe = fetchEvent(`${ORIGIN}/`, { method });
      sw.listeners.fetch(probe.event);
      expect(probe.responded, `${method} was intercepted`).toBe(false);
    }
    expect(sw.recorded.puts).toHaveLength(0);
  });

  it('ignores cross-origin requests', () => {
    const probe = fetchEvent('https://somewhere-else.test/thing.js');
    sw.listeners.fetch(probe.event);
    expect(probe.responded).toBe(false);
    expect(sw.recorded.puts).toHaveLength(0);
  });

  it('serves navigations network-first and caches only the shell document', async () => {
    const probe = fetchEvent(`${ORIGIN}/dashboard`, { mode: 'navigate' });
    sw.listeners.fetch(probe.event);
    expect(probe.responded).toBe(true);
    await probe.responsePromise;
    // The only thing written is the shell, under a single stable key.
    expect(sw.recorded.puts).toEqual(['/']);
  });

  it('warms only the shell and installability assets on install', async () => {
    const waits: Promise<unknown>[] = [];
    sw.listeners.install({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    // Nothing tenant-scoped, nothing under /api.
    expect(sw.recorded.adds.some((entry) => entry.startsWith('/api'))).toBe(false);
    expect(sw.recorded.adds).toContain('/');
    expect(sw.recorded.adds).toContain('/manifest.webmanifest');
    for (const entry of sw.recorded.adds) {
      expect(entry === '/' || entry.startsWith('/icons/') || entry === '/manifest.webmanifest' || entry === '/favicon.svg').toBe(true);
    }
  });

  it('drops caches from previous releases on activate', async () => {
    const waits: Promise<unknown>[] = [];
    sw.scope.caches.keys = vi.fn(async () => ['hrms-shell-v0', 'hrms-shell-v1', 'something-else']);
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    const deleted = (sw.scope.caches.delete as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(deleted).toContain('hrms-shell-v0');
    expect(deleted).toContain('something-else');
    expect(deleted).not.toContain('hrms-shell-v1');
  });

  it('contains no runtime caching rule for API traffic', () => {
    const source = fs.readFileSync(path.join(HRMS_ROOT, 'public', 'sw.js'), 'utf8');
    // Belt-and-braces alongside the behavioural tests above: the worker must
    // not grow an API caching strategy without this failing.
    expect(source).not.toMatch(/cache\.(put|add)\s*\(\s*[^)]*\/api/);
  });
});

// ------------------------------------------------------------ registration --

describe('registerServiceWorker', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not register outside a secure context', async () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubGlobal('isSecureContext', false);
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    const { registerServiceWorker } = await import('@/lib/pwa');
    registerServiceWorker();
    window.dispatchEvent(new Event('load'));

    expect(register).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('registers at the application scope on a secure origin', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(window.navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    });

    const { registerServiceWorker } = await import('@/lib/pwa');
    registerServiceWorker();
    window.dispatchEvent(new Event('load'));

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });
});
