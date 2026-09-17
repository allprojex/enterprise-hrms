import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmActionDialog } from '@/components/foundation';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Harness({ onConfirm, tone }: { onConfirm: () => unknown; tone?: 'destructive' | 'default' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Archive
      </button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive department?"
        description="“Finance” will be archived (marked inactive). Its historical records will be preserved."
        confirmLabel="Archive Department"
        tone={tone}
        onConfirm={onConfirm}
        testId="dialog-archive-department"
      />
    </>
  );
}

const dialog = () => screen.queryByTestId('dialog-archive-department');
const confirmButton = () => screen.getByTestId('dialog-archive-department-confirm');
const cancelButton = () => screen.getByTestId('dialog-archive-department-cancel');

describe('ConfirmActionDialog', () => {
  it('opens on the destructive click without running the action', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(dialog()).toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: 'Archive department?' })).toBeInTheDocument();
    expect(screen.getByText(/will be archived \(marked inactive\)/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog and runs nothing', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(cancelButton());

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirm runs the action exactly once and closes when it succeeds', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => Promise.resolve());
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(confirmButton());

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('a double click while processing cannot run the action twice, and the dialog cannot be dismissed mid-flight', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirm = vi.fn(() => pending.promise);
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await user.dblClick(confirmButton());
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toHaveAttribute('aria-busy', 'true');
    expect(cancelButton()).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(dialog()).toBeInTheDocument();

    pending.resolve();
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stays open and re-enables when the action fails, so nothing looks removed', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onConfirm = vi.fn(() => pending.promise);
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(confirmButton());

    pending.reject(new Error('Conflict'));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(dialog()).toBeInTheDocument();

    // A retry is a new, single attempt.
    onConfirm.mockImplementationOnce(() => Promise.resolve());
    await user.click(confirmButton());
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('a synchronous continue step (e.g. opening a follow-up form) closes immediately', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(confirmButton());

    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the wording it showed while open during the close animation, even though the caller clears its target', async () => {
    function ToggleHarness() {
      const [target, setTarget] = useState<{ name: string; active: boolean } | null>(null);
      const reactivating = target !== null && !target.active;
      return (
        <>
          <button type="button" onClick={() => setTarget({ name: 'Finance', active: false })}>
            Reactivate
          </button>
          <ConfirmActionDialog
            open={target !== null}
            onOpenChange={(o) => {
              if (!o) setTarget(null);
            }}
            title={reactivating ? 'Reactivate department?' : 'Archive department?'}
            description={`“${target?.name ?? ''}” will change status.`}
            confirmLabel={reactivating ? 'Reactivate Department' : 'Archive Department'}
            tone={reactivating ? 'default' : 'destructive'}
            onConfirm={vi.fn()}
            testId={reactivating ? 'dialog-reactivate-department' : 'dialog-archive-department'}
          />
        </>
      );
    }
    // Simulate CSS enter/exit animations so Radix keeps the content mounted
    // while it closes (jsdom has no CSS, so it would otherwise unmount at once).
    let animationName = 'enter';
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const real = realGetComputedStyle(el);
      return {
        get animationName() {
          return animationName;
        },
        display: real.display,
        visibility: real.visibility,
        getPropertyValue: (p: string) => real.getPropertyValue(p),
      } as unknown as CSSStyleDeclaration;
    });
    try {
      const user = userEvent.setup();
      render(<ToggleHarness />);
      await user.click(screen.getByRole('button', { name: 'Reactivate' }));
      expect(screen.getByTestId('dialog-reactivate-department')).toBeInTheDocument();

      animationName = 'exit';
      await user.click(screen.getByTestId('dialog-reactivate-department-cancel'));
      expect(screen.getByTestId('dialog-reactivate-department')).toBeInTheDocument();
      expect(screen.getByText('Reactivate department?')).toBeInTheDocument();
      expect(screen.queryByText('Archive department?')).not.toBeInTheDocument();
      expect(screen.getByText('“Finance” will change status.')).toBeInTheDocument();
      expect(screen.getByTestId('dialog-reactivate-department-confirm').className).toContain('bg-primary');
    } finally {
      spy.mockRestore();
    }
  });

  it('renders the confirm button with the destructive style by default and the default style for restorative actions', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness onConfirm={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(confirmButton().className).toContain('bg-danger');
    unmount();

    render(<Harness onConfirm={vi.fn()} tone="default" />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(confirmButton().className).toContain('bg-primary');
  });
});
