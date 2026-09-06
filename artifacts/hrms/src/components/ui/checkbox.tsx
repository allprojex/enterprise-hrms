import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { cn } from '@/lib/utils';
import { Check, Minus } from 'lucide-react';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer grid size-4 shrink-0 place-content-center rounded-sm border border-border-strong bg-surface shadow-xs motion-interactive ' +
        'hover:border-primary ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled disabled:text-disabled-foreground ' +
        'aria-invalid:border-danger ' +
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground ' +
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
      {props.checked === 'indeterminate' ? (
        <Minus className="size-3" strokeWidth={3} aria-hidden="true" />
      ) : (
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
