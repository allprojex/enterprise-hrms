import * as React from 'react';
import { Link } from 'wouter';
import { CheckCircle2, ChevronRight, AlertTriangle } from 'lucide-react';
import type { HrTaskList } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeader, EmptyState, ErrorState, ListSkeleton, StatusBadge } from '@/components/foundation';
import { TASK_SOURCE_LABEL, employeeName, taskTiming } from '@/lib/hr-dashboard';
import { cn } from '@/lib/utils';

const COLLAPSED_COUNT = 6;

export interface MyHrTasksProps {
  tasks: HrTaskList | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  /** Whether the caller may open the Action Centre (the full queue). */
  canOpenActionCentre: boolean;
  /**
   * Responsibility-aware heading. The section shows the same thing to everyone
   * — work only THIS membership can act on — but calling an employee's own
   * tasks "HR tasks" told them they were something they are not. Defaults to
   * the HR wording so existing callers are unchanged.
   */
  heading?: string;
  now?: Date;
}

/**
 * My HR Tasks — only work the current membership can perform now, already
 * ordered by the server (overdue → due soon → undated oldest). Each row is one
 * link into the owning module, which re-authorizes on arrival.
 */
export function MyHrTasks({ tasks, isLoading, isError, onRetry, canOpenActionCentre, heading = "My HR Tasks", now = new Date() }: MyHrTasksProps) {
  const [expanded, setExpanded] = React.useState(false);

  let body: React.ReactNode;
  if (isLoading) {
    body = <ListSkeleton lines={4} className="p-4" />;
  } else if (isError) {
    body = <ErrorState size="sm" title="Tasks could not be loaded" message="Your tasks are temporarily unavailable." onRetry={onRetry} className="m-4" />;
  } else if (!tasks || tasks.items.length === 0) {
    body = (
      <EmptyState
        size="sm"
        variant="plain"
        icon={<CheckCircle2 aria-hidden="true" />}
        title="You're all caught up"
        description="Nothing currently needs your action."
        data-testid="my-hr-tasks-empty"
      />
    );
  } else {
    const visible = expanded ? tasks.items : tasks.items.slice(0, COLLAPSED_COUNT);
    body = (
      <>
        <ul className="divide-y divide-border" data-testid="my-hr-tasks-list">
          {visible.map((task) => {
            const timing = taskTiming(task, now);
            const name = employeeName(task);
            return (
              <li key={`${task.sourceModule}:${task.sourceType}:${task.sourceId}`}>
                <Link
                  href={task.deepLink}
                  className="group flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus sm:items-center"
                  data-testid={`task-${task.sourceModule}-${task.sourceId}`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-body-sm font-semibold text-foreground">{task.title}</span>
                      <Badge variant="neutral" className="text-xs">
                        {TASK_SOURCE_LABEL[task.sourceModule]}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-helper text-foreground-muted">
                      {name && <span className="font-medium text-foreground">{name}</span>}
                      {task.context && <span>{task.context}</span>}
                      <span
                        data-tone={timing.tone}
                        className={cn(timing.tone === 'danger' && 'font-medium text-danger', timing.tone === 'warning' && 'text-warning-soft-foreground')}
                      >
                        {timing.text}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={task.status} className="hidden sm:inline-flex" />
                    <ChevronRight className="size-4 text-foreground-subtle transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {(tasks.items.length > COLLAPSED_COUNT || tasks.total > tasks.items.length) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            {tasks.items.length > COLLAPSED_COUNT ? (
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-testid="button-toggle-tasks">
                {expanded ? 'Show fewer' : `Show all ${tasks.items.length}`}
              </Button>
            ) : (
              <span />
            )}
            {tasks.total > tasks.items.length && (
              <span className="text-helper text-foreground-muted" data-testid="text-tasks-truncated">
                Showing {tasks.items.length} of {tasks.total}
              </span>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <section id="my-hr-tasks" aria-labelledby="my-hr-tasks-heading" className="scroll-mt-20 space-y-3" data-testid="section-my-hr-tasks">
      <SectionHeader
        title={<span id="my-hr-tasks-heading">{heading}</span>}
        description="Work waiting on you, most urgent first"
        actions={
          canOpenActionCentre ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/action-centre" data-testid="link-action-centre">
                Action Centre
              </Link>
            </Button>
          ) : undefined
        }
      />
      {tasks && tasks.unavailableSources.length > 0 && (
        <p className="flex items-center gap-2 text-helper text-warning-soft-foreground" role="status" data-testid="text-tasks-unavailable">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Some task sources could not be loaded: {tasks.unavailableSources.map((s) => TASK_SOURCE_LABEL[s as keyof typeof TASK_SOURCE_LABEL] ?? s).join(', ')}
        </p>
      )}
      <Card className="overflow-hidden p-0">{body}</Card>
    </section>
  );
}
