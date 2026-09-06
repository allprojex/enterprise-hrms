import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Button (WS-25A foundation).
 *
 * One control height scale shared with inputs (sm 32 / md 36 / lg 40), one
 * focus treatment (2px focus ring, offset), explicit hover/press feedback on
 * every variant via the tokens (no pseudo-element overlay system), and a
 * `loading` state that keeps the button's width, disables interaction and
 * announces itself with `aria-busy`.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-button motion-interactive select-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
    'disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground disabled:border-transparent disabled:shadow-none ' +
    'aria-busy:pointer-events-none active:translate-y-px ' +
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-hover',
        destructive:
          'bg-danger text-danger-foreground shadow-xs hover:bg-danger/90 active:bg-danger/85',
        outline:
          'border border-border-strong bg-surface text-foreground shadow-xs hover:bg-surface-hover hover:border-border-strong active:bg-surface-sunken',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-surface-sunken active:bg-surface-sunken',
        ghost:
          'bg-transparent text-foreground hover:bg-surface-hover active:bg-surface-sunken',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline active:translate-y-0',
      },
      size: {
        default: 'h-control min-h-control px-4',
        sm: 'h-control-sm min-h-control-sm rounded-md px-3 text-body-sm font-medium',
        lg: 'h-control-lg min-h-control-lg rounded-md px-6',
        icon: 'size-control',
        'icon-sm': 'size-control-sm',
        'icon-lg': 'size-control-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Shows a spinner in place of the leading content, disables the control and
   * sets `aria-busy`. The visible label is kept so the button does not change
   * width and the accessible name stays stable.
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" data-testid="button-spinner" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

// eslint-disable-next-line react-refresh/only-export-components -- shadcn/ui convention colocates the variant helper with its component; splitting only affects HMR granularity, not runtime behavior.
export { Button, buttonVariants };
