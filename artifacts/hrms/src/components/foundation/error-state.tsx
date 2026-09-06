import * as React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * ErrorState (WS-25A foundation).
 *
 * The one error surface for failed loads and failed sections: danger-toned
 * card, live region, optional retry. `QueryError` (components/query-error)
 * keeps its API and now renders this.
 */
export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  message?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: React.ReactNode;
  action?: React.ReactNode;
  size?: 'md' | 'sm';
}

export function ErrorState({
  title = 'Failed to load',
  message = 'An error occurred while loading this data. Please try again.',
  onRetry,
  retryLabel = 'Retry',
  action,
  size = 'md',
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/20 bg-danger-soft text-center',
        size === 'sm' ? 'p-4' : 'p-8 sm:p-10',
        className,
      )}
      {...props}
    >
      <div className="grid size-10 place-content-center rounded-full bg-danger/10 text-danger">
        <AlertCircle className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="text-card-title text-danger-soft-foreground">{title}</p>
        {message && <p className="text-body-sm text-danger-soft-foreground/85">{message}</p>}
      </div>
      {(onRetry || action) && (
        <div className="flex items-center gap-2">
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
