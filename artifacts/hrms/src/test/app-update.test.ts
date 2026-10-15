/**
 * Release detection for an already-open window (lib/app-update.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractEntryScript, fetchDeployedEntryScript, getRunningEntryScript, startUpdateWatcher } from '@/lib/app-update';

const deployedHtml = (hash: string) =>
  `<!DOCTYPE html><html><head><title>HRIS Plus</title>
   <script type="module" crossorigin src="/assets/index-${hash}.js"></script>
   <link rel="stylesheet" crossorigin href="/assets/index-${hash}.css">
   </head><body><div id="root"></div></body></html>`;

function htmlResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

function installRunningScript(hash: string | null) {
  document.querySelectorAll('script[data-test-entry]').forEach((s) => s.remove());
  if (!hash) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.setAttribute('src', `/assets/index-${hash}.js`);
  script.dataset.testEntry = '';
  document.head.appendChild(script);
}

describe('entry script detection', () => {
  it('extracts the hashed entry script from a production document', () => {
    expect(extractEntryScript(deployedHtml('AbC123'))).toBe('/assets/index-AbC123.js');
  });

  it('returns null for a development document', () => {
    expect(extractEntryScript('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
  });

  it('reads the running entry script from this document', () => {
    installRunningScript('Run111');
    expect(getRunningEntryScript()).toBe('/assets/index-Run111.js');
    installRunningScript(null);
    expect(getRunningEntryScript()).toBeNull();
  });

  it('fetches only the public document, uncached, and never /api', async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(deployedHtml('New222')));
    await expect(fetchDeployedEntryScript(fetchImpl as unknown as typeof fetch)).resolves.toBe('/assets/index-New222.js');
    expect(fetchImpl).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'no-store' }));
  });

  it('treats network failures and error responses as "unknown", not as an update', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(fetchDeployedEntryScript(failing as unknown as typeof fetch)).resolves.toBeNull();
    const erroring = vi.fn(async () => htmlResponse('Bad gateway', 502));
    await expect(fetchDeployedEntryScript(erroring as unknown as typeof fetch)).resolves.toBeNull();
  });
});

describe('startUpdateWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installRunningScript('Run111');
  });

  afterEach(() => {
    vi.useRealTimers();
    installRunningScript(null);
  });

  it('announces a newer deployment once, on the periodic check', async () => {
    const onUpdateAvailable = vi.fn();
    const fetchImpl = vi.fn(async () => htmlResponse(deployedHtml('New222')));
    const stop = startUpdateWatcher({ onUpdateAvailable, fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stays quiet while the deployed release matches the running one', async () => {
    const onUpdateAvailable = vi.fn();
    const fetchImpl = vi.fn(async () => htmlResponse(deployedHtml('Run111')));
    const stop = startUpdateWatcher({ onUpdateAvailable, fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchImpl).toHaveBeenCalled();
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    stop();
  });

  it('checks again when the window becomes visible', async () => {
    const onUpdateAvailable = vi.fn();
    const fetchImpl = vi.fn(async () => htmlResponse(deployedHtml('New222')));
    const stop = startUpdateWatcher({ onUpdateAvailable, fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 60_000 });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does nothing in development, where there is no hashed entry script', async () => {
    installRunningScript(null);
    const fetchImpl = vi.fn(async () => htmlResponse(deployedHtml('New222')));
    const stop = startUpdateWatcher({ onUpdateAvailable: vi.fn(), fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).not.toHaveBeenCalled();
    stop();
  });

  it('stops checking once stopped', async () => {
    const fetchImpl = vi.fn(async () => htmlResponse(deployedHtml('Run111')));
    const stop = startUpdateWatcher({ onUpdateAvailable: vi.fn(), fetchImpl: fetchImpl as unknown as typeof fetch, intervalMs: 1000 });
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
