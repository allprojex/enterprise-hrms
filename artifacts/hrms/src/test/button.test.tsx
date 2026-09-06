import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';

describe('<Button>', () => {
  it('renders every variant and size without the legacy elevate classes', () => {
    const variants = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const;
    const sizes = ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg'] as const;
    for (const variant of variants) {
      for (const size of sizes) {
        const { unmount } = render(
          <Button variant={variant} size={size} data-testid={`${variant}-${size}`}>
            x
          </Button>,
        );
        const cls = screen.getByTestId(`${variant}-${size}`).className;
        expect(cls).not.toMatch(/elevate/);
        expect(cls).toContain('focus-visible:ring-focus');
        unmount();
      }
    }
  });

  it('uses the shared control heights', () => {
    render(
      <>
        <Button data-testid="md">a</Button>
        <Button size="sm" data-testid="sm">
          a
        </Button>
        <Button size="lg" data-testid="lg">
          a
        </Button>
      </>,
    );
    expect(screen.getByTestId('md').className).toContain('h-control');
    expect(screen.getByTestId('sm').className).toContain('h-control-sm');
    expect(screen.getByTestId('lg').className).toContain('h-control-lg');
  });

  it('loading disables the control, announces aria-busy, shows a spinner and keeps the label', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
    await userEvent.click(btn).catch(() => undefined);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('not loading: no spinner, clickable', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    expect(screen.queryByTestId('button-spinner')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled uses the disabled tokens rather than opacity', () => {
    render(
      <Button disabled data-testid="d">
        x
      </Button>,
    );
    const cls = screen.getByTestId('d').className;
    expect(cls).toContain('disabled:bg-disabled');
    expect(cls).not.toContain('disabled:opacity-50');
  });

  it('asChild renders the child element with the button classes and never injects a spinner', () => {
    render(
      <Button asChild loading>
        <a href="/x">Link</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Link' });
    expect(link.className).toContain('inline-flex');
    expect(screen.queryByTestId('button-spinner')).toBeNull();
  });

  it('is keyboard operable', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Go' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
