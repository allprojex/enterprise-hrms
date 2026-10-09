import * as React from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { MetricCard, type MetricCardProps } from '@/components/foundation';
import { cn } from '@/lib/utils';

/**
 * A MetricCard that opens its destination. The whole tile is one link (a
 * single, large touch target with a visible focus ring); without `href` it
 * renders as a plain metric so an unreachable destination is never offered.
 * Hash hrefs (e.g. "#my-hr-tasks") stay on the page.
 */
export interface DashboardMetricLinkProps extends Omit<MetricCardProps, 'size'> {
  href?: string | null;
  testId: string;
}

export function DashboardMetricLink({ href, testId, className, ...metric }: DashboardMetricLinkProps) {
  const card = (
    <MetricCard
      size="sm"
      data-testid={testId}
      className={cn('h-full', href && 'transition-colors group-hover:border-border-strong', className)}
      {...metric}
      supporting={
        href ? (
          <span className="inline-flex items-center gap-1">
            {metric.supporting}
            <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden="true" />
          </span>
        ) : (
          metric.supporting
        )
      }
    />
  );
  if (!href) return card;
  const linkClass =
    'group block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background';
  if (href.startsWith('#')) {
    return (
      <a href={href} className={linkClass} data-testid={`${testId}-link`}>
        {card}
      </a>
    );
  }
  return (
    <Link href={href} className={linkClass} data-testid={`${testId}-link`}>
      {card}
    </Link>
  );
}
