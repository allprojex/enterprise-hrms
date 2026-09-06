import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * MetricCard (WS-25A foundation).
 *
 * The KPI tile: label above, value in the tabular KPI style, optional
 * supporting line and optional delta. Values are rendered exactly as given —
 * this component formats nothing and invents nothing. `loading` renders a
 * skeleton of the same footprint so a dashboard does not reflow.
 */
export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Secondary line under the value (e.g. "of 120 employees"). */
  supporting?: React.ReactNode;
  /** Change indicator. `tone` decides the colour; the text is yours. */
  delta?: { text: React.ReactNode; tone?: 'success' | 'danger' | 'neutral' };
  icon?: React.ReactNode;
  loading?: boolean;
  size?: 'md' | 'sm';
}

export function MetricCard({
  label,
  value,
  supporting,
  delta,
  icon,
  loading = false,
  size = 'md',
  className,
  ...props
}: MetricCardProps) {
  return (
    <Card variant="metric" className={cn('flex flex-col gap-2 p-5', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-label text-foreground-muted">{label}</span>
        {icon && (
          <span className="grid size-8 shrink-0 place-content-center rounded-md bg-surface-muted text-foreground-muted [&_svg]:size-4">
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className={cn(size === 'md' ? 'h-8 w-24' : 'h-6 w-16')} data-testid="metric-card-skeleton" />
      ) : (
        <span className={cn(size === 'md' ? 'text-kpi' : 'text-kpi-sm', 'text-foreground')} data-testid="metric-card-value">
          {value}
        </span>
      )}
      {(supporting || delta) && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {delta && (
            <span
              data-tone={delta.tone ?? 'neutral'}
              className={cn(
                'text-helper font-medium tabular-nums',
                delta.tone === 'success' && 'text-success',
                delta.tone === 'danger' && 'text-danger',
                (!delta.tone || delta.tone === 'neutral') && 'text-foreground-muted',
              )}
            >
              {delta.text}
            </span>
          )}
          {supporting && <span className="text-helper text-foreground-subtle">{supporting}</span>}
        </div>
      )}
    </Card>
  );
}
