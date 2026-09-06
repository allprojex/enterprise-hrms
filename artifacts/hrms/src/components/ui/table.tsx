import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Table foundation (WS-25A).
 *
 * Shared styling every table inherits without page edits: muted sticky-able
 * header, 13px cells, 44px comfortable rows (36px with `density="compact"`),
 * hover and selected states from the tokens, and a horizontal scroll
 * container that never lets the page itself overflow. Sorting, paging and
 * responsive column strategies are the DataTable's job in a later phase —
 * this file only fixes how any `<Table>` looks and behaves at rest.
 */
export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  density?: 'comfortable' | 'compact';
  /** Keeps the header row visible while the container scrolls. */
  stickyHeader?: boolean;
  /** Class applied to the scroll container. */
  containerClassName?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = 'comfortable', stickyHeader = false, containerClassName, ...props }, ref) => (
    <div
      className={cn('relative w-full overflow-x-auto overflow-y-visible', containerClassName)}
      data-slot="table-container"
    >
      <table
        ref={ref}
        data-density={density}
        data-sticky-header={stickyHeader || undefined}
        className={cn(
          'table-foundation w-full caption-bottom text-table',
          density === 'compact' && 'table-compact',
          stickyHeader && '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-raised',
          className,
        )}
        {...props}
      />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn('bg-surface-muted [&_tr]:border-b [&_tr]:border-border', className)}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-border bg-surface-muted font-medium [&>tr]:last:border-b-0',
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'h-[var(--table-row-height)] border-b border-border motion-interactive ' +
        'hover:bg-surface-hover ' +
        'data-[state=selected]:bg-primary-soft data-[state=selected]:shadow-[inset_2px_0_0_0_hsl(var(--primary))] ' +
        'aria-selected:bg-primary-soft ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
      className,
    )}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 whitespace-nowrap bg-surface-muted px-3 text-left align-middle text-table-head ' +
        '[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] ' +
        '[&[aria-sort]]:cursor-pointer [&[data-align=right]]:text-right [&[data-align=center]]:text-center',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric = false, ...props }, ref) => (
  <td
    ref={ref}
    data-numeric={numeric || undefined}
    className={cn(
      'px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      numeric && 'text-right tabular-nums',
      className,
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-3 text-helper text-muted-foreground', className)}
    {...props}
  />
));
TableCaption.displayName = 'TableCaption';

/** Trailing action cell: right-aligned, never wraps, keeps buttons compact. */
const TableActionCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('w-px whitespace-nowrap px-3 py-1 text-right align-middle [&>*]:inline-flex [&>*]:items-center [&>*]:justify-end [&>*]:gap-1', className)}
    {...props}
  />
));
TableActionCell.displayName = 'TableActionCell';

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableActionCell,
};
