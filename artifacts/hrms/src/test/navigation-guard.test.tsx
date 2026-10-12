/**
 * NavigationGuard — unsaved-changes protection for every route transition.
 *
 * These tests use wouter's REAL browser-history location (not memoryLocation),
 * because that is what Production runs and what the guard has to intercept:
 * anchor clicks (sidebar / breadcrumbs), programmatic navigate() →
 * history.pushState, browser back/forward → popstate, and tab close →
 * beforeunload.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Router, Switch, useLocation, useSearch } from 'wouter';
import { NavigationGuard } from '@/components/navigation-guard';
import { releaseNavigationGuard } from '@/lib/navigation-guard-registry';

function EditPage({ dirty }: { dirty: boolean }) {
  const [, navigate] = useLocation();
  const search = useSearch();
  return (
    <div>
      <h1>Edit page</h1>
      <p data-testid="current-search">search:{search}</p>
      <Link href="/edit?tab=two" data-testid="query-link">
        Tab two
      </Link>
      <button type="button" onClick={() => navigate('/edit?tab=two')} data-testid="query-push">
        Tab two (push)
      </button>
      <button type="button" onClick={() => navigate('/edit?tab=two', { replace: true })} data-testid="query-replace">
        Tab two (replace)
      </button>
      <nav aria-label="Sidebar">
        <Link href="/elsewhere" data-testid="sidebar-link">
          Elsewhere
        </Link>
        <a href="#section-two" data-testid="hash-link">
          Section two
        </a>
        <a href="https://example.com/help" data-testid="external-link">
          Help
        </a>
      </nav>
      <button type="button" onClick={() => navigate('/elsewhere')} data-testid="programmatic">
        Go programmatically
      </button>
      <button
        type="button"
        onClick={() => {
          releaseNavigationGuard();
          navigate('/saved');
        }}
        data-testid="save-and-leave"
      >
        Save
      </button>
      <NavigationGuard when={dirty} />
    </div>
  );
}

function App({ dirty }: { dirty: boolean }) {
  return (
    <Router>
      <Switch>
        <Route path="/edit">{() => <EditPage dirty={dirty} />}</Route>
        <Route path="/elsewhere">{() => <h1>Elsewhere page</h1>}</Route>
        <Route path="/saved">{() => <h1>Saved page</h1>}</Route>
        <Route path="/start">{() => <h1>Start page</h1>}</Route>
      </Switch>
    </Router>
  );
}

const originalPushState = history.pushState;

beforeEach(() => {
  history.replaceState(null, '', '/edit');
});

afterEach(() => {
  cleanup();
  expect(history.pushState).toBe(originalPushState);
});

describe('NavigationGuard', () => {
  it('does nothing while the form is clean', async () => {
    render(<App dirty={false} />);
    await userEvent.setup().click(screen.getByTestId('sidebar-link'));
    expect(await screen.findByRole('heading', { name: 'Elsewhere page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/elsewhere');
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
  });

  it('holds a sidebar/breadcrumb link click while dirty; Keep editing stays, Leave page goes', async () => {
    render(<App dirty />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sidebar-link'));
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/edit');
    // The dialog marks the page aria-hidden, so query the heading text directly.
    expect(screen.getByText('Edit page')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument());
    expect(window.location.pathname).toBe('/edit');

    await user.click(screen.getByTestId('sidebar-link'));
    await user.click(await screen.findByRole('button', { name: 'Leave page' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/elsewhere');
  });

  it('holds programmatic navigation (history.pushState) while dirty', async () => {
    render(<App dirty />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('programmatic'));
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/edit');
    expect(screen.queryByRole('heading', { name: 'Elsewhere page' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere page' })).toBeInTheDocument();
  });

  it('holds browser Back while dirty, restoring the page, and goes back only on confirmation', async () => {
    history.replaceState(null, '', '/start');
    history.pushState(null, '', '/edit');
    render(<App dirty />);
    const user = userEvent.setup();

    await act(async () => {
      history.back();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/edit');
    // The dialog marks the page aria-hidden, so query the heading text directly.
    expect(screen.getByText('Edit page')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    expect(await screen.findByRole('heading', { name: 'Start page' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/start');
  });

  it('lets a successful save navigate without any warning', async () => {
    render(<App dirty />);
    await userEvent.setup().click(screen.getByTestId('save-and-leave'));
    expect(await screen.findByRole('heading', { name: 'Saved page' })).toBeInTheDocument();
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
  });

  it('asks the browser to confirm closing or reloading the tab only while dirty', () => {
    const { rerender } = render(<App dirty />);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender(<App dirty={false} />);
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it('never intercepts same-page anchors, external links or modifier clicks', async () => {
    render(<App dirty />);
    fireEvent.click(screen.getByTestId('hash-link'));
    fireEvent.click(screen.getByTestId('sidebar-link'), { ctrlKey: true });
    const external = screen.getByTestId('external-link');
    const outcome = fireEvent.click(external);
    expect(outcome).toBe(true); // not default-prevented by the guard
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
  });

  it('restores history.pushState and stops guarding once the form becomes clean', async () => {
    const { rerender } = render(<App dirty />);
    expect(history.pushState).not.toBe(originalPushState);
    rerender(<App dirty={false} />);
    expect(history.pushState).toBe(originalPushState);
    await userEvent.setup().click(screen.getByTestId('programmatic'));
    expect(await screen.findByRole('heading', { name: 'Elsewhere page' })).toBeInTheDocument();
  });
});

/** Let jsdom deliver an asynchronous history traversal's popstate. */
async function traverse(step: () => void) {
  await act(async () => {
    step();
    await new Promise((r) => setTimeout(r, 50));
  });
}

