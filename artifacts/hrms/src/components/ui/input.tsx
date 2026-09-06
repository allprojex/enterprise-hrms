import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input (WS-25A foundation).
 *
 * Shares the control height scale with Button and Select (36px default),
 * sits on the surface colour with a hairline input border, and carries one
 * focus ring. Invalid state is driven by `aria-invalid` so forms can mark a
 * field without extra props; disabled uses the disabled tokens rather than
 * opacity so text stays legible.
 */
export const inputClassName =
  'flex h-control w-full min-w-0 rounded-md border border-input bg-surface px-3 py-1 text-body text-foreground shadow-xs motion-interactive ' +
  'placeholder:text-foreground-subtle hover:border-border-strong ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:border-input ' +
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger ' +
  'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground disabled:border-border ' +
  'read-only:bg-surface-muted ' +
  'file:mr-3 file:h-full file:border-0 file:bg-surface-muted file:px-3 file:text-body-sm file:font-medium file:text-foreground file:rounded-l-[calc(var(--radius)-1px)] ' +
  '[&[type=file]]:px-0 [&[type=file]]:py-0 [&[type=file]]:leading-[calc(var(--control-height)-2px)]';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputClassName, className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
