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

  // Contrast defect (Super Admin → Installations → "+ New Installation"):
  // tailwind-merge treated the type-scale utilities as text colours, so a
  // size="sm" primary button lost text-primary-foreground and rendered a dark
  // label/icon on the dark brand background. Every variant × size must keep
  // BOTH its foreground colour and its type-scale utility.
  it('keeps the variant foreground colour and the type-scale utility for every size', () => {
    const expectedForeground = {
      default: 'text-primary-foreground',
      destructive: 'text-danger-foreground',
      outline: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
    } as const;
    const sizes = ['default', 'sm', 'lg', 'icon', 'icon-sm', 'icon-lg'] as const;
    for (const [variant, foreground] of Object.entries(expectedForeground) as Array<[keyof typeof expectedForeground, string]>) {
      for (const size of sizes) {
        const { unmount } = render(
          <Button variant={variant} size={size} data-testid={`${variant}-${size}`}>
            x
          </Button>,
        );
        const cls = screen.getByTestId(`${variant}-${size}`).className.split(/\s+/);
        expect(cls, `${variant}/${size} foreground`).toContain(foreground);
        // The type-scale utility survives too: the sm size narrows to text-body-sm, every other size keeps text-button.
        expect(cls, `${variant}/${size} type scale`).toContain(size === 'sm' ? 'text-body-sm' : 'text-button');
        // Icons inherit currentColor, so the SVG must not be given its own colour.
        expect(cls.filter((c) => c.startsWith('[&_svg]:text-'))).toEqual([]);
        unmount();
      }
    }
  });

  it('a caller-supplied colour still wins over the variant foreground (className override remains possible)', () => {
    render(
      <Button size="sm" className="text-danger" data-testid="o">
        x
      </Button>,
    );
    const cls = screen.getByTestId('o').className.split(/\s+/);
    expect(cls).toContain('text-danger');
    expect(cls).not.toContain('text-primary-foreground');
    expect(cls).toContain('text-body-sm');
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
