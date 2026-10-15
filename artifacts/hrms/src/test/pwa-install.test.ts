/**
 * Cross-browser install availability (lib/pwa-install.ts).
 *
 * The rule under test: offer an install only where the browser can perform
 * one. Chromium browsers rely solely on `beforeinstallprompt` (so they map to
 * null here — no manual instructions); Safari, Firefox for Android and
 * Samsung Internet get their manual steps; browsers that cannot install
 * (Firefox desktop, Safari < 17 on macOS) get nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetInstallPromptForTests,
  detectManualInstallPlatform,
  getInstallPromptState,
  initInstallPromptCapture,
  promptInstall,
  type ManualInstallPlatform,
} from '@/lib/pwa-install';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/129.0.2792.84 Mobile/15E148 Safari/605.1.15',
  ipadLegacyUa:
    'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ Safari and macOS Safari share this desktop UA.
  safariDesktopUa:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macSafari16:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macEdge:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
  macOpera:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  winOperaGx:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0 (Edition GX-CN)',
  linuxChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  androidOpera:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0',
  androidEdge:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 EdgA/129.0.0.0',
};

const cases: [string, string, number, ManualInstallPlatform | null][] = [
  ['iPhone Safari', UA.iphoneSafari, 5, 'ios-safari'],
  ['iPhone Chrome', UA.iphoneChrome, 5, 'ios-other'],
  ['iPhone Firefox', UA.iphoneFirefox, 5, 'ios-other'],
  ['iPhone Edge', UA.iphoneEdge, 5, 'ios-other'],
  ['iPad (legacy UA) Safari', UA.ipadLegacyUa, 5, 'ios-safari'],
  ['iPad (desktop-class UA) Safari', UA.safariDesktopUa, 5, 'ios-safari'],
  ['macOS Safari 18', UA.safariDesktopUa, 0, 'macos-safari'],
  ['macOS Safari 16 (cannot install)', UA.macSafari16, 0, null],
  ['macOS Chrome (prompt only)', UA.macChrome, 0, null],
  ['macOS Edge (prompt only)', UA.macEdge, 0, null],
  ['macOS Opera (prompt only)', UA.macOpera, 0, null],
  ['macOS Firefox (cannot install)', UA.macFirefox, 0, null],
  ['Windows Chrome (prompt only)', UA.winChrome, 0, null],
  ['Windows Edge (prompt only)', UA.winEdge, 0, null],
  ['Windows Opera GX (prompt only)', UA.winOperaGx, 0, null],
  ['Windows Firefox (cannot install)', UA.winFirefox, 0, null],
  ['Linux Chrome (prompt only)', UA.linuxChrome, 0, null],
  ['Linux Firefox (cannot install)', UA.linuxFirefox, 0, null],
  ['Android Chrome (prompt only)', UA.androidChrome, 5, null],
  ['Android Edge (prompt only)', UA.androidEdge, 5, null],
  ['Android Opera (prompt only)', UA.androidOpera, 5, null],
  ['Android Samsung Internet', UA.androidSamsung, 5, 'samsung-internet'],
  ['Android Firefox', UA.androidFirefox, 5, 'firefox-android'],
];

describe('detectManualInstallPlatform', () => {
  it.each(cases)('%s', (_name, userAgent, maxTouchPoints, expected) => {
    expect(detectManualInstallPlatform({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

describe('install prompt capture', () => {
  afterEach(() => {
    __resetInstallPromptForTests();
  });

  function fakePromptEvent(outcome: 'accepted' | 'dismissed') {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string; platform: string }>;
    };
    event.prompt = vi.fn(async () => {});
    event.userChoice = Promise.resolve({ outcome, platform: 'web' });
    return event;
  }

  it('captures the prompt and suppresses the browser mini-infobar', () => {
    initInstallPromptCapture();
    const event = fakePromptEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallPromptState().deferredPrompt).toBe(event);
  });

  it('uses a prompt once and records an accepted install', async () => {
    initInstallPromptCapture();
    const event = fakePromptEvent('accepted');
    window.dispatchEvent(event);
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallPromptState()).toEqual({ deferredPrompt: null, installed: true });
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('a dismissed prompt is cleared without marking the app installed', async () => {
    initInstallPromptCapture();
    window.dispatchEvent(fakePromptEvent('dismissed'));
    await expect(promptInstall()).resolves.toBe('dismissed');
    expect(getInstallPromptState()).toEqual({ deferredPrompt: null, installed: false });
  });

  it('appinstalled marks the app installed and drops any pending prompt', () => {
    initInstallPromptCapture();
    window.dispatchEvent(fakePromptEvent('accepted'));
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallPromptState()).toEqual({ deferredPrompt: null, installed: true });
  });
});
