import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * PasswordInput (WS-25A foundation).
 *
 * The standard Input with a show/hide toggle. The toggle is a real button
 * (`aria-pressed`, `aria-label`), sits inside the control's height, and is
 * excluded from the tab order only when the field is disabled. The input
 * itself keeps every prop, so validation, refs and autocomplete behave as
 * they do for a plain `<Input type="password">`.
 */
export interface PasswordInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Initial visibility (default hidden). */
  defaultVisible?: boolean;
  showLabel?: string;
  hideLabel?: string;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, defaultVisible = false, showLabel = 'Show password', hideLabel = 'Hide password', disabled, ...props }, ref) => {
    const [visible, setVisible] = React.useState(defaultVisible);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-10', className)}
          disabled={disabled}
          autoComplete={props.autoComplete ?? 'current-password'}
          {...props}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? hideLabel : showLabel}
          disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          onClick={() => setVisible((v) => !v)}
          data-testid="password-visibility-toggle"
          className={cn(
            'absolute inset-y-0 right-0 my-auto mr-1 inline-flex size-7 items-center justify-center rounded-sm text-foreground-muted motion-interactive',
            'hover:bg-surface-hover hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            'disabled:pointer-events-none disabled:text-disabled-foreground',
          )}
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
