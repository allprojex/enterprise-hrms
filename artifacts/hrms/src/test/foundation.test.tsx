import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  NoResultsState,
  PageContainer,
  PageHeader,
  PasswordInput,
  SearchInput,
  TableSkeleton,
} from '@/components/foundation';
import { QueryError } from '@/components/query-error';

describe('Card variants', () => {
  it('defaults to a flat bordered surface with no shadow', () => {
    render(<Card data-testid="c">x</Card>);
    const cls = screen.getByTestId('c').className;
    expect(screen.getByTestId('c')).toHaveAttribute('data-variant', 'standard');
    expect(cls).toContain('border');
    expect(cls).toContain('bg-surface');
    expect(cls).not.toMatch(/\bshadow(-\w+)?\b/);
    expect(cls).not.toContain('rounded-xl');
  });

  it('only the elevated variant carries a shadow; alert carries a semantic rule', () => {
    render(
      <>
        <Card variant="elevated" data-testid="e">x</Card>
        <Card variant="alert" tone="warning" data-testid="a">x</Card>
        <Card variant="summary" data-testid="s">x</Card>
        <Card variant="actionable" data-testid="act">x</Card>
        <Card variant="information" data-testid="i">x</Card>
      </>,
    );
    expect(screen.getByTestId('e').className).toContain('shadow-md');
    expect(screen.getByTestId('a').className).toContain('border-l-warning');
    expect(screen.getByTestId('a').className).toContain('bg-warning-soft');
    expect(screen.getByTestId('s').className).toContain('bg-surface-muted');
    expect(screen.getByTestId('act').className).toContain('cursor-pointer');
    expect(screen.getByTestId('i').className).toContain('bg-info-soft');
  });
});

describe('Badge tones', () => {
  it('exposes success / warning / danger / info / neutral soft variants', () => {
    render(
      <>
        <Badge variant="success" data-testid="s">a</Badge>
        <Badge variant="warning" data-testid="w">a</Badge>
        <Badge variant="danger" data-testid="d">a</Badge>
        <Badge variant="info" data-testid="i">a</Badge>
        <Badge variant="neutral" data-testid="n">a</Badge>
        <Badge dot data-testid="dot">a</Badge>
      </>,
    );
    expect(screen.getByTestId('s').className).toContain('bg-success-soft');
    expect(screen.getByTestId('w').className).toContain('bg-warning-soft');
    expect(screen.getByTestId('d').className).toContain('bg-danger-soft');
    expect(screen.getByTestId('i').className).toContain('bg-info-soft');
    expect(screen.getByTestId('n').className).toContain('bg-surface-muted');
    expect(screen.getByTestId('dot').querySelector('span[aria-hidden]')).not.toBeNull();
  });
});

describe('Input, Label', () => {
  it('uses the control height, surface and focus tokens; invalid state via aria-invalid', () => {
    render(<Input aria-invalid="true" data-testid="i" />);
    const cls = screen.getByTestId('i').className;
    expect(cls).toContain('h-control');
    expect(cls).toContain('bg-surface');
    expect(cls).toContain('focus-visible:ring-focus');
    expect(cls).toContain('aria-invalid:border-danger');
    expect(cls).not.toContain('disabled:opacity-50');
  });

  it('Label renders a required marker that is hidden from assistive tech', () => {
    render(
      <Label htmlFor="x" required>
        Email
      </Label>,
    );
    const label = screen.getByText('Email');
    const star = label.querySelector('[aria-hidden="true"]');
    expect(star?.textContent).toBe('*');
  });
});

describe('MetricCard', () => {
  it('renders label, value, supporting text and delta as given (no formatting)', () => {
    render(<MetricCard label="Employees" value="1,284" supporting="across 6 branches" delta={{ text: '+12', tone: 'success' }} />);
    expect(screen.getByText('Employees')).toBeInTheDocument();
    expect(screen.getByTestId('metric-card-value')).toHaveTextContent('1,284');
    expect(screen.getByText('across 6 branches')).toBeInTheDocument();
    expect(screen.getByText('+12')).toHaveAttribute('data-tone', 'success');
  });

  it('loading swaps the value for a skeleton of the same footprint', () => {
    render(<MetricCard label="Employees" value="1,284" loading />);
    expect(screen.getByTestId('metric-card-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-card-value')).toBeNull();
  });
});

