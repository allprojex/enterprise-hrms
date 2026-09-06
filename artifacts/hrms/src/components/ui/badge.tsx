import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Badge (WS-25A foundation).
 *
 * Soft, low-contrast fills for status (`tone` variants) plus the four
 * shadcn variants existing pages already use. Text is the status carrier —
 * colour alone never is — so the badge always renders its children. For
 * system statuses prefer `StatusBadge` (components/foundation/status-badge)
 * which maps a status string onto a tone from one table.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-helper font-medium leading-4 motion-interactive ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
    '[&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-danger text-danger-foreground',
        outline: 'border-border-strong bg-transparent text-foreground',
        success: 'border-success/20 bg-success-soft text-success-soft-foreground',
        warning: 'border-warning/25 bg-warning-soft text-warning-soft-foreground',
        danger: 'border-danger/20 bg-danger-soft text-danger-soft-foreground',
        info: 'border-info/20 bg-info-soft text-info-soft-foreground',
        neutral: 'border-border bg-surface-muted text-foreground-muted',
        brand: 'border-primary/20 bg-primary-soft text-primary-soft-foreground',
        accent: 'border-accent/25 bg-accent-soft text-accent-soft-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Renders a small leading dot in the badge's current text colour. */
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- shadcn/ui convention colocates the variant helper with its component; splitting only affects HMR granularity, not runtime behavior.
export { Badge, badgeVariants };
