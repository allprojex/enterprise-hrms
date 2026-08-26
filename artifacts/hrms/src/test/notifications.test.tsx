/**
 * WS-6 — the notifications page's new dismiss action and actionPath link,
 * layered onto the pre-existing list/mark-read/mark-all-read behavior.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import Notifications from '@/pages/notifications';

const dismissMutate = vi.fn();
const markReadMutate = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useListNotifications: () => ({
    data: [
      { id: 1, title: 'Unread with action', message: 'm1', type: 'info', read: false, createdAt: new Date().toISOString(), actionPath: '/documents' },
      { id: 2, title: 'Already read', message: 'm2', type: 'success', read: true, createdAt: new Date().toISOString(), actionPath: null },
    ],
    isLoading: false,
  }),
  getListNotificationsQueryKey: () => ['notifications'],
  useMarkNotificationRead: () => ({ mutate: markReadMutate, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useDismissNotification: () => ({ mutate: dismissMutate, isPending: false }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: '/notifications' });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Notifications />
      </Router>
    </QueryClientProvider>,
  );
}

describe('Notifications page', () => {
  it('renders both notifications with their title and message', () => {
    renderPage();
    expect(screen.getByText('Unread with action')).toBeInTheDocument();
    expect(screen.getByText('Already read')).toBeInTheDocument();
  });

  it('shows an action link only for a notification with an actionPath', () => {
    renderPage();
    expect(screen.getByTestId('link-notification-action-1')).toHaveAttribute('href', '/documents');
    expect(screen.queryByTestId('link-notification-action-2')).not.toBeInTheDocument();
  });

  it('calls the dismiss mutation with the notification id when its dismiss button is clicked', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('button-dismiss-1'));
    await waitFor(() => {
      expect(dismissMutate).toHaveBeenCalledWith({ id: 1 }, expect.anything());
    });
  });

  it('only shows "Mark as read" for the unread notification', () => {
    renderPage();
    expect(screen.getByTestId('button-mark-read-1')).toBeInTheDocument();
    expect(screen.queryByTestId('button-mark-read-2')).not.toBeInTheDocument();
  });
});
