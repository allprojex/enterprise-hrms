import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * PageContainer (WS-25A foundation).
 *
 * Standard page padding and content width: 16px at <640, 24px to <1024,
 * 32px from 1024, centred at the content max width (1440px). `width`
 * narrows for reading/form pages. Vertical rhythm between page sections is
 * 32px (`space-y-8`) — matching what most pages already use.
 */
export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: 'default' | 'narrow' | 'form' | 'full';
}

export function PageContainer({ width = 'default', className, ...props }: PageContainerProps) {
  return (
    <div
      data-width={width}
      className={cn(
        'mx-auto w-full min-w-0 space-y-8 p-4 sm:p-6 lg:p-8',
        width === 'default' && 'max-w-content',
        width === 'narrow' && 'max-w-content-narrow',
        width === 'form' && 'max-w-content-form',
        className,
      )}
      {...props}
    />
  );
}
