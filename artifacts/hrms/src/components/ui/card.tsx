import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Card / surface (WS-25A foundation).
 *
 * The default card is flat: a hairline border on the surface colour with no
 * shadow, so a page of cards reads as structured panels rather than floating
 * tiles. Intentional variants cover the other jobs a surface does:
 *
 *   standard     grouping (default)
 *   metric       dashboard KPI tile (pair with MetricCard)
 *   actionable   clickable / linkable panel — hover border, focus ring
 *   information  guidance, tinted info surface
 *   alert        attention — 3px semantic left rule on a soft tint (`tone`)
 *   summary      read-only summary on the muted surface, no border
 *   elevated     the only variant with a shadow — for floating content
 */
const cardVariants = cva('rounded-lg text-card-foreground', {
  variants: {
    variant: {
      standard: 'border border-border bg-surface',
      metric: 'border border-border bg-surface',
      actionable:
        'border border-border bg-surface motion-interactive hover:border-border-strong hover:shadow-xs ' +
        'focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 focus-within:ring-offset-background ' +
        'cursor-pointer',
      information: 'border border-info/20 bg-info-soft text-info-soft-foreground',
      alert: 'border border-border bg-surface border-l-[3px]',
      summary: 'border-0 bg-surface-muted',
      elevated: 'border border-border bg-surface-elevated shadow-md',
    },
    tone: {
      none: '',
      success: 'border-l-success bg-success-soft text-success-soft-foreground',
      warning: 'border-l-warning bg-warning-soft text-warning-soft-foreground',
      danger: 'border-l-danger bg-danger-soft text-danger-soft-foreground',
      info: 'border-l-info bg-info-soft text-info-soft-foreground',
    },
  },
  defaultVariants: {
    variant: 'standard',
    tone: 'none',
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, tone, ...props }, ref) => (
    <div
      ref={ref}
      data-variant={variant ?? 'standard'}
      className={cn(cardVariants({ variant, tone }), className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1 p-5 sm:p-6', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-card-title leading-snug', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-body-sm text-muted-foreground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-5 pt-0 sm:p-6 sm:pt-0', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
// eslint-disable-next-line react-refresh/only-export-components -- shadcn/ui convention colocates the variant helper with its component; splitting only affects HMR granularity, not runtime behavior.
export { cardVariants };
