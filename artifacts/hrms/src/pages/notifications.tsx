import { useState } from 'react';
import { Link } from 'wouter';
import { Bell, CheckCheck, Loader2, Info, CheckCircle, AlertTriangle, AlertCircle, X, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  listNotifications,
  getListNotificationsQueryKey,
  useGetUnreadNotificationCount,
  getGetUnreadNotificationCountQueryKey,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useDismissNotification,
} from '@workspace/api-client-react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import type { Notification } from '@workspace/api-client-react';

/** Page size for the notification centre; the server caps any request at 100. */
const NOTIFICATION_PAGE_SIZE = 50;

/**
 * The centre's own cache entry: pages of the active organization's
 * notifications, newest first. Under the list's key prefix, so anything that
 * invalidates notifications refreshes it too.
 */
const notificationCentreQueryKey = () => [...getListNotificationsQueryKey(), 'centre'] as const;

type Pages = InfiniteData<Notification[], number | undefined>;

export default function Notifications() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: notificationCentreQueryKey(),
    queryFn: ({ pageParam, signal }) =>
      listNotifications({ limit: NOTIFICATION_PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) }, { signal }),
    initialPageParam: undefined as number | undefined,
    // Keyset paging: the next page starts after the oldest row already shown.
    // A short page means there is nothing older.
    getNextPageParam: (lastPage) =>
      lastPage.length < NOTIFICATION_PAGE_SIZE ? undefined : lastPage[lastPage.length - 1].id,
  });
  // A dismissed row is hidden here rather than removed from the cached pages:
  // getNextPageParam reads the pages, so removing one would shorten a full
  // page and hide "Load older" while older rows remain. The server accepts a
  // dismissed row as the cursor, and the next refetch drops it anyway.
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<number>>(() => new Set());
  const notifications = data?.pages.flat().filter((n) => !dismissedIds.has(n.id));

  // The same cache entry as the header bell, so the two never disagree.
  const { data: unread } = useGetUnreadNotificationCount({
    query: { queryKey: getGetUnreadNotificationCountQueryKey() },
  });

  const updatePages = (update: (rows: Notification[]) => Notification[]) =>
    queryClient.setQueryData<Pages>(notificationCentreQueryKey(), (old) =>
      old ? { ...old, pages: old.pages.map(update) } : old,
    );
  const refreshUnreadCount = () =>
    queryClient.invalidateQueries({ queryKey: getGetUnreadNotificationCountQueryKey() });

  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();
  const dismissMutation = useDismissNotification();

  const handleDismiss = (id: number) => {
    dismissMutation.mutate(
      { id },
      {
        onSuccess: () => {
          setDismissedIds((prev) => new Set(prev).add(id));
          refreshUnreadCount();
        },
        onError: (error) => {
          toast({
            title: 'Failed to dismiss notification',
            description: error instanceof Error ? error.message : 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleMarkRead = (id: number) => {
    markReadMutation.mutate(
      { id },
      {
        onSuccess: (updatedNotification) => {
          updatePages((rows) => rows.map((n) => (n.id === id ? updatedNotification : n)));
          refreshUnreadCount();
        },
        onError: (error) => {
          toast({
            title: 'Failed to mark notification',
            description: error instanceof Error ? error.message : 'Please try again.',
            variant: 'destructive',
          });
        }
      }
    );
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
        refreshUnreadCount();
        toast({
          title: 'All notifications marked as read',
          description: 'Your notification list has been cleared.',
        });
      },
      onError: (error) => {
        toast({
          title: 'Failed to mark all notifications',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
      }
    });
  };

  // The server's count covers every page, not only the ones loaded so far.
  const unreadCount = unread?.unreadCount ?? 0;

  const getTypeIcon = (type: Notification['type']) => {
    switch (type) {
      case 'info':
        return Info;
      case 'success':
        return CheckCircle;
      case 'warning':
        return AlertTriangle;
      case 'alert':
        return AlertCircle;
      default:
        return Bell;
    }
  };

  const getTypeColor = (type: Notification['type']) => {
    switch (type) {
      case 'info':
        return 'text-primary bg-primary/10';
      case 'success':
        return 'text-chart-3 bg-chart-3/10';
      case 'warning':
        return 'text-accent bg-accent/10';
      case 'alert':
        return 'text-destructive bg-destructive/10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0 ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'All caught up!'}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button 
            variant="outline" 
            onClick={handleMarkAllRead}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            {markAllReadMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Marking...
              </>
            ) : (
              <>
                <CheckCheck className="mr-2 h-4 w-4" />
                Mark all as read
              </>
            )}
          </Button>
        )}
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !notifications || notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No notifications</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              You're all caught up. We'll notify you when there's something new.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {notifications.map((notification, i) => {
              const TypeIcon = getTypeIcon(notification.type);
              const typeColor = getTypeColor(notification.type);

              return (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.05 }}
                >
                  <Card
                    className={`transition-all hover:shadow-md ${!notification.read ? 'border-l-4 border-l-primary bg-muted/20' : ''}`}
                    data-testid={`card-notification-${notification.id}`}
                  >
                    <CardContent className="flex items-start gap-4 p-4">
                      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${typeColor}`}>
                        <TypeIcon className="h-5 w-5" />
                      </div>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-foreground">
                            {notification.title}
                          </h4>
                          <div className="flex flex-shrink-0 items-center gap-2">
                            {!notification.read && (
                              <Badge variant="secondary" className="text-xs">
                                New
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleDismiss(notification.id)}
                              disabled={dismissMutation.isPending}
                              aria-label="Dismiss notification"
                              data-testid={`button-dismiss-${notification.id}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {notification.message}
                        </p>
                        <div className="flex items-center justify-between gap-4 pt-2">
                          <span className="text-xs text-muted-foreground">
                            {formatDate(notification.createdAt)}
                          </span>
                          <div className="flex items-center gap-3">
                            {notification.actionPath && (
                              <Link
                                href={notification.actionPath}
                                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                data-testid={`link-notification-action-${notification.id}`}
                              >
                                View <ArrowRight className="h-3 w-3" />
                              </Link>
                            )}
                            {!notification.read && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleMarkRead(notification.id)}
                                disabled={markReadMutation.isPending}
                                className="h-7 text-xs"
                                data-testid={`button-mark-read-${notification.id}`}
                              >
                                Mark as read
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="button-load-older-notifications"
              >
                {isFetchingNextPage ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  'Load older notifications'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