describe('PageHeader / PageContainer', () => {
  it('renders one h1 page title with eyebrow, description and actions', () => {
    render(
      <PageContainer data-testid="pc">
        <PageHeader eyebrow="Administration" title="Organizations" description="Manage tenants." actions={<button>Create</button>} />
      </PageContainer>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Organizations' })).toHaveClass('text-title');
    expect(screen.getByText('Administration')).toHaveClass('text-overline');
    expect(screen.getByText('Manage tenants.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByTestId('pc').className).toContain('max-w-content');
  });

  it('narrow / form widths', () => {
    render(
      <>
        <PageContainer width="narrow" data-testid="n" />
        <PageContainer width="form" data-testid="f" />
      </>,
    );
    expect(screen.getByTestId('n').className).toContain('max-w-content-narrow');
    expect(screen.getByTestId('f').className).toContain('max-w-content-form');
  });
});

describe('Empty / error / loading states', () => {
  it('EmptyState is a status region with title, description and action', () => {
    render(<EmptyState title="No employees yet" description="Add one." action={<button>Add</button>} />);
    const region = screen.getByRole('status');
    expect(within(region).getByText('No employees yet')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('NoResultsState quotes the query and offers to clear', async () => {
    const onClear = vi.fn();
    render(<NoResultsState query="gloria" onClear={onClear} />);
    expect(screen.getByText('“gloria”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('ErrorState is an alert with retry; QueryError keeps its API on top of it', async () => {
    const onRetry = vi.fn();
    render(<QueryError title="Failed to load" message="Try again." onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Failed to load')).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState without retry renders no button', () => {
    render(<ErrorState />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('LoadingState announces once; TableSkeleton renders the requested grid, hidden from AT', () => {
    render(
      <>
        <LoadingState label="Loading employees" />
        <TableSkeleton columns={['A', 'B', 'C']} rows={4} data-testid="ts" />
      </>,
    );
    expect(screen.getByText('Loading employees')).toBeInTheDocument();
    const ts = screen.getByTestId('ts');
    expect(ts).toHaveAttribute('role', 'status');
    expect(ts.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(ts.querySelectorAll('thead th')).toHaveLength(3);
    for (const sk of ts.querySelectorAll('tbody [aria-hidden="true"]')) expect(sk.className).toContain('animate-pulse');
  });
});

describe('PasswordInput', () => {
  it('toggles visibility with an accessible pressed button and keeps the value', async () => {
    render(<PasswordInput aria-label="Password" defaultValue="secret" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const toggle = screen.getByTestId('password-visibility-toggle');
    expect(input.type).toBe('password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAccessibleName('Show password');
    await userEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(input.value).toBe('secret');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName('Hide password');
  });

  it('disabled removes the toggle from the tab order', () => {
    render(<PasswordInput aria-label="Password" disabled />);
    expect(screen.getByTestId('password-visibility-toggle')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('password-visibility-toggle')).toBeDisabled();
  });
});

describe('SearchInput', () => {
  it('shows a clear button only when there is a value, and clears it', async () => {
    const onClear = vi.fn();
    render(<SearchInput aria-label="Search" onClear={onClear} />);
    const input = screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement;
    expect(screen.queryByTestId('search-clear')).toBeNull();
    await userEvent.type(input, 'glo');
    expect(input.value).toBe('glo');
    await userEvent.click(screen.getByTestId('search-clear'));
    expect(input.value).toBe('');
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('search-clear')).toBeNull();
  });

  it('works controlled', async () => {
    const onChange = vi.fn();
    render(<SearchInput aria-label="Search" value="abc" onChange={onChange} />);
    expect(screen.getByTestId('search-clear')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'd');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('Table foundation', () => {
  it('applies density, sticky header and numeric alignment; selected rows use the brand soft tint', () => {
    render(
      <Table density="compact" stickyHeader data-testid="t">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead data-align="right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow data-state="selected" data-testid="row">
            <TableCell>Ama</TableCell>
            <TableCell numeric data-testid="num">
              12.5
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const t = screen.getByTestId('t');
    expect(t).toHaveAttribute('data-density', 'compact');
    expect(t.className).toContain('table-compact');
    expect(t.className).toContain('[&_thead_th]:sticky');
    expect(screen.getByTestId('num').className).toContain('tabular-nums');
    expect(screen.getByTestId('num').className).toContain('text-right');
    expect(screen.getByTestId('row').className).toContain('data-[state=selected]:bg-primary-soft');
    // the scroll container isolates horizontal overflow from the page
    expect(t.parentElement?.className).toContain('overflow-x-auto');
  });
});

describe('Tabs', () => {
  it('defaults to line tabs with an underline indicator and supports the pill variant', async () => {
    render(
      <>
        <Tabs defaultValue="a">
          <TabsList data-testid="line">
            <TabsTrigger value="a" data-testid="ta">
              A
            </TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Content A</TabsContent>
          <TabsContent value="b">Content B</TabsContent>
        </Tabs>
        <Tabs defaultValue="x">
          <TabsList variant="pill" data-testid="pill">
            <TabsTrigger value="x" data-testid="tx">
              X
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </>,
    );
    expect(screen.getByTestId('line')).toHaveAttribute('data-variant', 'line');
    expect(screen.getByTestId('ta').className).toContain('data-[state=active]:border-primary');
    expect(screen.getByTestId('pill')).toHaveAttribute('data-variant', 'pill');
    expect(screen.getByTestId('tx').className).toContain('data-[state=active]:bg-surface');
    // keyboard: arrow keys move between tabs (Radix) — content follows
    screen.getByTestId('ta').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('Content B')).toBeVisible();
  });
});
