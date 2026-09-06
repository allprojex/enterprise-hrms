'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const labelVariants = cva(
  'text-label text-foreground peer-disabled:cursor-not-allowed peer-disabled:text-disabled-foreground',
);

export interface LabelProps
  extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {
  /** Appends a visible required marker; pair with `aria-required` on the control. */
  required?: boolean;
}

const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required = false, children, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(labelVariants(), className)}
      {...props}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      )}
    </LabelPrimitive.Root>
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
