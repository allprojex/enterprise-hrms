import * as React from 'react';
import { CalendarHeart, History } from 'lucide-react';
import type { HrActivityItem, HrUpcomingHoliday } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/foundation';
import { formatShortDate, humanizeEventType, relativeDays } from '@/lib/hr-dashboard';

/** Recent HR Activity — HR-category audit events only, as returned (already redacted) by the server. */
export function RecentActivityCard({ items }: { items: HrActivityItem[] }) {
  return (
    <Card data-testid="card-recent-activity">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-foreground-muted" aria-hidden="true" />
          Recent HR Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState size="sm" variant="plain" title="No recent HR activity" />
        ) : (
          <ol className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 text-body-sm">
                <span className="min-w-0">
                  <span className="block text-foreground">{humanizeEventType(item.eventType)}</span>
                  {item.actorName && <span className="block text-helper text-foreground-muted">by {item.actorName}</span>}
                </span>
                <time dateTime={item.occurredAt} className="shrink-0 text-helper text-foreground-subtle">
                  {formatShortDate(item.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function UpcomingHolidaysCard({ items, now = new Date() }: { items: HrUpcomingHoliday[]; now?: Date }) {
  return (
    <Card data-testid="card-upcoming-holidays">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarHeart className="size-4 text-foreground-muted" aria-hidden="true" />
          Upcoming Public Holidays
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState size="sm" variant="plain" title="No public holidays in the next 60 days" />
        ) : (
          <ul className="space-y-3">
            {items.map((holiday) => (
              <li key={`${holiday.id}-${holiday.date}`} className="flex items-center justify-between gap-3 text-body-sm">
                <span className="min-w-0 truncate text-foreground">{holiday.name}</span>
                <span className="shrink-0 text-right text-helper text-foreground-muted">
                  <time dateTime={holiday.date}>{formatShortDate(holiday.date)}</time> · {relativeDays(holiday.date, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
