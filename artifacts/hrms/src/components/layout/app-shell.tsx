import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { 
  Building2, 
  LayoutDashboard, 
  Users, 
  Bell, 
  Settings, 
  Search, 
  Menu, 
  X, 
  User, 
  LogOut,
  ChevronDown,
  Building
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetMe, getGetMeQueryKey, useListNotifications, getListNotificationsQueryKey, useListOrganizations, getListOrganizationsQueryKey, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: user, isLoading: userLoading, error: userError } = useGetMe({
    query: { queryKey: getGetMeQueryKey() }
  });

  const { data: notifications } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey() }
  });

  const { data: organizations } = useListOrganizations({
    query: { queryKey: getListOrganizationsQueryKey() }
  });

  const logoutMutation = useLogout();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (userError && 'status' in userError && userError.status === 401) {
      setLocation('/login');
    }
  }, [userError, setLocation]);

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation('/login');
        toast({
          title: 'Logged out successfully',
          description: 'You have been logged out of your account.',
        });
      },
      onError: () => {
        toast({
          title: 'Logout failed',
          description: 'An error occurred while logging out. Please try again.',
          variant: 'destructive',
        });
      }
    });
  };

  const unreadCount = notifications?.filter(n => !n.read).length || 0;
  const currentOrg = organizations?.find(org => org.id === user?.organizationId);

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/organizations', label: 'Organizations', icon: Building },
    { href: '/notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  const userInitials = user ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase() : '?';

  if (userLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r border-sidebar-border bg-sidebar">
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Building2 className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-semibold text-sidebar-foreground font-sans">Enterprise HRMS</h1>
          </div>
        </div>

        {/* Organization Selector */}
        {currentOrg && (
          <div className="border-b border-sidebar-border px-4 py-3">
            <button 
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted"
              data-testid="button-org-selector"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium text-card-foreground truncate">{currentOrg.name}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            </button>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = location === item.href;
              return (
                <li key={item.href}>
                  <Link 
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive 
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground' 
                        : 'text-sidebar-foreground hover:bg-sidebar-border/50'
                    }`}
                    data-testid={`link-nav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="h-5 w-5" />
                    <span>{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <Badge variant="secondary" className="ml-auto h-5 min-w-5 px-1 text-xs">
                        {item.badge}
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User Profile */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <Link href="/profile" className="block text-sm font-medium text-sidebar-foreground hover:underline truncate" data-testid="link-profile">
                {user.firstName} {user.lastName}
              </Link>
              <p className="text-xs text-muted-foreground truncate">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="w-full justify-start gap-2" 
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                    <Building2 className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <h1 className="text-base font-semibold text-sidebar-foreground font-sans">Enterprise HRMS</h1>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} data-testid="button-close-menu">
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {currentOrg && (
                <div className="border-b border-sidebar-border px-4 py-3">
                  <button className="flex w-full items-center justify-between gap-2 rounded-lg border border-sidebar-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium text-card-foreground truncate">{currentOrg.name}</span>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </button>
                </div>
              )}

              <nav className="flex-1 overflow-y-auto px-3 py-4">
                <ul className="space-y-1">
                  {navItems.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <li key={item.href}>
                        <Link 
                          href={item.href}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            isActive 
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground' 
                              : 'text-sidebar-foreground hover:bg-sidebar-border/50'
                          }`}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <item.icon className="h-5 w-5" />
                          <span>{item.label}</span>
                          {item.badge !== undefined && item.badge > 0 && (
                            <Badge variant="secondary" className="ml-auto h-5 min-w-5 px-1 text-xs">
                              {item.badge}
                            </Badge>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div className="border-t border-sidebar-border p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary text-primary-foreground font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <Link href="/profile" className="block text-sm font-medium text-sidebar-foreground hover:underline truncate" onClick={() => setSidebarOpen(false)}>
                      {user.firstName} {user.lastName}
                    </Link>
                    <p className="text-xs text-muted-foreground truncate">{user.role.replace('_', ' ')}</p>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start gap-2" 
                  onClick={handleLogout}
                  disabled={logoutMutation.isPending}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex h-16 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden" 
            onClick={() => setSidebarOpen(true)}
            data-testid="button-open-menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input 
                type="search" 
                placeholder="Search..." 
                className="pl-9 bg-muted/50 border-muted"
                data-testid="input-search"
              />
            </div>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <Link href="/notifications" data-testid="button-notifications">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" />
                )}
              </Button>
            </Link>
            <Link href="/profile" data-testid="button-user-menu">
              <Button variant="ghost" size="icon">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
