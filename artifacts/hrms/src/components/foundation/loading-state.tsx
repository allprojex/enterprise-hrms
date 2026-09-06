import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Loading foundations (WS-25A).
 *
 *   LoadingState      centred spinner + optional label (short waits, inline)
 *   TableSkeleton     skeleton rows matching a column count (table loads)
 *   ListSkeleton      stacked line skeletons (cards, lists, forms)
 *
 * Every skeleton is `aria-hidden`; the wrapper announces "Loading" once via
 * `role="status"`, so screen readers hear one message rather than a pulse.
 */
export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  size?: 'md' | 'sm';
}

export function LoadingState({ label = 'Loading…', size = 'md', className, ...props }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center justify-center gap-2 text-foreground-muted', size === 'sm' ? 'p-4' : 'p-10', className)}
      {...props}
    >
      <Spinner aria-hidden="true" role="presentation" aria-label={undefined} />
      <span className="text-body-sm">{label}</span>
    </div>
  );
}

export interface TableSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  columns: number | string[];
  rows?: number;
  density?: 'comfortable' | 'compact';
}

export function TableSkeleton({ columns, rows = 5, density = 'comfortable', className, ...props }: TableSkeletonProps) {
  const headers = typeof columns === 'number' ? Array.from({ length: columns }, () => null) : columns;
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className={cn(className)} {...props}>
      <Table density={density}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {headers.map((h, i) => (
              <TableHead key={i}>{h ?? <Skeleton className="h-3 w-20" />}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r} className="hover:bg-transparent">
              {headers.map((_, c) => (
                <TableCell key={c}>
                  <Skeleton className={cn('h-3.5', c === 0 ? 'w-40 max-w-full' : 'w-24 max-w-full')} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export interface ListSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function ListSkeleton({ lines = 3, className, ...props }: ListSkeletonProps) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className={cn('space-y-3', className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ))}
    </div>
  );
}
