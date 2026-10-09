import { useEffect, useState } from 'react';

/**
 * The value, settled.
 *
 * Returns `value` only once it has stopped changing for `delayMs`. Used to keep
 * a server-backed search from firing a request per keystroke while still
 * feeling immediate: the input stays fully controlled and responsive, and only
 * the query key lags behind it.
 *
 * The first value is returned immediately rather than after a delay, so an
 * initial render does not start with an empty search it will replace a moment
 * later.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);

  return settled;
}
