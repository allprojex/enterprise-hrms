import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useListEmployees, getListEmployeesQueryKey, type Employee } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { employeeLabel } from '@/lib/employee-account';
import { cn } from '@/lib/utils';

/**
 * Reporting-manager picker: a server-side, debounced search over the
 * organisation's own directory (GET /organizations/:id/employees, which the
 * caller already holds employee.read for). Nothing new is fetched beyond a
 * single small page per search, so it works for a workforce of any size.
 *
 * What it will not offer: the employee being edited (the server rejects a
 * self-report), and separated employees (the server rejects a terminated
 * manager). Both exclusions are a courtesy; the API enforces them, together
 * with same-organisation and no-cycle rules, on every write.
 */

const PAGE_SIZE = 20;

export interface EmployeeManagerPickerProps {
  organizationId: number;
  /** Selected manager id as the form holds it ('' = none). */
  value: string;
  /** Name to show for a prefilled selection before the search has run. */
  valueLabel?: string | null;
  onChange: (next: { id: string; label: string }) => void;
  /** The record being edited, never offered as its own manager. */
  excludeEmployeeId?: number;
  disabled?: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function EmployeeManagerPicker({
  organizationId,
  value,
  valueLabel,
  onChange,
  excludeEmployeeId,
  disabled,
  id,
  ...aria
}: EmployeeManagerPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const params = useMemo(
    () => ({ search: debouncedSearch.trim() || undefined, page: 1, pageSize: PAGE_SIZE }),
    [debouncedSearch],
  );
  const { data, isLoading, isFetching, error, refetch } = useListEmployees(organizationId, params, {
    query: {
      queryKey: getListEmployeesQueryKey(organizationId, params),
      // Fetch only once the person opens the picker — a registration form
      // should not query the directory just by rendering.
      enabled: open && organizationId > 0,
      placeholderData: keepPreviousData,
    },
  });

  const candidates = (data?.items ?? []).filter(
    (e: Employee) => e.id !== excludeEmployeeId && e.employmentStatus !== 'terminated',
  );
  const total = data?.total ?? 0;
  const truncated = total > (data?.items?.length ?? 0);

  const selected = candidates.find((e) => String(e.id) === value);
  const display = selected ? employeeLabel(selected) : value ? valueLabel ?? 'Selected manager' : null;

  return (
    <div className="flex items-stretch gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={disabled}
            className="min-w-0 flex-1 justify-between font-normal"
            data-testid="select-reporting-manager"
            {...aria}
          >
            <span className={cn('truncate', !display && 'text-foreground-muted')}>
              {display ?? 'Search by name or staff number'}
            </span>
            <ChevronsUpDown aria-hidden="true" className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search employees…"
              value={search}
              onValueChange={setSearch}
              data-testid="input-reporting-manager-search"
            />
            <CommandList>
              {error ? (
                <div className="p-4 text-center text-body-sm" data-testid="state-reporting-manager-error">
                  <p className="text-foreground-muted">Could not load employees.</p>
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>
                    Try again
                  </Button>
                </div>
              ) : isLoading || (isFetching && candidates.length === 0) ? (
                <div
                  className="flex items-center justify-center gap-2 p-4 text-body-sm text-foreground-muted"
                  data-testid="state-reporting-manager-loading"
                >
                  <Spinner className="size-4" aria-hidden="true" />
                  Searching…
                </div>
              ) : (
                <>
                  <CommandEmpty>No active employee matches that name or staff number.</CommandEmpty>
                  <CommandGroup>
                    {candidates.map((employee) => (
                      <CommandItem
                        key={employee.id}
                        value={String(employee.id)}
                        onSelect={() => {
                          onChange({ id: String(employee.id), label: employeeLabel(employee) });
                          setOpen(false);
                        }}
                        data-testid={`option-reporting-manager-${employee.id}`}
                      >
                        <Check
                          aria-hidden="true"
                          className={cn('mr-2 size-4', String(employee.id) === value ? 'opacity-100' : 'opacity-0')}
                        />
                        <span className="flex-1 truncate">{employeeLabel(employee)}</span>
                        {employee.positionName && (
                          <span className="ml-2 shrink-0 text-helper text-foreground-muted">{employee.positionName}</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {truncated && (
                    <p className="px-3 py-2 text-helper text-foreground-muted">
                      Showing the first {data?.items?.length ?? 0} of {total}. Keep typing to narrow the list.
                    </p>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear reporting manager"
          onClick={() => onChange({ id: '', label: '' })}
          data-testid="button-clear-reporting-manager"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