describe('NavigationGuard — query-string routes (Revision 3)', () => {
  it('holds a query-only pushState (?tab=…) while dirty, and performs it on Leave page', async () => {
    render(<App dirty />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('query-push'));
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(screen.getByTestId('current-search')).toHaveTextContent('search:');
    expect(screen.getByTestId('current-search')).not.toHaveTextContent('tab=two');

    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    await waitFor(() => expect(window.location.search).toBe('?tab=two'));
    expect(screen.getByTestId('current-search')).toHaveTextContent('search:tab=two');
  });

  it('holds a query-only replaceState, and Leave page replaces rather than pushes', async () => {
    render(<App dirty />);
    const user = userEvent.setup();
    const lengthBefore = history.length;

    await user.click(screen.getByTestId('query-replace'));
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.search).toBe('');

    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    await waitFor(() => expect(window.location.search).toBe('?tab=two'));
    expect(history.length).toBe(lengthBefore);
  });

  it('holds a query-only link click', async () => {
    render(<App dirty />);
    await userEvent.setup().click(screen.getByTestId('query-link'));
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('holds a query-only browser Back, restoring the current query, and goes back on confirmation', async () => {
    history.replaceState(null, '', '/edit?tab=one');
    history.pushState(null, '', '/edit?tab=two');
    render(<App dirty />);
    const user = userEvent.setup();

    await traverse(() => history.back());
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=two');
    expect(screen.getByTestId('current-search')).toHaveTextContent('search:tab=two');

    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    await waitFor(() => expect(window.location.search).toBe('?tab=one'));
  });

  it('holds a query-only browser Forward, restoring the current query, and goes forward on confirmation', async () => {
    history.replaceState(null, '', '/edit?tab=one');
    history.pushState(null, '', '/edit?tab=two');
    await traverse(() => history.back());
    expect(window.location.search).toBe('?tab=one');

    render(<App dirty />);
    const user = userEvent.setup();

    await traverse(() => history.forward());
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=one');
    expect(screen.getByTestId('current-search')).toHaveTextContent('search:tab=one');

    await user.click(screen.getByRole('button', { name: 'Leave page' }));
    await waitFor(() => expect(window.location.search).toBe('?tab=two'));
  });

  it('never prompts for hash-only section navigation, pushed or traversed with Back', async () => {
    render(<App dirty />);
    act(() => {
      history.pushState(null, '', '/edit#section-two');
    });
    expect(window.location.hash).toBe('#section-two');
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();

    await traverse(() => history.back());
    expect(window.location.hash).toBe('');
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
    expect(screen.getByText('Edit page')).toBeInTheDocument();
  });

  it('after an allowed hash-only Back, a further Back off the page is still held', async () => {
    history.replaceState(null, '', '/start');
    history.pushState(null, '', '/edit');
    render(<App dirty />);
    act(() => {
      history.pushState(null, '', '/edit#section-two');
    });
    await traverse(() => history.back()); // hash-only: allowed
    await traverse(() => history.back()); // to /start: held
    expect(await screen.findByTestId('dialog-unsaved-changes')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/edit');
  });

  it('lets query navigation through on a clean form', async () => {
    render(<App dirty={false} />);
    await userEvent.setup().click(screen.getByTestId('query-push'));
    await waitFor(() => expect(window.location.search).toBe('?tab=two'));
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();
  });
});

describe('NavigationGuard — ownership-safe History API cleanup (Revision 3)', () => {
  it('never overwrites a wrapper another component installed later; its own wrapper becomes inert', async () => {
    const { rerender } = render(<App dirty />);
    const guardWrapper = history.pushState;
    expect(guardWrapper).not.toBe(originalPushState);

    // Another component wraps pushState on top of the guard (e.g. analytics).
    const seen: string[] = [];
    const below = history.pushState;
    const thirdParty = function (this: History, ...args: Parameters<History['pushState']>) {
      seen.push(String(args[2]));
      return below.apply(this, args);
    };
    history.pushState = thirdParty;

    // The form becomes clean: the guard deactivates.
    rerender(<App dirty={false} />);

    // The later wrapper is still installed — not clobbered by the guard's cleanup.
    expect(history.pushState).toBe(thirdParty);
    // replaceState was not re-wrapped by anyone, so the guard restored it.
    expect(history.replaceState).not.toBe(guardWrapper);

    // Navigation flows through the third-party wrapper and the now-inert guard wrapper, unblocked.
    await userEvent.setup().click(screen.getByTestId('programmatic'));
    expect(await screen.findByRole('heading', { name: 'Elsewhere page' })).toBeInTheDocument();
    expect(seen).toContain('/elsewhere');
    expect(screen.queryByTestId('dialog-unsaved-changes')).not.toBeInTheDocument();

    // Test-owned teardown of the simulated third-party wrapper.
    history.pushState = originalPushState;
  });

  it('restores the original functions when its own wrappers are still on top', () => {
    const originalReplaceState = history.replaceState;
    const { rerender } = render(<App dirty />);
    expect(history.pushState).not.toBe(originalPushState);
    expect(history.replaceState).not.toBe(originalReplaceState);
    rerender(<App dirty={false} />);
    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
  });
});
