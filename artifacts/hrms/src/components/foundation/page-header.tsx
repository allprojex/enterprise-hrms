import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageHeader (WS-25A foundation).
 *
 * The one page-title recipe: 22px/600 title, optional eyebrow (section or
 * organization context), optional description, and a right-aligned action
 * slot that wraps under the title on narrow screens. Replaces the eight
 * `<h1>` class recipes found across pages as they migrate.
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Slot rendered under the header (tabs, filters). */
  children?: React.ReactNode;
  /** Heading level for the title (default h1). */
  as?: 'h1' | 'h2';
}

export function PageHeader({ title, eyebrow, description, actions, children, as = 'h1', className, ...props }: PageHeaderProps) {
  const Heading = as;
  return (
    <header className={cn('flex flex-col gap-4', className)} {...props}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          {eyebrow && <div className="text-overline">{eyebrow}</div>}
          <Heading className="text-title text-foreground" data-testid="page-title">
            {title}
          </Heading>
          {description && <p className="max-w-prose text-body-sm text-foreground-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Section heading inside a page: 17px/600 with optional description + actions. */
export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: 'h2' | 'h3';
}

export function SectionHeader({ title, description, actions, as = 'h2', className, ...props }: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between', className)} {...props}>
      <div className="min-w-0 space-y-0.5">
        <Heading className="text-section text-foreground">{title}</Heading>
        {description && <p className="text-body-sm text-foreground-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
