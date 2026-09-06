import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Tabs (WS-25A foundation).
 *
 * Two looks from one primitive:
 *   line  (default)  — underline indicator on a hairline rule; the enterprise
 *                       navigation style for page sections.
 *   pill             — the previous segmented control, for compact toggles.
 * The indicator is a bottom border on the active trigger, transitioned with
 * the motion tokens, so no measuring or absolutely-positioned bar is needed.
 */
type TabsVariant = 'line' | 'pill';
const TabsVariantContext = React.createContext<TabsVariant>('line');

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = 'line', ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(
        variant === 'line'
          ? 'inline-flex h-10 w-full max-w-full items-end justify-start gap-1 overflow-x-auto border-b border-border text-muted-foreground'
          : 'inline-flex h-9 items-center justify-center rounded-md bg-surface-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap text-body font-medium motion-indicator ' +
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background ' +
          'disabled:pointer-events-none disabled:text-disabled-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        variant === 'line'
          ? '-mb-px h-10 rounded-t-sm border-b-2 border-transparent px-3 hover:text-foreground ' +
              'data-[state=active]:border-primary data-[state=active]:text-foreground'
          : 'h-7 rounded-sm px-3 hover:text-foreground ' +
              'data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
