import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[5rem] w-full rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground shadow-xs motion-interactive ' +
          'placeholder:text-foreground-subtle hover:border-border-strong ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
          'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger ' +
          'disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground read-only:bg-surface-muted',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
