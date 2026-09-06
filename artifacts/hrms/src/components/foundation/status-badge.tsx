import * as React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toneForStatus, formatStatusLabel, type StatusTone } from '@/lib/status-tone';

/**
 * StatusBadge (WS-25A foundation).
 *
 * One mapping from the platform's status vocabulary to a semantic tone. Pages
 * that used to hand-roll `bg-amber-100`/`bg-green-100` classes or their own
 * status→variant switch render `<StatusBadge status={value} />` instead and
 * inherit the tokens. Unknown statuses fall back to neutral — never to a
 * colour that implies a meaning the platform did not assign.
 *
 * The visible text is always the status word itself (or `label`), so colour
 * is never the only carrier of meaning. The mapping lives in lib/status-tone.
 */
export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'children'> {
  status: string | null | undefined;
  /** Overrides the derived tone (for a domain whose vocabulary differs). */
  tone?: StatusTone;
  /** Overrides the visible text (default: formatted status). */
  label?: React.ReactNode;
  /** Shows the leading dot (default true). */
  dot?: boolean;
}

export function StatusBadge({ status, tone, label, dot = true, className, ...props }: StatusBadgeProps) {
  const resolvedTone = tone ?? toneForStatus(status);
  const text = label ?? (status ? formatStatusLabel(status) : 'Unknown');
  return (
    <Badge
      variant={resolvedTone}
      dot={dot}
      data-status={status ?? undefined}
      data-tone={resolvedTone}
      className={cn(className)}
      {...props}
    >
      {text}
    </Badge>
  );
}
