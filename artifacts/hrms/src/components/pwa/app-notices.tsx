/**
 * Application-wide notices for the installed / installable app:
 *
 *   - OfflineNotice: shown while the browser reports no connection. Explains
 *     that HRIS Plus needs the internet and offers Retry. It shows nothing
 *     from any cache — data already on screen stays in memory only, exactly
 *     as before, and nothing is written to disk.
 *   - UpdateNotice: shown when a newer release has been deployed while this
 *     window was open (lib/app-update.ts). The person chooses when to refresh.
 *     Refresh waits for any in-flight save, and a form with unsaved changes
 *     still gets the navigation guard's own "leave page?" confirmation, so an
 *     update never silently discards work.
 *   - SignedOutElsewhereSync: when another window of this origin logs out (an
 *     installed app and a browser tab share one session), clear this window's
 *     in-memory data and return to the sign-in page.
 *
 * Mounted once in App.tsx, outside the router.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reloadToLatest, startUpdateWatcher } from '@/lib/app-update';
import { onSignedOutElsewhere, redirectToSignIn } from '@/lib/auth';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function useIsOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

// Back online, React Query's default refetchOnReconnect re-fetches what is on
// screen, so the notice itself only needs to come and go.
function OfflineNotice() {
  const online = useIsOnline();
  return online ? null : <OfflineNoticeCard />;
}

function OfflineNoticeCard() {
  const queryClient = useQueryClient();
  const [stillOffline, setStillOffline] = useState(false);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="notice-offline"
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
    >
      <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">You're offline</p>
        <p className="text-sm text-muted-foreground">
          HRIS Plus needs an internet connection. Changes can't be saved until you reconnect.
        </p>
        {stillOffline && (
          <p className="mt-1 text-sm text-muted-foreground">Still offline. Check your Wi-Fi or mobile data.</p>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="button-offline-retry"
        onClick={() => {
          if (navigator.onLine === false) {
            setStillOffline(true);
            return;
          }
          void queryClient.refetchQueries({ type: 'active' });
        }}
      >
        Retry
      </Button>
    </div>
  );
}

function UpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const savesInFlight = useIsMutating();

  useEffect(
    () =>
      startUpdateWatcher({
        onUpdateAvailable: () => {
          setAvailable(true);
          setDismissed(false);
        },
      }),
    [],
  );

  // Refresh only once nothing is being saved. If a form still has unsaved
  // changes, its navigation guard's beforeunload prompt asks first.
  useEffect(() => {
    if (refreshRequested && savesInFlight === 0) reloadToLatest();
  }, [refreshRequested, savesInFlight]);

  if (!available || dismissed) return null;

  const waiting = refreshRequested && savesInFlight > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="notice-update"
      className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
    >
      <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">A new version of HRIS Plus is available</p>
        <p className="text-sm text-muted-foreground">
          {waiting
            ? 'Finishing your current action, then refreshing…'
            : 'Save any work in progress, then refresh to get the latest version.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="button-update-refresh"
            disabled={waiting}
            onClick={() => setRefreshRequested(true)}
          >
            Refresh now
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="button-update-later"
            onClick={() => {
              setRefreshRequested(false);
              setDismissed(true);
            }}
          >
            Later
          </Button>
        </div>
      </div>
    </div>
  );
}

function SignedOutElsewhereSync() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onSignedOutElsewhere(() => {
        queryClient.clear();
        redirectToSignIn();
      }),
    [queryClient],
  );
  return null;
}

export function AppNotices() {
  return (
    <>
      <SignedOutElsewhereSync />
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-toast mx-auto flex w-full max-w-md flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        data-testid="app-notices"
      >
        <UpdateNotice />
        <OfflineNotice />
      </div>
    </>
  );
}
