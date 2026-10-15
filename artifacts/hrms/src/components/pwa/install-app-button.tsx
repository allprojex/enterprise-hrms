/**
 * The discreet "Install app" control in the sidebar footer.
 *
 * Renders nothing unless this browser can actually install HRIS Plus
 * (lib/pwa-install.ts): Chromium only after `beforeinstallprompt` has fired,
 * Safari / Firefox Android / Samsung Internet with their manual steps. It is
 * hidden once the app is installed, inside the installed app itself, and
 * after "Don't show again". It never opens by itself.
 */
import { useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  detectManualInstallPlatform,
  getInstallPromptState,
  hideInstallOption,
  isInstallOptionHidden,
  isRunningStandalone,
  promptInstall,
  subscribeInstallPrompt,
  type ManualInstallPlatform,
} from '@/lib/pwa-install';

const INSTRUCTIONS: Record<ManualInstallPlatform, { title: string; steps: string[]; note?: string }> = {
  'ios-safari': {
    title: 'Add HRIS Plus to your Home Screen',
    steps: [
      'Tap the Share button (the square with an arrow pointing up) in Safari’s toolbar.',
      'Scroll down and tap “Add to Home Screen”.',
      'Check the name says HRIS Plus, then tap “Add”.',
    ],
    note: 'Open HRIS Plus from the new Home Screen icon. It opens full screen, without Safari’s address bar.',
  },
  'ios-other': {
    title: 'Add HRIS Plus to your Home Screen',
    steps: [
      'Open your browser’s Share menu (on iPhone and iPad this is usually the Share button or the ••• menu).',
      'Tap “Add to Home Screen”, then “Add”.',
    ],
    note: 'If “Add to Home Screen” is not listed, open this page in Safari and use Share → Add to Home Screen. Adding from other browsers needs iOS / iPadOS 16.4 or later.',
  },
  'macos-safari': {
    title: 'Add HRIS Plus to your Dock',
    steps: ['In the menu bar, choose File → “Add to Dock…”.', 'Check the name says HRIS Plus, then click “Add”.'],
    note: 'HRIS Plus then opens in its own window from the Dock or Launchpad.',
  },
  'firefox-android': {
    title: 'Install HRIS Plus',
    steps: ['Tap the ⋮ menu in Firefox.', 'Tap “Install” (or “Add to Home screen”), then confirm.'],
  },
  'samsung-internet': {
    title: 'Install HRIS Plus',
    steps: ['Tap the ≡ menu at the bottom of Samsung Internet.', 'Tap “Add page to”, then “Home screen”, then “Add”.'],
  },
};

const getServerSnapshot = () => getInstallPromptState();

export function InstallAppButton({ className }: { className?: string }) {
  const { deferredPrompt, installed } = useSyncExternalStore(subscribeInstallPrompt, getInstallPromptState, getServerSnapshot);
  const [hidden, setHidden] = useState(isInstallOptionHidden);
  const [open, setOpen] = useState(false);

  if (installed || hidden || isRunningStandalone()) return null;

  const manualPlatform = deferredPrompt
    ? null
    : detectManualInstallPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 });
  if (!deferredPrompt && !manualPlatform) return null;

  const instructions = manualPlatform ? INSTRUCTIONS[manualPlatform] : null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={className ?? 'w-full justify-start gap-2 text-muted-foreground'}
        data-testid="button-install-app"
        onClick={() => {
          if (deferredPrompt) void promptInstall();
          else setOpen(true);
        }}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        Install app
      </Button>

      {instructions && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent data-testid="dialog-install-instructions">
            <DialogHeader>
              <DialogTitle>{instructions.title}</DialogTitle>
              <DialogDescription>
                Installing adds an HRIS Plus icon to this device. You sign in and use it exactly as you do in the browser.
              </DialogDescription>
            </DialogHeader>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {instructions.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {instructions.note && <p className="text-sm text-muted-foreground">{instructions.note}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                data-testid="button-install-hide"
                onClick={() => {
                  hideInstallOption();
                  setHidden(true);
                  setOpen(false);
                }}
              >
                Don’t show again
              </Button>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
