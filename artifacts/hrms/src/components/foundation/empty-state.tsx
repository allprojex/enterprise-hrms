import * as React from 'react';
import { SearchX, Inbox } from 'lucide-react';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { cn } from '@/lib/utils';

/**
 * EmptyState / NoResultsState (WS-25A foundation).
 *
 * Wires the installed `ui/empty` primitive into two named states so pages
 * stop composing their own centred icon + text. Nothing here fabricates
 * data: the caller supplies the words and the action.
 */
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  /** `bordered` draws the dashed outline; `plain` sits inside an existing card. */
  variant?: 'bordered' | 'plain';
  size?: 'md' | 'sm';
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  variant = 'bordered',
  size = 'md',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Empty
      role="status"
      className={cn(
        variant === 'bordered' ? 'border border-dashed border-border-strong bg-surface' : 'border-0 bg-transparent',
        size === 'sm' ? 'gap-3 p-4 md:p-6' : 'gap-4 p-6 md:p-10',
        className,
      )}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-surface-muted text-foreground-muted">
          {icon ?? <Inbox aria-hidden="true" />}
        </EmptyMedia>
        <EmptyTitle className="text-card-title">{title}</EmptyTitle>
        {description && <EmptyDescription className="text-body-sm">{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export interface NoResultsStateProps extends Omit<EmptyStateProps, 'title' | 'icon'> {
  title?: React.ReactNode;
  /** The search term or filter summary, quoted in the description. */
  query?: string;
  onClear?: () => void;
}

export function NoResultsState({ title = 'No results', query, description, action, onClear, ...props }: NoResultsStateProps) {
  return (
    <EmptyState
      title={title}
      icon={<SearchX aria-hidden="true" />}
      description={
        description ??
        (query ? (
          <>
            Nothing matches <span className="font-medium text-foreground">“{query}”</span>. Try a different search or clear the filters.
          </>
        ) : (
          'Nothing matches the current filters.'
        ))
      }
      action={
        action ??
        (onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="text-body-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 rounded-sm"
          >
            Clear filters
          </button>
        ) : undefined)
      }
      {...props}
    />
  );
}
