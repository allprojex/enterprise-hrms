import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

/**
 * Indeterminate progress. Announced as a status; `animate-spin` collapses
 * under `prefers-reduced-motion` via the global rule, leaving a static mark.
 */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn('size-4 shrink-0 animate-spin text-foreground-muted', className)}
      {...props}
    />
  );
}

export { Spinner };
