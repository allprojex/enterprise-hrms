import * as React from 'react';
import * as ToastPrimitives from '@radix-ui/react-toast';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { X, CheckCircle2, AlertTriangle, AlertCircle, Info } from 'lucide-react';

/**
 * Toast (WS-25A foundation).
 *
 * Elevated surface with a semantic left rule and icon per variant, 180ms
 * enter / 120ms exit, bottom-right on desktop and top on small screens. The
 * existing `default` and `destructive` variants keep working for the 74
 * pages that call `toast()` today; `success`, `warning` and `info` are new.
 */
const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      'fixed top-0 z-toast flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border border-border border-l-[3px] bg-surface-elevated p-4 pr-10 text-foreground shadow-lg ' +
    'motion-toast data-[state=closed]:motion-exit ' +
    'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none ' +
    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out ' +
    'data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
  {
    variants: {
      variant: {
        default: 'border-l-primary',
        destructive: 'destructive border-l-danger',
        success: 'border-l-success',
        warning: 'border-l-warning',
        info: 'border-l-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const ICON_BY_VARIANT = {
  default: null,
  destructive: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
} as const;

const ICON_COLOR_BY_VARIANT = {
  default: '',
  destructive: 'text-danger',
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
} as const;

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
    VariantProps<typeof toastVariants>
>(({ className, variant, children, ...props }, ref) => {
  const key = (variant ?? 'default') as keyof typeof ICON_BY_VARIANT;
  const Icon = ICON_BY_VARIANT[key];
  return (
    <ToastPrimitives.Root
      ref={ref}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    >
      {Icon && <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_COLOR_BY_VARIANT[key])} aria-hidden="true" />}
      {children}
    </ToastPrimitives.Root>
  );
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      'inline-flex h-control-sm shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface px-3 text-body-sm font-medium motion-interactive ' +
        'hover:bg-surface-hover ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
        'disabled:pointer-events-none disabled:text-disabled-foreground ' +
        'group-[.destructive]:border-danger/30 group-[.destructive]:hover:bg-danger-soft',
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      'absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-foreground-muted motion-interactive ' +
        'hover:bg-surface-hover hover:text-foreground ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
      className,
    )}
    toast-close=""
    aria-label="Dismiss"
    {...props}
  >
    <X className="size-4" aria-hidden="true" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn('text-body font-semibold', className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn('text-body-sm text-muted-foreground', className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
