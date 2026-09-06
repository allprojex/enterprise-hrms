import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * SearchInput (WS-25A foundation).
 *
 * `type="search"` Input with a leading icon and a clear button that appears
 * when there is a value. Controlled or uncontrolled; `onClear` fires after
 * the value is emptied so a page can reset its query state.
 */
export interface SearchInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  onClear?: () => void;
  clearLabel?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, value, defaultValue, onChange, onClear, clearLabel = 'Clear search', disabled, ...props }, ref) => {
    const isControlled = value !== undefined;
    const [inner, setInner] = React.useState<string>(String(defaultValue ?? ''));
    const current = isControlled ? String(value ?? '') : inner;
    const innerRef = React.useRef<HTMLInputElement | null>(null);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    const clear = () => {
      if (!isControlled) setInner('');
      const el = innerRef.current;
      if (el) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
      }
      onClear?.();
    };

    return (
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" aria-hidden="true" />
        <Input
          ref={setRefs}
          type="search"
          role="searchbox"
          value={isControlled ? value : inner}
          onChange={(e) => {
            if (!isControlled) setInner(e.target.value);
            onChange?.(e);
          }}
          disabled={disabled}
          className={cn('pl-9', current && 'pr-9', className)}
          {...props}
        />
        {current && !disabled && (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={clear}
            data-testid="search-clear"
            className="absolute inset-y-0 right-0 my-auto mr-1 inline-flex size-7 items-center justify-center rounded-sm text-foreground-muted motion-interactive hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  },
);
SearchInput.displayName = 'SearchInput';
