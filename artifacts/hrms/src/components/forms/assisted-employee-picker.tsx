import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { Check, ChevronsUpDown, UserRoundX } from 'lucide-react';
import { useListEmployees, getListEmployeesQueryKey, type Employee } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import { employeeHasAccount, employeeLabel, NO_ACCOUNT_NOTICE } from '@/lib/employee-account';

/**
 * Employee picker for assisted form completion (S2 + B2).
 *
 * Two things this replaces. It used to pull the first 200 employees into the
 * browser and offer them in a plain select, which is a browsing experience, not
 * a search — unusable past a few hundred people. And it showed nothing about
 * whether the employee could actually act on the form afterwards.
 *
 * So: the query is server-side and debounced (the employees endpoint already
 * supports `search`; no new endpoint was added), a small page is fetched rather
 * than the workforce, and every row says whether that person has a login yet.
 *
 * An employee with no account is deliberately still SELECTABLE. Preparing a
 * form for someone who cannot reach the system is the reason this feature
 * exists — a new starter on day one is the textbook case. What changes is that
 * HR is told, before and at the point of confirming, that the employee will not
 * be able to review or sign until an account is linked. The workflow itself is
 * untouched: the stage resolves live, so the form completes normally the moment
 * the account exists.
 *
 * Tenant scoping is the server's: the list is fetched under the organization id
 * and the server filters by it. No id is ever typed in.
 */

const PAGE_SIZE = 20;

export interface AssistedEmployeePickerProps {
  organizationId: number;
  /** The selected employee, held by the parent so it survives search changes. */
  value: Employee | null;
  onChange: (employee: Employee) => void;
  disabled?: boolean;
  /** Fires the query only once the dialog that owns this picker is open. */
  enabled?: boolean;
}

export function AssistedEmployeePicker({ organizationId, value, onChange, disabled, enabled = true }: AssistedEmployeePickerProps) {
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
      enabled: enabled && organizationId > 0,
      // Keep the previous page visible while the next search settles, so the
      // list does not flash empty between keystrokes.
      placeholderData: keepPreviousData,
    },
  });

  const employees = data?.items ?? [];
  const total = data?.total ?? 0;
  const truncated = total > employees.length;

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Employee this form is for"
            disabled={disabled}
            className="w-full justify-between font-normal"
            data-testid="select-assisted-employee"
          >
            <span className={cn('truncate', !value && 'text-foreground-muted')}>
              {value ? employeeLabel(value) : 'Search by name or staff number'}
            </span>
            <ChevronsUpDown aria-hidden="true" className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          {/* Server-side search: cmdk must not also filter what came back. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search employees…"
              value={search}
              onValueChange={setSearch}
              data-testid="input-assisted-employee-search"
            />
            <CommandList>
              {error ? (
                <div className="p-4 text-center text-body-sm" data-testid="state-assisted-employee-error">
                  <p className="text-foreground-muted">Could not load employees.</p>
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => refetch()}>
                    Try again
                  </Button>
                </div>
              ) : isLoading || (isFetching && employees.length === 0) ? (
                <div
                  className="flex items-center justify-center gap-2 p-4 text-body-sm text-foreground-muted"
                  data-testid="state-assisted-employee-loading"
                >
                  <Spinner className="size-4" aria-hidden="true" />
                  Searching…
                </div>
              ) : (
                <>
                  <CommandEmpty data-testid="state-assisted-employee-empty">
                    No employee matches that name or staff number.
                  </CommandEmpty>
                  <CommandGroup>
                    {employees.map((employee: Employee) => {
                      const hasAccount = employeeHasAccount(employee);
                      return (
                        <CommandItem
                          key={employee.id}
                          value={String(employee.id)}
                          onSelect={() => {
                            onChange(employee);
                            setOpen(false);
                          }}
                          data-testid={`option-assisted-employee-${employee.id}`}
                        >
                          <Check
                            aria-hidden="true"
                            className={cn('mr-2 size-4', value?.id === employee.id ? 'opacity-100' : 'opacity-0')}
                          />
                          <span className="flex-1 truncate">{employeeLabel(employee)}</span>
                          {!hasAccount && (
                            <Badge variant="secondary" className="ml-2 shrink-0" data-testid={`badge-no-account-${employee.id}`}>
                              No account
                            </Badge>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  {truncated && (
                    <p className="px-3 py-2 text-helper text-foreground-muted" data-testid="text-assisted-employee-truncated">
                      Showing the first {employees.length} of {total}. Keep typing to narrow the list.
                    </p>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value && !employeeHasAccount(value) && (
        <p
          className="flex items-start gap-1.5 text-helper text-warning-soft-foreground"
          role="note"
          data-testid="text-assisted-employee-no-account"
        >
          <UserRoundX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{NO_ACCOUNT_NOTICE}</span>
        </p>
      )}
    </div>
  );
}
