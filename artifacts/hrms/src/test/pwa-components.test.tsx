/**
 * PWA user-facing controls: the "Install app" button, the offline notice,
 * the update notice and cross-window sign-out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mutating = vi.hoisted(() => ({ count: 0 }));
const updateWatcher = vi.hoisted(() => ({ announce: null as null | (() => void) }));
const reloadToLatest = vi.hoisted(() => vi.fn());
const redirectToSignIn = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useIsMutating: () => mutating.count,
}));
vi.mock('@/lib/app-update', () => ({
  startUpdateWatcher: ({ onUpdateAvailable }: { onUpdateAvailable: () => void }) => {
    updateWatcher.announce = onUpdateAvailable;
    return () => {};
  },
  reloadToLatest,
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  redirectToSignIn,
}));

import { InstallAppButton } from '@/components/pwa/install-app-button';
import { AppNotices } from '@/components/pwa/app-notices';
import { __resetInstallPromptForTests, initInstallPromptCapture } from '@/lib/pwa-install';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

const originalUserAgent = navigator.userAgent;

function setBrowser(userAgent: string, maxTouchPoints = 0, standalone?: boolean) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  Object.defineProperty(window.navigator, 'standalone', { value: standalone, configurable: true });
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  __resetInstallPromptForTests();
  localStorage.clear();
  mutating.count = 0;
  updateWatcher.announce = null;
  reloadToLatest.mockReset();
  redirectToSignIn.mockReset();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  setBrowser(originalUserAgent, 0, undefined);
});

describe('InstallAppButton', () => {
  it('is not offered where the browser cannot install (Firefox desktop)', () => {
    setBrowser(UA.winFirefox);
    render(<InstallAppButton />);
    expect(screen.queryByTestId('button-install-app')).not.toBeInTheDocument();
  });

  it('is not offered by Chromium until the browser says the app is installable', () => {
    setBrowser(UA.winChrome);
    initInstallPromptCapture();
    render(<InstallAppButton />);
    expect(screen.queryByTestId('button-install-app')).not.toBeInTheDocument();
  });

  it('uses the browser prompt on Chromium once beforeinstallprompt has fired', async () => {
    setBrowser(UA.winChrome);
    initInstallPromptCapture();
    render(<InstallAppButton />);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    await userEvent.click(screen.getByTestId('button-install-app'));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // Accepted → installed → the control disappears.
    expect(screen.queryByTestId('button-install-app')).not.toBeInTheDocument();
  });

  it('shows Safari Add to Home Screen steps on iPhone instead of a prompt', async () => {
    setBrowser(UA.iphoneSafari, 5);
    render(<InstallAppButton />);
    await userEvent.click(screen.getByTestId('button-install-app'));
    const dialog = screen.getByTestId('dialog-install-instructions');
    expect(dialog).toHaveTextContent('Add HRIS Plus to your Home Screen');
    expect(dialog).toHaveTextContent('Add to Home Screen');
    expect(dialog).toHaveTextContent('Share');
  });

  it('is hidden inside the installed app', () => {
    setBrowser(UA.iphoneSafari, 5, true);
    render(<InstallAppButton />);
    expect(screen.queryByTestId('button-install-app')).not.toBeInTheDocument();
  });

  it('"Don’t show again" hides the option on this device', async () => {
    setBrowser(UA.iphoneSafari, 5);
    const { unmount } = render(<InstallAppButton />);
    await userEvent.click(screen.getByTestId('button-install-app'));
    await userEvent.click(screen.getByTestId('button-install-hide'));
    expect(screen.queryByTestId('button-install-app')).not.toBeInTheDocument();
    unmount();
    render(<InstallAppButton />);
    expect(screen.queryByTestId('button-install-app')).not.toBeInTheDocument();
  });
});

describe('AppNotices — offline', () => {
  it('explains the connection requirement while offline and disappears when back online', () => {
    renderWithQueryClient(<AppNotices />);
    expect(screen.queryByTestId('notice-offline')).not.toBeInTheDocument();
    act(() => setOnline(false));
    expect(screen.getByTestId('notice-offline')).toHaveTextContent('HRIS Plus needs an internet connection');
    expect(screen.getByTestId('button-offline-retry')).toBeInTheDocument();
    act(() => setOnline(true));
    expect(screen.queryByTestId('notice-offline')).not.toBeInTheDocument();
  });

  it('Retry while still offline says so instead of failing silently', async () => {
    renderWithQueryClient(<AppNotices />);
    act(() => setOnline(false));
    await userEvent.click(screen.getByTestId('button-offline-retry'));
    expect(screen.getByTestId('notice-offline')).toHaveTextContent('Still offline');
  });
});

describe('AppNotices — update available', () => {
  it('never reloads on its own; refreshes only when asked', async () => {
    renderWithQueryClient(<AppNotices />);
    expect(screen.queryByTestId('notice-update')).not.toBeInTheDocument();
    act(() => updateWatcher.announce?.());
    expect(screen.getByTestId('notice-update')).toHaveTextContent('A new version of HRIS Plus is available');
    expect(reloadToLatest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('button-update-refresh'));
    expect(reloadToLatest).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight save before refreshing', async () => {
    mutating.count = 1;
    const { queryClient, rerender } = renderWithQueryClient(<AppNotices />);
    act(() => updateWatcher.announce?.());
    await userEvent.click(screen.getByTestId('button-update-refresh'));
    expect(reloadToLatest).not.toHaveBeenCalled();
    expect(screen.getByTestId('notice-update')).toHaveTextContent('Finishing your current action');
    mutating.count = 0;
    rerender(
      <QueryClientProvider client={queryClient}>
        <AppNotices />
      </QueryClientProvider>,
    );
    expect(reloadToLatest).toHaveBeenCalledTimes(1);
  });

  it('"Later" dismisses the notice without refreshing', async () => {
    renderWithQueryClient(<AppNotices />);
    act(() => updateWatcher.announce?.());
    await userEvent.click(screen.getByTestId('button-update-later'));
    expect(screen.queryByTestId('notice-update')).not.toBeInTheDocument();
    expect(reloadToLatest).not.toHaveBeenCalled();
  });
});

describe('AppNotices — signed out in another window', () => {
  it('clears this window and returns to sign-in when another window logs out', () => {
    const { queryClient } = renderWithQueryClient(<AppNotices />);
    queryClient.setQueryData(['employee', 463], { firstName: 'Confidential' });
    // The other window removed the token; this window only hears the storage event.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'hrms_auth_token', oldValue: 'tok', newValue: null }));
    });
    expect(queryClient.getQueryData(['employee', 463])).toBeUndefined();
    expect(redirectToSignIn).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated storage changes and sign-ins', () => {
    renderWithQueryClient(<AppNotices />);
    localStorage.setItem('hrms_auth_token', 'still-signed-in');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'hrisplus.install.hidden', newValue: '1' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'hrms_auth_token', newValue: 'still-signed-in' }));
    });
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });
});
