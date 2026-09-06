import { cn } from '@/lib/utils';

/**
 * Skeleton placeholder: neutral surface pulse (never the brand colour), so a
 * loading page reads as structure rather than as highlighted content.
 * `animate-pulse` collapses under `prefers-reduced-motion` via the global rule.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}

export { Skeleton };
