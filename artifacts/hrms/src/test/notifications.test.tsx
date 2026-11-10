/**
 * WS-6 — the notifications page's dismiss action and actionPath link, plus
 * P1a: keyset paging ("Load older" asks for rows before the oldest one
 * shown), and an unread figure that comes from the server's organization-
 * scoped count rather than from whatever pages happen to be loaded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Notifications from '@/pages/notifications';

const dismissMutate = vi.fn();
const markReadMutate = vi.fn();
const markAllMutate = vi.fn();
const listNotifications = vi.fn();
let unreadCount = 1;

vi.mock('@workspace/api-client-react', () => ({
  listNotifications: (...args: unknown[]) => listNotifications(...args),
  getListNotificationsQueryKey: () => ['/api/notifications'],
  useGetUnreadNotificationCount: () => ({ data: { unreadCount } }),
  getGetUnreadNotificationCountQueryKey: () => ['/api/notifications/unread-count'],
  useMarkNotificationRead: () => ({ mutate: markReadMutate, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: markAllMutate, isPending: false }),
  useDismissNotification: () => ({ mutate: dismissMutate, isPending: false }),
}));

const row = (id: number, read = false, actionPath: string | null = null) => ({
  id,
  title: `Notification ${id}`,
  message: `m${id}`,
  type: 'info',
  read,
  createdAt: new Date().toISOString(),
  actionPath,
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const { hook } = memoryLocation({ path: '/notifications' });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Notifications />
      </Router>
    </QueryClientProvider>,
  );
  return { queryClient, invalidate };
}

beforeEach(() => {
  dismissMutate.mockReset();
  markReadMutate.mockReset();
  markAllMutate.mockReset();
  listNotifications.mockReset();
  unreadCount = 1;
  listNotifications.mockResolvedValue([
    { ...row(1, false, '/documents'), title: 'Unread with action' },
    { ...row(2, true), title: 'Already read' },
  ]);
});

describe('Notifications page', () => {
  it('renders both notifications with their title and message', async () => {
    renderPage();
    expect(await screen.findByText('Unread with action')).toBeInTheDocument();
    expect(screen.getByText('Already read')).toBeInTheDocument();
  });

  it('shows an action link only for a notification with an actionPath', async () => {
    renderPage();
    expect(await screen.findByTestId('link-notification-action-1')).toHaveAttribute('href', '/documents');
    expect(screen.queryByTestId('link-notification-action-2')).not.toBeInTheDocument();
  });

  it('calls the dismiss mutation with the notification id when its dismiss button is clicked', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('button-dismiss-1'));
    await waitFor(() => {
      expect(dismissMutate).toHaveBeenCalledWith({ id: 1 }, expect.anything());
    });
  });

  it('only shows "Mark as read" for the unread notification', async () => {
    renderPage();
    expect(await screen.findByTestId('button-mark-read-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-mark-read-2')).not.toBeInTheDocument();
  });
});

describe('Notifications page — P1a paging and server count', () => {
  it('requests the first page with no cursor, and offers no "Load older" for a short page', async () => {
    renderPage();
    await screen.findByText('Unread with action');
    expect(listNotifications).toHaveBeenCalledTimes(1);
    expect(listNotifications.mock.calls[0][0]).toEqual({ limit: 50 });
    expect(screen.queryByTestId('button-load-older-notifications')).not.toBeInTheDocument();
  });

  it('a full page offers "Load older", which asks for rows before the oldest one shown and appends them', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => row(500 - i));
    listNotifications.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([row(7)]);
    renderPage();
    fireEvent.click(await screen.findByTestId('button-load-older-notifications'));

    expect(await screen.findByText('Notification 7')).toBeInTheDocument();
    expect(listNotifications.mock.calls[1][0]).toEqual({ limit: 50, before: 451 });
    expect(screen.getByText('Notification 500')).toBeInTheDocument();
    // The second page was short: nothing older remains.
    await waitFor(() => expect(screen.queryByTestId('button-load-older-notifications')).not.toBeInTheDocument());
  });

  it('shows the server-side unread count, not a count of the loaded rows', async () => {
    unreadCount = 73;
    renderPage();
    expect(await screen.findByText('You have 73 unread notifications')).toBeInTheDocument();
  });

  it('says "All caught up" and hides "Mark all as read" when the server count is zero', async () => {
    unreadCount = 0;
    renderPage();
    expect(await screen.findByText('All caught up!')).toBeInTheDocument();
    expect(screen.queryByTestId('button-mark-all-read')).not.toBeInTheDocument();
  });

  it('marking read updates the row in place and refreshes the unread count', async () => {
    const { invalidate } = renderPage();
    fireEvent.click(await screen.findByTestId('button-mark-read-1'));
    const [, handlers] = markReadMutate.mock.calls[0];
    handlers.onSuccess({ ...row(1, true, '/documents'), title: 'Unread with action' });

    await waitFor(() => expect(screen.queryByTestId('button-mark-read-1')).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/notifications/unread-count'] });
  });

  it('dismissing removes the row and refreshes the unread count', async () => {
    const { invalidate } = renderPage();
    fireEvent.click(await screen.findByTestId('button-dismiss-1'));
    const [, handlers] = dismissMutate.mock.calls[0];
    handlers.onSuccess();

    await waitFor(() => expect(screen.queryByText('Unread with action')).not.toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/notifications/unread-count'] });
  });

  it('dismissing a row on a full page keeps "Load older", whose cursor is still the oldest row fetched', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => row(500 - i));
    listNotifications.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([row(7)]);
    renderPage();
    fireEvent.click(await screen.findByTestId('button-dismiss-451'));
    const [, handlers] = dismissMutate.mock.calls[0];
    handlers.onSuccess();

    // The row leaves through an exit animation, which can outlast the default 1s under a loaded test run.
    await waitFor(() => expect(screen.queryByText('Notification 451')).not.toBeInTheDocument(), { timeout: 5000 });
    fireEvent.click(screen.getByTestId('button-load-older-notifications'));
    expect(await screen.findByText('Notification 7', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(listNotifications.mock.calls[1][0]).toEqual({ limit: 50, before: 451 });
  });

  it('mark all as read refreshes both the list and the unread count', async () => {
    const { invalidate } = renderPage();
    fireEvent.click(await screen.findByTestId('button-mark-all-read'));
    const [, handlers] = markAllMutate.mock.calls[0];
    handlers.onSuccess();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/notifications'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/notifications/unread-count'] });
  });
});
