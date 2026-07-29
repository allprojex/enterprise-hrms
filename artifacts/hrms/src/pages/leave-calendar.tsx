import { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  useGetMe,
  getGetMeQueryKey,
  useListDepartments,
  getListDepartmentsQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  useListLeaveCalendar,
  getListLeaveCalendarQueryKey,
  type LeaveCalendarEntry,
} from '@workspace/api-client-react';
import { QueryError } from '@/components/query-error';

const EMPTY = '__any__';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Local calendar-date components only — never routes through toISOString(),
// which converts via UTC and can silently shift the displayed date by a day
// depending on the browser's timezone offset.
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfCalendarGrid(cursor: Date): Date {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return start;
}

function buildGridDays(cursor: Date): Date[] {
  const start = startOfCalendarGrid(cursor);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function LeaveCalendar() {
  const { data: user } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const organizationId = user?.activeOrganizationId ?? user?.organizationId ?? 0;

  const [cursor, setCursor] = useState(() => new Date());
  const [departmentId, setDepartmentId] = useState(EMPTY);
  const [branchId, setBranchId] = useState(EMPTY);

  const { data: departments } = useListDepartments(organizationId, {
    query: { queryKey: getListDepartmentsQueryKey(organizationId), enabled: organizationId > 0 },
  });
  const { data: branches } = useListBranches(organizationId, {
    query: { queryKey: getListBranchesQueryKey(organizationId), enabled: organizationId > 0 },
  });

  const gridDays = buildGridDays(cursor);
  const from = formatLocalDate(gridDays[0]);
  const to = formatLocalDate(gridDays[gridDays.length - 1]);
  const params = {
    from,
    to,
    departmentId: departmentId === EMPTY ? undefined : Number(departmentId),
    branchId: branchId === EMPTY ? undefined : Number(branchId),
  };

  const {
    data: entries,
    isLoading,
    error,
    refetch,
  } = useListLeaveCalendar(organizationId, params, {
    query: { queryKey: getListLeaveCalendarQueryKey(organizationId, params), enabled: organizationId > 0 },
  });

  const entriesByDate = new Map<string, LeaveCalendarEntry[]>();
  for (const entry of entries ?? []) {
    for (const d of gridDays) {
      const dateStr = formatLocalDate(d);
      if (entry.startDate <= dateStr && entry.endDate >= dateStr) {
        const list = entriesByDate.get(dateStr) ?? [];
        list.push(entry);
        entriesByDate.set(dateStr, list);
      }
    }
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const currentMonth = cursor.getMonth();

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Leave Calendar</h1>
          <p className="text-muted-foreground">Approved leave only — pending and rejected requests never appear here</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-40" data-testid="select-calendar-department">
              <SelectValue placeholder="All departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY}>All departments</SelectItem>
              {(departments ?? []).map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-40" data-testid="select-calendar-branch">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY}>All branches</SelectItem>
              {(branches ?? []).map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{monthLabel}</CardTitle>
            <CardDescription>Month view</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label="Previous month"
              data-testid="button-calendar-prev-month"
              onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-calendar-today"
              onClick={() => setCursor(new Date())}
            >
              Today
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label="Next month"
              data-testid="button-calendar-next-month"
              onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <QueryError title="Could not load the leave calendar" onRetry={() => refetch()} />
          ) : isLoading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <div className="grid grid-cols-7 gap-px overflow-x-auto rounded-md border border-border bg-border text-sm">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">
                  {label}
                </div>
              ))}
              {gridDays.map((d) => {
                const dateStr = formatLocalDate(d);
                const dayEntries = entriesByDate.get(dateStr) ?? [];
                const inCurrentMonth = d.getMonth() === currentMonth;
                return (
                  <div
                    key={dateStr}
                    className={`min-h-24 space-y-1 bg-card p-1.5 ${inCurrentMonth ? '' : 'opacity-40'}`}
                    data-testid={`cell-calendar-day-${dateStr}`}
                  >
                    <p className="text-xs text-muted-foreground">{d.getDate()}</p>
                    {dayEntries.map((entry) => (
                      <div
                        key={`${entry.id}-${dateStr}`}
                        className="truncate rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                        title={`${entry.employeeName} — ${entry.leaveTypeName} (${entry.daysRequested} day(s))`}
                        data-testid={`chip-calendar-entry-${entry.id}`}
                      >
                        {entry.employeeName}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {!isLoading && !error && (entries ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <CalendarRange className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No approved leave in this range.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
